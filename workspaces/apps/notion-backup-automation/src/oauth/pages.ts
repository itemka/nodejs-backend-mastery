/*
 * The pages a person sees during a phone re-login: plain outcomes, in fixed text only.
 */

/** No cache, no framing (clickjacking), no script, no referrer. */
const pageHeaders = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  'Content-Type': 'text/html; charset=utf-8',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
} as const;

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** An outcome in plain words; `paragraphs` are fixed text, escaped all the same. */
export function messagePage(status: number, title: string, ...paragraphs: string[]): Response {
  const document = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem;line-height:1.5}</style></head>
<body>
<h1>${escapeHtml(title)}</h1>
${paragraphs.map((text) => `<p>${escapeHtml(text)}</p>`).join('\n')}
</body>
</html>
`;

  return new Response(document, { headers: pageHeaders, status });
}
