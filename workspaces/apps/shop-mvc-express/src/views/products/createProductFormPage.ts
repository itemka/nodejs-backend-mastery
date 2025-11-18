export function createProductFormPage(): string {
  return `
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
        <form action="/products" method="POST">
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
        <a href="/products" class="back-link">← Back to Products</a>
      </div>
    </body>
    </html>
  `;
}
