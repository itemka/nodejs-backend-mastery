import { Router } from 'express';

import { productsRouter } from './products.routes';

export const shopRouter = Router();

shopRouter.use('/products', productsRouter);
