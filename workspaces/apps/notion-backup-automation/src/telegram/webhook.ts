import { telegramMessageSchema } from '@workspaces/telegram-contracts';
import { createHash } from 'node:crypto';
import { z } from 'zod';

import type {
  ConfirmedAction,
  MessageFormatOptions,
} from '../adapters/telegram/message-formats.js';
import {
  confirmMessage,
  fixLoginMessage,
  helpMessage,
  noticeMessage,
  parseCallbackData,
  statusMessage,
} from '../adapters/telegram/message-formats.js';
import type { TelegramClient, TelegramMessage } from '../adapters/telegram/telegram-client.js';
import { isPermanentRefusal } from '../adapters/telegram/telegram-client.js';
import { ApplicationError } from '../application/application-error.js';
import type { BackupApplicationService } from '../application/backup-service.js';
import type { BackupJob } from '../domain/job.js';
import { jobIdSchema } from '../domain/naming.js';
import type { BackupPolicy } from '../domain/policy.js';
import type { Stage } from '../domain/statuses.js';
import { isTerminal } from '../domain/statuses.js';
import { jobView } from '../mcp/views.js';
import type { IdGenerator } from '../shared/ids.js';
import type { Logger } from '../shared/logger.js';
import type { CallbackInput } from './updates.js';
import { parseUpdate } from './updates.js';

/** A confirmation button works for 10 minutes. */
export const CONFIRM_TTL_SEC = 10 * 60;

export const TELEGRAM_CANCEL_REASON = 'Cancelled from Telegram';

/** What the webhook remembers between updates. */
export interface TelegramState {
  /** Only completed updates are ignored; a live processing lease remains retryable. */
  claimUpdate(updateId: number): Promise<'busy' | 'claimed' | 'completed'>;
  completeUpdate(updateId: number): Promise<void>;
  readActionReceipt(updateId: number): Promise<string | undefined>;
  saveActionReceipt(updateId: number, receipt: string): Promise<void>;
  bindAction(actionKey: string, fingerprint: string): Promise<boolean>;
  /** A transport failure must not permanently consume an update before it is handled. */
  releaseUpdate(updateId: number): Promise<void>;
  saveConfirmation(nonce: string, value: string, ttlSec: number): Promise<void>;
  /** A lease reserves a pending action without consuming it before a transient failure. */
  claimConfirmation(nonce: string): Promise<string | undefined>;
  completeConfirmation(nonce: string): Promise<void>;
  releaseConfirmation(nonce: string): Promise<void>;
}

/**
 * - `handled`: a message or button from your chat was answered;
 * - `duplicate`: this `update_id` was handled before;
 * - `invalid`: not a Telegram update;
 * - `rejected`: the hub refused a reply for good (a 4xx), so the update is finished unanswered.
 */
export type WebhookOutcome = 'duplicate' | 'handled' | 'invalid' | 'rejected';

export interface TelegramWebhookOptions {
  readonly client: Pick<TelegramClient, 'answerCallbackQuery' | 'removeButtons' | 'sendMessage'>;
  readonly format: MessageFormatOptions;
  readonly ids: Pick<IdGenerator, 'token'>;
  readonly logger: Logger;
  readonly policy: Pick<BackupPolicy, 'maxExportAttempts'>;
  readonly service: Pick<BackupApplicationService, 'cancel' | 'retry' | 'status'>;
  readonly state: TelegramState;
}

const actionReceiptSchema = z.object({
  answer: z.string().optional(),
  removeMessageIds: z.array(z.number().int().positive()),
  reply: telegramMessageSchema.pick({ html: true }),
});

const pendingSchema = z.object({
  action: z.enum(['cancel', 'retryFromScratch']),
  jobId: jobIdSchema,
  /** The message whose button asked; its buttons go once the action is done. */
  messageId: z.number().int().optional(),
});

type Pending = z.infer<typeof pendingSchema>;

const loginServiceSchema = z.enum(['drive', 'google', 'notion']);

/** What a button tap answers with: a short notice on the button, or nothing. */
type Answer = string | undefined;

/**
 * Your messages and button taps, mapped to the same application methods as the MCP tools. The
 * bot shows, retries and cancels jobs; it cannot start a backup or talk to a model. Every
 * button acts on the job's current state, so a stale one changes nothing.
 */
export class TelegramWebhook {
  private readonly client: TelegramWebhookOptions['client'];
  private readonly format: MessageFormatOptions;
  private readonly ids: Pick<IdGenerator, 'token'>;
  private readonly logger: Logger;
  private readonly policy: Pick<BackupPolicy, 'maxExportAttempts'>;
  private readonly service: TelegramWebhookOptions['service'];
  private readonly state: TelegramState;

  constructor(options: TelegramWebhookOptions) {
    this.client = options.client;
    this.format = options.format;
    this.ids = options.ids;
    this.logger = options.logger;
    this.policy = options.policy;
    this.service = options.service;
    this.state = options.state;
  }

  /**
   * A normalized update from the authenticated hub. Explicit application refusals are terminal;
   * storage, scheduling and hub transport failures release the receipt and remain retryable.
   */
  async handle(body: unknown): Promise<WebhookOutcome> {
    const parsed = parseUpdate(body);

    if (parsed.outcome !== 'accepted') {
      this.logger.info(`telegram.${parsed.outcome}`);

      return parsed.outcome;
    }

    const { input, updateId } = parsed;

    const claim = await this.state.claimUpdate(updateId);

    if (claim === 'completed') {
      this.logger.info('telegram.duplicate', { updateId });

      return 'duplicate';
    }

    if (claim === 'busy') {
      throw new Error('Telegram update is being handled');
    }

    try {
      if (input.kind === 'message') {
        await this.guard(() => this.onMessage(input.text));
      } else {
        let answer: Answer;

        await this.guard(async () => {
          const receipt = await this.state.readActionReceipt(updateId);

          if (receipt === undefined) {
            answer = await this.onCallback(input, updateId);
          } else {
            const parsedReceipt = actionReceiptSchema.parse(JSON.parse(receipt) as unknown);

            await this.deliverAction(parsedReceipt);
            answer = parsedReceipt.answer;
          }
        });
        // Only now: after a transient failure the resent update answers with the real notice,
        // and Telegram accepts one answer per tap.
        await this.answer(input, answer);
      }

      this.logger.info('telegram.handled', { kind: input.kind, updateId });

      await this.state.completeUpdate(updateId);

      return 'handled';
    } catch (error) {
      if (!isPermanentRefusal(error)) {
        await this.state.releaseUpdate(updateId);

        throw error;
      }

      // The hub refused a reply for good: a resend would only fail the same way.
      this.logger.warn('telegram.rejected', { code: error.code, kind: input.kind, updateId });

      if (input.kind === 'callback') {
        await this.answer(input);
      }

      await this.state.completeUpdate(updateId);

      return 'rejected';
    }
  }

  /** A refusal is replied with its code and message; anything else is logged and named only. */
  private async guard(run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      if (error instanceof ApplicationError) {
        await this.reply(noticeMessage(`${error.code}: ${error.message}`));

        return;
      }

      if (!isPermanentRefusal(error)) {
        this.logger.error('telegram.failed', { error });
      }

      throw error;
    }
  }

  private async onMessage(text: string): Promise<void> {
    const command = text.trim().split(/\s+/, 1)[0]?.toLowerCase().replace(/@\w+$/, '');

    await (command === '/status' || command === '/backup_status'
      ? this.replyStatus()
      : this.reply(helpMessage()));
  }

  private async onCallback({ data, messageId }: CallbackInput, updateId: number): Promise<Answer> {
    const button = parseCallbackData(data);

    if (button === undefined) {
      return 'Unknown button';
    }

    const { action, target } = button;

    switch (action) {
      case 'cancel': {
        return this.withJob(target, (job) => this.askToConfirm(action, job, messageId));
      }

      case 'confirm': {
        return this.confirm(target, messageId, updateId);
      }

      case 'fixLogin': {
        const service = loginServiceSchema.safeParse(target);

        if (!service.success) {
          return 'Unknown button';
        }

        await this.reply(fixLoginMessage(service.data, this.format));

        return undefined;
      }

      case 'retry': {
        return this.withJob(target, (job, version) =>
          this.retry(job, version, undefined, [messageId], updateId),
        );
      }

      case 'retryFromScratch': {
        return this.withJob(target, (job) => this.askToConfirm(action, job, messageId));
      }

      case 'status': {
        if (target !== '' && !jobIdSchema.safeParse(target).success) {
          return 'Unknown button';
        }

        await this.replyStatus(target === '' ? undefined : target);

        return undefined;
      }
    }
  }

  /** Cancel and Retry from scratch: a confirmation button that works once, for 10 minutes. */
  private async askToConfirm(
    action: ConfirmedAction,
    job: BackupJob,
    messageId: number | undefined,
  ): Promise<Answer> {
    const refusal = action === 'cancel' ? stale(job) : this.retryRefusal(job, 'NOTION_TRIGGER');

    if (refusal !== undefined) {
      return refusal;
    }

    const nonce = this.ids.token();
    const pending: Pending = {
      action,
      jobId: job.id,
      ...(messageId === undefined ? {} : { messageId }),
    };

    await this.state.saveConfirmation(nonce, JSON.stringify(pending), CONFIRM_TTL_SEC);
    await this.reply(confirmMessage(action, job.id, nonce));

    return undefined;
  }

  /** The second tap: the saved action, on the job's state now. */
  private async confirm(
    nonce: string,
    messageId: number | undefined,
    updateId: number,
  ): Promise<Answer> {
    const raw = await this.state.claimConfirmation(nonce);

    if (raw === 'busy') {
      throw new Error('Confirmation is being handled');
    }

    const pending = parsePending(raw);

    if (pending === undefined) {
      if (raw !== undefined) {
        await this.state.completeConfirmation(nonce);
      }

      await this.removeButtons([messageId]);

      return 'This confirmation expired or was used; tap the button on the report again';
    }

    const asked = [messageId, pending.messageId];

    try {
      return await this.withJob(pending.jobId, async (job, version) => {
        if (pending.action === 'retryFromScratch') {
          return this.retry(job, version, 'NOTION_TRIGGER', asked, updateId, nonce);
        }

        const refusal = stale(job);

        if (refusal !== undefined) {
          await this.state.completeConfirmation(nonce);

          return refusal;
        }

        if (!(await this.bindMutation(`confirm-${nonce}`, job, 'cancel', version))) {
          await this.state.completeConfirmation(nonce);

          return 'This action already ran or the job changed; use a fresh button';
        }

        const { job: cancelled } = await this.service.cancel(job.id, TELEGRAM_CANCEL_REASON);
        const receipt = {
          answer: 'Cancelled',
          removeMessageIds: asked.filter((id): id is number => id !== undefined),
          reply: noticeMessage(
            cancelled.status === 'CANCELLED'
              ? `🚫 Job ${cancelled.id} cancelled.`
              : `🚫 Job ${cancelled.id} is cancelled at its next step boundary; a worker holds it now.`,
          ),
        };

        await this.state.saveActionReceipt(updateId, JSON.stringify(receipt));
        await this.state.completeConfirmation(nonce);
        await this.deliverAction(receipt);

        return receipt.answer;
      });
    } catch (error) {
      await (error instanceof ApplicationError
        ? this.state.completeConfirmation(nonce)
        : this.state.releaseConfirmation(nonce));

      throw error;
    }
  }

  private async retry(
    job: BackupJob,
    version: number,
    fromStage: Stage | undefined,
    asked: readonly (number | undefined)[],
    updateId: number,
    confirmationNonce?: string,
  ): Promise<Answer> {
    const refusal = this.retryRefusal(job, fromStage);

    if (refusal !== undefined) {
      if (confirmationNonce !== undefined) {
        await this.state.completeConfirmation(confirmationNonce);
      }

      return refusal;
    }

    const actionKey =
      confirmationNonce === undefined ? `update-${updateId}` : `confirm-${confirmationNonce}`;

    if (!(await this.bindMutation(actionKey, job, `retry-${fromStage ?? 'resume'}`, version))) {
      if (confirmationNonce !== undefined) {
        await this.state.completeConfirmation(confirmationNonce);
      }

      return 'This action already ran or the job changed; use a fresh button';
    }

    const { job: retried } = await this.service.retry(job.id, fromStage);
    const scratch = fromStage === 'NOTION_TRIGGER' ? ' from scratch' : '';
    const receipt = {
      answer: 'Retry queued',
      removeMessageIds: asked.filter((id): id is number => id !== undefined),
      reply: noticeMessage(
        `🔁 Job ${retried.id} retried${scratch}: ${retried.status}. A worker picks it up now.`,
      ),
    };

    await this.state.saveActionReceipt(updateId, JSON.stringify(receipt));

    if (confirmationNonce !== undefined) {
      await this.state.completeConfirmation(confirmationNonce);
    }

    await this.deliverAction(receipt);

    return receipt.answer;
  }

  private async bindMutation(
    actionKey: string,
    job: BackupJob,
    action: string,
    version: number,
  ): Promise<boolean> {
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ action, jobId: job.id, version }))
      .digest('hex');

    return this.state.bindAction(actionKey, fingerprint);
  }

  private async deliverAction(receipt: {
    readonly reply: TelegramMessage;
    readonly removeMessageIds: readonly number[];
  }): Promise<void> {
    await this.reply(receipt.reply);
    await this.removeButtons(receipt.removeMessageIds);
  }

  /** Why a retry would change nothing, read from the job's current state. */
  private retryRefusal(job: BackupJob, fromStage: Stage | undefined): Answer {
    const ended = stale(job);

    if (ended !== undefined) {
      return ended;
    }

    if (job.status !== 'NEEDS_ATTENTION' && job.status !== 'RETRYABLE_FAILURE') {
      return `Job ${job.id} is ${job.status}; there is nothing to retry`;
    }

    if (fromStage === 'NOTION_TRIGGER' && job.exportAttempt >= this.policy.maxExportAttempts) {
      return `Job ${job.id} used all ${this.policy.maxExportAttempts} export attempts`;
    }

    return undefined;
  }

  private async replyStatus(jobId?: string): Promise<void> {
    let found;

    try {
      found = await this.service.status(jobId);
    } catch (error) {
      if (error instanceof ApplicationError && error.code === 'JOB_NOT_FOUND') {
        await this.reply(
          noticeMessage(jobId === undefined ? 'No backup job exists yet.' : `No job ${jobId}.`),
        );

        return;
      }

      throw error;
    }

    const { events, job } = found;

    await this.reply(
      statusMessage(jobView(job, events), {
        ...this.format,
        retryFromScratch: job.exportAttempt < this.policy.maxExportAttempts,
      }),
    );
  }

  /** Runs `act` on the button's job as it is stored now; an unknown ID is a stale button. */
  private async withJob(
    target: string,
    act: (job: BackupJob, version: number) => Promise<Answer>,
  ): Promise<Answer> {
    if (!jobIdSchema.safeParse(target).success) {
      return 'Unknown button';
    }

    const { job, version } = await this.service.status(target);

    return act(job, version);
  }

  private async reply(message: TelegramMessage): Promise<void> {
    await this.client.sendMessage(message);
  }

  /** Best effort: the action is done whether or not the old buttons go. */
  private async removeButtons(messageIds: readonly (number | undefined)[]): Promise<void> {
    for (const messageId of new Set(messageIds)) {
      if (messageId === undefined) {
        continue;
      }

      try {
        await this.client.removeButtons(messageId);
      } catch (error) {
        this.logger.warn('telegram.buttons_not_removed', { error });
      }
    }
  }

  /** Ends the button's spinner; a failure only means Telegram shows it a little longer. */
  private async answer(input: CallbackInput, text?: string): Promise<void> {
    try {
      await this.client.answerCallbackQuery(input.callbackId, text);
    } catch (error) {
      this.logger.warn('telegram.answer_failed', { error });
    }
  }
}

/** A button for a job that ended changes nothing. */
function stale(job: BackupJob): Answer {
  return isTerminal(job.status) ? `Job ${job.id} is already ${job.status}` : undefined;
}

function parsePending(raw: string | undefined): Pending | undefined {
  if (raw === undefined) {
    return undefined;
  }

  try {
    const parsed = pendingSchema.safeParse(JSON.parse(raw));

    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
