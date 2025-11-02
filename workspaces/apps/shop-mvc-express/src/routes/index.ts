import { Router } from 'express';

import { products } from './products';

export const routes = Router();

routes.use(products);
