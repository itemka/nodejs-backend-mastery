import { Router } from 'express';

import * as productsController from '../controllers/products.controller';

export const products = Router();

products.get('/add-product', productsController.getAddProduct);

products.post('/product', productsController.createProduct);

products.get('/', productsController.listProducts);
