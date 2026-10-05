/**
 * MeterSahi? — delete-account Edge Function
 *
 * Deleting a user from auth.users requires the service-role key, which
 * must never be shipped to the browser. The browser therefore calls this
 * function with its own access token; the function verifies that token,
 * then deletes exactly the user it belongs to — a caller can never name
 * someone else's id.
 *
 * The user's data goes with them via the `on delete cascade` foreign
 * keys added in supabase/schema/accounts.sql (profiles,
 * fare_calculations.user_id, vehicle_reports.user_id). Anonymous rows,
 * which carry a NULL user_id, are untouched.
 *
 * Deploy:
 *   supabase functions deploy delete-account
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

const ALLOWED_ORIGINS = [
  'https://metersahi.in',
  'https://www.metersahi.in',
  'http://localhost:4321',
];

function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin');

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, origin);
  }

  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return json({ error: 'Missing bearer token' }, 401, origin);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Function is misconfigured' }, 500, origin);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Identify the caller from their own token. The id is never taken
  // from the request body, so one user cannot delete another.
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return json({ error: 'Invalid or expired session' }, 401, origin);
  }

  const userId = userData.user.id;

  // Belt and braces: the cascades should clear these, but deleting them
  // explicitly means a missing FK (e.g. the migration only half-applied)
  // can't leave orphaned personal data behind.
  await admin.from('vehicle_reports').delete().eq('user_id', userId);
  await admin.from('fare_calculations').delete().eq('user_id', userId);
  await admin.from('profiles').delete().eq('id', userId);

  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) {
    return json({ error: delErr.message }, 500, origin);
  }

  return json({ ok: true, deleted: userId }, 200, origin);
});
