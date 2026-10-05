/**
 * Tests for the accounts feature: sign-in/up, dashboard, deletion.
 *
 * These run without a browser or network. auth.js is executed in a vm
 * with a stubbed window/document so its public surface is checked for
 * real rather than grepped, and the two helpers app.js uses to stamp
 * rows are executed directly against fake sessions.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf-8');

let authJs, appJs, accountJs, accountAstro, sql, edgeFn, accountHtml;

beforeAll(() => {
  authJs = read('public/auth.js');
  appJs = read('public/app.js');
  accountJs = read('public/account.js');
  accountAstro = read('src/pages/account.astro');
  sql = read('supabase/schema/accounts.sql');
  edgeFn = read('supabase/functions/delete-account/index.ts');
  const built = resolve(root, 'dist/account/index.html');
  if (!existsSync(built)) throw new Error('dist/ not built. Run `npm run build` first.');
  accountHtml = readFileSync(built, 'utf-8');
});

/* ─────────────────────────────────────────────
   auth.js public surface — executed, not grepped
   ───────────────────────────────────────────── */
function loadAuth() {
  const win = { location: { origin: 'https://metersahi.in', href: '' } };
  const doc = {
    // 'loading' keeps the module from auto-calling ready(), which would
    // try to import() from the CDN. We only want the API surface here.
    readyState: 'loading',
    addEventListener() {},
  };
  const ctx = vm.createContext({
    window: win, document: doc, console,
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
  });
  vm.runInContext(authJs, ctx);
  return win.MSAuth;
}

describe('auth.js exposes the account API', () => {
  const expected = [
    'ready', 'getSession', 'getUser', 'isSignedIn', 'onChange',
    'signInWithProvider', 'signInWithPassword', 'signUpWithPassword',
    'sendPasswordReset', 'updatePassword', 'signOut',
    'fetchProfile', 'fetchSummary', 'fetchTrips', 'fetchReports',
    'deleteAccount',
  ];

  it('defines window.MSAuth', () => {
    expect(loadAuth()).toBeTypeOf('object');
  });

  it.each(expected)('exposes %s()', (name) => {
    expect(loadAuth()[name]).toBeTypeOf('function');
  });

  it('reports signed-out state before any session exists', () => {
    const a = loadAuth();
    expect(a.isSignedIn()).toBe(false);
    expect(a.getUser()).toBe(null);
  });

  it('rejects deleteAccount when signed out instead of calling the function', () => {
    return expect(loadAuth().deleteAccount()).rejects.toThrow(/not signed in/i);
  });

  it('supports both chosen OAuth providers', () => {
    expect(authJs).toContain("'google'");
    expect(accountJs).toContain("signInWithProvider('google')");
    expect(accountJs).toContain("signInWithProvider('facebook')");
  });

  it('offers email/password sign-up as well as OAuth', () => {
    expect(authJs).toMatch(/signUpWithPassword/);
    expect(authJs).toMatch(/signInWithPassword/);
  });

  it('never embeds a service-role key in client code', () => {
    for (const src of [authJs, accountJs, appJs]) {
      expect(src).not.toMatch(/service_role/i);
      expect(src).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    }
  });
});

/* ─────────────────────────────────────────────
   app.js: rows are stamped only when signed in
   ───────────────────────────────────────────── */
function loadInsertHelpers(session) {
  const start = appJs.indexOf('function currentUserId');
  // End at the closing brace of supabaseWriteHeaders, not at the next
  // comment banner — anything beyond it needs CITIES and the DOM.
  const fnStart = appJs.indexOf('function supabaseWriteHeaders', start);
  const end = appJs.indexOf('\n}', fnStart) + 2;
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const src = appJs.slice(start, end);
  const ctx = vm.createContext({
    window: { MSAuth: session ? {
      getUser: () => session.user,
      getSession: () => session,
    } : undefined },
    SUPABASE_ANON_KEY: 'anon-key',
  });
  vm.runInContext(src + '\n;({ currentUserId, supabaseWriteHeaders })', ctx);
  return vm.runInContext('({ currentUserId, supabaseWriteHeaders })', ctx);
}

describe('fare and report inserts stay anonymous unless signed in', () => {
  const session = { access_token: 'user-token', user: { id: 'user-123' } };

  it('user_id is null when signed out', () => {
    expect(loadInsertHelpers(null).currentUserId()).toBe(null);
  });

  it('user_id is the user id when signed in', () => {
    expect(loadInsertHelpers(session).currentUserId()).toBe('user-123');
  });

  it('signed-out writes use the anon key, matching the anon RLS policy', () => {
    const h = loadInsertHelpers(null).supabaseWriteHeaders();
    expect(h.Authorization).toBe('Bearer anon-key');
    expect(h.apikey).toBe('anon-key');
  });

  it('signed-in writes use the access token, matching the authenticated policy', () => {
    const h = loadInsertHelpers(session).supabaseWriteHeaders();
    expect(h.Authorization).toBe('Bearer user-token');
    expect(h.apikey).toBe('anon-key');
  });

  it('both tracked tables stamp user_id', () => {
    expect(appJs).toMatch(/user_id:\s+currentUserId\(\)/);
    expect((appJs.match(/currentUserId\(\)/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it('user_feedback is left on the anon path (no user_id column for it)', () => {
    const idx = appJs.indexOf('rest/v1/user_feedback');
    const block = appJs.slice(idx, idx + 400);
    expect(block).toContain('SUPABASE_ANON_KEY');
    expect(block).not.toContain('supabaseWriteHeaders()');
  });
});

/* ─────────────────────────────────────────────
   Schema
   ───────────────────────────────────────────── */
describe('accounts.sql', () => {
  it('creates the profiles table keyed to auth.users', () => {
    expect(sql).toMatch(/create table if not exists public\.profiles/);
    expect(sql).toMatch(/references auth\.users\(id\) on delete cascade/);
  });

  it('adds user_id to both tracked tables', () => {
    expect(sql).toMatch(/alter table public\.fare_calculations[\s\S]*?add column if not exists user_id/);
    expect(sql).toMatch(/alter table public\.vehicle_reports[\s\S]*?add column if not exists user_id/);
  });

  it('cascades deletes so removing a user removes their data', () => {
    const cascades = sql.match(/on delete cascade/g) || [];
    expect(cascades.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps anonymous insert working, restricted to NULL user_id', () => {
    expect(sql).toMatch(/to anon[\s\S]{0,80}with check \(user_id is null\)/);
  });

  it('lets users read only their own rows', () => {
    expect(sql).toMatch(/for select[\s\S]{0,60}using \(user_id = auth\.uid\(\)\)/);
  });

  it('grants no public SELECT to the anon role', () => {
    expect(sql).not.toMatch(/for select\s+to anon/);
  });

  it('enables RLS on every table it touches', () => {
    expect(sql).toMatch(/alter table public\.profiles enable row level security/);
    expect(sql).toMatch(/alter table public\.fare_calculations enable row level security/);
    expect(sql).toMatch(/alter table public\.vehicle_reports\s+enable row level security/);
  });

  it('is re-runnable (guards every create)', () => {
    const creates = sql.match(/^create (table|policy|trigger|index|view|or replace)/gim) || [];
    const guards = sql.match(/if not exists|drop policy if exists|drop trigger if exists|or replace/gi) || [];
    expect(guards.length).toBeGreaterThanOrEqual(creates.length);
  });

  it('exposes the dashboard summary under the caller RLS', () => {
    expect(sql).toMatch(/security_invoker = on/);
    expect(sql).toMatch(/my_activity_summary/);
  });
});

/* ─────────────────────────────────────────────
   Deletion edge function
   ───────────────────────────────────────────── */
describe('delete-account function', () => {
  it('takes the user id from the verified token, never the request body', () => {
    expect(edgeFn).toMatch(/auth\.getUser\(token\)/);
    expect(edgeFn).not.toMatch(/req\.json\(\)[\s\S]{0,120}user_id/);
  });

  it('rejects requests with no bearer token', () => {
    expect(edgeFn).toMatch(/Missing bearer token/);
    expect(edgeFn).toMatch(/401/);
  });

  it('deletes the auth user, which is what cascades the data', () => {
    expect(edgeFn).toMatch(/auth\.admin\.deleteUser\(userId\)/);
  });

  it('also clears rows explicitly in case a cascade is missing', () => {
    expect(edgeFn).toMatch(/from\('vehicle_reports'\)\.delete\(\)\.eq\('user_id', userId\)/);
    expect(edgeFn).toMatch(/from\('fare_calculations'\)\.delete\(\)\.eq\('user_id', userId\)/);
  });

  it('restricts CORS to the site origins', () => {
    expect(edgeFn).toContain('https://metersahi.in');
    expect(edgeFn).not.toMatch(/Access-Control-Allow-Origin['"]:\s*['"]\*/);
  });
});

/* ─────────────────────────────────────────────
   Dashboard markup and script agree
   ───────────────────────────────────────────── */
describe('account page', () => {
  it('is built and excluded from search engines', () => {
    expect(accountHtml).toMatch(/<meta name="robots" content="noindex, nofollow"/);
  });

  it('loads auth.js before account.js', () => {
    expect(accountHtml.indexOf('/auth.js')).toBeGreaterThan(-1);
    expect(accountHtml.indexOf('/auth.js')).toBeLessThan(accountHtml.indexOf('/account.js'));
  });

  it('every element id account.js looks up exists in the markup', () => {
    const ids = new Set();
    for (const m of accountJs.matchAll(/\$\('([a-z0-9-]+)'\)/gi)) ids.add(m[1]);
    const missing = [...ids].filter(id => !accountHtml.includes(`id="${id}"`));
    expect(missing).toEqual([]);
  });

  it('shows all four dashboard stat tiles', () => {
    ['stat-trips', 'stat-reports', 'stat-cities', 'stat-succeeded']
      .forEach(id => expect(accountHtml).toContain(`id="${id}"`));
  });

  it('has trip history and complaints panels', () => {
    expect(accountHtml).toContain('id="trips-body"');
    expect(accountHtml).toContain('id="reports-body"');
  });

  it('requires typing DELETE before the destructive action is enabled', () => {
    expect(accountHtml).toContain('id="btn-delete-confirm"');
    expect(accountHtml).toMatch(/disabled/);
    expect(accountJs).toMatch(/input\.value\.trim\(\) !== 'DELETE'/);
  });

  it('escapes user-supplied text before injecting it into tables', () => {
    expect(accountJs).toMatch(/function esc\(/);
    expect(accountJs).toMatch(/esc\(route\)/);
    expect(accountJs).toMatch(/esc\(r\.plate_full/);
  });

  it('city pages link to the dashboard', () => {
    const city = readFileSync(resolve(root, 'dist/mumbai/index.html'), 'utf-8');
    expect(city).toContain('href="/account/"');
    expect(city).toContain('/auth.js');
  });
});
