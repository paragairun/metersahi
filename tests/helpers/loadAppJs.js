// Loads public/app.js in a vm sandbox, the same way loadCitiesJs does,
// so the Supabase write helpers can be tested without a browser.
//
// app.js expects cities.js to have run first (it reads CITIES and
// CITY_SLUG from the shared global scope), and it registers a
// DOMContentLoaded listener at the bottom. Both are satisfied with
// stubs rather than by modifying app.js — that file is a live
// production asset served straight to browsers.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadAppJs({ fetchImpl, session = null } = {}) {
  const citiesSrc = fs.readFileSync(path.join(__dirname, '../../public/cities.js'), 'utf8');
  const appSrc = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');

  const calls = [];
  const consoleCalls = { warn: [], error: [] };

  const noop = () => {};
  const fakeEl = () => new Proxy({}, {
    get: (_t, k) => (k === 'style' ? {} : (k === 'classList' ? { add: noop, remove: noop } : noop)),
    set: () => true,
  });

  const sandbox = {
    console: {
      log: noop,
      warn: (...a) => consoleCalls.warn.push(a.map(String).join(' ')),
      error: (...a) => consoleCalls.error.push(a.map(String).join(' ')),
    },
    document: {
      addEventListener: noop,
      getElementById: fakeEl,
      querySelector: fakeEl,
      querySelectorAll: () => [],
      createElement: fakeEl,
    },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    setTimeout, clearTimeout, Date, Math, JSON, Promise, Error,
    encodeURIComponent, decodeURIComponent, isNaN, parseFloat, parseInt,
    fetch: (url, opts) => { calls.push({ url, opts }); return fetchImpl(url, opts); },
    CITY_SLUG: 'mumbai',
    navigator: { userAgent: 'test', geolocation: { getCurrentPosition: noop } },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window.MSAuth = session
    ? { getSession: () => session, getUser: () => ({ id: session.user_id }) }
    : { getSession: () => null, getUser: () => null };

  vm.createContext(sandbox);
  vm.runInContext(citiesSrc, sandbox, { filename: 'cities.js' });
  vm.runInContext(appSrc, sandbox, { filename: 'app.js' });

  const extracted = vm.runInContext(
    `({ supabaseInsert, supabaseWriteHeaders, supabaseAnonHeaders, currentUserId,
        computeRoutesAPI, routeWaypoint, withCityContext, isUsableCoordPair,
        resolvedPointFor, normaliseAddressText, resolvedPoints })`,
    sandbox,
  );

  return { ...extracted, calls, consoleCalls };
}

/** A stub PostgREST response. */
export function reply(status, body = '') {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  });
}
