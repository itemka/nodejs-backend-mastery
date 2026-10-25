import {
  attentionText,
  failureText,
  loginWarningText,
  successText,
} from '../../application/notification-text.js';
import type {
  AttentionNotification,
  FailureNotification,
  LoginWarningNotification,
  Notifier,
  SuccessNotification,
} from '../../application/ports.js';
import type { Logger } from '../../shared/logger.js';

/**
 * One structured log line per notification (`notify.success`, `notify.failure`,
 * `notify.attention`, `notify.login`), with the one-line summary as `text`. Hobby keeps these
 * for an hour; the job events keep the same text.
 */
export class ConsoleNotifier implements Notifier {
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  attention(notification: AttentionNotification): Promise<void> {
    this.logger.warn('notify.attention', {
      code: notification.code,
      jobId: notification.jobId,
      period: notification.period,
      text: attentionText(notification),
    });

    return Promise.resolve();
  }

  failure(notification: FailureNotification): Promise<void> {
    this.logger.error('notify.failure', {
      code: notification.code,
      jobId: notification.jobId,
      period: notification.period,
      text: failureText(notification),
    });

    return Promise.resolve();
  }

  loginWarning(notification: LoginWarningNotification): Promise<void> {
    this.logger.warn('notify.login', {
      kind: notification.kind,
      service: notification.service,
      text: loginWarningText(notification),
    });

    return Promise.resolve();
  }

  success(notification: SuccessNotification): Promise<void> {
    this.logger.info('notify.success', {
      jobId: notification.jobId,
      period: notification.period,
      text: successText(notification),
    });

    return Promise.resolve();
  }
}
