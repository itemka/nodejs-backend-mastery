import type { ErrorCode } from '../domain/error-catalog.js';
import { periodFor } from '../domain/period.js';
import { abortable } from '../shared/abortable.js';
import type { Clock } from '../shared/clock.js';
import type { Logger } from '../shared/logger.js';
import type { HealthSnapshot } from './health-snapshot.js';
import { IntegrationError } from './integration-error.js';
import type { HealthProbes, HealthStore } from './ports.js';

export const probeNames = ['drive', 'google', 'notion'] as const;

export type ProbeName = (typeof probeNames)[number];

export function isProbeName(value: string): value is ProbeName {
  return (probeNames as readonly string[]).includes(value);
}

/** A probe's time; the Notion one opens Settings in Chromium (S2: about 35 s on Vercel). */
export const PROBE_BUDGET_MS: Readonly<Record<ProbeName, number>> = {
  drive: 60_000,
  google: 30_000,
  notion: 120_000,
};

/** A budget that ran out is the service being slow, not access being lost. */
const PROBE_TIMEOUT_CODE: Readonly<Record<ProbeName, ErrorCode>> = {
  drive: 'DRIVE_UNAVAILABLE',
  google: 'GMAIL_UNAVAILABLE',
  notion: 'NOTION_UNAVAILABLE',
};

type NotionState = NonNullable<HealthSnapshot['notionSession']>['state'];

/** The answer to `?probe=`: content-free, as `backup_health` shows it. */
export type ProbeReport =
  | {
      readonly authCookieExpiresAt?: string;
      readonly exportDialog: 'in_progress' | 'ready';
      readonly notionSession: 'valid';
      readonly ok: true;
      readonly probe: 'notion';
    }
  | {
      readonly code: ErrorCode;
      readonly notionSession?: NotionState;
      readonly ok: false;
      readonly probe: ProbeName;
    }
  | { readonly mode: 'app-owned' | 'existing'; readonly ok: true; readonly probe: 'drive' }
  | { readonly ok: true; readonly probe: 'google'; readonly scopes: readonly string[] };

export interface ProbeRunnerOptions {
  readonly clock: Clock;
  readonly health: HealthStore;
  readonly logger: Logger;
  /** The Notion probe needs the browser, so `/oauth` runs without it. */
  readonly probes: Partial<Pick<HealthProbes, 'notion'>> & Pick<HealthProbes, 'drive' | 'google'>;
  /** `BACKUP_TIME_ZONE`: the period whose year folder the Drive probe resolves. */
  readonly timeZone: string;
}

/**
 * One dependency check within its budget, recorded in `health` as `backup_health` shows it: the
 * daily cron's probes, and the Google and Drive checks after a phone re-login.
 */
export class ProbeRunner {
  private readonly options: ProbeRunnerOptions;

  constructor(options: ProbeRunnerOptions) {
    this.options = options;
  }

  /**
   * One probe, recorded in `health`; `?probe=` runs only this. A probe's own failure is its
   * result; failing to record it (Redis) throws.
   */
  async probe(name: ProbeName): Promise<ProbeReport> {
    const checkedAt = this.options.clock.now().toISOString();
    const signal = AbortSignal.timeout(PROBE_BUDGET_MS[name]);
    let report: ProbeReport;

    try {
      report = await this.runProbe(name, signal);
    } catch (error) {
      const code = probeCode(error, name, signal);

      this.options.logger.warn('cron.probe.failed', { code, probe: name });
      report =
        name === 'notion'
          ? { code, notionSession: notionStateFor(code), ok: false, probe: name }
          : { code, ok: false, probe: name };
    }

    await this.record(report, checkedAt);

    return report;
  }

  /** The probe's result in its `health` field: the pass's facts, or the failure's code. */
  private async record(report: ProbeReport, checkedAt: string): Promise<void> {
    const { health } = this.options;

    if (!report.ok) {
      const { code } = report;

      switch (report.probe) {
        case 'drive': {
          await health.write('driveRoot', { checkedAt, code, ok: false });

          return;
        }

        case 'google': {
          await health.write('google', { checkedAt, code, scopes: [], tokenOk: false });

          return;
        }

        case 'notion': {
          await health.write('notionSession', { checkedAt, code, state: notionStateFor(code) });

          return;
        }
      }
    }

    switch (report.probe) {
      case 'drive': {
        await health.write('driveRoot', { checkedAt, mode: report.mode, ok: true });

        return;
      }

      case 'google': {
        await health.write('google', { checkedAt, scopes: [...report.scopes], tokenOk: true });

        return;
      }

      case 'notion': {
        await health.write('notionSession', {
          checkedAt,
          exportDialog: report.exportDialog,
          state: 'valid',
          ...(report.authCookieExpiresAt === undefined
            ? {}
            : { authCookieExpiresAt: report.authCookieExpiresAt }),
        });
      }
    }
  }

  /** The probe itself, within its budget; a failure throws. */
  private async runProbe(name: ProbeName, signal: AbortSignal): Promise<ProbeReport> {
    const { clock, probes, timeZone } = this.options;

    switch (name) {
      case 'drive': {
        const { mode } = await abortable(
          probes.drive(periodFor(clock.now(), timeZone), signal),
          signal,
        );

        return { mode, ok: true, probe: name };
      }

      case 'google': {
        const { scopes } = await abortable(probes.google(signal), signal);

        return { ok: true, probe: name, scopes };
      }

      case 'notion': {
        if (probes.notion === undefined) {
          throw new Error('This function has no Notion probe');
        }

        const result = await abortable(probes.notion(signal), signal);

        return { ...result, notionSession: 'valid', ok: true, probe: name };
      }
    }
  }
}

function probeCode(error: unknown, name: ProbeName, signal: AbortSignal): ErrorCode {
  if (error instanceof IntegrationError) {
    return error.code;
  }

  return signal.aborted ? PROBE_TIMEOUT_CODE[name] : 'UNKNOWN_ERROR';
}

function notionStateFor(code: ErrorCode): NotionState {
  switch (code) {
    case 'NOTION_INTERACTIVE_CHALLENGE': {
      return 'challenge';
    }

    case 'NOTION_SESSION_EXPIRED': {
      return 'expired';
    }

    default: {
      return 'error';
    }
  }
}
