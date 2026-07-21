import * as ui from '@workspaces/cli-output';
import escapeHtml from 'escape-html';
import type { Request, Response, NextFunction } from 'express';

import type { Product } from '@/models/product';
import { createProductSchema } from '@/schemas/product.schema';
import { generateId } from '@/utils/id';
import { createProductFormPage } from '@/views/products/createProductFormPage';
import { createProductValidationErrorPage } from '@/views/products/createProductValidationErrorPage';
import { productsPage, type ProductListItemViewModel } from '@/views/products/productsPage';
import type { SafeHtml } from '@/views/safeHtml';

// TODO: In-memory store for products (replace with DB later)
const products: Product[] = [];

export function renderCreateProductForm(_req: Request, res: Response) {
  res.type('html').end(createProductFormPage());
}

export function createProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const result = createProductSchema.safeParse(req.body);

    if (!result.success) {
      const errorMessages = result.error.issues.map((issue) => issue.message).join(', ');
      const safeErrorMessagesHtml = escapeHtml(errorMessages) as SafeHtml;

      return res
        .status(400)
        .type('html')
        .end(createProductValidationErrorPage(safeErrorMessagesHtml));
    }

    const product: Product = {
      id: generateId(),
      title: result.data.title,
    };

    products.push(product);

    console.log(ui.success('Product created:'), product);
    console.log(ui.muted('All products:'), products);

    res.redirect('/products');
  } catch (error) {
    next(error);
  }
}

export function getProducts(_req: Request, res: Response) {
  res.type('html').end(
    productsPage({
      products: products.map((product) => toProductListItemViewModel(product)),
    }),
  );
}

function toProductListItemViewModel(product: Product): ProductListItemViewModel {
  return {
    id: product.id,
    titleHtml: escapeHtml(product.title) as SafeHtml,
  };
}
