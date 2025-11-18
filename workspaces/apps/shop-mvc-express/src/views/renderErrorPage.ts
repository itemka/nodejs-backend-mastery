import escapeHtml from 'escape-html';

export type SafeHtml = string & { __brand: 'SafeHtml' };

interface ErrorPageOptions {
  statusCode: number;
  title: string;
  message: string;
  /**
   * Optional, developer-friendly details (e.g. stack trace) to show in non-production.
   *
   * IMPORTANT: This must be pre-escaped / safe HTML. Do not pass untrusted user input directly.
   * Use `escapeHtml` (or an equivalent encoder) before constructing this value.
   */
  detailsHtml?: SafeHtml | undefined;
}

export function renderErrorPage(options: ErrorPageOptions): string {
  const { detailsHtml, message, statusCode, title } = options;

  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${safeTitle}</title>
      <style>
        :root {
          color-scheme: light dark;
        }
        body {
          font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          margin: 0;
          padding: 0;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: radial-gradient(circle at top, #f5f5f5 0, #e4ebf5 40%, #cfd8e3 100%);
        }
        .card {
          background: white;
          border-radius: 12px;
          box-shadow:
            0 10px 30px rgba(15, 23, 42, 0.15),
            0 0 0 1px rgba(148, 163, 184, 0.2);
          padding: 32px 36px;
          max-width: 640px;
          width: 100%;
          box-sizing: border-box;
        }
        .status {
          font-size: 14px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #6b7280;
        }
        .status span {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border-radius: 999px;
          background: #fee2e2;
          color: #b91c1c;
          margin-right: 8px;
          font-size: 13px;
        }
        h1 {
          margin: 16px 0 8px;
          font-size: 24px;
          color: #111827;
        }
        p {
          margin: 0 0 12px;
          color: #4b5563;
          line-height: 1.6;
        }
        .actions {
          margin-top: 20px;
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
        }
        a.button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 10px 18px;
          border-radius: 999px;
          font-weight: 500;
          text-decoration: none;
          border: 1px solid transparent;
          background: linear-gradient(135deg, #22c55e, #16a34a);
          color: white;
          box-shadow: 0 8px 18px rgba(22, 163, 74, 0.35);
          transition:
            transform 0.15s ease,
            box-shadow 0.15s ease,
            background 0.15s ease;
        }
        a.button:hover {
          transform: translateY(-1px);
          box-shadow: 0 12px 24px rgba(22, 163, 74, 0.45);
          background: linear-gradient(135deg, #16a34a, #15803d);
        }
        a.button.secondary {
          background: white;
          color: #111827;
          border-color: #d1d5db;
          box-shadow: none;
        }
        a.button.secondary:hover {
          background: #f3f4f6;
        }
        .details {
          margin-top: 18px;
          padding: 12px 14px;
          border-radius: 8px;
          background: #f9fafb;
          border: 1px dashed #e5e7eb;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
            monospace;
          font-size: 12px;
          color: #6b7280;
          max-height: 240px;
          overflow: auto;
          white-space: pre-wrap;
        }
        @media (max-width: 640px) {
          .card {
            margin: 16px;
            padding: 24px;
          }
        }
      </style>
    </head>
    <body>
      <main class="card" aria-labelledby="error-title">
        <div class="status">
          <span>${statusCode}</span>
          Error
        </div>
        <h1 id="error-title">${safeTitle}</h1>
        <p>${safeMessage}</p>
        <div class="actions">
          <a href="/" class="button secondary">Go to home</a>
        </div>
        ${
          detailsHtml
            ? `<div class="details" aria-label="Technical details">${detailsHtml}</div>`
            : ''
        }
      </main>
    </body>
    </html>
  `;
}
