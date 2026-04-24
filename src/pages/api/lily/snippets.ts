import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import {
  createSupabaseServerClient,
  ensureDbUserFromSession,
  json,
} from '../../../lib/forum-server';

const SNIPPETS_DIR = path.join(process.cwd(), 'public', 'lily', 'snippets');

function ensureSnippetsDir() {
  if (!fs.existsSync(SNIPPETS_DIR)) {
    fs.mkdirSync(SNIPPETS_DIR, { recursive: true });
  }
}

// GET /api/lily/snippets
export const GET: APIRoute = async () => {
  try {
    ensureSnippetsDir();
    const files = fs.readdirSync(SNIPPETS_DIR);
    const snippets = files
      .filter((file) => file.endsWith('.ly') || file.endsWith('.txt') || file.endsWith('.md'))
      .sort();
    return json({ snippets });
  } catch (error: any) {
    return json({ error: error.message }, 500);
  }
};

// POST /api/lily/snippets
export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const supabase = createSupabaseServerClient();
  const user = await ensureDbUserFromSession(supabase, session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  try {
    const body = await request.json();
    let name = String(body?.name || '').trim();
    const code = String(body?.code || '');

    if (!name) return json({ error: 'Name is required' }, 400);

    // Sanitize filename but preserve dots for extensions
    const ext = path.extname(name).toLowerCase();
    const base = path.basename(name, ext).replace(/[^a-zA-Z0-9_.-]/g, '-');
    
    if (ext === '.md' || ext === '.ly' || ext === '.txt') {
      name = base + ext;
    } else {
      name = base + '.md';
    }

    ensureSnippetsDir();
    const filePath = path.join(SNIPPETS_DIR, name);
    fs.writeFileSync(filePath, code, 'utf8');

    return json({ success: true, name });
  } catch (error: any) {
    return json({ error: error.message }, 500);
  }
};

// DELETE /api/lily/snippets?name=...
export const DELETE: APIRoute = async ({ url, locals }) => {
  const session = (locals as any).session;
  const supabase = createSupabaseServerClient();
  const user = await ensureDbUserFromSession(supabase, session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  try {
    const name = url.searchParams.get('name');
    if (!name) return json({ error: 'Name is required' }, 400);

    // Sanitize
    const safeName = name.replace(/[^a-zA-Z0-9_.-]/g, '');
    if (!safeName) return json({ error: 'Invalid name' }, 400);

    const filePath = path.join(SNIPPETS_DIR, safeName);
    if (!filePath.startsWith(SNIPPETS_DIR)) {
      return json({ error: 'Invalid path' }, 400); // Directory traversal check
    }

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    return json({ success: true });
  } catch (error: any) {
    return json({ error: error.message }, 500);
  }
};
