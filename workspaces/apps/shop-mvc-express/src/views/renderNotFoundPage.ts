import { renderErrorPage } from './renderErrorPage';

interface NotFoundPageOptions {
  path?: string;
}

export function renderNotFoundPage(options: NotFoundPageOptions = {}): string {
  const { path } = options;

  const message = path
    ? `The page "${path}" could not be found.`
    : 'The page you are looking for could not be found.';

  return renderErrorPage({
    message,
    statusCode: 404,
    title: 'Page not found',
  });
}
