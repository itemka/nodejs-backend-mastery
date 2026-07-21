import { Router, type RequestHandler } from 'express';

import { config } from '../config';
import { adminRouter } from './admin';
import { authRouter } from './auth/auth.routes';
import { docsRouter } from './docs.routes';
import { shopRouter } from './shop';

export function createAppRouter() {
  const router = Router();

  router.use('/auth', authRouter);
  router.use('/admin', adminRouter as RequestHandler);

  // The API contract and Swagger UI are development aids: they stay off in
  // production so a deployment never publishes the contract by default.
  if (config.nodeEnv !== 'production') {
    router.use(docsRouter);
  }

  router.use(shopRouter);

  // TODO: remove this redirect after adding the home page
  router.get('/', (_req, res) => {
    res.redirect('/products');
  });

  return router;
}
