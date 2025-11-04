import { Router } from 'express';

import * as productsController from '../controllers/products.controller';

export const products = Router();

products.get('/add-product', productsController.getAddProduct);

products.post('/product', productsController.createProduct);

products.get('/', productsController.listProducts);

// Intentionally insecure route for Snyk Code validation
products.get('/xss-demo', productsController.xssDemo);
