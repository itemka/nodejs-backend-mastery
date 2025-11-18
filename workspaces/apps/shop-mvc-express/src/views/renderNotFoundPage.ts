import { renderErrorPage } from './renderErrorPage';

interface NotFoundPageOptions {
  path?: string;
  /**
   * Optional custom message to display for this 404.
   * If omitted, a generic message based on the path will be used.
   */
  message?: string;
}

export function renderNotFoundPage(options: NotFoundPageOptions = {}): string {
  const { message: overrideMessage, path } = options;

  const message =
    overrideMessage ??
    (path
      ? `The page "${path}" could not be found.`
      : 'The page you are looking for could not be found.');

  return renderErrorPage({
    message,
    statusCode: 404,
    title: 'Page not found',
  });
}
