import escapeHtml from 'escape-html';

export function createProductValidationErrorPage(errorMessages: string): string {
  const safeMessages = escapeHtml(errorMessages);

  return `
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
        <p>${safeMessages}</p>
      </div>
      <a href="/products/new">← Go back</a>
    </body>
    </html>
  `;
}
