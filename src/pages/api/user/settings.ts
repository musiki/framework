import type { APIRoute } from 'astro';
import { getSession } from 'auth-astro/server';
import { createSupabaseServerClient } from '../../../lib/forum-server';
import { resolveUserIdByEmail } from '../../../lib/user-email';

export const POST: APIRoute = async ({ request }) => {
  const session = (await getSession(request)) as any;
  const user = session?.user;

  if (!user?.email) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 });
  }

  try {
    const body = await request.json();
    const nextSettings = body?.settings || {};

    const supabase = createSupabaseServerClient();
    const normalizedEmail = String(user.email).toLowerCase().trim();
    
    // Resolve user ID using existing multi-email logic
    const userId = await resolveUserIdByEmail(supabase, normalizedEmail).catch(() => null);
    
    if (!userId) {
      // Fallback to direct email lookup if not in UserEmail table yet
      const { data: directUser } = await supabase
        .from('User')
        .select('id, settings')
        .ilike('email', normalizedEmail)
        .maybeSingle();
      
      if (!directUser) {
        return new Response(JSON.stringify({ error: 'User not found in DB' }), { status: 404 });
      }

      const mergedSettings = { ...(directUser.settings || {}), ...nextSettings };
      const { error: updateError } = await supabase
        .from('User')
        .update({ settings: mergedSettings, updatedAt: new Date() })
        .eq('id', directUser.id);
      
      if (updateError) throw updateError;
    } else {
      // Fetch current settings to merge
      const { data: currentUser } = await supabase
        .from('User')
        .select('settings')
        .eq('id', userId)
        .single();

      const mergedSettings = { ...(currentUser?.settings || {}), ...nextSettings };
      const { error: updateError } = await supabase
        .from('User')
        .update({ settings: mergedSettings, updatedAt: new Date() })
        .eq('id', userId);
      
      if (updateError) throw updateError;
    }

    return new Response(JSON.stringify({ success: true }), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    console.error('Error updating user settings:', error);
    return new Response(JSON.stringify({ error: error?.message || 'Failed to update settings' }), { status: 500 });
  }
};
