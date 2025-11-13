import express from 'express';
import helmet from 'helmet';

import { env } from './env';
import { createAppRouter } from './routes';

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: false })); // Parse HTML form data

  // TODO: Implement later: review existing ones and add other Helmet defaults (noSniff, frameguard, hidePoweredBy, etc.)
  // Security headers via Helmet
  const isProd = env.NODE_ENV === 'production';
  app.use(
    helmet({
      // Enable CSP with strict script policy; allow inline styles for our templates
      contentSecurityPolicy: {
        directives: {
          'base-uri': ["'self'"],
          'frame-ancestors': ["'none'"],
          'object-src': ["'none'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
        },
        useDefaults: true,
      },
      // Only send HSTS in production (requires HTTPS)
      hsts: isProd
        ? {
            includeSubDomains: true,
            maxAge: 60 * 60 * 24 * 365, // 1 year
            preload: false,
          }
        : false,
      // Reasonable privacy default
      referrerPolicy: {
        policy: 'no-referrer',
      },
    }),
  );

  app.use(createAppRouter());
  // TODO: not found middleware

  return app;
}
