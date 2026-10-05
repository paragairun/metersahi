/**
 * MeterSahi? - account.js
 * Behaviour for /account/. Talks only to window.MSAuth (auth.js);
 * supabase-js is never touched directly from here.
 */

'use strict';

(function () {

  const $ = function (id) { return document.getElementById(id); };
  let mode = 'signin'; // or 'signup'

  const CITY_NAME = function (slug) {
    if (!slug) return '—';
    return slug.split('-').map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  };

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

    window.MSAuth.fetchTrips(25).then(renderTrips).catch(function (e) {
      console.warn('trips failed', e);
      $('trips-body').innerHTML = '<div class="acc-empty">Could not load your trip history.</div>';
    });

    window.MSAuth.fetchReports(25).then(renderReports).catch(function (e) {
      console.warn('reports failed', e);
      $('reports-body').innerHTML = '<div class="acc-empty">Could not load your complaints.</div>';
    });
  }

  function renderTrips(rows) {
    if (!rows.length) {
      $('trips-body').innerHTML =
        '<div class="acc-empty">No fare checks yet. <a href="/">Check a fare</a> and it will appear here.</div>';
      return;
    }
    let html = '<div class="acc-table-wrap"><table class="acc-table"><thead><tr>' +
      '<th>Date</th><th>City</th><th>Route</th><th>Distance</th><th>Fare</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      const route = (r.pickup_text || '—') + ' → ' + (r.dropoff_text || '—');
      html += '<tr>' +
        '<td>' + esc(fmtDate(r.created_at)) + '</td>' +
        '<td>' + esc(CITY_NAME(r.city_slug)) +
          '<span class="acc-chip">' + (r.vehicle_type === 'taxi' ? '🚕 Taxi' : '🛺 Auto') + '</span>' +
          (r.is_night ? '<span class="acc-chip acc-chip--night">Night</span>' : '') + '</td>' +
        '<td class="acc-route">' + esc(route) + '</td>' +
        '<td>' + (r.distance_km != null ? esc(r.distance_km) + ' km' : '—') + '</td>' +
        '<td>' + (r.calculated_fare != null ? '₹' + esc(r.calculated_fare) : '—') + '</td>' +
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
      '<th>Date</th><th>Vehicle</th><th>City</th><th>Correct</th><th>Charged</th><th>Overcharge</th>' +
      '</tr></thead><tbody>';
    rows.forEach(function (r) {
      const over = (r.actual_fare_charged != null && r.calculated_fare != null)
        ? r.actual_fare_charged - r.calculated_fare : null;
      html += '<tr>' +
        '<td>' + esc(fmtDate(r.created_at)) + '</td>' +
        '<td><span class="acc-plate">' + esc(r.plate_full || '—') + '</span></td>' +
        '<td>' + esc(CITY_NAME(r.city_slug)) + '</td>' +
        '<td>' + (r.calculated_fare != null ? '₹' + esc(r.calculated_fare) : '—') + '</td>' +
        '<td>' + (r.actual_fare_charged != null ? '₹' + esc(r.actual_fare_charged) : '—') + '</td>' +
        '<td>' + (over != null
            ? '<span class="' + (over > 0 ? 'acc-over' : 'acc-ok') + '">' + (over > 0 ? '+₹' + over : '₹' + over) + '</span>'
            : '—') + '</td>' +
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
