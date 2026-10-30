import type {
  AttentionNotification,
  FailureNotification,
  LateEmailNotification,
  LoginWarningNotification,
  Notifier,
  SuccessNotification,
} from '../../application/ports.js';
import type { Logger } from '../../shared/logger.js';

export interface NamedNotifier {
  /** `console` or `telegram`: what `notify.failed` names. */
  readonly name: string;
  readonly notifier: Notifier;
}

type NotificationKind = 'attention' | 'failure' | 'lateEmail' | 'loginWarning' | 'success';

/**
 * Fans each notification out to every notifier at once. A notifier that fails is logged as
 * `notify.failed` with its name and error code, never its message; nothing here throws, so no
 * notification fails a tick or the cron run.
 */
export class CompositeNotifier implements Notifier {
  private readonly logger: Logger;
  private readonly notifiers: readonly NamedNotifier[];

  constructor(notifiers: readonly NamedNotifier[], logger: Logger) {
    this.logger = logger;
    this.notifiers = notifiers;
  }

  attention(notification: AttentionNotification): Promise<void> {
    return this.fanOut('attention', (notifier) => notifier.attention(notification));
  }

  failure(notification: FailureNotification): Promise<void> {
    return this.fanOut('failure', (notifier) => notifier.failure(notification));
  }

  lateEmail(notification: LateEmailNotification): Promise<void> {
    return this.fanOut('lateEmail', (notifier) => notifier.lateEmail(notification));
  }

  loginWarning(notification: LoginWarningNotification): Promise<void> {
    return this.fanOut('loginWarning', (notifier) => notifier.loginWarning(notification));
  }

  success(notification: SuccessNotification): Promise<void> {
    return this.fanOut('success', (notifier) => notifier.success(notification));
  }

  private async fanOut(
    kind: NotificationKind,
    deliver: (notifier: Notifier) => Promise<void>,
  ): Promise<void> {
    await Promise.all(
      this.notifiers.map(async ({ name, notifier }) => {
        try {
          await deliver(notifier);
        } catch (error) {
          this.logger.warn('notify.failed', { code: failureCode(error), kind, notifier: name });
        }
      }),
    );
  }
}

/** A `TelegramApiError`'s `telegram_<error_code>`, another error's code, or its name. */
function failureCode(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'unknown';
  }

  const { code } = error as Error & { code?: unknown };

  return typeof code === 'string' || typeof code === 'number' ? String(code) : error.name;
}
