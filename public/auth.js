/**
 * MeterSahi? - auth.js
 * Supabase-backed accounts: Google, Facebook and email/password.
 *
 * Design notes
 * ------------
 * - Loaded as a classic <script> like every other file here, and pulls
 *   supabase-js in via dynamic import() from jsDelivr (already allowed
 *   by the page CSP and by the Capacitor allowNavigation list). Nothing
 *   is bundled, so the Astro build stays dependency-free.
 * - Signing in is entirely optional. Every existing feature keeps
 *   working logged out, and the anon-key inserts in app.js are unchanged
 *   except that they now stamp user_id when a session exists.
 * - window.MSAuth is the whole public surface. app.js and account.astro
 *   both talk to it; neither imports supabase-js itself.
 */

'use strict';

(function () {

  const SB_URL  = 'https://uolzvbewjditinjfgdtb.supabase.co';
  const SB_ANON = 'sb_publishable_7GHLx872yuUQcn8lKcDBVw_ehC9Cx6e';
  const SB_CDN  = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.58.0/+esm';

  let clientPromise = null;
  let session       = null;
  const listeners   = [];

  /** Lazily create the Supabase client; repeated calls share one instance. */
  function getClient() {
    if (!clientPromise) {
      clientPromise = import(SB_CDN)
        .then(function (mod) {
          const client = mod.createClient(SB_URL, SB_ANON, {
            auth: {
              persistSession: true,
              autoRefreshToken: true,
              detectSessionInUrl: true,
            },
          });
          client.auth.onAuthStateChange(function (_event, newSession) {
            session = newSession;
            listeners.forEach(function (fn) {
              try { fn(session); } catch (e) { console.warn('auth listener failed', e); }
            });
          });
          return client.auth.getSession().then(function (res) {
            session = (res && res.data && res.data.session) || null;
            return client;
          });
        })
        .catch(function (err) {
          // A CDN failure must never break the calculator, so reset the
          // promise and let a later call retry instead of caching a
          // rejected promise forever.
          clientPromise = null;
          throw err;
        });
    }
    return clientPromise;
  }

  const MSAuth = {

    /** Resolves once the stored session (if any) has been restored. */
    ready: function () {
      return getClient().then(function () { return session; });
    },

    /** Current session, or null. Synchronous — may be null before ready(). */
    getSession: function () { return session; },
    getUser:    function () { return session ? session.user : null; },
    isSignedIn: function () { return !!session; },

    /** Subscribe to sign-in/sign-out. Returns an unsubscribe function. */
    onChange: function (fn) {
      listeners.push(fn);
      if (session) { try { fn(session); } catch (e) { /* ignore */ } }
      return function () {
        const i = listeners.indexOf(fn);
        if (i > -1) listeners.splice(i, 1);
      };
    },

    /**
     * OAuth sign-in. `provider` is 'google' or 'facebook'.
     * Returns the user to `next` (default: the account dashboard).
     */
    signInWithProvider: function (provider, next) {
      return getClient().then(function (c) {
        return c.auth.signInWithOAuth({
          provider: provider,
          options: {
            redirectTo: window.location.origin + (next || '/account/'),
          },
        });
      });
    },

    signInWithPassword: function (email, password) {
      return getClient().then(function (c) {
        return c.auth.signInWithPassword({
          email: String(email || '').trim().toLowerCase(),
          password: password,
        });
      });
    },

    signUpWithPassword: function (email, password, displayName) {
      return getClient().then(function (c) {
        return c.auth.signUp({
          email: String(email || '').trim().toLowerCase(),
          password: password,
          options: {
            data: displayName ? { full_name: displayName } : undefined,
            emailRedirectTo: window.location.origin + '/account/',
          },
        });
      });
    },

    sendPasswordReset: function (email) {
      return getClient().then(function (c) {
        return c.auth.resetPasswordForEmail(
          String(email || '').trim().toLowerCase(),
          { redirectTo: window.location.origin + '/account/?reset=1' }
        );
      });
    },

    updatePassword: function (password) {
      return getClient().then(function (c) {
        return c.auth.updateUser({ password: password });
      });
    },

    signOut: function () {
      return getClient().then(function (c) { return c.auth.signOut(); });
    },

    /** The signed-in user's profile row, or null. */
    fetchProfile: function () {
      if (!session) return Promise.resolve(null);
      return getClient().then(function (c) {
        return c.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
      }).then(function (res) { return (res && res.data) || null; });
    },

    /** Counts for the dashboard tiles, in one round trip. */
    fetchSummary: function () {
      if (!session) return Promise.resolve(null);
      return getClient().then(function (c) {
        return c.from('my_activity_summary').select('*').maybeSingle();
      }).then(function (res) { return (res && res.data) || null; });
    },

    /** Most recent fare calculations for this user. */
    fetchTrips: function (limit) {
      if (!session) return Promise.resolve([]);
      return getClient().then(function (c) {
        return c.from('fare_calculations')
          .select('id, created_at, city_slug, vehicle_type, pickup_text, dropoff_text, distance_km, calculated_fare, is_night, succeeded')
          .order('created_at', { ascending: false })
          .limit(limit || 25);
      }).then(function (res) { return (res && res.data) || []; });
    },

    /** Complaints/reports this user has raised. */
    fetchReports: function (limit) {
      if (!session) return Promise.resolve([]);
      return getClient().then(function (c) {
        return c.from('vehicle_reports')
          .select('id, created_at, city_slug, vehicle_type, plate_full, pickup_name, dropoff_name, distance_km, calculated_fare, actual_fare_charged')
          .order('created_at', { ascending: false })
          .limit(limit || 25);
      }).then(function (res) { return (res && res.data) || []; });
    },

    /**
     * Permanently delete the account and everything attached to it.
     * Deleting an auth user needs the service-role key, which must never
     * reach the browser, so this calls the delete-account Edge Function;
     * the FK cascades in accounts.sql remove the user's rows.
     */
    deleteAccount: function () {
      if (!session) return Promise.reject(new Error('Not signed in'));
      return fetch(SB_URL + '/functions/v1/delete-account', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SB_ANON,
          'Authorization': 'Bearer ' + session.access_token,
        },
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok) throw new Error(body.error || ('Delete failed: ' + res.status));
          return body;
        });
      }).then(function (body) {
        return MSAuth.signOut().then(function () { return body; });
      });
    },
  };

  window.MSAuth = MSAuth;

  // Restore any stored session as soon as the page settles. Deliberately
  // not awaited by anything on the critical path.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { MSAuth.ready().catch(function () {}); });
  } else {
    MSAuth.ready().catch(function () {});
  }

})();
