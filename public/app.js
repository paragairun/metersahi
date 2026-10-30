/**
 * MeterSahi? - app.js
 * Shared calculator logic for all city pages.
 * Requires cities.js to be loaded first.
 * CITY_SLUG must be defined in the page before this script loads.
 *
 * CHANGELOG:
 * - Added vehicle-type toggle (Auto/Taxi). TARIFF is now resolved via
 *   getTariff(), which reads CITY.taxiTariff when 'taxi' is selected.
 *   Cities without a taxiTariff never show the toggle, so this is a
 *   no-op everywhere except Mumbai and Pune for now.
 * - Added toggleSection() for the two collapsible optional sections
 *   (Ride details / What did the driver ask?), collapsed by default.
 *   Underlying fields stay in the DOM either way, so nothing else
 *   (autoSetRideTime, calculateFare, wait-override toggle) needed to
 *   change - this is purely a visibility/CSS concern.
 */

'use strict';

/* ── Supabase (vehicle report storage) ──
   The anon key below is meant to be public - it can only INSERT into
   vehicle_reports (see supabase-schema.sql RLS policy), never read or
   modify existing rows. Data is viewed/exported via the Supabase
   dashboard, not through this key. */
const SUPABASE_URL      = 'https://uolzvbewjditinjfgdtb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_7GHLx872yuUQcn8lKcDBVw_ehC9Cx6e';

/* ── Account-aware inserts ──
   auth.js (window.MSAuth) is optional: the calculator works exactly as
   before when signed out, and these helpers then return the anon-key
   headers and a null user_id, which is what the RLS policy for `anon`
   expects. When a session exists the row is stamped with the user's id
   and sent with their access token, so it appears in their dashboard.
   user_feedback is deliberately left on the anon path - it has no
   user_id column and no authenticated-insert policy. */
function currentUserId() {
  const u = window.MSAuth && window.MSAuth.getUser && window.MSAuth.getUser();
  return u ? u.id : null;
}

/** The anon-key header set. One definition, used by every write. */
function supabaseAnonHeaders() {
  return {
    'Content-Type':  'application/json',
    'apikey':        SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Prefer':        'return=minimal',
  };
}

/**
 * The same headers, but carrying the signed-in user's access token so
 * the row is written as `authenticated` and can satisfy an own-rows RLS
 * policy. Falls back to the anon key when nobody is signed in.
 */
function supabaseWriteHeaders() {
  const session = window.MSAuth && window.MSAuth.getSession && window.MSAuth.getSession();
  const h = supabaseAnonHeaders();
  if (session && session.access_token) {
    h.Authorization = 'Bearer ' + session.access_token;
  }
  return h;
}

/**
 * POST one row to a Supabase table, rejecting with a USEFUL error when
 * the database refuses it.
 *
 * This exists because `fetch(...).catch(...)` does not catch HTTP
 * errors. A 400 or a 403 resolves the promise normally, so a write that
 * PostgREST rejected looked identical to one that succeeded, and the
 * .catch() never ran. fare_calculations silently recorded nothing for
 * days as a result: the real reason was sitting in a response body
 * nobody read. Two of the three write sites already checked res.ok by
 * hand; this makes it impossible to forget on a fourth.
 *
 * The response body is included in the error, because PostgREST puts
 * the actual cause there ("column user_id does not exist", "new row
 * violates row-level security policy") and the status code alone does
 * not distinguish a missing column from a policy refusal.
 */
function supabaseInsert(table, payload, headers) {
  return fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers || supabaseWriteHeaders(),
    body: JSON.stringify(payload),
  }).then(function (res) {
    if (res.ok) return res;
    // .text() rather than .json(): an error body is not always JSON,
    // and a parse failure here would mask the error we are reporting.
    return res.text().then(function (body) {
      throw new Error(`${table} insert failed: HTTP ${res.status} ${body || '(empty body)'}`);
    }, function () {
      throw new Error(`${table} insert failed: HTTP ${res.status} (body unreadable)`);
    });
  });
}

/* ── State ── */
let mapInstance        = null;
let directionsRenderer = null;
let mapReady           = false;
let lastRouteData      = null;

const CITY = CITIES[CITY_SLUG];
// Same currency symbol the Astro-rendered parts of the page use - this
// file (app.js) builds the fare breakdown/verdict/feedback text
// dynamically after Calculate is clicked, so it needs its own copy of
// this rather than inheriting the template's {currency} variable.
const CURRENCY = CITY.currencySymbol || '₹';

// Vehicle type toggle: 'auto' (default) or 'taxi'. Cities without a
// taxiTariff (most, for now) simply never show the toggle, so this
// always resolves to CITY.tariff for them.
let vehicleType = 'auto';
function getTariff() {
  return (vehicleType === 'taxi' && CITY.taxiTariff) ? CITY.taxiTariff : CITY.tariff;
}

window.setVehicleType = function (type) {
  if (type === vehicleType) return;
  if (type === 'taxi' && !CITY.taxiTariff) return; // guard: no taxi data for this city
  vehicleType = type;

  document.querySelectorAll('.vt-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.vehicle === type);
  });

  // Swap every tariff-dependent block on the page (tariff preview card,
  // fare chart, FAQ answers) to the selected vehicle. Without this the
  // toggle changed only the calculated fare while the rest of the page
  // kept showing auto rickshaw rates. See .vt-pane rules in style.css.
  document.documentElement.setAttribute('data-vehicle', type);

  autoSetRideTime();
  // Fare depends on the selected vehicle's tariff, so any previously
  // shown result is now stale - ask for a fresh Calculate rather than
  // risk showing a mismatched fare.
  hideResults();
};

/* ════════════════════════════════════════════
   CITY DROPDOWN (BookMyShow style)
   ════════════════════════════════════════════ */
/* ════════════════════════════════════════════
   COLLAPSIBLE SECTIONS (Ride details / What did
   the driver ask?) — collapsed by default so the
   form doesn't feel like it demands every field.
   ════════════════════════════════════════════ */
window.toggleSection = function (id) {
  const content = document.getElementById(id + '-content');
  const chevron = document.getElementById(id + '-chevron');
  if (!content) return;
  const isOpen = content.classList.toggle('expanded');
  if (chevron) chevron.classList.toggle('expanded', isOpen);
};

function buildCityDropdown() {
  const trigger  = document.getElementById('city-dropdown-trigger');
  const panel    = document.getElementById('city-dropdown-panel');
  const search   = document.getElementById('city-search-input');
  const grid     = document.getElementById('city-dropdown-grid');
  if (!trigger || !panel) return;

  // Populate grid - filtered to cities in the same country as the
  // current page, so a Bangkok visitor sees Thai cities, not Indian ones.
  function renderCities(filter) {
    const q = (filter || '').toLowerCase();
    const currentCountry = (CITIES[CITY_SLUG] && CITIES[CITY_SLUG].country) || 'India';
    grid.innerHTML = '';
    CITY_LIST
      .filter(slug => (CITIES[slug].country || 'India') === currentCountry)
      .filter(slug => !q || CITIES[slug].name.toLowerCase().includes(q))
      .forEach(slug => {
        const c   = CITIES[slug];
        const btn = document.createElement('a');
        btn.href  = `/${slug}/`;
        btn.className = 'cd-city-btn' + (slug === CITY_SLUG ? ' active' : '');
        btn.innerHTML = `<span class="cd-city-name">${c.name}</span><span class="cd-city-state">${c.state}</span>`;
        grid.appendChild(btn);
      });
    if (!grid.innerHTML) grid.innerHTML = '<div class="cd-no-results">No cities found</div>';
  }
  renderCities('');

  // Toggle
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = panel.classList.toggle('open');
    if (open) { search.value = ''; renderCities(''); setTimeout(() => search.focus(), 50); }
  });
  search.addEventListener('input', () => renderCities(search.value));
  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && e.target !== trigger) panel.classList.remove('open');
  });
  search.addEventListener('keydown', e => { if (e.key === 'Escape') panel.classList.remove('open'); });
}

/* ════════════════════════════════════════════
   GOOGLE MAPS INIT
   Maps JS API is used only for:
     - Map canvas rendering
     - Places Autocomplete (address search)
     - Drawing the route polyline
   Route calculation now uses the Routes API
   (REST POST) — not DirectionsService.
   ════════════════════════════════════════════ */
window.initMap = function () {
  try {
    // DirectionsRenderer for drawing the polyline on the map
    directionsRenderer = new google.maps.DirectionsRenderer({
      suppressMarkers: false,
      preserveViewport: false,
      polylineOptions: { strokeColor: '#f59e0b', strokeWeight: 4, strokeOpacity: 0.85 },
    });
    mapInstance = new google.maps.Map(document.getElementById('map'), {
      zoom: 13,
      center: CITY.mapCenter,
      disableDefaultUI: true,
      zoomControl: true,
      styles: [
        { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', elementType: 'labels', stylers: [{ visibility: 'off' }] },
      ],
    });
    directionsRenderer.setMap(mapInstance);

    // Places Autocomplete — unchanged, still uses Maps JS API
    const b = CITY.acBounds;
    const bounds = new google.maps.LatLngBounds(
      new google.maps.LatLng(b.sw.lat, b.sw.lng),
      new google.maps.LatLng(b.ne.lat, b.ne.lng)
    );
    // Country restriction must match the CITY being searched, not the
    // visitor's own location - was hardcoded to India for every city,
    // silently breaking address search on Bangkok (and any future
    // non-Indian city) since Thai addresses were being filtered out.
    const acCountryCode = (CITY.countryCode || 'IN').toLowerCase();
    const acOptions = { bounds, strictBounds: false, componentRestrictions: { country: acCountryCode } };
    // Each picker records the place the user actually chooses, so the
    // route is computed between those two points rather than between
    // whatever their names geocode back to.
    attachPlacePicker(document.getElementById('pickup'),  'pickup',  acOptions);
    attachPlacePicker(document.getElementById('dropoff'), 'dropoff', acOptions);

    mapReady = true;
  } catch (err) {
    console.warn('Maps init error:', err);
    mapReady = false;
  }

  // First action once Maps is ready: try to auto-fill pickup with the
  // user's current location. Falls back silently to normal manual
  // typing (the pre-existing flow) if permission is denied,
  // unavailable, or times out - never blocks or shows an error, just
  // leaves the field empty for the user to type into as before.
  // Kept outside the try/catch above so a geolocation issue can never
  // be mistaken for a map-init failure.
  if (mapReady) {
    try { attemptAutoLocate(); } catch (err) { console.warn('Auto-locate error:', err); }
  }
};

/**
 * Attempts to fill the pickup field with the user's current location.
 * Called automatically once on map init, and re-triggerable any time
 * via the location button next to the pickup field (e.g. if the user
 * initially denied permission and changes their mind).
 */
window.attemptAutoLocate = function () {
  const statusEl  = document.getElementById('locate-status');
  const locateBtn = document.getElementById('locate-btn');

  if (!navigator.geolocation) {
    // No geolocation support - fall back to a saved Home if there is
    // one, otherwise to manual entry exactly as before.
    geoAttemptFailed = true;
    maybeApplyHomeFallback();
    return;
  }

  if (statusEl) { statusEl.textContent = 'Detecting your location…'; statusEl.className = 'locate-status locate-status--loading'; }
  if (locateBtn) locateBtn.classList.add('locating');

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (locateBtn) locateBtn.classList.remove('locating');
      reverseGeocodeAndFillPickup(pos.coords.latitude, pos.coords.longitude);
    },
    (err) => {
      // Denied, unavailable, or timed out - fall back silently to the
      // pre-existing manual-typing flow. Not an error state for the
      // user, just means we couldn't skip a step for them this time.
      console.warn('Geolocation unavailable:', err.message);
      if (locateBtn) locateBtn.classList.remove('locating');
      if (statusEl) { statusEl.textContent = ''; statusEl.className = 'locate-status'; }
      // A denied prompt used to leave the user with an empty box and
      // nothing to show for it. Use their saved Home instead, if the
      // places have loaded; if they haven't yet, loadSavedPlaces() will
      // retry this the moment they do.
      geoAttemptFailed = true;
      maybeApplyHomeFallback();
    },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
  );
};

function reverseGeocodeAndFillPickup(lat, lng) {
  const statusEl = document.getElementById('locate-status');
  if (!window.google || !google.maps || !google.maps.Geocoder) {
    if (statusEl) { statusEl.textContent = ''; statusEl.className = 'locate-status'; }
    return;
  }
  const geocoder = new google.maps.Geocoder();
  geocoder.geocode({ location: { lat, lng } }, (results, status) => {
    if (status === 'OK' && results && results[0]) {
      const pickupInput = document.getElementById('pickup');
      if (pickupInput) {
        pickupInput.value = results[0].formatted_address;
        // The GPS fix is the most precise thing this field will ever
        // have. Record the coordinates themselves — deliberately NOT
        // the reverse-geocoded place id, which is the building or
        // locality the address names rather than where the user is
        // standing — so the route starts from the actual spot instead
        // of wherever that formatted address geocodes back to.
        resolvedPoints.pickup = { placeId: null, lat, lng, text: pickupInput.value };
        // The best moment to offer "save this as Home" is right after a
        // GPS fix named the place, so surface the Save chip now.
        renderSavedPlaceRows();
      }
      if (statusEl) { statusEl.textContent = 'Using your current location'; statusEl.className = 'locate-status locate-status--success'; }
    } else {
      // Reverse geocode failed - leave pickup empty for manual entry
      // rather than showing a raw lat/lng or an error.
      if (statusEl) { statusEl.textContent = ''; statusEl.className = 'locate-status'; }
    }
  });
}

// Alias exposed to the "use current location" button next to the pickup field
window.useCurrentLocation = window.attemptAutoLocate;

window.handleMapError = function () { mapReady = false; };

/* ════════════════════════════════════════════
   RESOLVED ENDPOINTS
   The single source of truth for WHERE a route
   starts and ends.

   The Routes API will take a waypoint as a place
   id, as a lat/lng, or as free text. Text is the
   worst of the three: Google has to geocode it
   again, and the point it lands on need not be
   the one the user picked from the autocomplete
   dropdown. That is how the site can report a
   different distance from Google Maps for what
   looks like the same journey.

   So whenever a precise point IS known — the
   user chose a prediction, or the browser handed
   us a GPS fix — it is recorded here and sent
   instead of the text. Free text remains the
   fallback for someone who types an address and
   presses Calculate without picking anything.
   ════════════════════════════════════════════ */
const resolvedPoints = { pickup: null, dropoff: null };

function normaliseAddressText(s) {
  return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The recorded point for a field, but only while it still describes
 * what is actually in the box. If someone picks "Juhu Beach" and then
 * edits the text, the stored point is stale: routing from it would
 * quietly ignore what they typed and send them somewhere else.
 */
function resolvedPointFor(fieldId, currentText) {
  const p = resolvedPoints[fieldId];
  if (!p) return null;
  return normaliseAddressText(p.text) === normaliseAddressText(currentText) ? p : null;
}

/**
 * Number.isFinite rather than a truthiness check, because Number(null),
 * Number('') and Number(false) are all 0 — a real coordinate in the
 * Gulf of Guinea. 0,0 is rejected for the same reason: no address in
 * any city this site covers resolves there, so it only ever means the
 * value was missing.
 */
function isUsableCoordPair(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/** Append the city when the text does not already name it. */
function withCityContext(text, cityName) {
  const t    = String(text == null ? '' : text).trim();
  const city = String(cityName == null ? '' : cityName).trim();
  if (!city) return t;
  return t.toLowerCase().includes(city.toLowerCase()) ? t : t + ', ' + city + ', India';
}

/**
 * One end of the journey as a Routes API waypoint, in order of
 * precision: place id, then coordinates, then the typed text.
 */
function routeWaypoint(resolved, rawText, cityName) {
  if (resolved && resolved.placeId) {
    return { placeId: resolved.placeId };
  }
  if (resolved && isUsableCoordPair(resolved.lat, resolved.lng)) {
    return { location: { latLng: { latitude: resolved.lat, longitude: resolved.lng } } };
  }
  return { address: withCityContext(rawText, cityName) };
}

/**
 * Wires one input to Places Autocomplete and records whatever the user
 * picks. Kept in one function so pickup and dropoff cannot drift apart.
 */
function attachPlacePicker(input, fieldId, acOptions) {
  if (!input) return null;

  const ac = new google.maps.places.Autocomplete(input, Object.assign({}, acOptions, {
    // Only the fields actually used below. Asking for more moves the
    // call into a dearer Places billing tier for no benefit.
    fields: ['place_id', 'geometry.location', 'formatted_address', 'name'],
  }));

  ac.addListener('place_changed', function () {
    const place = ac.getPlace();
    // Pressing Enter without choosing a prediction returns an object
    // with neither an id nor geometry. Treat that as "nothing picked"
    // so the text fallback runs, rather than storing a half-filled
    // place that would route from nowhere in particular.
    if (!place || (!place.place_id && !(place.geometry && place.geometry.location))) {
      resolvedPoints[fieldId] = null;
      return;
    }
    const loc = place.geometry && place.geometry.location;
    resolvedPoints[fieldId] = {
      placeId: place.place_id || null,
      lat: loc && typeof loc.lat === 'function' ? loc.lat() : undefined,
      lng: loc && typeof loc.lng === 'function' ? loc.lng() : undefined,
      // The widget has already written its own text into the box by the
      // time this fires, so record exactly that — the staleness check
      // then compares like with like.
      text: input.value,
    };
  });

  // Typing after choosing invalidates the choice.
  input.addEventListener('input', function () {
    if (resolvedPointFor(fieldId, input.value) === null) resolvedPoints[fieldId] = null;
  });

  return ac;
}

/* ════════════════════════════════════════════
   SAVED PLACES  (signed-in only)

   Home / Work / named favourites, stored per user
   in saved_places. Two jobs here:

     1. one-tap fill — a chip row under pickup and
        under drop-off. Tapping a chip writes the
        address AND the stored place id/coords into
        resolvedPoints, so a saved place routes from
        the exact point the user originally picked
        rather than being re-geocoded every trip.

     2. save — the place id and coordinates only
        exist on this page, where Autocomplete just
        handed them over. So saving happens here;
        /account/ only lists and removes.

   Everything degrades to nothing when logged out:
   the rows stay display:none and the calculator is
   byte-for-byte the flow it was before.
   ════════════════════════════════════════════ */
let savedPlaces = [];
// Set when a geolocation attempt has already failed, so that saved
// places arriving later (they load async) can still fill the pickup
// that geolocation couldn't.
let geoAttemptFailed = false;

const PLACE_KIND_ICON = { home: 'ti-home', work: 'ti-briefcase', other: 'ti-star' };

function isSignedIn() {
  return !!(window.MSAuth && window.MSAuth.isSignedIn && window.MSAuth.isSignedIn());
}

/**
 * Places worth offering on THIS city's page. A Home saved in Ahmedabad
 * is not a usable pickup on the Mumbai page — it would route across the
 * country — so anything stamped with a different city is left out.
 * Rows saved before city_slug existed (null) are kept rather than
 * silently vanishing.
 */
function placesForThisCity() {
  return savedPlaces.filter(function (p) {
    return !p.city_slug || p.city_slug === CITY_SLUG;
  });
}

/** Write a saved place into a field, carrying its precision with it. */
function fillFieldFromPlace(fieldId, place) {
  const input = document.getElementById(fieldId);
  if (!input || !place) return;
  input.value = place.address;
  resolvedPoints[fieldId] = {
    placeId: place.place_id || null,
    lat: Number.isFinite(place.lat) ? place.lat : undefined,
    lng: Number.isFinite(place.lng) ? place.lng : undefined,
    text: place.address,
  };
  if (fieldId === 'pickup') {
    const statusEl = document.getElementById('locate-status');
    if (statusEl) {
      statusEl.textContent = 'Using your saved ' + place.label;
      statusEl.className = 'locate-status locate-status--success';
    }
  }
  // Setting .value in code fires no 'input' event, so the Save chip
  // would otherwise stay hidden until the user typed something.
  renderSavedPlaceRows();
}

function chipButton(label, iconClass, onClick, extraClass) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sp-chip' + (extraClass ? ' ' + extraClass : '');
  const i = document.createElement('i');
  i.className = 'ti ' + iconClass;
  b.appendChild(i);
  // textContent, never innerHTML: labels and addresses are user input.
  b.appendChild(document.createTextNode(' ' + label));
  b.addEventListener('click', onClick);
  return b;
}

function renderSavedPlaceRows() {
  ['pickup', 'dropoff'].forEach(function (fieldId) {
    const row = document.getElementById('saved-places-' + fieldId);
    if (!row) return;

    if (!isSignedIn()) {
      row.style.display = 'none';
      row.textContent = '';
      return;
    }

    row.textContent = '';
    const mine = placesForThisCity();

    mine.forEach(function (p) {
      const chip = chipButton(
        p.label,
        PLACE_KIND_ICON[p.kind] || PLACE_KIND_ICON.other,
        function () { fillFieldFromPlace(fieldId, p); },
        'sp-chip--' + p.kind
      );
      chip.title = p.address;
      row.appendChild(chip);
    });

    const input = document.getElementById(fieldId);
    const hasText = !!(input && input.value.trim());
    // Nothing saved and nothing typed yet: an empty "Save" chip on its
    // own is just noise, so the row stays hidden until there is either
    // something to use or something to save.
    if (!mine.length && !hasText) {
      row.style.display = 'none';
      return;
    }
    if (hasText) {
      row.appendChild(chipButton('Save', 'ti-bookmark-plus', function () {
        openSavePlacePopover(fieldId);
      }, 'sp-chip--save'));
    }
    row.style.display = 'flex';
  });
}

/** Re-render the Save chip as a field gains or loses text. */
function watchFieldsForSaveChip() {
  ['pickup', 'dropoff'].forEach(function (fieldId) {
    const input = document.getElementById(fieldId);
    if (!input) return;
    let last = input.value.trim() !== '';
    input.addEventListener('input', function () {
      const now = input.value.trim() !== '';
      if (now !== last) { last = now; renderSavedPlaceRows(); }
    });
  });
}

/**
 * The save popover: Home, Work, or a custom label. Deliberately not
 * window.prompt() — it is blocked inside the Capacitor WebView and
 * blocks every subsequent event when it does appear.
 */
window.openSavePlacePopover = function (fieldId) {
  const pop = document.getElementById('save-place-popover');
  const row = document.getElementById('saved-places-' + fieldId);
  if (!pop || !row) return;

  const input = document.getElementById(fieldId);
  const address = input ? input.value.trim() : '';
  if (!address) return;

  pop.dataset.field = fieldId;
  document.getElementById('sp-pop-address').textContent = address;
  document.getElementById('sp-pop-label').value = '';
  document.getElementById('sp-pop-msg').textContent = '';
  // Move it under the row that asked for it, so it reads as attached to
  // that field rather than floating over the form.
  row.insertAdjacentElement('afterend', pop);
  pop.style.display = 'block';
};

window.closeSavePlacePopover = function () {
  const pop = document.getElementById('save-place-popover');
  if (pop) pop.style.display = 'none';
};

/**
 * Persist whatever is currently in the field as `kind`. The resolved
 * point is read through resolvedPointFor(), so an address the user
 * edited after picking it is saved as text only rather than with coords
 * that no longer match what the box says.
 */
window.saveCurrentPlace = function (kind) {
  const pop = document.getElementById('save-place-popover');
  if (!pop) return;
  const fieldId = pop.dataset.field || 'pickup';
  const input   = document.getElementById(fieldId);
  const msgEl   = document.getElementById('sp-pop-msg');
  const address = input ? input.value.trim() : '';
  if (!address) return;

  let label;
  if (kind === 'home')      label = 'Home';
  else if (kind === 'work') label = 'Work';
  else {
    label = document.getElementById('sp-pop-label').value.trim();
    if (!label) { msgEl.textContent = 'Give this place a name first.'; return; }
  }

  const resolved = resolvedPointFor(fieldId, address);
  msgEl.textContent = 'Saving…';

  window.MSAuth.saveSavedPlace({
    kind:      kind,
    label:     label,
    address:   address,
    place_id:  resolved ? resolved.placeId : null,
    lat:       resolved ? resolved.lat : null,
    lng:       resolved ? resolved.lng : null,
    city_slug: CITY_SLUG,
  }).then(function () {
    return loadSavedPlaces();
  }).then(function () {
    window.closeSavePlacePopover();
  }).catch(function (err) {
    console.warn('Saving place failed:', err);
    msgEl.textContent = err.message || "Couldn't save that. Try again.";
  });
};

function loadSavedPlaces() {
  if (!isSignedIn()) {
    savedPlaces = [];
    renderSavedPlaceRows();
    return Promise.resolve([]);
  }
  return window.MSAuth.fetchSavedPlaces().then(function (rows) {
    savedPlaces = rows || [];
    renderSavedPlaceRows();
    maybeApplyHomeFallback();
    return savedPlaces;
  }).catch(function (err) {
    console.warn('Saved places unavailable:', err);
    return [];
  });
}

/**
 * Geolocation gets denied often, and until now that left the pickup box
 * empty with nothing to show for the prompt. A signed-in user with a
 * saved Home gets it filled instead.
 */
function maybeApplyHomeFallback() {
  if (!geoAttemptFailed) return;
  const input = document.getElementById('pickup');
  if (!input || input.value.trim()) return; // never overwrite typing
  const home = placesForThisCity().filter(function (p) { return p.kind === 'home'; })[0];
  if (!home) return;
  fillFieldFromPlace('pickup', home);
  renderSavedPlaceRows();
}

/* ════════════════════════════════════════════
   RE-RUN A PAST TRIP
   /account/ links back here as
   /<city>/?from=…&to=…&v=auto|taxi&run=1
   so a row in the trip history becomes one tap
   instead of retyping both ends.
   ════════════════════════════════════════════ */
function applyTripFromQuery() {
  let q;
  try { q = new URLSearchParams(window.location.search); } catch (e) { return; }

  const CAP = 200; // same ceiling the address inputs accept
  const from = (q.get('from') || '').trim().slice(0, CAP);
  const to   = (q.get('to')   || '').trim().slice(0, CAP);
  const v    = q.get('v');
  const run  = q.get('run') === '1';

  if (v === 'taxi' && CITY.taxiTariff) window.setVehicleType('taxi');

  const pickupEl  = document.getElementById('pickup');
  const dropoffEl = document.getElementById('dropoff');

  // Text only: fare_calculations stores the typed address, not the place
  // id, so these go in as free text and routeWaypoint() geocodes them.
  // resolvedPoints is cleared so a stale point can't be paired with it.
  if (from && pickupEl)  { pickupEl.value  = from; resolvedPoints.pickup  = null; }
  if (to   && dropoffEl) { dropoffEl.value = to;   resolvedPoints.dropoff = null; }

  if (run && from && to) {
    const statusEl = document.getElementById('locate-status');
    if (statusEl) {
      statusEl.textContent = 'Re-running your saved trip…';
      statusEl.className = 'locate-status locate-status--loading';
    }
    // Deliberately after the current tick: setVehicleType() above calls
    // hideResults(), and calculating in the same tick would race it.
    setTimeout(function () { window.calculateFare(); }, 0);
  }

  return !!(from || to);
}

/* ════════════════════════════════════════════
   ROUTES API — REST call
   Replaces the old DirectionsService.
   Endpoint: routes.googleapis.com/directions/v2:computeRoutes
   Field mask requests only what we need to
   keep billing events at the Essentials tier.
   ════════════════════════════════════════════ */
const ROUTES_API_KEY = 'AIzaSyC--1rhnaUVZOO8eiq11EAiB3nEZhMvdhM';
const ROUTES_ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';

function parseDurationSecs(durationStr) {
  // Routes API returns duration as "123s" string
  if (!durationStr) return 0;
  return parseInt(durationStr.replace('s', ''), 10) || 0;
}

function computeRoutesAPI(originAddress, destinationAddress) {
  // NOTE: departureTime intentionally omitted - Routes API defaults to
  // "now" server-side. Setting it client-side risks it being resolved
  // as a past timestamp by the time the request reaches Google's
  // servers, which triggers a 400 INVALID_ARGUMENT ("Timestamp must
  // be set to a future time.").
  const cityName = CITY.name;

  const body = {
    // Place id or coordinates when the user picked a real place, the
    // typed text only as a fallback. See RESOLVED ENDPOINTS above.
    origin:      routeWaypoint(resolvedPointFor('pickup',  originAddress),      originAddress,      cityName),
    destination: routeWaypoint(resolvedPointFor('dropoff', destinationAddress), destinationAddress, cityName),
    travelMode:  'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
    computeAlternativeRoutes: false,
    languageCode: 'en-IN',
    units: 'METRIC',
  };

  return fetch(ROUTES_ENDPOINT, {
    method:  'POST',
    headers: {
      'Content-Type':       'application/json',
      'X-Goog-Api-Key':     ROUTES_API_KEY,
      // Field mask — request only what we need
      // staticDuration = free-flow, duration = traffic-aware
      // Keeps billing at Essentials tier (no traffic-on-polyline surcharge)
      'X-Goog-FieldMask':   'routes.distanceMeters,routes.duration,routes.staticDuration,routes.polyline.encodedPolyline,routes.legs.startLocation,routes.legs.endLocation',
    },
    body: JSON.stringify(body),
  }).then(function(res) { return res.json(); });
}

/* ════════════════════════════════════════════
   FARE CALCULATION
   ════════════════════════════════════════════ */
window.calculateFare = function () {
  const pickup  = document.getElementById('pickup').value.trim();
  const dropoff = document.getElementById('dropoff').value.trim();
  if (!pickup || !dropoff) { alert('Please enter both pickup and drop-off.'); return; }

  scheduleFeedbackDialog();

  const isNight     = document.getElementById('ride-time').value === 'night';
  const luggage     = parseInt(document.getElementById('luggage').value, 10);
  const actualFare  = parseActualFare();
  const waitOverride = parseWaitOverride();

  setLoading(true);
  hideResults();

  computeRoutesAPI(pickup, dropoff)
    .then(function(data) {
      setLoading(false);
      if (data.routes && data.routes.length > 0) {
        handleRoutesResult(data.routes[0], isNight, luggage, actualFare, pickup, dropoff, waitOverride);
        // lastRouteData is populated synchronously inside
        // handleRoutesResult/renderResults, so it's safe to read here.
        const rd = lastRouteData || {};
        logFareCalculation({
          pickup, dropoff, isNight, luggage, succeeded: true,
          distanceKm: rd.distKm, calculatedFare: rd.calculatedFare,
        });
      } else {
        console.warn('Routes API returned no routes:', data);
        showManualFallback(pickup, dropoff, isNight, luggage, actualFare, waitOverride);
        logFareCalculation({ pickup, dropoff, isNight, luggage, succeeded: false });
      }
    })
    .catch(function(err) {
      setLoading(false);
      console.warn('Routes API error:', err);
      showManualFallback(pickup, dropoff, isNight, luggage, actualFare, waitOverride);
      logFareCalculation({ pickup, dropoff, isNight, luggage, succeeded: false });
    });
};

/**
 * Logs one row per "Calculate correct fare" press to the
 * fare_calculations table - separate from vehicle_reports, which only
 * logs when someone reports a mismatch. Fire-and-forget: never blocks
 * or interrupts the user's flow, and a logging failure is silently
 * swallowed (console-warned only) since this is analytics, not a
 * feature the user is relying on.
 */
function logFareCalculation({ pickup, dropoff, isNight, luggage, succeeded, distanceKm, calculatedFare }) {
  const payload = {
    city_slug:       CITY_SLUG,
    vehicle_type:    vehicleType,
    pickup_text:     pickup || null,
    dropoff_text:    dropoff || null,
    is_night:        !!isNight,
    luggage_count:   Number.isFinite(luggage) ? luggage : 0,
    succeeded:       !!succeeded,
    distance_km:     distanceKm != null ? Math.round(distanceKm * 100) / 100 : null,
    calculated_fare: calculatedFare != null ? Math.round(calculatedFare) : null,
    user_id:         currentUserId(),
  };

  // Still fire-and-forget - a logging failure must never interrupt the
  // user - but a REJECTED write now says so, loudly, with the reason.
  supabaseInsert('fare_calculations', payload).catch(function (err) {
    console.error('Fare calculation logging failed (non-blocking):', err.message);
  });
}

function handleRoutesResult(route, isNight, luggage, actualFare, pickup, dropoff, waitOverride) {
  const TARIFF = getTariff();
  const distKm             = route.distanceMeters / 1000;
  // duration = traffic-aware, staticDuration = free-flow
  const durationTrafficSec = parseDurationSecs(route.duration);
  const durationFreeSec    = parseDurationSecs(route.staticDuration || route.duration);
  const totalMinutes       = durationTrafficSec / 60;
  const trafficDelaySec    = Math.max(0, durationTrafficSec - durationFreeSec);
  const estimatedWait      = (trafficDelaySec * TARIFF.STANDSTILL_FACTOR) / 60;
  const waitMinutes        = (waitOverride !== null && waitOverride !== undefined) ? waitOverride : estimatedWait;
  const isWaitOverridden   = (waitOverride !== null && waitOverride !== undefined);

  // Extract coordinates from legs for deep links
  const leg        = route.legs && route.legs[0];
  const pickupLat  = leg && leg.startLocation && leg.startLocation.latLng ? leg.startLocation.latLng.latitude  : '';
  const pickupLng  = leg && leg.startLocation && leg.startLocation.latLng ? leg.startLocation.latLng.longitude : '';
  const dropLat    = leg && leg.endLocation   && leg.endLocation.latLng   ? leg.endLocation.latLng.latitude    : '';
  const dropLng    = leg && leg.endLocation   && leg.endLocation.latLng   ? leg.endLocation.latLng.longitude   : '';

  lastRouteData = { distKm, totalMinutes, waitMinutes, isNight, luggage, actualFare, isWaitOverridden, pickupName: pickup, dropName: dropoff };
  const fare = renderResults(distKm, totalMinutes, waitMinutes, isNight, luggage, actualFare, isWaitOverridden,
    pickup, dropoff, pickupLat, pickupLng, dropLat, dropLng);
  if (fare) lastRouteData.calculatedFare = fare.subtotal;

  // Draw route on map using the encoded polyline from the response
  if (mapInstance && directionsRenderer && route.polyline && route.polyline.encodedPolyline) {
    const decodedPath = google.maps.geometry.encoding.decodePath(route.polyline.encodedPolyline);
    const bounds = new google.maps.LatLngBounds();
    decodedPath.forEach(function(pt) { bounds.extend(pt); });

    // Draw as a plain Polyline since we no longer use DirectionsResult
    if (window._routePolyline) window._routePolyline.setMap(null);
    window._routePolyline = new google.maps.Polyline({
      path:          decodedPath,
      strokeColor:   '#f59e0b',
      strokeWeight:  4,
      strokeOpacity: 0.85,
      map:           mapInstance,
    });

    // Add start/end markers
    if (window._routeMarkers) window._routeMarkers.forEach(function(m) { m.setMap(null); });
    window._routeMarkers = [
      new google.maps.Marker({ position: decodedPath[0],                       map: mapInstance }),
      new google.maps.Marker({ position: decodedPath[decodedPath.length - 1],  map: mapInstance }),
    ];

    mapInstance.fitBounds(bounds, { padding: 40 });
  }
}

/* ════════════════════════════════════════════
   RENDER RESULTS
   ════════════════════════════════════════════ */
function renderResults(distKm, totalMin, waitMin, isNight, luggage, actualFare, isWaitOverridden,
  pickupName, dropName, pickupLat, pickupLng, dropLat, dropLng) {
  const TARIFF = getTariff();
  const fare = computeFare(distKm, waitMin, isNight, luggage, TARIFF);

  document.getElementById('empty-state').style.display    = 'none';
  document.getElementById('result-content').style.display = 'flex';

  // On mobile, the results panel sits below the form instead of beside
  // it (see .main-grid's 760px breakpoint), so it's off-screen until
  // the user scrolls. Bring it into view automatically once a fare is
  // actually calculated. Desktop is untouched - the results are
  // already visible side-by-side there, so scrolling would just be
  // disorienting.
  if (window.innerWidth <= 760) {
    requestAnimationFrame(function () {
      document.getElementById('result-content').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  const waitMins = Math.floor(waitMin);
  const waitSecs = Math.round((waitMin % 1) * 60);
  const waitLabel = isWaitOverridden ? 'your reported time' : 'est. standstill';
  const waitClass = isWaitOverridden ? 'metric-unit overridden' : 'metric-unit';

  document.getElementById('metrics-row').innerHTML = `
    <div class="metric-card">
      <div class="metric-label"><i class="ti ti-road"></i> Distance</div>
      <div class="metric-value">${distKm.toFixed(1)}</div>
      <div class="metric-unit">km</div>
    </div>
    <div class="metric-card">
      <div class="metric-label"><i class="ti ti-clock"></i> Journey</div>
      <div class="metric-value">${Math.round(totalMin)}</div>
      <div class="metric-unit">min (traffic)</div>
    </div>
    <div class="metric-card">
      <div class="metric-label"><i class="ti ti-traffic-cone"></i> Wait</div>
      <div class="metric-value">${waitMins}m ${waitSecs}s</div>
      <div class="${waitClass}">${waitLabel}</div>
    </div>`;

  // Verdict
  const verdictEl = document.getElementById('verdict-box');
  if (actualFare !== null) {
    const low  = fare.subtotal - TARIFF.TOLERANCE;
    const high = fare.subtotal + TARIFF.TOLERANCE;
    const diff = actualFare - fare.subtotal;
    if (actualFare >= low && actualFare <= high) {
      verdictEl.innerHTML = `<div class="verdict--ok">
        <div class="verdict-emoji">✅</div>
        <div class="verdict-title">Meter looks correct</div>
        <div class="verdict-body">Driver charged <strong>${CURRENCY}${actualFare}</strong> — within ±${CURRENCY}${TARIFF.TOLERANCE} of the correct fare <strong>${CURRENCY}${fare.subtotal}</strong>.</div>
      </div>`;
    } else if (actualFare > high) {
      const pct = Math.round((diff / fare.subtotal) * 100);
      verdictEl.innerHTML = `<div class="verdict--tampered">
        <div class="verdict-emoji">🚨</div>
        <div class="verdict-title">Possible meter tampering</div>
        <div class="verdict-body">Driver charged <strong>${CURRENCY}${actualFare}</strong> but correct fare is <strong>${CURRENCY}${fare.subtotal}</strong>. That's <span class="overcharge-amount">${CURRENCY}${diff} extra (${pct}% overcharge)</span>.</div>
      </div>`;
    } else {
      verdictEl.innerHTML = `<div class="verdict--neutral">
        <div class="verdict-emoji">ℹ️</div>
        <div class="verdict-title">Fare is lower than expected</div>
        <div class="verdict-body">Driver charged <strong>${CURRENCY}${actualFare}</strong>, estimate is <strong>${CURRENCY}${fare.subtotal}</strong>. Driver may have taken a shorter route.</div>
      </div>`;
    }
  } else {
    verdictEl.innerHTML = `<div class="verdict--neutral">
      <div class="verdict-emoji">🧮</div>
      <div class="verdict-title">Correct fare: ${CURRENCY}${fare.subtotal}</div>
      <div class="verdict-body">Acceptable range: <strong>${CURRENCY}${fare.subtotal - TARIFF.TOLERANCE} – ${CURRENCY}${fare.subtotal + TARIFF.TOLERANCE}</strong>.</div>
    </div>`;
  }

  // Breakdown
  const freeWait = TARIFF.WAIT_FREE_MINS || 0;
  let rows = `<div class="breakdown-row"><span>Base fare (${distKm.toFixed(1)} km${distKm <= TARIFF.MIN_KM ? ', minimum' : ''})</span><span class="amount">${CURRENCY}${fare.base}</span></div>`;
  if (fare.waitCharge > 0) {
    rows += `<div class="breakdown-row"><span>Wait time (${waitMins}m ${waitSecs}s${freeWait > 0 ? `, first ${freeWait}m free` : ''})</span><span class="amount">${CURRENCY}${fare.waitCharge}</span></div>`;
  }
  if (fare.luggageCharge > 0) {
    rows += `<div class="breakdown-row"><span>Luggage (${luggage} piece${luggage > 1 ? 's' : ''})</span><span class="amount">${CURRENCY}${fare.luggageCharge}</span></div>`;
  }
  if (isNight && fare.nightAdd > 0) {
    const pct = Math.round((TARIFF.NIGHT_MULTIPLIER - 1) * 100);
    rows += `<div class="breakdown-row"><span>Night surcharge (+${pct}%)</span><span class="amount">+${CURRENCY}${fare.nightAdd}</span></div>`;
  }
  rows += `<div class="breakdown-row total-row"><span>Total correct fare</span><span class="amount">${CURRENCY}${fare.subtotal}</span></div>`;

  document.getElementById('breakdown-box').innerHTML = `
    <div class="breakdown-title">Fare breakdown</div>
    ${rows}
    <div class="fare-band-label">Tolerance band: ${CURRENCY}${fare.subtotal - TARIFF.TOLERANCE} – ${CURRENCY}${fare.subtotal + TARIFF.TOLERANCE}</div>`;

  // Feedback
  const fb = document.getElementById('feedback-section');
  if (fb) {
    fb.style.display = 'block';
    const fbQuestion = document.getElementById('feedback-question-text');
    if (fbQuestion) {
      fbQuestion.textContent = `Is your actual fare higher than the ${CURRENCY}${fare.subtotal - TARIFF.TOLERANCE}–${CURRENCY}${fare.subtotal + TARIFF.TOLERANCE} range?`;
    }
    document.querySelectorAll('.feedback-btn').forEach(b => {
      b.classList.remove('selected', 'pulse');
      const icon = b.querySelector('.ti');
      if (icon && icon.dataset.originalClass) icon.className = icon.dataset.originalClass;
    });
    const reportSection = document.getElementById('report-vehicle-section');
    if (reportSection) reportSection.style.display = 'none';
    const conf = document.getElementById('report-confirmation');
    if (conf) conf.style.display = 'none';
    const btn = document.getElementById('btn-submit-report');
    if (btn) btn.style.display = 'flex';
    const thanks = document.getElementById('feedback-thanks');
    if (thanks) thanks.style.display = 'none';
  }

  document.getElementById('manual-fallback').style.display = 'none';

  // Ride comparison — shown after fare is calculated
  if (typeof renderRideComparison === 'function' && pickupName) {
    renderRideComparison(
      distKm, waitMin, fare.subtotal,
      pickupName, dropName,
      pickupLat, pickupLng, dropLat, dropLng
    );
  }

  return fare;
}

/* ════════════════════════════════════════════
   FEEDBACK FLOW
   ════════════════════════════════════════════ */
window.handleFeedback = function (answer) {
  document.querySelectorAll('.feedback-btn').forEach(b => {
    b.classList.remove('selected', 'pulse');
    const icon = b.querySelector('.ti');
    if (icon && icon.dataset.originalClass) icon.className = icon.dataset.originalClass;
  });
  const btn = document.querySelector(answer === 'yes' ? '.feedback-btn--yes' : '.feedback-btn--no');
  if (btn) {
    btn.classList.add('selected');
    const icon = btn.querySelector('.ti');
    if (icon) { if (!icon.dataset.originalClass) icon.dataset.originalClass = icon.className; icon.className = 'ti ti-check'; }
    requestAnimationFrame(() => btn.classList.add('pulse'));
  }
  const reportSection = document.getElementById('report-vehicle-section');
  const thanksBox     = document.getElementById('feedback-thanks');
  if (answer === 'no') {
    if (thanksBox) thanksBox.style.display = 'none';
    if (reportSection) {
      reportSection.style.display = 'block';
      document.getElementById('report-confirmation').style.display = 'none';
      document.getElementById('btn-submit-report').style.display = 'flex';
      document.getElementById('btn-submit-report').disabled = false;
      const priceInput = document.getElementById('vn-price-input');
      if (priceInput) priceInput.value = '';
      initVehicleSelects();
      reportSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  } else {
    if (reportSection) reportSection.style.display = 'none';
    if (thanksBox) thanksBox.style.display = 'flex';
  }
};

window.submitReport = function () {
  // Indian cities render the 4-part structured plate selects; other
  // cities render a single plain text field instead (see
  // useIndianPlateFormat in CityLayout.astro). Detect which is present
  // rather than hardcoding one path.
  const stateInput = document.getElementById('vn-state-input');
  let plateNo, plateState = null, plateDistrict = null, plateSeries = null, plateNumber = null;

  if (stateInput) {
    const s1 = stateInput.value;
    const s2 = document.getElementById('vn-district-input').value;
    const s3 = document.getElementById('vn-series-input').value;
    const s4 = document.getElementById('vn-number-input').value;
    if (!s1 || !s2 || !s3 || !s4) { alert('Please select all four parts of the number plate.'); return; }
    plateNo = `${s1} ${s2} ${s3} ${s4}`;
    plateState = s1; plateDistrict = s2; plateSeries = s3; plateNumber = s4;
  } else {
    const plainInput = document.getElementById('vn-plain-input');
    plateNo = (plainInput && plainInput.value || '').trim();
    if (!plateNo) { alert('Please enter the registration/plate number.'); return; }
  }

  const btn  = document.getElementById('btn-submit-report');
  const conf = document.getElementById('report-confirmation');
  btn.disabled = true;

  const rd = lastRouteData || {};
  const priceInput = document.getElementById('vn-price-input');
  const priceAtReport = priceInput && priceInput.value !== '' ? parseFloat(priceInput.value) : null;
  // Prefer the amount entered right here on the report form - falls
  // back to the earlier optional "Meter reading" field (section 2/3)
  // if someone filled that in but left this one blank.
  const actualFareCharged = priceAtReport != null && !isNaN(priceAtReport) ? priceAtReport : rd.actualFare;

  const payload = {
    city_slug:           CITY_SLUG,
    vehicle_type:        vehicleType,
    plate_full:           plateNo,
    plate_state:          plateState,
    plate_district:       plateDistrict,
    plate_series:         plateSeries,
    plate_number:         plateNumber,
    pickup_name:          rd.pickupName || null,
    dropoff_name:         rd.dropName || null,
    distance_km:          rd.distKm != null ? Math.round(rd.distKm * 100) / 100 : null,
    calculated_fare:      rd.calculatedFare != null ? Math.round(rd.calculatedFare) : null,
    actual_fare_charged:  actualFareCharged != null ? Math.round(actualFareCharged) : null,
    is_night:             !!rd.isNight,
    user_id:              currentUserId(),
  };

  supabaseInsert('vehicle_reports', payload)
    .then(function () {
      btn.style.display = 'none';
      conf.innerHTML = `<i class="ti ti-circle-check"></i> Report for <strong>${plateNo}</strong> submitted. Thank you!`;
      conf.style.display = 'flex';
    })
    .catch(function (err) {
      console.warn('Report submission error:', err);
      btn.disabled = false;
      conf.innerHTML = `<i class="ti ti-alert-circle"></i> Couldn't submit right now - please try again in a moment.`;
      conf.style.display = 'flex';
    });
};

/* ════════════════════════════════════════════
   SEARCHABLE SELECT (vehicle number plate)
   ════════════════════════════════════════════ */
const STATE_CODES   = ['AN','AP','AR','AS','BR','CG','CH','DD','DL','DN','GA','GJ','HP','HR','JH','JK','KA','KL','LA','LD','MH','ML','MN','MP','MZ','NL','OD','PB','PY','RJ','SK','TN','TR','TS','UK','UP','WB'];
const DISTRICT_CODES = Array.from({length:99}, (_,i) => String(i+1).padStart(2,'0'));
function generateSeries() {
  const a='ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const s=[];
  a.forEach(x=>s.push(x));
  a.forEach(x=>a.forEach(y=>s.push(x+y)));
  a.forEach(x=>a.forEach(y=>a.forEach(z=>s.push(x+y+z))));
  return s;
}
const SERIES_CODES = generateSeries();
const NUMBER_CODES = Array.from({length:9999}, (_,i) => String(i+1).padStart(4,'0'));

function buildSearchableSelect(wrapperId, inputId, dropdownId, options, onChange, defaultValue) {
  const wrapper  = document.getElementById(wrapperId);
  const input    = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);
  if (!wrapper||!input||!dropdown) return;
  dropdown.innerHTML = `<div class="ss-search-wrap"><input class="ss-search" type="text" placeholder="Type to search…" autocomplete="off"/></div><div class="ss-list"></div>`;
  const searchInput = dropdown.querySelector('.ss-search');
  const list        = dropdown.querySelector('.ss-list');

  function renderList(filter) {
    const q = (filter||'').toUpperCase().trim();
    const filtered = q ? options.filter(o=>o.toUpperCase().includes(q)) : options;
    if (!filtered.length) { list.innerHTML='<div class="ss-no-results">No results</div>'; return; }
    list.innerHTML = filtered.map(o=>`<div class="ss-option${input.value===o?' selected':''}" data-value="${o}">${o}</div>`).join('');
    list.querySelectorAll('.ss-option').forEach(el=>el.addEventListener('mousedown',e=>{e.preventDefault();selectOption(el.dataset.value);}));
  }
  function selectOption(v) { input.value=v; input.classList.add('has-value'); closeDropdown(); if(onChange)onChange(v); }
  function openDropdown() { dropdown.classList.add('open'); searchInput.value=''; renderList(''); setTimeout(()=>searchInput.focus(),50); }
  function closeDropdown() { dropdown.classList.remove('open'); }
  input.addEventListener('click',e=>{e.stopPropagation();dropdown.classList.contains('open')?closeDropdown():(document.querySelectorAll('.ss-dropdown.open').forEach(d=>d.classList.remove('open')),openDropdown());});
  searchInput.addEventListener('input',()=>renderList(searchInput.value));
  searchInput.addEventListener('keydown',e=>{if(e.key==='Escape')closeDropdown();if(e.key==='Enter'){const f=list.querySelector('.ss-option');if(f)selectOption(f.dataset.value);}});
  document.addEventListener('click',e=>{if(!wrapper.contains(e.target))closeDropdown();});
  renderList('');

  // Pre-fill (e.g. the state code matching the current city) while
  // keeping the field fully editable - a visitor whose vehicle is
  // registered in a different state can still change it via the
  // dropdown as normal.
  if (defaultValue && options.includes(defaultValue)) {
    input.value = defaultValue;
    input.classList.add('has-value');
  }
}

function initVehicleSelects() {
  buildSearchableSelect('ss-state','vn-state-input','ss-state-dropdown',STATE_CODES,()=>{},CITY.stateCode);
  buildSearchableSelect('ss-district','vn-district-input','ss-district-dropdown',DISTRICT_CODES,()=>{});
  buildSearchableSelect('ss-series','vn-series-input','ss-series-dropdown',SERIES_CODES,()=>{});
  buildSearchableSelect('ss-number','vn-number-input','ss-number-dropdown',NUMBER_CODES,()=>{});
}

/* ════════════════════════════════════════════
   MANUAL FALLBACK
   ════════════════════════════════════════════ */
function showManualFallback(pickup, dropoff, isNight, luggage, actualFare, waitOverride) {
  document.getElementById('empty-state').style.display    = 'none';
  document.getElementById('result-content').style.display = 'flex';
  document.getElementById('metrics-row').innerHTML        = '';
  document.getElementById('verdict-box').innerHTML        = '';
  document.getElementById('breakdown-box').innerHTML      = '';

  // Same mobile scroll-into-view as renderResults() - the manual
  // fallback form is also reached by pressing Calculate (when the
  // Routes API can't find a route), so it should behave consistently.
  if (window.innerWidth <= 760) {
    requestAnimationFrame(function () {
      document.getElementById('result-content').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  const fb = document.getElementById('feedback-section');
  if (fb) fb.style.display = 'none';
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(pickup)}&destination=${encodeURIComponent(dropoff)}&travelmode=driving`;
  document.getElementById('maps-link').href = mapsUrl;
  document.getElementById('manual-fallback').style.display = 'block';
  if (waitOverride !== null && waitOverride !== undefined) {
    document.getElementById('manual-wait').value = (Math.round(waitOverride * 100) / 100);
  }
  document.getElementById('manual-btn').onclick = function () {
    const km   = parseFloat(document.getElementById('manual-km').value);
    const wait = parseFloat(document.getElementById('manual-wait').value) || 0;
    if (isNaN(km)||km<=0){alert('Enter a valid distance.');return;}
    const isOverridden = waitOverride !== null && waitOverride !== undefined;
    const totalMin = (km/20)*60+wait;
    lastRouteData = { distKm: km, totalMinutes: totalMin, waitMinutes: wait, isNight, luggage, actualFare, isWaitOverridden: isOverridden, pickupName: pickup, dropName: dropoff };
    const fare = renderResults(km, totalMin, wait, isNight, luggage, actualFare, isOverridden);
    if (fare) lastRouteData.calculatedFare = fare.subtotal;
  };
}

/* ════════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════════ */
function parseActualFare() {
  const raw = document.getElementById('actual-fare').value.trim();
  if (!raw) return null;
  const val = parseFloat(raw);
  return isNaN(val)||val<=0 ? null : val;
}

function parseWaitOverride() {
  const toggle = document.getElementById('wait-override-toggle');
  if (!toggle||!toggle.checked) return null;
  const mins = parseFloat(document.getElementById('wait-min').value) || 0;
  const secs = parseFloat(document.getElementById('wait-sec').value) || 0;
  const total = mins + secs / 60;
  return total >= 0 ? total : null;
}

function setLoading(on) {
  const btn     = document.getElementById('calc-btn');
  const spinner = document.getElementById('spinner');
  btn.disabled  = on;
  spinner.classList.toggle('visible', on);
}

function hideResults() {
  // Clear the inline display instead of setting 'block'. The stylesheet
  // rule is `.empty-state { display:flex; ... align-items:center; }`, so
  // an inline `display:block` beat it and the tariff summary card jumped
  // out of its centred position the first time anything hid the results
  // (switching the Auto/Taxi toggle, for one). Removing the inline value
  // hands control back to the stylesheet and the card stays put.
  document.getElementById('empty-state').style.removeProperty('display');
  document.getElementById('result-content').style.display = 'none';
}

/* ════════════════════════════════════════════
   FEEDBACK DIALOG
   Appears 5s after "Calculate correct fare" is
   pressed.

   Rules:
     - Never submitted before, and dismisses: no
       suppression at all, shows again next visit.
     - Submits (first time or any time after):
       suppressed for FEEDBACK_VISITS_COOLDOWN more
       visits.
     - Has submitted at LEAST ONCE, ever, and later
       dismisses: ALSO suppressed for
       FEEDBACK_VISITS_COOLDOWN visits, same as a
       submission would. Once someone has told us
       what they think even once, every subsequent
       dismissal is treated the same as a submission
       for cooldown purposes - only a person who has
       genuinely never submitted gets the
       show-again-immediately treatment on dismiss.

   "Visits" means calculation attempts, not days -
   see countVisitAndCheckSuppressed() below.
   ════════════════════════════════════════════ */
const FEEDBACK_STORAGE_KEY = 'ms_feedback_status';
const FEEDBACK_DELAY_MS = 5000;
const FEEDBACK_VISITS_COOLDOWN = 10; // used for BOTH submit and (post-first-submit) dismiss
let feedbackTimer = null;
let feedbackSelectedStars = 0;

function getFeedbackStatus() {
  try {
    const raw = localStorage.getItem(FEEDBACK_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null; // localStorage unavailable (private browsing etc.) - just don't suppress
  }
}

function setFeedbackStatus(record) {
  try {
    localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(record));
  } catch (err) {
    // Silently ignore - worst case the dialog shows again next time
  }
}

/**
 * Called once per "Calculate correct fare" press. Only does something
 * when there's an active cooldown (status is 'submitted' or
 * 'dismissed') - counts this visit toward FEEDBACK_VISITS_COOLDOWN and
 * returns true (still suppressed) until the count is reached, at
 * which point the cooldown clears but hasSubmittedBefore is
 * DELIBERATELY preserved - that's what makes every later dismissal
 * behave like a submission once someone has submitted at least once.
 */
function countVisitAndCheckSuppressed() {
  const record = getFeedbackStatus();
  if (!record || !record.status) return false; // no active cooldown

  const visits = (record.visitsSinceAction || 0) + 1;
  if (visits < FEEDBACK_VISITS_COOLDOWN) {
    setFeedbackStatus({ ...record, visitsSinceAction: visits });
    return true; // still cooling down
  }

  // Cooldown finished - clear the active status/counter, but keep
  // hasSubmittedBefore intact so future dismissals still cool down too.
  setFeedbackStatus({ hasSubmittedBefore: !!record.hasSubmittedBefore });
  return false;
}

function scheduleFeedbackDialog() {
  if (countVisitAndCheckSuppressed()) return;
  if (feedbackTimer) clearTimeout(feedbackTimer); // one clean attempt per calculation
  feedbackTimer = setTimeout(showFeedbackDialog, FEEDBACK_DELAY_MS);
}

function showFeedbackDialog() {
  const overlay = document.getElementById('feedback-dialog-overlay');
  if (!overlay || overlay.style.display === 'flex') return; // already open
  overlay.style.display = 'flex';
}

window.dismissFeedbackDialog = function () {
  document.getElementById('feedback-dialog-overlay').style.display = 'none';

  const record = getFeedbackStatus();
  if (record && record.hasSubmittedBefore) {
    // They've submitted at least once before, ever - this dismissal
    // cools down the same as a submission would, not the "always show
    // again" treatment reserved for people who've never submitted.
    setFeedbackStatus({ hasSubmittedBefore: true, status: 'dismissed', visitsSinceAction: 0 });
  }
  // Otherwise: write nothing. Never having submitted means this
  // dismissal has no cooldown at all - eligible again next visit.
};

window.submitFeedback = function () {
  if (feedbackSelectedStars < 1) return;
  const textInput = document.getElementById('feedback-text-input');
  const submitBtn = document.getElementById('feedback-dialog-submit');
  const thanksBox = document.getElementById('feedback-dialog-thanks');
  submitBtn.disabled = true;

  const payload = {
    city_slug:     CITY_SLUG,
    rating:        feedbackSelectedStars,
    feedback_text: (textInput.value || '').trim() || null,
  };

  // Deliberately the ANON headers, not supabaseWriteHeaders(): feedback
  // has always been written as `anon` and its RLS was built for that.
  // Switching it to the user's token would change which role the insert
  // runs as, which is not a change to make without checking that table's
  // policies first.
  supabaseInsert('user_feedback', payload, supabaseAnonHeaders())
    .then(function () {
      setFeedbackStatus({ hasSubmittedBefore: true, status: 'submitted', visitsSinceAction: 0 });
      document.querySelector('.feedback-dialog h3').style.display = 'none';
      document.querySelector('.feedback-dialog-sub').style.display = 'none';
      document.getElementById('feedback-star-row').style.display = 'none';
      textInput.style.display = 'none';
      submitBtn.style.display = 'none';
      thanksBox.style.display = 'flex';
      setTimeout(function () {
        const overlay = document.getElementById('feedback-dialog-overlay');
        if (overlay) overlay.style.display = 'none';
      }, 1800);
    })
    .catch(function (err) {
      console.warn('Feedback submission failed:', err);
      submitBtn.disabled = false; // let them retry
    });
};

function initFeedbackStars() {
  const row = document.getElementById('feedback-star-row');
  if (!row) return;
  const stars = Array.from(row.querySelectorAll('.feedback-star'));

  function paint(count) {
    stars.forEach(function (s) {
      s.classList.toggle('filled', parseInt(s.dataset.star, 10) <= count);
    });
  }

  stars.forEach(function (star) {
    star.addEventListener('mouseenter', function () { paint(parseInt(star.dataset.star, 10)); });
    star.addEventListener('click', function () {
      feedbackSelectedStars = parseInt(star.dataset.star, 10);
      paint(feedbackSelectedStars);
      document.getElementById('feedback-dialog-submit').disabled = false;
    });
  });
  row.addEventListener('mouseleave', function () { paint(feedbackSelectedStars); });

  // Click the dimmed backdrop (not the dialog card itself) to dismiss,
  // same pattern as the city dropdown and searchable-select panels.
  const overlay = document.getElementById('feedback-dialog-overlay');
  if (overlay) {
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) dismissFeedbackDialog();
    });
  }
}

/* ════════════════════════════════════════════
   AUTO-SET NIGHT/DAY BASED ON CURRENT TIME
   ════════════════════════════════════════════ */
function autoSetRideTime() {
  const sel = document.getElementById('ride-time');
  if (!sel) return;
  sel.value = isNightTime(getTariff()) ? 'night' : 'day';
}

/* ════════════════════════════════════════════
   INIT
   ════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  buildCityDropdown();
  autoSetRideTime();
  initFeedbackStars();
  watchFieldsForSaveChip();

  // A trip re-run arrives as query params and must win over the saved
  // Home fallback, so it is applied before anything can fill pickup.
  applyTripFromQuery();

  // Saved places follow the session: they appear on sign-in and the
  // chips disappear on sign-out, without a reload either way.
  if (window.MSAuth) {
    window.MSAuth.ready().then(loadSavedPlaces).catch(function () {});
    window.MSAuth.onChange(function () { loadSavedPlaces(); });
  }
  ['pickup','dropoff','actual-fare','wait-min','wait-sec'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', e => { if (e.key==='Enter'){e.preventDefault();calculateFare();} });
  });
  const toggle = document.getElementById('wait-override-toggle');
  const inputs = document.getElementById('wait-time-inputs');
  if (toggle && inputs) {
    toggle.addEventListener('change', () => {
      inputs.style.display = toggle.checked ? 'flex' : 'none';
      if (toggle.checked) document.getElementById('wait-min').focus();
    });
  }
});
