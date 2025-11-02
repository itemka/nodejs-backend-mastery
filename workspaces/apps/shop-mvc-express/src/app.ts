import express from 'express';

import { routes } from './routes';

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: false })); // Parse HTML form data

  app.use(routes);
  // TODO: not found middleware

  return app;
}
