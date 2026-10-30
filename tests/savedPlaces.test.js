/**
 * Tests for the signed-in features added on top of accounts:
 *   - saved places (Home / Work / favourites) and one-tap fill
 *   - re-running a past trip from the account dashboard
 *   - the overcharge ledger
 *   - the complaint letter at /complaint/
 *
 * These run against the real sources and the real built HTML in dist/,
 * so reverting any of the fixes fails the suite. The behavioural side
 * (clicking chips, print CSS, XSS) is covered by the headless-browser
 * pass; what is asserted here is everything checkable without a DOM.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf-8');

/**
 * Strips comments so that a negative assertion ("this file must not use
 * innerHTML") is about the code and not about a comment explaining why
 * the code avoids it. Crude — it will also chew the "//" inside a URL
 * literal — which is fine, because it is only ever used for assertions
 * about the absence of an identifier.
 */
const codeOnly = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\/\/[^\n'"`]*$/gm, '');

let sql = '';
let authJs = '';
let appJs = '';
let accountJs = '';
let complaintJs = '';
let css = '';
let ahmedabad = '';
let accountHtml = '';
let complaintHtml = '';

beforeAll(() => {
  sql         = read('supabase/schema/saved-places-and-ledger.sql');
  authJs      = read('public/auth.js');
  appJs       = read('public/app.js');
  accountJs   = read('public/account.js');
  complaintJs = read('public/complaint.js');
  css         = read('public/style.css');

  const built = resolve(root, 'dist/ahmedabad/index.html');
  if (!existsSync(built)) {
    throw new Error('dist/ not built. Run `npm run build` before these tests.');
  }
  ahmedabad      = read('dist/ahmedabad/index.html');
  accountHtml    = read('dist/account/index.html');
  complaintHtml  = read('dist/complaint/index.html');
});

/* ─────────────────────────────────────────────
   Schema
   ───────────────────────────────────────────── */
describe('saved-places-and-ledger.sql', () => {
  it('creates saved_places guarded, so it is safe to re-run', () => {
    expect(sql).toMatch(/create table if not exists public\.saved_places/);
  });

  it('cascades on user deletion, so deleting an account removes places', () => {
    expect(sql).toMatch(/user_id\s+uuid not null references auth\.users\(id\) on delete cascade/);
  });

  it('restricts kind to home/work/other', () => {
    expect(sql).toMatch(/kind\s+text not null check \(kind in \('home', 'work', 'other'\)\)/);
  });

  it('enables RLS on saved_places', () => {
    expect(sql).toMatch(/alter table public\.saved_places enable row level security/);
  });

  it('allows at most one Home and one Work per user', () => {
    expect(sql).toMatch(/create unique index if not exists saved_places_one_home_per_user[\s\S]*?where kind = 'home'/);
    expect(sql).toMatch(/create unique index if not exists saved_places_one_work_per_user[\s\S]*?where kind = 'work'/);
  });

  it('scopes all four verbs to the owning user', () => {
    ['select', 'insert', 'update', 'delete'].forEach((verb) => {
      const re = new RegExp(`on public\\.saved_places for ${verb}[\\s\\S]{0,200}?auth\\.uid\\(\\)`);
      expect(sql, `${verb} policy must be scoped to auth.uid()`).toMatch(re);
    });
  });

  it('grants the anon role nothing on saved_places', () => {
    // A policy "to anon" would expose every user's home address to the
    // publishable key that ships in app.js.
    const block = sql.slice(sql.indexOf('saved_places'), sql.indexOf('OVERCHARGE LEDGER'));
    expect(block).not.toMatch(/to anon/);
    expect(sql).not.toMatch(/grant[^;]*saved_places[^;]*to anon/i);
  });

  it('runs both views under the caller\'s RLS, not the owner\'s', () => {
    expect(sql).toMatch(/create or replace view public\.my_overcharge_ledger[\s\S]*?security_invoker = on/);
    expect(sql).toMatch(/create or replace view public\.my_fare_spend[\s\S]*?security_invoker = on/);
  });

  it('filters both views to the caller\'s own rows', () => {
    expect(sql).toMatch(/from public\.vehicle_reports r\s*\n\s*where r\.user_id = auth\.uid\(\)/);
    expect(sql).toMatch(/from public\.fare_calculations f\s*\n\s*where f\.user_id = auth\.uid\(\)/);
  });

  it('never lets an undercharged trip cancel out a real overcharge', () => {
    // sum(delta) alone would net a -50 trip against a +50 one and report
    // zero overcharge to someone who was overcharged.
    expect(sql).toMatch(/sum\(greatest\(delta, 0\)\)/);
  });

  it('counts only overcharged trips in the average', () => {
    expect(sql).toMatch(/avg\(delta\) filter \(where delta > 0\)/);
  });

  it('treats a missing fare as unknown rather than zero', () => {
    expect(sql).toMatch(/when r\.actual_fare_charged is null or r\.calculated_fare is null then null/);
  });

  it('counts fare spend only over successful routes', () => {
    expect(sql).toMatch(/and f\.succeeded/);
  });

  it('grants both views to authenticated only', () => {
    expect(sql).toMatch(/grant select on public\.my_overcharge_ledger to authenticated/);
    expect(sql).toMatch(/grant select on public\.my_fare_spend to authenticated/);
  });
});

/* ─────────────────────────────────────────────
   auth.js data layer
   ───────────────────────────────────────────── */
describe('auth.js — saved places and ledger API', () => {
  const surface = [
    'fetchSavedPlaces', 'saveSavedPlace', 'deleteSavedPlace',
    'fetchLedger', 'fetchReport',
  ];

  surface.forEach((fn) => {
    it(`exposes ${fn}`, () => {
      expect(authJs).toMatch(new RegExp(`${fn}:\\s*function`));
    });
  });

  it('refuses every new call when signed out', () => {
    const block = authJs.slice(authJs.indexOf('fetchSavedPlaces'));
    // Each one must bail before touching the client.
    expect(block).toMatch(/fetchSavedPlaces: function \(\) \{\s*\n\s*if \(!session\)/);
    expect(block).toMatch(/saveSavedPlace: function \(place\) \{\s*\n\s*if \(!session\)/);
    expect(block).toMatch(/deleteSavedPlace: function \(id\) \{\s*\n\s*if \(!session/);
    // And so must the two new reads.
    expect(authJs).toMatch(/fetchReport: function \(id\) \{\s*\n\s*if \(!session/);
    expect(authJs).toMatch(/fetchLedger: function \(\) \{\s*\n\s*if \(!session\)/);
  });

  it('stamps the writer\'s own id on an insert', () => {
    expect(authJs).toMatch(/user_id:\s+uid/);
  });

  it('replaces rather than duplicates Home and Work', () => {
    // The partial unique index would otherwise reject the second save.
    const block = authJs.slice(authJs.indexOf('saveSavedPlace'), authJs.indexOf('deleteSavedPlace'));
    expect(block).toMatch(/\.delete\(\)\.eq\('user_id', uid\)/);
    expect(block).toMatch(/kind === 'other'/);
  });

  it('keys an "other" favourite by label so re-saving one leaves the rest', () => {
    const block = authJs.slice(authJs.indexOf('saveSavedPlace'), authJs.indexOf('deleteSavedPlace'));
    expect(block).toMatch(/\.eq\('kind', 'other'\)\.eq\('label', row\.label\)/);
  });

  it('rejects a place with no label or no address before any round trip', () => {
    expect(authJs).toMatch(/if \(!row\.label\)\s+return Promise\.reject/);
    expect(authJs).toMatch(/if \(!row\.address\) return Promise\.reject/);
  });

  it('caps label and address to the column limits', () => {
    expect(authJs).toMatch(/\.slice\(0, 40\)/);
    expect(authJs).toMatch(/\.slice\(0, 300\)/);
  });

  it('stores only finite coordinates, never Number(null) === 0', () => {
    expect(authJs).toMatch(/Number\.isFinite\(place && place\.lat\) \? place\.lat : null/);
    expect(authJs).toMatch(/Number\.isFinite\(place && place\.lng\) \? place\.lng : null/);
  });

  it('reads one report by id and leaves authorisation to RLS', () => {
    const block = authJs.slice(authJs.indexOf('fetchReport:'), authJs.indexOf('fetchLedger:'));
    expect(block).toMatch(/\.eq\('id', id\)/);
    // Deliberately no .eq('user_id', ...): the RLS policy is what scopes
    // it, and duplicating that here would imply the client enforces it.
    expect(block).toMatch(/maybeSingle/);
  });

  it('uses one shared column list for both report reads', () => {
    expect(authJs).toMatch(/const REPORT_COLUMNS\s*=/);
    const uses = authJs.match(/\.select\(REPORT_COLUMNS\)/g) || [];
    expect(uses.length).toBe(2);
  });

  it('includes every field the complaint letter renders', () => {
    const cols = authJs.slice(authJs.indexOf('const REPORT_COLUMNS'), authJs.indexOf('/** Lazily'));
    ['plate_full', 'pickup_name', 'dropoff_name', 'distance_km',
     'calculated_fare', 'actual_fare_charged', 'city_slug', 'vehicle_type', 'created_at']
      .forEach((c) => expect(cols, `REPORT_COLUMNS must include ${c}`).toContain(c));
  });

  it('reads the ledger and the spend view together', () => {
    const block = authJs.slice(authJs.indexOf('fetchLedger:'), authJs.indexOf('/* ── Saved places'));
    expect(block).toContain('my_overcharge_ledger');
    expect(block).toContain('my_fare_spend');
    expect(block).toMatch(/Promise\.all/);
  });
});

/* ─────────────────────────────────────────────
   app.js — calculator side
   ───────────────────────────────────────────── */
describe('app.js — saved places on the calculator', () => {
  it('renders nothing at all when signed out', () => {
    expect(appJs).toMatch(/if \(!isSignedIn\(\)\) \{[\s\S]{0,160}?display = 'none'/);
  });

  it('treats a missing MSAuth as signed out rather than throwing', () => {
    expect(appJs).toMatch(/window\.MSAuth && window\.MSAuth\.isSignedIn && window\.MSAuth\.isSignedIn\(\)/);
  });

  it('hides places saved against a different city', () => {
    expect(appJs).toMatch(/return !p\.city_slug \|\| p\.city_slug === CITY_SLUG;/);
  });

  it('carries the stored place id and coordinates into the route', () => {
    const block = appJs.slice(appJs.indexOf('function fillFieldFromPlace'));
    expect(block).toMatch(/resolvedPoints\[fieldId\] = \{[\s\S]{0,220}?placeId: place\.place_id \|\| null/);
    expect(block).toMatch(/lat: Number\.isFinite\(place\.lat\) \? place\.lat : undefined/);
  });

  it('records the same text it put in the box, so the staleness check passes', () => {
    const block = appJs.slice(appJs.indexOf('function fillFieldFromPlace'));
    expect(block).toMatch(/input\.value = place\.address/);
    expect(block).toMatch(/text: place\.address/);
  });

  it('re-renders after filling in code, where no input event fires', () => {
    const block = appJs.slice(appJs.indexOf('function fillFieldFromPlace'),
                              appJs.indexOf('function chipButton'));
    expect(block).toMatch(/renderSavedPlaceRows\(\)/);
  });

  it('builds chips with textContent, never innerHTML', () => {
    const block = codeOnly(appJs).slice(codeOnly(appJs).indexOf('function chipButton'),
                                        codeOnly(appJs).indexOf('function renderSavedPlaceRows'));
    expect(block).not.toMatch(/innerHTML/);
    expect(block).toMatch(/createTextNode/);
  });

  it('clears a row with textContent rather than innerHTML', () => {
    const src = codeOnly(appJs);
    const block = src.slice(src.indexOf('function renderSavedPlaceRows'),
                            src.indexOf('function watchFieldsForSaveChip'));
    expect(block).not.toMatch(/innerHTML/);
  });

  it('saves only a point that still matches the box', () => {
    // resolvedPointFor returns null once the text has been edited, so an
    // edited address is saved as text instead of with stale coordinates.
    const block = appJs.slice(appJs.indexOf('window.saveCurrentPlace'));
    expect(block).toMatch(/const resolved = resolvedPointFor\(fieldId, address\)/);
    expect(block).toMatch(/place_id:\s+resolved \? resolved\.placeId : null/);
  });

  it('requires a name for a custom favourite', () => {
    const block = appJs.slice(appJs.indexOf('window.saveCurrentPlace'));
    expect(block).toMatch(/if \(!label\) \{[\s\S]{0,120}?return; \}/);
  });

  it('stamps the current city on a save', () => {
    expect(appJs).toMatch(/city_slug: CITY_SLUG,/);
  });

  it('does not use window.prompt, which the Capacitor WebView blocks', () => {
    expect(codeOnly(appJs)).not.toMatch(/\bprompt\s*\(/);
  });
});

describe('app.js — geolocation falls back to a saved Home', () => {
  it('marks a denied or unavailable fix so a later load can still fill', () => {
    const matches = appJs.match(/geoAttemptFailed = true/g) || [];
    expect(matches.length).toBe(2); // no-support path and error path
  });

  it('retries the fallback once saved places arrive', () => {
    const block = appJs.slice(appJs.indexOf('function loadSavedPlaces'));
    expect(block).toMatch(/maybeApplyHomeFallback\(\)/);
  });

  it('never overwrites something already in the pickup box', () => {
    const block = appJs.slice(appJs.indexOf('function maybeApplyHomeFallback'));
    expect(block).toMatch(/if \(!input \|\| input\.value\.trim\(\)\) return;/);
  });

  it('only ever falls back to a Home in this city', () => {
    const block = appJs.slice(appJs.indexOf('function maybeApplyHomeFallback'));
    expect(block).toMatch(/placesForThisCity\(\)[\s\S]{0,90}?p\.kind === 'home'/);
  });

  it('does nothing when the fix succeeded', () => {
    const block = appJs.slice(appJs.indexOf('function maybeApplyHomeFallback'));
    expect(block).toMatch(/if \(!geoAttemptFailed\) return;/);
  });
});

describe('app.js — re-running a past trip', () => {
  it('reads from, to, v and run from the query string', () => {
    const block = appJs.slice(appJs.indexOf('function applyTripFromQuery'));
    ['from', 'to', 'v', 'run'].forEach((p) => expect(block).toContain(`'${p}'`));
  });

  it('survives a browser without URLSearchParams instead of throwing', () => {
    const block = appJs.slice(appJs.indexOf('function applyTripFromQuery'));
    expect(block).toMatch(/try \{ q = new URLSearchParams[\s\S]{0,70}?catch \(e\) \{ return; \}/);
  });

  it('caps the incoming address length', () => {
    const block = appJs.slice(appJs.indexOf('function applyTripFromQuery'));
    expect(block).toMatch(/\.slice\(0, CAP\)/);
  });

  it('ignores v=taxi on a city with no taxi tariff', () => {
    const block = appJs.slice(appJs.indexOf('function applyTripFromQuery'));
    expect(block).toMatch(/if \(v === 'taxi' && CITY\.taxiTariff\)/);
  });

  it('clears any resolved point when filling from text', () => {
    const block = appJs.slice(appJs.indexOf('function applyTripFromQuery'));
    expect(block).toMatch(/resolvedPoints\.pickup\s+= null/);
    expect(block).toMatch(/resolvedPoints\.dropoff = null/);
  });

  it('only auto-calculates when run=1 and both ends are present', () => {
    const block = appJs.slice(appJs.indexOf('function applyTripFromQuery'));
    expect(block).toMatch(/if \(run && from && to\)/);
  });

  it('applies the query before anything can fill pickup', () => {
    // The Home fallback must not win a race against an explicit re-run.
    const init = appJs.slice(appJs.indexOf("document.addEventListener('DOMContentLoaded'"));
    expect(init.indexOf('applyTripFromQuery()')).toBeGreaterThan(-1);
    expect(init.indexOf('applyTripFromQuery()')).toBeLessThan(init.indexOf('loadSavedPlaces'));
  });

  it('follows the session without a reload', () => {
    const init = appJs.slice(appJs.indexOf("document.addEventListener('DOMContentLoaded'"));
    expect(init).toMatch(/MSAuth\.onChange\(function \(\) \{ loadSavedPlaces\(\); \}\)/);
  });
});

/* ─────────────────────────────────────────────
   app.js still loads in a sandbox
   ───────────────────────────────────────────── */
describe('app.js — new code runs at load with no DOM and no MSAuth', () => {
  it('evaluates and exposes the new helpers', () => {
    const noop = () => {};
    const fakeEl = () => new Proxy({}, {
      get: (_t, k) => (k === 'style' ? {} : (k === 'classList' ? { add: noop, remove: noop, toggle: noop } : noop)),
      set: () => true,
    });
    const sandbox = {
      console: { log: noop, warn: noop, error: noop },
      document: {
        addEventListener: noop, getElementById: fakeEl, querySelector: fakeEl,
        querySelectorAll: () => [], createElement: fakeEl,
        documentElement: { setAttribute: noop, getAttribute: () => null },
      },
      localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
      setTimeout, clearTimeout, Date, Math, JSON, Promise, Error, URLSearchParams,
      encodeURIComponent, decodeURIComponent, isNaN, parseFloat, parseInt, Number, String,
      fetch: () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') }),
      CITY_SLUG: 'ahmedabad',
      navigator: { userAgent: 'test', geolocation: { getCurrentPosition: noop } },
      location: { search: '' },
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    // Deliberately no window.MSAuth: auth.js is a separate file and may
    // fail to load (its CDN import can fail) without breaking this one.
    vm.createContext(sandbox);
    vm.runInContext(read('public/cities.js'), sandbox, { filename: 'cities.js' });
    expect(() => vm.runInContext(appJs, sandbox, { filename: 'app.js' })).not.toThrow();

    const api = vm.runInContext(
      '({ isSignedIn, placesForThisCity, applyTripFromQuery, maybeApplyHomeFallback })',
      sandbox,
    );
    expect(typeof api.isSignedIn).toBe('function');
    expect(api.isSignedIn()).toBe(false);
    expect(api.placesForThisCity()).toEqual([]);
    // No query string, no MSAuth: both must be no-ops rather than throw.
    expect(() => api.applyTripFromQuery()).not.toThrow();
    expect(() => api.maybeApplyHomeFallback()).not.toThrow();
  });

  it('filters saved places to the current city', () => {
    const noop = () => {};
    const sandbox = {
      console: { log: noop, warn: noop, error: noop },
      document: {
        addEventListener: noop,
        getElementById: () => null, querySelector: () => null,
        querySelectorAll: () => [], createElement: () => ({ style: {}, classList: { add: noop } }),
        documentElement: { setAttribute: noop, getAttribute: () => null },
      },
      localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
      setTimeout, clearTimeout, Date, Math, JSON, Promise, Error, URLSearchParams,
      encodeURIComponent, decodeURIComponent, isNaN, parseFloat, parseInt, Number, String,
      fetch: () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') }),
      CITY_SLUG: 'ahmedabad',
      navigator: { userAgent: 'test', geolocation: { getCurrentPosition: noop } },
      location: { search: '' },
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(read('public/cities.js'), sandbox, { filename: 'cities.js' });
    vm.runInContext(appJs, sandbox, { filename: 'app.js' });

    vm.runInContext(`savedPlaces = [
      { kind:'home',  label:'Home', city_slug:'ahmedabad' },
      { kind:'other', label:'Old',  city_slug:null },
      { kind:'other', label:'Away', city_slug:'mumbai' }
    ];`, sandbox);

    const labels = vm.runInContext('placesForThisCity().map(function(p){return p.label;})', sandbox);
    expect(labels).toEqual(['Home', 'Old']);
  });
});

/* ─────────────────────────────────────────────
   account.js
   ───────────────────────────────────────────── */
describe('account.js — ledger, places and row actions', () => {
  it('resolves real city names instead of title-casing the slug', () => {
    // "riodejaneiro" title-cased is "Riodejaneiro".
    expect(accountJs).toMatch(/const c = \(typeof CITIES !== 'undefined'\) && CITIES\[slug\]/);
    expect(accountJs).toMatch(/if \(c && c\.name\) return c\.name/);
  });

  it('keeps the slug fallback for a city cities.js does not know', () => {
    const block = accountJs.slice(accountJs.indexOf('const CITY_NAME'), accountJs.indexOf('const CURRENCY'));
    expect(block).toMatch(/charAt\(0\)\.toUpperCase\(\)/);
  });

  it('uses each city\'s own currency symbol, not a hardcoded rupee', () => {
    expect(accountJs).toMatch(/const CURRENCY = function \(slug\)/);
    expect(accountJs).toMatch(/CURRENCY\(r\.city_slug\)/);
  });

  it('builds a re-run link at the trip\'s own city', () => {
    const block = accountJs.slice(accountJs.indexOf('function rerunHref'));
    expect(block).toMatch(/'\/' \+ encodeURIComponent\(r\.city_slug\) \+ '\/\?'/);
    expect(block).toMatch(/q\.set\('run', '1'\)/);
  });

  it('offers Re-run only when there is a city and both ends', () => {
    expect(accountJs).toMatch(/const canRerun = !!\(r\.city_slug && r\.pickup_text && r\.dropoff_text\)/);
  });

  it('escapes the re-run href it injects', () => {
    expect(accountJs).toMatch(/href="' \+ esc\(rerunHref\(r\)\)/);
  });

  it('links each report to its complaint letter by encoded id', () => {
    expect(accountJs).toMatch(/\/complaint\/\?r=' \+ encodeURIComponent\(r\.id\)/);
  });

  it('renders saved places with textContent, not innerHTML', () => {
    const block = accountJs.slice(accountJs.indexOf('function renderPlaces'),
                                  accountJs.indexOf('function rerunHref'));
    expect(block).toMatch(/lab\.textContent = p\.label/);
    expect(block).toMatch(/addr\.textContent = p\.address/);
    // The only innerHTML here is the static trash icon and the static
    // empty-state copy. What must never appear is a user field inside
    // one, which is what would actually be injectable.
    const assignments = block.match(/innerHTML\s*=[\s\S]*?;/g) || [];
    assignments.forEach((a) => {
      expect(a, 'innerHTML must not interpolate a saved place').not.toMatch(/p\.(label|address|city_slug)/);
    });
  });

  it('reports a zero overcharge as "none yet", not a bare total', () => {
    expect(accountJs).toMatch(/'no overcharge reported yet'/);
  });

  it('averages only over overcharged trips in the copy too', () => {
    expect(accountJs).toMatch(/average when overcharged/);
  });

  it('does not total different currencies into one number', () => {
    // Reports can span cities; the comment and the single symbol are the
    // record of that decision.
    expect(accountJs).toMatch(/Totalling those[\s\S]{0,80}?would be wrong/);
  });
});

/* ─────────────────────────────────────────────
   complaint.js
   ───────────────────────────────────────────── */
describe('complaint.js — the letter', () => {
  it('reads the report id from the query string', () => {
    expect(complaintJs).toMatch(/queryParam\('r'\)/);
  });

  it('shows a sign-in prompt rather than a letter when signed out', () => {
    expect(complaintJs).toMatch(/if \(!session\) \{ hide\('cmp-loading'\); show\('cmp-signed-out'\); return; \}/);
  });

  it('shows not-found for an id that is not the user\'s', () => {
    expect(complaintJs).toMatch(/if \(!row\) \{ show\('cmp-missing'\); return; \}/);
  });

  it('shows not-found when no id is given at all', () => {
    expect(complaintJs).toMatch(/if \(!reportId\) \{ hide\('cmp-loading'\); show\('cmp-missing'\); return; \}/);
  });

  it('computes the excess only when both fares are known', () => {
    expect(complaintJs).toMatch(/\(Number\.isFinite\(correct\) && Number\.isFinite\(charged\)\)/);
  });

  it('distinguishes a nil excess from an unrecorded one', () => {
    expect(complaintJs).toMatch(/'Nil'/);
    expect(complaintJs).toMatch(/'Not recorded'/);
  });

  it('names the authority the way that city\'s own page does', () => {
    expect(complaintJs).toMatch(/c\.regulatorName \|\| \(\(c\.state \|\| ''\) \+ ' Motor Vehicles Department'\)/);
  });

  it('uses the city\'s own currency symbol', () => {
    expect(complaintJs).toMatch(/\(city && city\.currencySymbol\) \|\| '₹'/);
  });

  it('builds the whole letter with textContent', () => {
    // A plate or address rendered as markup would be an injection into a
    // document the user is about to send to a government office.
    const src = codeOnly(complaintJs);
    const render = src.slice(src.indexOf('function renderLetter'), src.indexOf('function letterAsText'));
    expect(render).not.toMatch(/innerHTML/);
    expect(render).toMatch(/\.textContent\s*=/);
  });

  it('builds the contacts panel with textContent too', () => {
    const src = codeOnly(complaintJs);
    const block = src.slice(src.indexOf('function renderContacts'), src.indexOf('function start'));
    const assignments = block.match(/innerHTML\s*=[\s\S]*?;/g) || [];
    assignments.forEach((a) => {
      expect(a, 'innerHTML must not interpolate report or city data').not.toMatch(/\b(r|city|report)\./);
    });
    expect(block).toMatch(/\.textContent\s*=\s*(label|value|hint)/);
  });

  it('keeps the complainant\'s details on the device only', () => {
    expect(complaintJs).toMatch(/localStorage\.setItem\(CONTACT_STORAGE_KEY/);
    // Never written back to Supabase.
    expect(complaintJs).not.toMatch(/supabaseInsert|rest\/v1/);
  });

  it('survives localStorage throwing in private browsing', () => {
    expect(complaintJs).toMatch(/function loadContact\(\) \{\s*\n\s*try \{/);
    expect(complaintJs).toMatch(/function saveContact\(c\) \{\s*\n\s*try \{/);
  });

  it('url-encodes the mailto subject and body', () => {
    expect(complaintJs).toMatch(/'\?subject=' \+ encodeURIComponent\(subject\)/);
    expect(complaintJs).toMatch(/'&body=' \+ encodeURIComponent\(letterAsText\(\)\)/);
  });

  it('still opens a draft when the city publishes no RTO email', () => {
    expect(complaintJs).toMatch(/\|\| \{\}\)\.email \|\| ''/);
  });

  it('states plainly that MeterSahi is not a government portal', () => {
    expect(complaintJs).toMatch(/not a government portal/);
  });

  it('gets the article right for both vehicle types', () => {
    // 'a ' + 'auto rickshaw' produced "a auto rickshaw" in the opening
    // line of a letter addressed to a government office.
    expect(complaintJs).toMatch(/isTaxi \? 'a taxi' : 'an auto rickshaw'/);
    expect(complaintJs).not.toMatch(/regarding a ' \+ vehicle/);
  });
});

/* ─────────────────────────────────────────────
   Built output
   ───────────────────────────────────────────── */
describe('built pages', () => {
  it('every city page carries both saved-place rows', () => {
    expect(ahmedabad).toContain('id="saved-places-pickup"');
    expect(ahmedabad).toContain('id="saved-places-dropoff"');
  });

  it('ships them hidden, so the logged-out page is unchanged', () => {
    expect(ahmedabad).toMatch(/id="saved-places-pickup"[^>]*style="display:none"/);
    expect(ahmedabad).toMatch(/id="saved-places-dropoff"[^>]*style="display:none"/);
  });

  it('ships the save popover hidden', () => {
    expect(ahmedabad).toMatch(/id="save-place-popover"[^>]*style="display:none"/);
  });

  it('the popover offers Home, Work and a custom name', () => {
    expect(ahmedabad).toMatch(/saveCurrentPlace\('home'\)/);
    expect(ahmedabad).toMatch(/saveCurrentPlace\('work'\)/);
    expect(ahmedabad).toMatch(/saveCurrentPlace\('other'\)/);
  });

  it('the account page has the ledger, saved places and cities.js', () => {
    expect(accountHtml).toContain('id="ledger-overcharge"');
    expect(accountHtml).toContain('id="ledger-worst"');
    expect(accountHtml).toContain('id="ledger-spend"');
    expect(accountHtml).toContain('id="places-body"');
    expect(accountHtml).toMatch(/src="\/cities\.js"/);
  });

  it('the complaint page builds, and stays out of the index', () => {
    expect(complaintHtml).toContain('id="cmp-letter"');
    expect(complaintHtml).toMatch(/<meta name="robots" content="noindex, nofollow"\/?>/);
  });

  it('the complaint page loads cities.js, auth.js and complaint.js', () => {
    ['/cities.js', '/auth.js', '/complaint.js'].forEach((s) => {
      expect(complaintHtml).toContain(`src="${s}"`);
    });
  });

  it('the complaint page is not in the sitemap, being noindex and per-user', () => {
    const sitemap = read('public/sitemap.xml');
    expect(sitemap).not.toContain('/complaint/');
  });
});

/* ─────────────────────────────────────────────
   CSS
   ───────────────────────────────────────────── */
describe('style.css', () => {
  it('declares the aliases the account stylesheet was written against', () => {
    // These were used throughout but never defined, so every rule using
    // them resolved to an invalid value and silently inherited.
    ['--text:', '--text-muted:', '--accent:'].forEach((t) => {
      expect(css).toContain(t);
    });
  });

  it('styles the chip row and the popover', () => {
    expect(css).toMatch(/\.saved-places-row \{[^}]*display:flex/);
    expect(css).toMatch(/\.sp-chip \{/);
    expect(css).toMatch(/\.sp-popover \{/);
  });

  it('prints the letter and nothing else', () => {
    const print = css.slice(css.indexOf('@media print'));
    expect(print).toMatch(/\.no-print[^{]*\{ display:none !important/);
    expect(print).toMatch(/\.site-header/);
    expect(print).toMatch(/\.cmp-actions/);
    expect(print).toMatch(/\.cmp-letter \{/);
  });

  it('keeps the fare table from splitting across pages', () => {
    const print = css.slice(css.indexOf('@media print'));
    expect(print).toMatch(/\.cmp-table \{ page-break-inside:avoid/);
  });

  it('collapses the ledger to one column on a phone', () => {
    expect(css).toMatch(/@media \(max-width: 760px\) \{\s*\n\s*\.acc-ledger \{ grid-template-columns:1fr/);
  });
});
