import escapeHtml from 'escape-html';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

import { generateId } from '@/utils/id';

interface Product {
  id: string;
  title: string;
}

// TODO: In-memory store for products (replace with DB later)
const products: Product[] = [];

const createProductSchema = z.object({
  title: z.string().min(1, 'Title is required').max(100, 'Title is too long'),
});

/**
 * GET /add-product
 * Renders the add product form
 */
export function getAddProduct(_req: Request, res: Response) {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Add Product</title>
      <style>
        body {
          font-family: system-ui, -apple-system, sans-serif;
          max-width: 600px;
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
        form {
          margin-top: 20px;
        }
        label {
          display: block;
          margin-bottom: 8px;
          font-weight: 500;
          color: #555;
        }
        input[type="text"] {
          width: 100%;
          padding: 10px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 16px;
          box-sizing: border-box;
        }
        input[type="text"]:focus {
          outline: none;
          border-color: #4CAF50;
        }
        button {
          margin-top: 15px;
          padding: 12px 24px;
          background-color: #4CAF50;
          color: white;
          border: none;
          border-radius: 4px;
          font-size: 16px;
          cursor: pointer;
          transition: background-color 0.3s;
        }
        button:hover {
          background-color: #45a049;
        }
        .back-link {
          display: inline-block;
          margin-top: 15px;
          color: #666;
          text-decoration: none;
        }
        .back-link:hover {
          text-decoration: underline;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Add Product</h1>
        <form action="/product" method="POST">
          <label for="title">Product Title</label>
          <input 
            type="text" 
            id="title" 
            name="title" 
            placeholder="Enter product title"
            required
            autofocus
          />
          <button type="submit">Add Product</button>
        </form>
        <a href="/" class="back-link">← Back to Home</a>
      </div>
    </body>
    </html>
  `);
}

/**
 * POST /product
 * Handles product creation
 */
export function createProduct(req: Request, res: Response, next: NextFunction) {
  try {
    const result = createProductSchema.safeParse(req.body);

    if (!result.success) {
      const errorMessages = result.error.issues.map((issue) => issue.message).join(', ');

      return res.status(400).send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Error</title>
          <style>
            body {
              font-family: system-ui, -apple-system, sans-serif;
              max-width: 600px;
              margin: 50px auto;
              padding: 20px;
            }
            .error {
              background: #fee;
              border: 1px solid #fcc;
              border-radius: 4px;
              padding: 20px;
              color: #c33;
            }
            a {
              display: inline-block;
              margin-top: 15px;
              color: #666;
            }
          </style>
        </head>
        <body>
          <div class="error">
            <h2>Validation Error</h2>
            <p>${errorMessages}</p>
          </div>
          <a href="/add-product">← Go back</a>
        </body>
        </html>
      `);
    }

    const product: Product = {
      id: generateId(),
      title: result.data.title,
    };

    products.push(product);

    console.log('Product created:', product);
    console.log('All products:', products);

    res.redirect('/');
  } catch (error) {
    next(error);
  }
}

/**
 * GET /
 * Displays list of products
 */
export function listProducts(_req: Request, res: Response) {
  res.send(`
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
        <a href="/add-product" class="add-btn">+ Add New Product</a>
        
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
  `);
}

const QuerySchema = z.object({ q: z.string().max(200).trim().optional() });

/**
 * GET /xss-demo
 * Intentionally insecure: echoes unescaped user input to HTML.
 * This exists only to trigger Snyk Code PR checks.
 */
export function xssDemo(req: Request, res: Response) {
  const { q: userInput = '' } = QuerySchema.parse(req.query);

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>XSS Demo</title>
      <style>
        body { font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
        .container { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        input { padding: 8px; width: 100%; box-sizing: border-box; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>XSS Demo</h1>
        <form method="GET" action="/xss-demo">
          <label for="q">Query (unsafe)</label>
          <input id="q" name="q" placeholder="Try: &lt;img src=x onerror=alert(1)&gt;" />
          <button type="submit">Submit</button>
        </form>
        <h2>Result</h2>
        <div>${escapeHtml(userInput)}</div>
        <a href="/">← Back to Home</a>
      </div>
    </body>
    </html>
  `);
}
