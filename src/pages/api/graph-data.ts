import { buildGraphData } from '../../scripts/build-graph-data.mjs';
import { TENANTS, DEFAULT_TENANT_ID } from '../../lib/tenant/tenants';

export const prerender = false;

export async function GET({ locals }: { locals: Record<string, any> }) {
  const tenant = (locals as any)?.tenant ?? TENANTS[DEFAULT_TENANT_ID];
  const hasSession = Boolean((locals as any)?.session?.user);
  const data = buildGraphData({ publicOnly: !hasSession, tenant: tenant.id });

  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': hasSession
        ? 'no-cache, no-store, must-revalidate'
        : 'public, max-age=300',
    },
  });
}
