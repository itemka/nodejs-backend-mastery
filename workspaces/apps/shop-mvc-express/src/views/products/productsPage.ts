import escapeHtml from 'escape-html';

import type { Product } from '@/models/product';

interface ProductsPageOptions {
  products: Product[];
}

export function productsPage(options: ProductsPageOptions): string {
  const { products } = options;

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Products</title>
      <style>
        body {
          font-family: system-ui, -apple-system, sans-serif;
          max-width: 800px;
          margin: 50px auto;
          padding: 20px;
          background-color: #f5f5f5;
        }
        .container {
          background: white;
          padding: 30px;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 {
          color: #333;
          margin-top: 0;
        }
        .add-btn {
          display: inline-block;
          padding: 12px 24px;
          background-color: #4CAF50;
          color: white;
          text-decoration: none;
          border-radius: 4px;
          margin: 20px 0;
          transition: background-color 0.3s;
        }
        .add-btn:hover {
          background-color: #45a049;
        }
        .products-list {
          list-style: none;
          padding: 0;
        }
        .product-item {
          padding: 15px;
          border: 1px solid #eee;
          border-radius: 4px;
          margin-bottom: 10px;
          background: #fafafa;
        }
        .product-item:hover {
          background: #f0f0f0;
        }
        .empty-state {
          text-align: center;
          padding: 40px;
          color: #999;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Shop Products</h1>
        <a href="/products/new" class="add-btn">+ Add New Product</a>
        ${
          products.length === 0
            ? '<div class="empty-state">No products yet. Add your first product!</div>'
            : `
              <ul class="products-list">
                ${products
                  .map(
                    (p) => `
                  <li class="product-item">
                    <strong>${escapeHtml(p.title)}</strong>
                  </li>
                `,
                  )
                  .join('')}
              </ul>
            `
        }
      </div>
    </body>
    </html>
  `;
}
