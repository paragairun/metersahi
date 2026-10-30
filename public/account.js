/**
 * MeterSahi? - account.js
 * Behaviour for /account/. Talks only to window.MSAuth (auth.js);
 * supabase-js is never touched directly from here.
 */

'use strict';

(function () {

  const $ = function (id) { return document.getElementById(id); };
  let mode = 'signin'; // or 'signup'

  /**
   * Real city name from cities.js when it loaded, falling back to
   * title-casing the slug. The fallback alone turned "riodejaneiro"
   * into "Riodejaneiro" and "mexicocity" into "Mexicocity".
   */
  const CITY_NAME = function (slug) {
    if (!slug) return '—';
    const c = (typeof CITIES !== 'undefined') && CITIES[slug];
    if (c && c.name) return c.name;
    return slug.split('-').map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  };

  /** A city's own currency symbol — these pages are not all in rupees. */
  const CURRENCY = function (slug) {
    const c = (typeof CITIES !== 'undefined') && CITIES[slug];
    return (c && c.currencySymbol) || '₹';
  };

  /** Whole rupees for counts, two decimals never shown to the user. */
  function money(sym, n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return sym + Math.round(v).toLocaleString('en-IN');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function msg(el, text, kind) {
    el.textContent = text || '';
    el.className = 'acc-msg' + (kind ? ' acc-msg--' + kind : '');
  }

  function show(id)  { const el = $(id); if (el) el.style.display = ''; }
  function hide(id)  { const el = $(id); if (el) el.style.display = 'none'; }

  /* ── View switching ── */
  function renderSignedOut() {
    hide('acc-loading'); hide('acc-dashboard'); show('acc-signed-out');
  }

  function renderSignedIn(user) {
    hide('acc-loading'); hide('acc-signed-out'); show('acc-dashboard');

    const meta = (user && user.user_metadata) || {};
    const name = meta.full_name || meta.name || (user.email || '').split('@')[0];
    $('acc-name-display').textContent = name ? ('Hello, ' + name) : 'Your dashboard';
    $('acc-email-display').textContent = user.email || '';
    if (user.created_at) {
      $('acc-member-since').textContent = 'Member since ' + fmtDate(user.created_at);
    }

    const avatarUrl = meta.avatar_url || meta.picture;
    if (avatarUrl) {
      const img = $('acc-avatar');
      img.src = avatarUrl;
      img.style.display = '';
      hide('acc-avatar-fallback');
    }

    window.MSAuth.fetchSummary().then(function (s) {
      if (!s) return;
      $('stat-trips').textContent     = s.trips_calculated != null ? s.trips_calculated : 0;
      $('stat-reports').textContent   = s.reports_raised   != null ? s.reports_raised   : 0;
      $('stat-cities').textContent    = s.cities_used      != null ? s.cities_used      : 0;
      $('stat-succeeded').textContent = s.trips_succeeded  != null ? s.trips_succeeded  : 0;
    }).catch(function (e) {
      console.warn('summary failed', e);
      ['stat-trips', 'stat-reports', 'stat-cities', 'stat-succeeded']
        .forEach(function (id) { $(id).textContent = '—'; });
    });

    window.MSAuth.fetchLedger().then(renderLedger).catch(function (e) {
      console.warn('ledger failed', e);
      ['ledger-overcharge', 'ledger-worst', 'ledger-spend']
        .forEach(function (id) { $(id).textContent = '—'; });
    });

    window.MSAuth.fetchSavedPlaces().then(renderPlaces).catch(function (e) {
      console.warn('places failed', e);
      $('places-body').innerHTML = '<div class="acc-empty">Could not load your saved places.</div>';
    });

    window.MSAuth.fetchTrips(25).then(renderTrips).catch(function (e) {
      console.warn('trips failed', e);
      $('trips-body').innerHTML = '<div class="acc-empty">Could not load your trip history.</div>';
    });

    window.MSAuth.fetchReports(25).then(renderReports).catch(function (e) {
      console.warn('reports failed', e);
      $('reports-body').innerHTML = '<div class="acc-empty">Could not load your complaints.</div>';
    });
  }

  /* ── Overcharge ledger ── */
  function renderLedger(l) {
    if (!l) return;
    // Reports can span cities with different currencies. Totalling those
    // into one number would be wrong, so the ledger is labelled with the
    // symbol only when every reported city shares one; otherwise the
    // neutral '₹' default stands in and the counts carry the meaning.
    const sym = '₹';

    const total = Number(l.overcharge_total) || 0;
    const count = Number(l.overcharge_count) || 0;
    $('ledger-overcharge').textContent = money(sym, total);
    $('ledger-overcharge-sub').textContent = count
      ? ('across ' + count + ' overcharged trip' + (count === 1 ? '' : 's'))
      : 'no overcharge reported yet';

    const worst = Number(l.worst_overcharge) || 0;
    const avg   = Number(l.avg_overcharge) || 0;
    $('ledger-worst').textContent = worst > 0 ? money(sym, worst) : '—';
    $('ledger-avg').textContent   = avg > 0
      ? (money(sym, avg) + ' average when overcharged')
      : 'nothing flagged so far';

    const spend = Number(l.fare_total) || 0;
    const trips = Number(l.trips_total) || 0;
    const dist  = Number(l.distance_total) || 0;
    $('ledger-spend').textContent = trips ? money(sym, spend) : '—';
    $('ledger-distance').textContent = trips
      ? (trips + ' trip' + (trips === 1 ? '' : 's') + ' · ' + Math.round(dist) + ' km')
      : 'check a fare to start';
  }

  /* ── Saved places ── */
  function renderPlaces(rows) {
    const body = $('places-body');
    if (!rows || !rows.length) {
      body.innerHTML =
        '<div class="acc-empty">No saved places yet. On any city page, type a pickup or drop-off ' +
        'and tap <strong>Save</strong> to keep it as Home, Work or a favourite.</div>';
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'acc-places';

    rows.forEach(function (p) {
      const kind = (p.kind === 'home' || p.kind === 'work') ? p.kind : 'other';
      const card = document.createElement('div');
      card.className = 'acc-place';

      const icon = document.createElement('i');
      icon.className = 'ti ' +
        (kind === 'home' ? 'ti-home' : kind === 'work' ? 'ti-briefcase' : 'ti-star') +
        ' acc-place-icon is-' + kind;
      card.appendChild(icon);

      const text = document.createElement('div');
      text.className = 'acc-place-text';
      // textContent throughout: labels and addresses are user input and
      // must never be parsed as markup here.
      const lab = document.createElement('div');
      lab.className = 'acc-place-label';
      lab.textContent = p.label;
      const addr = document.createElement('div');
      addr.className = 'acc-place-address';
      addr.textContent = p.address;
      text.appendChild(lab);
      text.appendChild(addr);
      if (p.city_slug) {
        const city = document.createElement('div');
        city.className = 'acc-place-city';
        city.textContent = CITY_NAME(p.city_slug);
        text.appendChild(city);
      }
      card.appendChild(text);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'acc-place-del';
      del.title = 'Remove ' + p.label;
      del.setAttribute('aria-label', 'Remove ' + p.label);
      del.innerHTML = '<i class="ti ti-trash"></i>';
      del.addEventListener('click', function () {
        del.disabled = true;
        window.MSAuth.deleteSavedPlace(p.id)
          .then(function () { return window.MSAuth.fetchSavedPlaces(); })
          .then(renderPlaces)
          .catch(function (err) {
            console.warn('delete place failed', err);
            del.disabled = false;
          });
      });
      card.appendChild(del);

      wrap.appendChild(card);
    });

    body.innerHTML = '';
    body.appendChild(wrap);
  }

  /**
   * Link back to a city page with both ends pre-filled, so a history row
   * becomes one tap instead of retyping. app.js reads these params in
   * applyTripFromQuery().
   */
  function rerunHref(r) {
    const q = new URLSearchParams();
    q.set('from', r.pickup_text || '');
    q.set('to', r.dropoff_text || '');
    if (r.vehicle_type) q.set('v', r.vehicle_type);
    q.set('run', '1');
    return '/' + encodeURIComponent(r.city_slug) + '/?' + q.toString();
  }

  function renderTrips(rows) {
    if (!rows.length) {
      $('trips-body').innerHTML =
        '<div class="acc-empty">No fare checks yet. <a href="/">Check a fare</a> and it will appear here.</div>';
      return;
    }
    let html = '<div class="acc-table-wrap"><table class="acc-table"><thead><tr>' +
      '<th>Date</th><th>City</th><th>Route</th><th>Distance</th><th>Fare</th><th></th></tr></thead><tbody>';
    rows.forEach(function (r) {
      const route = (r.pickup_text || '—') + ' → ' + (r.dropoff_text || '—');
      const canRerun = !!(r.city_slug && r.pickup_text && r.dropoff_text);
      html += '<tr>' +
        '<td>' + esc(fmtDate(r.created_at)) + '</td>' +
        '<td>' + esc(CITY_NAME(r.city_slug)) +
          '<span class="acc-chip">' + (r.vehicle_type === 'taxi' ? '🚕 Taxi' : '🛺 Auto') + '</span>' +
          (r.is_night ? '<span class="acc-chip acc-chip--night">Night</span>' : '') + '</td>' +
        '<td class="acc-route">' + esc(route) + '</td>' +
        '<td>' + (r.distance_km != null ? esc(r.distance_km) + ' km' : '—') + '</td>' +
        '<td>' + (r.calculated_fare != null ? esc(CURRENCY(r.city_slug)) + esc(r.calculated_fare) : '—') + '</td>' +
        '<td>' + (canRerun
          ? '<a class="acc-row-btn" href="' + esc(rerunHref(r)) + '"><i class="ti ti-refresh"></i> Re-run</a>'
          : '') + '</td>' +
        '</tr>';
    });
    $('trips-body').innerHTML = html + '</tbody></table></div>';
  }

  function renderReports(rows) {
    if (!rows.length) {
      $('reports-body').innerHTML =
        '<div class="acc-empty">You haven\'t reported any vehicle yet.</div>';
      return;
    }
    let html = '<div class="acc-table-wrap"><table class="acc-table"><thead><tr>' +
      '<th>Date</th><th>Vehicle</th><th>City</th><th>Correct</th><th>Charged</th><th>Overcharge</th><th></th>' +
      '</tr></thead><tbody>';
    rows.forEach(function (r) {
      const over = (r.actual_fare_charged != null && r.calculated_fare != null)
        ? r.actual_fare_charged - r.calculated_fare : null;
      const sym = esc(CURRENCY(r.city_slug));
      html += '<tr>' +
        '<td>' + esc(fmtDate(r.created_at)) + '</td>' +
        '<td><span class="acc-plate">' + esc(r.plate_full || '—') + '</span></td>' +
        '<td>' + esc(CITY_NAME(r.city_slug)) + '</td>' +
        '<td>' + (r.calculated_fare != null ? sym + esc(r.calculated_fare) : '—') + '</td>' +
        '<td>' + (r.actual_fare_charged != null ? sym + esc(r.actual_fare_charged) : '—') + '</td>' +
        '<td>' + (over != null
            ? '<span class="' + (over > 0 ? 'acc-over' : 'acc-ok') + '">' + (over > 0 ? '+' + sym + over : sym + over) + '</span>'
            : '—') + '</td>' +
        '<td><a class="acc-row-btn" href="/complaint/?r=' + encodeURIComponent(r.id) + '">' +
          '<i class="ti ti-file-text"></i> Complaint</a></td>' +
        '</tr>';
    });
    $('reports-body').innerHTML = html + '</tbody></table></div>';
  }

  /* ── Sign-in / sign-up form ── */
  function setMode(next) {
    mode = next;
    const isSignup = mode === 'signup';
    $('field-name').style.display = isSignup ? '' : 'none';
    $('btn-email-submit').textContent = isSignup ? 'Create account' : 'Sign in';
    $('btn-toggle-mode').textContent = isSignup
      ? 'Already have an account? Sign in'
      : 'New here? Create an account';
    $('acc-password').setAttribute('autocomplete', isSignup ? 'new-password' : 'current-password');
    msg($('acc-msg'), '');
  }

  function handleEmailSubmit() {
    const email = $('acc-email').value.trim();
    const password = $('acc-password').value;
    const name = $('acc-name').value.trim();
    const box = $('acc-msg');

    if (!email || !password) { msg(box, 'Enter your email and password.', 'error'); return; }
    if (mode === 'signup' && password.length < 8) {
      msg(box, 'Password must be at least 8 characters.', 'error'); return;
    }

    const btn = $('btn-email-submit');
    btn.disabled = true;
    msg(box, 'Please wait…');

    const op = mode === 'signup'
      ? window.MSAuth.signUpWithPassword(email, password, name)
      : window.MSAuth.signInWithPassword(email, password);

    op.then(function (res) {
      btn.disabled = false;
      if (res && res.error) { msg(box, res.error.message, 'error'); return; }
      if (mode === 'signup' && res.data && res.data.user && !res.data.session) {
        msg(box, 'Check your email to confirm your account, then sign in.', 'ok');
        return;
      }
      // A live session triggers MSAuth.onChange, which re-renders.
    }).catch(function (err) {
      btn.disabled = false;
      msg(box, err.message || 'Something went wrong. Try again.', 'error');
    });
  }

  function handleForgot() {
    const email = $('acc-email').value.trim();
    const box = $('acc-msg');
    if (!email) { msg(box, 'Enter your email address first.', 'error'); return; }
    msg(box, 'Sending reset link…');
    window.MSAuth.sendPasswordReset(email).then(function (res) {
      if (res && res.error) { msg(box, res.error.message, 'error'); return; }
      msg(box, 'Reset link sent. Check your inbox.', 'ok');
    }).catch(function (err) {
      msg(box, err.message || 'Could not send the reset link.', 'error');
    });
  }

  /* ── Deletion ── */
  function wireDelete() {
    const confirmBox = $('acc-confirm');
    const input = $('acc-confirm-input');
    const confirmBtn = $('btn-delete-confirm');
    const box = $('acc-delete-msg');

    $('btn-delete').addEventListener('click', function () {
      confirmBox.style.display = '';
      $('btn-delete').style.display = 'none';
      input.focus();
    });

    $('btn-delete-cancel').addEventListener('click', function () {
      confirmBox.style.display = 'none';
      $('btn-delete').style.display = '';
      input.value = '';
      confirmBtn.disabled = true;
      msg(box, '');
    });

    input.addEventListener('input', function () {
      confirmBtn.disabled = input.value.trim() !== 'DELETE';
    });

    confirmBtn.addEventListener('click', function () {
      confirmBtn.disabled = true;
      msg(box, 'Deleting your account…');
      window.MSAuth.deleteAccount().then(function () {
        document.body.innerHTML =
          '<div class="acc-state"><div class="acc-signin-card">' +
          '<h1>Account deleted</h1>' +
          '<p class="acc-sub">Your account and all of its data have been permanently removed.</p>' +
          '<a class="btn-calculate acc-submit" href="/">Back to MeterSahi?</a>' +
          '</div></div>';
      }).catch(function (err) {
        confirmBtn.disabled = false;
        msg(box, err.message || 'Could not delete the account. Please try again.', 'error');
      });
    });
  }

  /* ── Boot ── */
  document.addEventListener('DOMContentLoaded', function () {
    $('btn-google').addEventListener('click', function () {
      window.MSAuth.signInWithProvider('google');
    });
    $('btn-facebook').addEventListener('click', function () {
      window.MSAuth.signInWithProvider('facebook');
    });
    $('btn-email-submit').addEventListener('click', handleEmailSubmit);
    $('acc-password').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') handleEmailSubmit();
    });
    $('btn-toggle-mode').addEventListener('click', function () {
      setMode(mode === 'signup' ? 'signin' : 'signup');
    });
    $('btn-forgot').addEventListener('click', handleForgot);
    $('btn-signout').addEventListener('click', function () {
      window.MSAuth.signOut().then(function () { window.location.href = '/'; });
    });
    wireDelete();
    setMode('signin');

    window.MSAuth.onChange(function (session) {
      if (session && session.user) renderSignedIn(session.user);
      else renderSignedOut();
    });

    window.MSAuth.ready().then(function (session) {
      if (session && session.user) renderSignedIn(session.user);
      else renderSignedOut();
    }).catch(function (err) {
      console.warn('auth init failed', err);
      renderSignedOut();
      msg($('acc-msg'), 'Could not reach the sign-in service. Please retry.', 'error');
    });
  });

})();
