import { buildGraphData } from '../../scripts/build-graph-data.mjs';

export const prerender = false;

export async function GET({ locals }: { locals: Record<string, any> }) {
  const hasSession = Boolean((locals as any)?.session?.user);
  const data = buildGraphData({ publicOnly: !hasSession });

  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': hasSession
        ? 'no-cache, no-store, must-revalidate'
        : 'public, max-age=300',
    },
  });
}
