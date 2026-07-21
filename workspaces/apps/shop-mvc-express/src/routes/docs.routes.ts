import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';

import { openApiDocument } from '../openapi/document';

// Strict routing keeps `/docs` and `/docs/` distinct so the redirect below
// cannot loop. Swagger UI's assets are referenced relatively (`./swagger-ui.css`),
// so the page must be served from the trailing-slash form to resolve them
// under `/docs/` instead of the app root.
export const docsRouter = Router({ strict: true });

docsRouter.get('/openapi.json', (_req, res) => {
  res.json(openApiDocument);
});

docsRouter.get('/docs', (_req, res) => {
  res.redirect(302, '/docs/');
});

docsRouter.use('/docs', swaggerUi.serveFiles(openApiDocument), swaggerUi.setup(openApiDocument));
