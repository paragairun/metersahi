/**
 * MeterSahi? - complaint.js
 * Behaviour for /complaint/?r=<report id>.
 *
 * Builds a formal complaint letter out of one vehicle_reports row plus
 * that city's regulator and RTO details from cities.js. Three ways out:
 * print (the browser's own Save-as-PDF), a pre-addressed mailto, or
 * copy-to-clipboard for WhatsApp and online grievance forms.
 *
 * The report is fetched with the signed-in user's own session, so RLS -
 * not this file - is what stops anyone opening a complaint that isn't
 * theirs. A guessed id simply returns nothing.
 */

'use strict';

(function () {

  const $ = function (id) { return document.getElementById(id); };
  const CONTACT_STORAGE_KEY = 'ms_complainant';

  let report = null;
  let city   = null;

  /* ── Helpers ── */

  function show(id) { const el = $(id); if (el) el.style.display = ''; }
  function hide(id) { const el = $(id); if (el) el.style.display = 'none'; }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function money(sym, n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return null;
    return sym + Math.round(v).toLocaleString('en-IN');
  }

  function queryParam(name) {
    try { return new URLSearchParams(window.location.search).get(name); }
    catch (e) { return null; }
  }

  /** Name the authority the way that city's own page names it. */
  function authorityName(c) {
    if (!c) return 'The Regional Transport Officer';
    return c.regulatorName || ((c.state || '') + ' Motor Vehicles Department').trim();
  }

  /* ── Remembered complainant details ──
     Kept in localStorage, never sent anywhere. Wrapped because storage
     throws outright in private browsing on some browsers. */

  function loadContact() {
    try {
      const raw = localStorage.getItem(CONTACT_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  function saveContact(c) {
    try { localStorage.setItem(CONTACT_STORAGE_KEY, JSON.stringify(c)); }
    catch (e) { /* storage unavailable - the letter still works */ }
  }

  function currentContact() {
    return {
      name:  $('cmp-name').value.trim(),
      phone: $('cmp-phone').value.trim(),
      email: $('cmp-email').value.trim(),
    };
  }

  /* ── Rendering ── */

  function renderLetter() {
    const sym      = (city && city.currencySymbol) || '₹';
    const cityName = (city && city.name) || report.city_slug || 'the city';
    const isTaxi   = report.vehicle_type === 'taxi';
    const vehicle  = isTaxi ? 'Taxi' : 'Auto rickshaw';
    // "a auto rickshaw" otherwise — the article has to follow the noun.
    const vehiclePhrase = isTaxi ? 'a taxi' : 'an auto rickshaw';

    const correct = Number(report.calculated_fare);
    const charged = Number(report.actual_fare_charged);
    const excess  = (Number.isFinite(correct) && Number.isFinite(charged))
      ? charged - correct : null;

    $('cmp-today').textContent     = fmtDate(new Date().toISOString());
    $('cmp-authority').textContent = authorityName(city) + (city && city.state ? '\n' + city.state : '');

    $('cmp-intro').textContent =
      'I wish to lodge a complaint regarding ' + vehiclePhrase + ' journey in ' +
      cityName + ' on ' + fmtDate(report.created_at) + ', for which I was charged an amount ' +
      'higher than the fare payable under the notified tariff. The details are set out below.';

    $('cmp-plate').textContent     = report.plate_full || '—';
    $('cmp-vehicle').textContent   = vehicle;
    $('cmp-city').textContent      = cityName + (city && city.state ? ', ' + city.state : '');
    $('cmp-trip-date').textContent = fmtDate(report.created_at);
    $('cmp-from').textContent      = report.pickup_name || 'Not recorded';
    $('cmp-to-place').textContent  = report.dropoff_name || 'Not recorded';
    $('cmp-distance').textContent  = report.distance_km != null
      ? (Number(report.distance_km).toFixed(1) + ' km') : 'Not recorded';
    $('cmp-correct').textContent   = money(sym, correct) || 'Not recorded';
    $('cmp-charged').textContent   = money(sym, charged) || 'Not recorded';
    $('cmp-excess').textContent    = (excess != null && excess > 0)
      ? money(sym, excess) : (excess != null ? 'Nil' : 'Not recorded');

    const tariffLine = (city && city.tariffDate)
      ? (' as notified by ' + authorityName(city) + ' (' + city.tariffDate + ')')
      : '';

    $('cmp-ask').textContent =
      'The correct fare shown above was computed from the official tariff' + tariffLine +
      ', using the actual distance of the journey and the waiting time incurred. ' +
      'I request that the matter be investigated, that the vehicle\'s meter be examined ' +
      'for tampering or calibration error, and that appropriate action be taken against ' +
      'the permit holder. I am willing to provide any further information required.';

    const sig = currentContact();
    $('cmp-sign-name').textContent = sig.name || '—';
    const bits = [];
    if (sig.phone) bits.push('Phone: ' + sig.phone);
    if (sig.email) bits.push('Email: ' + sig.email);
    $('cmp-sign-contact').textContent = bits.join('  ·  ');

    $('cmp-footnote').textContent =
      'Fare computed using MeterSahi (metersahi.in), which applies the published ' +
      (city && city.state ? city.state + ' ' : '') + 'tariff to the route distance and waiting time. ' +
      'MeterSahi is not a government portal and this computation is provided for reference.';

    refreshMailto();
  }

  /** The letter as plain text, for mailto and clipboard. */
  function letterAsText() {
    const rows = Array.prototype.map.call(
      document.querySelectorAll('.cmp-table tr'),
      function (tr) {
        const th = tr.querySelector('th'), td = tr.querySelector('td');
        return th && td ? (th.textContent + ': ' + td.textContent) : '';
      }
    ).filter(Boolean);

    return [
      'Complaint: overcharging / suspected meter tampering',
      $('cmp-today').textContent,
      '',
      'To,',
      $('cmp-authority').textContent,
      '',
      'Sir / Madam,',
      '',
      $('cmp-intro').textContent,
      '',
      rows.join('\n'),
      '',
      $('cmp-ask').textContent,
      '',
      'Yours faithfully,',
      $('cmp-sign-name').textContent,
      $('cmp-sign-contact').textContent,
      '',
      $('cmp-footnote').textContent,
    ].join('\n');
  }

  /**
   * Pre-address the mail to the first RTO address this city publishes.
   * Several cities publish none, in which case the draft still opens -
   * with an empty To: line for the user to fill - rather than the button
   * doing nothing.
   */
  function refreshMailto() {
    const contacts = (city && city.rtoContact) || [];
    const to = (contacts.filter(function (r) { return r && r.email; })[0] || {}).email || '';
    const subject = 'Complaint: overcharging by ' +
      (report.vehicle_type === 'taxi' ? 'taxi' : 'auto rickshaw') + ' no.' +
      ' ' + (report.plate_full || '') + ' — ' + ((city && city.name) || report.city_slug);

    $('btn-email').setAttribute('href',
      'mailto:' + encodeURIComponent(to) +
      '?subject=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(letterAsText()));
  }

  function renderContacts() {
    const body = $('cmp-contacts');
    const list = document.createElement('div');
    list.className = 'complaint-options cmp-contacts';

    function card(icon, label, value, hint) {
      const d = document.createElement('div');
      d.className = 'complaint-card';
      const i = document.createElement('i');
      i.className = 'ti ' + icon;
      const l = document.createElement('span'); l.className = 'cc-label'; l.textContent = label;
      const v = document.createElement('span'); v.className = 'cc-value'; v.textContent = value || 'Not published';
      const h = document.createElement('span'); h.className = 'cc-hint';  h.textContent = hint || '';
      d.appendChild(i); d.appendChild(l); d.appendChild(v); d.appendChild(h);
      return d;
    }

    if (city && city.helpline) {
      list.appendChild(card('ti-phone',
        city.helplineLabel || 'State Transport Helpline',
        city.helpline,
        city.helplineHint || 'Toll-free'));
    }
    ((city && city.rtoContact) || []).forEach(function (r) {
      list.appendChild(card('ti-building-bank', r.label, r.phone, r.email));
    });
    if (city && city.onlineComplaint) {
      list.appendChild(card('ti-device-laptop',
        city.onlineComplaint.label, city.onlineComplaint.value, city.onlineComplaint.hint));
    }

    body.innerHTML = '';
    if (!list.children.length) {
      body.innerHTML = '<div class="acc-empty">No published contacts for this city yet.</div>';
      return;
    }
    body.appendChild(list);
  }

  /* ── Boot ── */

  function start(reportId) {
    window.MSAuth.fetchReport(reportId).then(function (row) {
      hide('cmp-loading');
      if (!row) { show('cmp-missing'); return; }

      report = row;
      city = (typeof CITIES !== 'undefined' && CITIES[row.city_slug]) || null;

      // Prefill from storage, then from the signed-in profile for
      // anything still blank.
      const saved = loadContact();
      const user  = window.MSAuth.getUser() || {};
      const meta  = user.user_metadata || {};
      $('cmp-name').value  = saved.name  || meta.full_name || meta.name || '';
      $('cmp-phone').value = saved.phone || '';
      $('cmp-email').value = saved.email || user.email || '';

      renderLetter();
      renderContacts();
      show('cmp-main');
    }).catch(function (err) {
      console.warn('complaint load failed', err);
      hide('cmp-loading');
      show('cmp-missing');
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    const reportId = queryParam('r');

    ['cmp-name', 'cmp-phone', 'cmp-email'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        saveContact(currentContact());
        if (report) renderLetter();
      });
    });

    $('btn-print').addEventListener('click', function () { window.print(); });

    $('btn-copy').addEventListener('click', function () {
      const text = letterAsText();
      const done = function (ok) {
        $('cmp-action-msg').textContent = ok ? 'Copied.' : "Couldn't copy — select the letter and copy manually.";
        setTimeout(function () { $('cmp-action-msg').textContent = ''; }, 2500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      } else {
        done(false);
      }
    });

    if (!reportId) { hide('cmp-loading'); show('cmp-missing'); return; }

    window.MSAuth.ready().then(function (session) {
      if (!session) { hide('cmp-loading'); show('cmp-signed-out'); return; }
      start(reportId);
    }).catch(function (err) {
      console.warn('auth init failed', err);
      hide('cmp-loading');
      show('cmp-signed-out');
    });
  });

})();
