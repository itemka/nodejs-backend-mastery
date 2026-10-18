import { IntegrationError } from '../../application/integration-error.js';
import type {
  ExportEmailFinder,
  ExportEmailRejection,
  ExportEmailSearch,
  ExportEmailSearchResult,
} from '../../application/ports.js';
import type { Logger } from '../../shared/logger.js';
import { SecretValue } from '../../shared/secret-value.js';
import { GoogleApiError } from '../google/google-api-client.js';
import {
  checkExportEmail,
  exportEmailQuery,
  extractDownloadLink,
  SEARCH_SKEW_MS,
} from './export-email-parser.js';
import type { GmailApi } from './gmail-api.js';
import type { GmailMessage } from './gmail-schemas.js';

export interface GmailExportEmailFinderOptions {
  gmail: GmailApi;
  /** Logs message IDs, verdicts and rejection reasons only: never a link, subject or body. */
  logger: Logger;
  /** How many search hits are inspected; Notion sends one email per export. */
  maxResults?: number;
}

/** `ExportEmailFinder` over Gmail REST (`gmail.readonly`). */
export class GmailExportEmailFinder implements ExportEmailFinder {
  private readonly gmail: GmailApi;
  private readonly logger: Logger;
  private readonly maxResults: number;

  constructor({ gmail, logger, maxResults = 10 }: GmailExportEmailFinderOptions) {
    this.gmail = gmail;
    this.logger = logger;
    this.maxResults = maxResults;
  }

  /**
   * The newest hit that passes every trust check decides: found when it has exactly one
   * allowed download link, `EMAIL_UNRECOGNIZED` when it does not.
   */
  async findReadyEmail({
    excludeIds,
    requestedAfter,
  }: ExportEmailSearch): Promise<ExportEmailSearchResult> {
    const notBefore = new Date(requestedAfter.getTime() - SEARCH_SKEW_MS);
    const ids = await this.gmail.listMessageIds(exportEmailQuery(notBefore), this.maxResults);
    const messages: GmailMessage[] = [];

    for (const id of ids) {
      messages.push(await this.gmail.getMessage(id));
    }

    messages.sort((a, b) => Number(b.internalDate) - Number(a.internalDate));

    const rejected: Partial<Record<ExportEmailRejection, number>> = {};

    for (const message of messages) {
      const rejection = checkExportEmail(message, { excludeIds, notBefore });

      if (rejection !== undefined) {
        rejected[rejection] = (rejected[rejection] ?? 0) + 1;
        this.logger.info('gmail.export_email.rejected', { messageId: message.id, rejection });
        continue;
      }

      this.requireLink(message);

      const receivedAt = new Date(Number(message.internalDate)).toISOString();

      this.logger.info('gmail.export_email.found', { messageId: message.id, receivedAt });

      return { email: { messageId: message.id, receivedAt }, status: 'found' };
    }

    this.logger.info('gmail.export_email.not_found', { hits: messages.length, rejected });

    return { rejected, status: 'not_found' };
  }

  /** Re-reads the email and re-runs the trust checks; the job already owns the email. */
  async getDownloadLink(messageId: string): Promise<SecretValue<string>> {
    let message: GmailMessage;

    try {
      message = await this.gmail.getMessage(messageId);
    } catch (error) {
      if (error instanceof GoogleApiError && error.status === 404) {
        throw new IntegrationError('EMAIL_UNRECOGNIZED', 'The export email no longer exists');
      }

      throw error;
    }

    const rejection = checkExportEmail(message, { excludeIds: [], notBefore: new Date(0) });

    if (rejection !== undefined) {
      this.logger.warn('gmail.export_email.rejected', { messageId, rejection });

      throw new IntegrationError(
        'EMAIL_UNRECOGNIZED',
        `The export email failed a trust check (${rejection})`,
      );
    }

    return new SecretValue(this.requireLink(message));
  }

  private requireLink(message: GmailMessage): string {
    const result = extractDownloadLink(message);

    if (result.ok) {
      return result.link;
    }

    this.logger.warn('gmail.export_email.unrecognized', {
      messageId: message.id,
      problem: result.problem,
    });

    throw new IntegrationError(
      'EMAIL_UNRECOGNIZED',
      `The export email has no single allowed download link (${result.problem})`,
    );
  }
}
