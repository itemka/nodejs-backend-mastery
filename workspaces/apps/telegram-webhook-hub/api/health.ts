export function GET(): Response {
  return Response.json(
    { ok: true, service: 'telegram-webhook-hub' },
    { headers: { 'cache-control': 'no-store' } },
  );
}
