import { Router, type RequestHandler } from 'express';

import { adminRouter } from './admin';
import { authRouter } from './auth/auth.routes';
import { shopRouter } from './shop';

export function createAppRouter() {
  const router = Router();

  router.use('/auth', authRouter);
  router.use('/admin', adminRouter as RequestHandler);
  router.use(shopRouter);

  // TODO: remove this redirect after adding the home page
  router.get('/', (_req, res) => {
    res.redirect('/products');
  });

  return router;
}
