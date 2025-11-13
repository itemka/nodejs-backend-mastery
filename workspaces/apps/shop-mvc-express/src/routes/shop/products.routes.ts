import { Router } from 'express';

import {
  renderCreateProductForm,
  createProduct,
  getProducts,
} from '../../controllers/products.controller';

export const productsRouter = Router();

productsRouter.get('/new', renderCreateProductForm);

productsRouter.post('/', createProduct);

productsRouter.get('/', getProducts);
