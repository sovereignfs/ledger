export const dynamic = 'force-dynamic';

/**
 * The instance asks this before it sends anyone to the app (the manifest's `health`), and a container's health check and CI ask it too. It
 * answers 200 once the server is up; task 1.5 makes it answer 200 only when the database does.
 */
export function GET() {
  return Response.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } });
}
