/**
 * MeterSahi? — cities.js
 * Shared city config, tariff data, geolocation city mapping,
 * and fare calculation engine for all city pages.
 *
 * Tariff sources:
 *   Mumbai/Pune : Maharashtra MVD, w.e.f. 1 Feb 2025
 *   Delhi       : Delhi Transport Dept, w.e.f. Oct 2022
 *   Bengaluru   : Karnataka DTA, w.e.f. 1 Aug 2025
 *   Hyderabad   : Telangana RTA (latest published rates)
 *   Kochi       : Kerala MVD, w.e.f. May 2022
 *   Kolkata     : West Bengal Transport Dept
 *   Chennai     : Tamil Nadu RTA
 *   Ahmedabad   : Gujarat RTA, w.e.f. Nov 2021
 */

'use strict';

/* ════════════════════════════════════════════
   CITY TARIFF DATABASE
   ════════════════════════════════════════════ */
const CITIES = {
  mumbai: {
    name:         'Mumbai',
    slug:         'mumbai',
    state:        'Maharashtra',
    country:      'India',
    countryCode:  'IN',
    stateCode:    'MH',
    currencyCode: 'INR',
    currencySymbol: '₹',
    mapCenter:    { lat: 19.0760, lng: 72.8777 },
    acBounds:     { sw: { lat: 18.85, lng: 72.75 }, ne: { lat: 19.32, lng: 73.05 } },
    tariffDate:   '1 Sep 2026',
    tariff: {
      MIN_FARE:          27,
      MIN_KM:            1.5,
      RATE_PER_KM:       18.22,
      WAIT_RATE_PER_MIN: 1.822,
      NIGHT_MULTIPLIER:  1.25,
      NIGHT_START:       0,    // 12 AM
      NIGHT_END:         5,    // 5 AM
      LUGGAGE_PER_PIECE: 6,
      TOLERANCE:         5,
      STANDSTILL_FACTOR: 0.80,
    },
    // Black & Yellow Taxi (CNG), Maharashtra Motor Vehicles Dept,
    // w.e.f. 1 Feb 2025. Source: transport.maharashtra.gov.in
    // (Black Yellow Taxi Tariff Card PDF). Non-AC only for now —
    // AC taxi is +10% per the same tariff card but not yet wired
    // into the calculator.
    taxiTariffDate: '1 Sep 2026',
    taxiTariff: {
      MIN_FARE:          33,
      MIN_KM:            1.5,
      RATE_PER_KM:       21.90,
      WAIT_RATE_PER_MIN: 2.190,  // 10% of per-km rate, per tariff card note
      NIGHT_MULTIPLIER:  1.25,
      NIGHT_START:       0,
      NIGHT_END:         5,
      LUGGAGE_PER_PIECE: 6,
      TOLERANCE:         5,
      STANDSTILL_FACTOR: 0.80,
    },
    rtoContact: [
      { label: 'RTO Mumbai Central', phone: '9076201010', email: 'mh01taxicomplaint@gmail.com' },
      { label: 'RTO Mumbai West',    phone: '9920240202', email: 'mh02.autotaxicomplaint@gmail.com' },
    ],
    onlineComplaint: { label: 'Online complaint', value: 'Aaple Sarkar / State portal', hint: 'File via state transport website' },
    helpline: '1800-233-1922',
  },

  pune: {
    name:         'Pune',
    slug:         'pune',
    state:        'Maharashtra',
    country:      'India',
    countryCode:  'IN',
    stateCode:    'MH',
    currencyCode: 'INR',
    currencySymbol: '₹',
    mapCenter:    { lat: 18.5204, lng: 73.8567 },
    acBounds:     { sw: { lat: 18.40, lng: 73.70 }, ne: { lat: 18.65, lng: 74.00 } },
    tariffDate:   '1 Feb 2025',
    tariff: {
      MIN_FARE:          26,
      MIN_KM:            1.5,
      RATE_PER_KM:       17.14,
      WAIT_RATE_PER_MIN: 1.714,
      NIGHT_MULTIPLIER:  1.25,
      NIGHT_START:       0,
      NIGHT_END:         5,
      LUGGAGE_PER_PIECE: 6,
      TOLERANCE:         5,
      STANDSTILL_FACTOR: 0.80,
    },
    // Same statewide Maharashtra Black & Yellow Taxi tariff as Mumbai.
    taxiTariffDate: '1 Feb 2025',
    taxiTariff: {
      MIN_FARE:          31,
      MIN_KM:            1.5,
      RATE_PER_KM:       20.66,
      WAIT_RATE_PER_MIN: 2.066,
      NIGHT_MULTIPLIER:  1.25,
      NIGHT_START:       0,
      NIGHT_END:         5,
      LUGGAGE_PER_PIECE: 6,
      TOLERANCE:         5,
      STANDSTILL_FACTOR: 0.80,
    },
    rtoContact: [
      { label: 'RTO Pune', phone: '020-26051400', email: '' },
    ],
    onlineComplaint: { label: 'Online complaint', value: 'Aaple Sarkar / State portal', hint: 'File via state transport website' },
    helpline: '1800-233-1922',
  },

  delhi: {
    name:         'New Delhi',
    slug:         'delhi',
    state:        'Delhi',
    country:      'India',
    countryCode:  'IN',
    stateCode:    'DL',
    currencyCode: 'INR',
    currencySymbol: '₹',
    mapCenter:    { lat: 28.6139, lng: 77.2090 },
    acBounds:     { sw: { lat: 28.40, lng: 76.84 }, ne: { lat: 28.88, lng: 77.35 } },
    tariffDate:   'Oct 2022',
    tariff: {
      MIN_FARE:          30,
      MIN_KM:            1.5,
      RATE_PER_KM:       11.00,
      WAIT_RATE_PER_MIN: 1.00,
      NIGHT_MULTIPLIER:  1.25,
      NIGHT_START:       23,   // 11 PM
      NIGHT_END:         5,
      LUGGAGE_PER_PIECE: 0,
      TOLERANCE:         5,
      STANDSTILL_FACTOR: 0.80,
    },
    // Black & Yellow Taxi (non-AC), Delhi Transport Dept notification
    // dated 9 Jan 2023 - still the current listed rate on
    // transport.delhi.gov.in as of this writing.
    taxiTariffDate: '9 Jan 2023',
    taxiTariff: {
      MIN_FARE:          40,
      MIN_KM:            1,
      RATE_PER_KM:       17,
      WAIT_RATE_PER_MIN: 1,
      NIGHT_MULTIPLIER:  1.25,
      NIGHT_START:       23,
      NIGHT_END:         5,
      LUGGAGE_PER_PIECE: 15,
      TOLERANCE:         5,
      STANDSTILL_FACTOR: 0.80,
    },
    rtoContact: [
      { label: 'STA Delhi', phone: '011-23370004', email: '' },
    ],
    helpline: '1800-11-0443',
  },

  bengaluru: {
    name:         'Bengaluru',
    slug:         'bengaluru',
    state:        'Karnataka',
    country:      'India',
    countryCode:  'IN',
    stateCode:    'KA',
    currencyCode: 'INR',
    currencySymbol: '₹',
    mapCenter:    { lat: 12.9716, lng: 77.5946 },
    acBounds:     { sw: { lat: 12.80, lng: 77.40 }, ne: { lat: 13.15, lng: 77.80 } },
    tariffDate:   '1 Aug 2025',
    tariff: {
      MIN_FARE:          36,
      MIN_KM:            2.0,
      RATE_PER_KM:       18.00,
      WAIT_RATE_PER_MIN: 0.667,  // ₹10 per 15 min after first 5 free mins
      WAIT_FREE_MINS:    5,
      NIGHT_MULTIPLIER:  1.50,
      NIGHT_START:       22,   // 10 PM
      NIGHT_END:         5,
      LUGGAGE_PER_PIECE: 0,
      TOLERANCE:         5,
      STANDSTILL_FACTOR: 0.80,
    },
    rtoContact: [
      { label: 'RTO Bengaluru East', phone: '080-22372109', email: '' },
      { label: 'RTO Bengaluru West', phone: '080-23323233', email: '' },
    ],
    helpline: '1800-425-1616',
  },

  hyderabad: {
    name:         'Hyderabad',
    slug:         'hyderabad',
    state:        'Telangana',
    country:      'India',
    countryCode:  'IN',
    stateCode:    'TS',
    currencyCode: 'INR',
    currencySymbol: '₹',
    mapCenter:    { lat: 17.3850, lng: 78.4867 },
    acBounds:     { sw: { lat: 17.20, lng: 78.25 }, ne: { lat: 17.60, lng: 78.65 } },
    tariffDate:   'Current official',
    tariff: {
      MIN_FARE:          20,
      MIN_KM:            2.0,
      RATE_PER_KM:       11.00,
      WAIT_RATE_PER_MIN: 0,
      NIGHT_MULTIPLIER:  1.50,
      NIGHT_START:       23,
      NIGHT_END:         5,
      LUGGAGE_PER_PIECE: 0,
      TOLERANCE:         5,
      STANDSTILL_FACTOR: 0.80,
    },
    rtoContact: [
      { label: 'TS Transport Dept', phone: '040-23450145', email: '' },
    ],
    helpline: '1800-425-1616',
  },

  kochi: {
    name:         'Kochi',
    slug:         'kochi',
    state:        'Kerala',
    country:      'India',
    countryCode:  'IN',
    stateCode:    'KL',
    currencyCode: 'INR',
    currencySymbol: '₹',
    mapCenter:    { lat: 9.9312, lng: 76.2673 },
    acBounds:     { sw: { lat: 9.75, lng: 76.10 }, ne: { lat: 10.15, lng: 76.45 } },
    tariffDate:   'May 2022',
    tariff: {
      MIN_FARE:          30,
      MIN_KM:            1.5,
      RATE_PER_KM:       15.00,
      WAIT_RATE_PER_MIN: 1.50,
      NIGHT_MULTIPLIER:  1.50,
      NIGHT_START:       22,  // 10 PM
      NIGHT_END:         5,
      LUGGAGE_PER_PIECE: 0,
      TOLERANCE:         5,
      STANDSTILL_FACTOR: 0.80,
    },
    rtoContact: [
      { label: 'Kerala MVD Helpdesk', phone: '91 88 96 11 00', email: 'complaints.mvd@kerala.gov.in' },
    ],
    helpline: '91 88 96 11 00',
  },

  kolkata: {
    name:         'Kolkata',
    slug:         'kolkata',
    state:        'West Bengal',
    country:      'India',
    countryCode:  'IN',
    stateCode:    'WB',
    currencyCode: 'INR',
    currencySymbol: '₹',
    mapCenter:    { lat: 22.5726, lng: 88.3639 },
    acBounds:     { sw: { lat: 22.40, lng: 88.20 }, ne: { lat: 22.75, lng: 88.55 } },
    tariffDate:   'Current official',
    tariff: {
      MIN_FARE:          25,
      MIN_KM:            2.0,
      RATE_PER_KM:       13.00,
      WAIT_RATE_PER_MIN: 0.50,
      NIGHT_MULTIPLIER:  1.25,
      NIGHT_START:       22,
      NIGHT_END:         5,
      LUGGAGE_PER_PIECE: 0,
      TOLERANCE:         5,
      STANDSTILL_FACTOR: 0.80,
    },
    // Yellow Taxi (metered). CAUTION - lower confidence than Mumbai/
    // Pune/Delhi: West Bengal's Transport Dept has NOT revised yellow
    // taxi fares since 2016 (confirmed via a Jan 2025 PTI news report
    // quoting a taxi union leader), and no clean, fetchable official
    // notification PDF could be found to cite directly (transport.wb.gov.in
    // blocks automated access). These figures are compiled from
    // multiple secondary sources describing the post-2018-recalibration
    // meter reading, not a single authoritative document. If you have
    // the actual WB govt notification, send it and this should be
    // corrected/confirmed against it.
    taxiTariffDate: '~2016 (unrevised since, per Jan 2025 news report) - unconfirmed against original notification',
    taxiTariff: {
      MIN_FARE:          30,
      MIN_KM:            2,
      RATE_PER_KM:       15,
      WAIT_RATE_PER_MIN: 1,
      NIGHT_MULTIPLIER:  1.25,
      NIGHT_START:       22,
      NIGHT_END:         5,
      LUGGAGE_PER_PIECE: 5,
      TOLERANCE:         5,
      STANDSTILL_FACTOR: 0.80,
    },
    rtoContact: [
      { label: 'WB Transport Dept', phone: '033-22143053', email: '' },
    ],
    helpline: '1800-345-5555',
  },

  chennai: {
    name:         'Chennai',
    slug:         'chennai',
    state:        'Tamil Nadu',
    country:      'India',
    countryCode:  'IN',
    stateCode:    'TN',
    currencyCode: 'INR',
    currencySymbol: '₹',
    mapCenter:    { lat: 13.0827, lng: 80.2707 },
    acBounds:     { sw: { lat: 12.85, lng: 80.05 }, ne: { lat: 13.25, lng: 80.45 } },
    // CORRECTED RATE_PER_KM (was 16, didn't match any traceable
    // source - "Current official" as a date was itself a red flag).
    // Source: Chennai Auto Fare Chart (2023) - Rs25 min for first
    // 1.8km, Rs12/km thereafter, Rs3.50/5min waiting, +50% night
    // (11pm-5am). This is the most coherent identifiable "official"
    // figure, distinct from Tamil Nadu's much older base Government
    // Order (Rs6/km, Rs14 min for 2km - itself frozen for years by
    // litigation per transportinfo.in's own account of the order's
    // history) and from a 2025 union-imposed rate (Rs50 min/Rs18 per
    // km) that TWO independent sources (LiveChennai, dtnext.in)
    // explicitly describe as UNOFFICIAL - "implemented unilaterally by
    // unions... despite years of protests and petitions for fare
    // revisions, no official action has been taken."
    //
    // IMPORTANT COMPLIANCE CAVEAT: a Deccan Herald report independently
    // describes real-world Chennai auto fares as chronically far above
    // any of these figures - "anywhere between Rs80 to Rs100 for a
    // distance of two km" - due to widespread meter-dumping and
    // unions/drivers setting their own rates. This is a more severe
    // version of the compliance gap already flagged for Goa. The
    // number shown here is the most defensible OFFICIAL figure
    // available, not necessarily what most Chennai auto drivers will
    // actually accept in practice.
    tariffDate:   '2023 revised chart (TN auto fare)',
    tariff: {
      MIN_FARE:          25,
      MIN_KM:            1.8,
      RATE_PER_KM:       12.00,
      WAIT_RATE_PER_MIN: 0.70,  // ₹3.50 per 5 min
      NIGHT_MULTIPLIER:  1.50,
      NIGHT_START:       23,
      NIGHT_END:         5,
      LUGGAGE_PER_PIECE: 0,
      TOLERANCE:         5,
      STANDSTILL_FACTOR: 0.80,
    },
    rtoContact: [
      { label: 'TN Transport Dept', phone: '044-24333220', email: '' },
    ],
    helpline: '1800-425-1616',
  },

  ahmedabad: {
    name:         'Ahmedabad',
    slug:         'ahmedabad',
    state:        'Gujarat',
    country:      'India',
    countryCode:  'IN',
    stateCode:    'GJ',
    currencyCode: 'INR',
    currencySymbol: '₹',
    mapCenter:    { lat: 23.0225, lng: 72.5714 },
    acBounds:     { sw: { lat: 22.85, lng: 72.40 }, ne: { lat: 23.20, lng: 72.75 } },
    // CORRECTED (was stale at Nov 2021's Rs18/Rs13 - missed two
    // subsequent revisions). Source: DeshGujarat (English) and Gujarat
    // Samachar (Gujarati, one of Gujarat's largest newspapers), both
    // dated 22 Jun 2026, reporting a meeting at the Transport
    // Commissioner's office (Gandhinagar) with Ahmedabad RTO, the
    // Rickshaw Drivers Welfare Association, and Smart City Driver
    // Union: minimum fare Rs20->Rs25, per-km Rs15->Rs20, driven by
    // rising CNG prices (~Rs88/kg, up ~Rs6 in the preceding two
    // months). Explicitly framed as an AHMEDABAD-specific decision in
    // both sources, not a Gujarat-wide one (unlike the 2022 revision,
    // which was explicitly statewide) - do not assume this applies to
    // Surat/Vadodara/Rajkot without separate confirmation.
    tariffDate:   '22 Jun 2026 (Transport Commissioner, Ahmedabad)',
    tariff: {
      MIN_FARE:          25,
      MIN_KM:            1.25,
      RATE_PER_KM:       20.00,
      WAIT_RATE_PER_MIN: 1.00,
      NIGHT_MULTIPLIER:  1.25,
      NIGHT_START:       23,
      NIGHT_END:         6,
      LUGGAGE_PER_PIECE: 0,
      TOLERANCE:         5,
      STANDSTILL_FACTOR: 0.80,
    },
    rtoContact: [
      { label: 'RTO Ahmedabad', phone: '079-26580701', email: '' },
    ],
    helpline: '1800-233-1022',
  },

  // Taxi-primary city: no auto-rickshaw tariff exists in any meaningful
  // sense in Goa (multiple firsthand accounts confirm autos are rare to
  // nonexistent, especially North Goa). The regulated vehicle is the
  // Yellow-Black Taxi. Rate blends GoaMiles (govt-backed taxi app,
  // clean per-km + per-min figures) with the Jan 2021 state gazette's
  // night surcharge. CAUTION: multiple independent accounts (locals,
  // Quora) report the taxi union resists government meters and drivers
  // often don't follow the official rate in practice - shown here
  // anyway since the point is giving users the correct number to push
  // back with, same reasoning as Kolkata's stale-but-official tariff.
  goa: {
    name:         'Goa',
    slug:         'goa',
    state:        'Goa',
    country:      'India',
    countryCode:  'IN',
    stateCode:    'GA',
    currencyCode: 'INR',
    currencySymbol: '₹',
    primaryVehicleType: 'taxi',
    mapCenter:    { lat: 15.4909, lng: 73.8278 },
    acBounds:     { sw: { lat: 14.90, lng: 73.70 }, ne: { lat: 15.80, lng: 74.35 } },
    tariffDate:   'GoaMiles / 2021 gazette',
    tariff: {
      MIN_FARE:          22,
      MIN_KM:            1,
      RATE_PER_KM:       21.50,
      WAIT_RATE_PER_MIN: 1.00,
      NIGHT_MULTIPLIER:  1.35,
      NIGHT_START:       22,
      NIGHT_END:         5,
      LUGGAGE_PER_PIECE: 0,
      TOLERANCE:         5,
      STANDSTILL_FACTOR: 0.80,
    },
    rtoContact: [
      { label: 'Transport Dept Panaji', phone: '0832-2225606', email: '' },
      { label: 'Transport Dept Margao', phone: '0832-2741962', email: '' },
    ],
    helpline: '0832-2225606',
  },

  // Taxi-primary city (see Goa comment above - same reasoning). Sikkim's
  // official data is specifically for the government's own "Sikkim Cab"
  // app, tiered by distance band (see computeFareTiered in this file).
  // CAUTION: WAIT_RATE_PER_MIN is an assumption - the source notification
  // only gives hourly/day-hire rates for extended hire, not a clean
  // point-to-point per-minute waiting rate. Flagged here for correction
  // if a better source turns up.
  gangtok: {
    name:         'Gangtok',
    slug:         'gangtok',
    state:        'Sikkim',
    country:      'India',
    countryCode:  'IN',
    stateCode:    'SK',
    currencyCode: 'INR',
    currencySymbol: '₹',
    primaryVehicleType: 'taxi',
    mapCenter:    { lat: 27.3389, lng: 88.6065 },
    acBounds:     { sw: { lat: 27.28, lng: 88.55 }, ne: { lat: 27.40, lng: 88.65 } },
    tariffDate:   'Sikkim Cab tariff',
    tariff: {
      BANDS: [
        { upTo: 2,      flatFare: 100 },
        { upTo: 4,      flatFare: 200 },
        { upTo: 15,     perKm: 40 },
        { upTo: 50,     perKm: 38 },
        { upTo: 75,     perKm: 33 },
        { upTo: 999999, perKm: 24 },
      ],
      WAIT_RATE_PER_MIN: 2.00, // ASSUMPTION - see comment above
      NIGHT_MULTIPLIER:  1.50,
      NIGHT_START:       22,
      NIGHT_END:         4,
      LUGGAGE_PER_PIECE: 0,
      TOLERANCE:         5,
      STANDSTILL_FACTOR: 0.80,
    },
    rtoContact: [
      { label: 'State Transport Authority', phone: '03592-202483', email: 'secy-transport-skm@sikkim.gov.in' },
    ],
    helpline: '03592-202483',
  },

  // Same statewide Maharashtra MVD auto-rickshaw (CNG) tariff card as
  // Mumbai/Pune (w.e.f. 1 Feb 2025) - the tariff card itself is issued
  // once for the whole state, not per-city, and no Nagpur-specific
  // deviation notification was found. One low-quality aggregator site
  // showed different numbers (Rs18 min / Rs11/km) but its own citation
  // linked to a Mysuru (Karnataka) news article as its "source" for
  // Nagpur data - a clear sign of templated/unreliable content, so
  // discounted. Revisit if a genuine Nagpur-specific notification turns up.
  nagpur: {
    name:         'Nagpur',
    slug:         'nagpur',
    state:        'Maharashtra',
    country:      'India',
    countryCode:  'IN',
    stateCode:    'MH',
    currencyCode: 'INR',
    currencySymbol: '₹',
    mapCenter:    { lat: 21.1458, lng: 79.0882 },
    acBounds:     { sw: { lat: 21.00, lng: 78.95 }, ne: { lat: 21.30, lng: 79.20 } },
    tariffDate:   '1 Feb 2025',
    tariff: {
      MIN_FARE:          26,
      MIN_KM:            1.5,
      RATE_PER_KM:       17.14,
      WAIT_RATE_PER_MIN: 1.714,
      NIGHT_MULTIPLIER:  1.25,
      NIGHT_START:       0,
      NIGHT_END:         5,
      LUGGAGE_PER_PIECE: 6,
      TOLERANCE:         5,
      STANDSTILL_FACTOR: 0.80,
    },
    rtoContact: [
      { label: 'RTO Nagpur City (MH-31)',  phone: '0712-2560781', email: 'rto.31-mh@gov.in' },
      { label: 'RTO Nagpur Rural (MH-40)', phone: '0712-2728461', email: 'rto.40-mh@gov.in' },
    ],
    helpline: '1800-233-1922',
  },

  // Same statewide Maharashtra MVD auto-rickshaw (CNG) tariff card as
  // Mumbai/Pune/Nagpur (w.e.f. 1 Feb 2025) - no Nashik-specific
  // deviation notification found.
  nashik: {
    name:         'Nashik',
    slug:         'nashik',
    state:        'Maharashtra',
    country:      'India',
    countryCode:  'IN',
    stateCode:    'MH',
    currencyCode: 'INR',
    currencySymbol: '₹',
    mapCenter:    { lat: 19.9975, lng: 73.7898 },
    acBounds:     { sw: { lat: 19.85, lng: 73.65 }, ne: { lat: 20.15, lng: 73.95 } },
    tariffDate:   '1 Feb 2025',
    tariff: {
      MIN_FARE:          26,
      MIN_KM:            1.5,
      RATE_PER_KM:       17.14,
      WAIT_RATE_PER_MIN: 1.714,
      NIGHT_MULTIPLIER:  1.25,
      NIGHT_START:       0,
      NIGHT_END:         5,
      LUGGAGE_PER_PIECE: 6,
      TOLERANCE:         5,
      STANDSTILL_FACTOR: 0.80,
    },
    rtoContact: [
      { label: 'RTO Nashik City (MH-15)', phone: '0253-2576001', email: 'rto-nashik@mahatranscom.in' },
    ],
    helpline: '1800-233-1922',
  },

  // First international city (pilot for the currency/country/progressive-
  // fare architecture). Source: Jan 2023 Royal Gazette notification,
  // reported consistently across 5 independent contemporaneous news
  // outlets (Bangkok Post, Nation Thailand x2, Thaiger, Tripadvisor
  // forum quoting the same announcement). Cross-validated against a
  // real-world example (~26km Bangkok airport trip, sourced ~267 THB):
  // this tariff's own formula gives 217 THB base + 50 THB airport
  // surcharge = 267 THB exactly.
  //
  // IMPORTANT: this is a PROGRESSIVE/cumulative meter (see
  // computeFareProgressive) - each band only charges its own portion of
  // the distance, unlike Gangtok's bracket-for-the-whole-trip model.
  //
  // Airport surcharge (50 THB) and toll charges are NOT modeled here -
  // the calculator will under-quote airport trips by that amount. Same
  // limitation as the site not modeling city-specific surcharges
  // elsewhere; flagged rather than silently wrong.
  bangkok: {
    name:         'Bangkok',
    slug:         'bangkok',
    state:        'Bangkok',
    country:      'Thailand',
    countryCode:  'TH',
    currencyCode: 'THB',
    currencySymbol: '\u0e3f',
    regulatorName: 'Department of Land Transport, Thailand',
    regulatorShortName: 'DLT',
    primaryVehicleType: 'taxi',
    mapCenter:    { lat: 13.7563, lng: 100.5018 },
    acBounds:     { sw: { lat: 13.55, lng: 100.30 }, ne: { lat: 13.95, lng: 100.75 } },
    tariffDate:   '13 Jan 2023 (Royal Gazette)',
    tariff: {
      PROGRESSIVE_BANDS: [
        { upTo: 1,      flatFare: 40 },
        { upTo: 10,     perKm: 6.5 },
        { upTo: 20,     perKm: 7.0 },
        { upTo: 40,     perKm: 8.0 },
        { upTo: 60,     perKm: 8.5 },
        { upTo: 999999, perKm: 8.5 }, // rate beyond 60km not directly
        // sourced - continuing the last confirmed rate rather than
        // guessing a higher number. City calculator, so low real-world impact.
      ],
      WAIT_RATE_PER_MIN: 3.00, // "traffic congestion" charge, <6km/h
      NIGHT_MULTIPLIER:  1,    // No official night surcharge found for
      // Bangkok metered taxis (unlike Indian auto tariffs). Set to 1
      // (no surcharge) rather than assuming one exists.
      NIGHT_START:       0,
      NIGHT_END:         0,
      LUGGAGE_PER_PIECE: 0,
      TOLERANCE:         5,
      STANDSTILL_FACTOR: 0.80,
    },
    rtoContact: [
      { label: 'Tourist Police', phone: '1155', email: 'yourfirstfriend@touristpolice.go.th' },
    ],
    helpline: '1584',
    helplineLabel: 'DLT Complaint Hotline',
    helplineHint: 'National hotline',
  },

  // Source: 3 independent major Turkish news outlets (Hürriyet,
  // Milliyet, Sabah) all reporting the same İBB (Istanbul Metropolitan
  // Municipality) Meclis council decision from its 12 Feb 2026 session,
  // effective 16 Feb 2026. Cross-corroborated by two additional
  // aggregator sources citing the same "İBB tariff" figures. This is
  // meaningfully well-sourced - three independent mainstream news
  // outlets reporting the same council decision is comparable to
  // Bangkok Post's Royal Gazette coverage.
  //
  // Night surcharge: Istanbul abolished its night tariff in 2017 - a
  // single 24/7 rate applies (multiple sources explicitly confirm this
  // and warn that a driver claiming a night surcharge is not legitimate).
  //
  // Uses FLAG_FALL (see computeFare) since Istanbul's meter is
  // "opening fee + per-km for the whole distance", floored at a
  // separate minimum fare for short trips - structurally different
  // from Mumbai-style tariffs where MIN_FARE alone covers the first
  // MIN_KM with no separate flag-fall add-on.
  istanbul: {
    name:         'Istanbul',
    slug:         'istanbul',
    state:        'Istanbul',
    country:      'Turkey',
    countryCode:  'TR',
    currencyCode: 'TRY',
    currencySymbol: '\u20ba',
    regulatorName: 'Istanbul Metropolitan Municipality (\u0130BB)',
    regulatorShortName: '\u0130BB',
    primaryVehicleType: 'taxi',
    mapCenter:    { lat: 41.0082, lng: 28.9784 },
    acBounds:     { sw: { lat: 40.80, lng: 28.60 }, ne: { lat: 41.25, lng: 29.40 } },
    tariffDate:   '16 Feb 2026 (\u0130BB Meclis decision)',
    tariff: {
      MIN_FARE:          210,
      MIN_KM:            0,
      RATE_PER_KM:       43.56,
      FLAG_FALL:         65.40,
      WAIT_RATE_PER_MIN: 9.07,
      NIGHT_MULTIPLIER:  1, // No night surcharge - abolished 2017, confirmed
      // by multiple sources; a driver claiming one is not following the
      // legitimate tariff.
      NIGHT_START:       0,
      NIGHT_END:         0,
      LUGGAGE_PER_PIECE: 0,
      TOLERANCE:         10, // Wider tolerance than Indian cities - TRY
      // fares are larger round numbers and traffic-driven waiting time
      // variance is more significant here.
      STANDSTILL_FACTOR: 0.80,
    },
    rtoContact: [
      { label: 'Istanbul Taxi Drivers Guild', phone: '444 15 23', email: 'info@iteo.org.tr' },
    ],
    helpline: '153', // İBB Beyaz Masa (White Desk) citizen complaint line - ALO 153
    helplineLabel: '\u0130BB Complaint Line',
    helplineHint: 'Municipality hotline',
  },

  // Source: 4 independent Mexican news outlets (Terra Mexico, La Silla
  // Rota, SomosNews, plus historical continuity from El Universal/UnoTV)
  // - two dated Nov 2025 explicitly confirm the taxi banderazo was
  // UNCHANGED even as a general Mexico City transit fare adjustment
  // took effect, giving confidence this is still current. "Taxi Libre"
  // (street-hailed, pink-and-white) rates used - the most common type.
  //
  // Converted from the real meter unit (pesos per 250m or 45 seconds,
  // whichever comes first - a combined distance+time meter) into
  // MeterSahi's per-km/per-min model: 1.07 pesos/250m x 4 = 4.28
  // pesos/km; 1.07 pesos/45sec x (60/45) = ~1.43 pesos/min.
  //
  // KNOWN LIMITATION: night surcharge officially applies Mon-Sat
  // 23:00-6:00 AND all day Sunday - this engine only supports an
  // hour-of-day window, not a day-of-week rule, so the Sunday-all-day
  // portion is not modeled. Flagging rather than silently wrong.
  mexicocity: {
    name:         'Mexico City',
    slug:         'mexicocity',
    state:        'CDMX',
    country:      'Mexico',
    countryCode:  'MX',
    currencyCode: 'MXN',
    currencySymbol: 'MX$',
    regulatorName: 'Secretar\u00eda de Movilidad (SEMOVI), Mexico City',
    regulatorShortName: 'SEMOVI',
    primaryVehicleType: 'taxi',
    mapCenter:    { lat: 19.4326, lng: -99.1332 },
    acBounds:     { sw: { lat: 19.20, lng: -99.35 }, ne: { lat: 19.60, lng: -98.95 } },
    tariffDate:   'Nov 2025 (confirmed unchanged)',
    tariff: {
      MIN_FARE:          8.74,
      MIN_KM:            0,
      RATE_PER_KM:       4.28,
      FLAG_FALL:         8.74,
      WAIT_RATE_PER_MIN: 1.43,
      NIGHT_MULTIPLIER:  1.20,
      NIGHT_START:       23,
      NIGHT_END:         6,
      LUGGAGE_PER_PIECE: 0,
      TOLERANCE:         5,
      STANDSTILL_FACTOR: 0.80,
    },
    rtoContact: [
      { label: 'SEMOVI VigiMovi (taxi reports)', phone: '56581111', email: 'vigimovi@cdmx.gob.mx' },
    ],
    helpline: '56581111',
    helplineLabel: 'LOCATEL (CDMX citizen line)',
    helplineHint: 'City hotline',
  },

  // Source: Rio's own municipal government website (transportes.prefeitura.rio,
  // SMTR - Secretaria Municipal de Transportes) directly lists the
  // current tariff, corroborated by 4 independent Brazilian news
  // outlets (Diario do Rio, Tempo Real, Band News FM) all reporting the
  // same Resolucao SMTR No. 3784, effective 2 Jan 2026. This is a
  // primary government source, not just secondary reporting - the
  // strongest sourcing of any city built so far.
  //
  // KNOWN LIMITATION: the official night rate (tarifa 2, 20% higher)
  // applies weekday nights 21:00-6:00 AND all day Sunday/holidays AND
  // steep-incline roads at any time. This engine only supports an
  // hour-of-day window, so the Sunday/holiday/steep-hill portions are
  // not modeled - same class of simplification as Mexico City's
  // Sunday-all-day gap. Flagging rather than silently wrong.
  //
  // Uses FLAG_FALL (bandeirada) + per-km, no separate minimum-fare
  // floor beyond the flag-fall itself (unlike Istanbul's higher
  // "indi-bindi" floor) - matches the official formula stated directly
  // on SMTR's site: "Corrida = Bandeirada + Quilometragem x Tarifa".
  riodejaneiro: {
    name:         'Rio de Janeiro',
    slug:         'riodejaneiro',
    state:        'Rio de Janeiro',
    country:      'Brazil',
    countryCode:  'BR',
    currencyCode: 'BRL',
    currencySymbol: 'R$',
    regulatorName: 'Secretaria Municipal de Transportes (SMTR), Rio de Janeiro',
    regulatorShortName: 'SMTR',
    primaryVehicleType: 'taxi',
    mapCenter:    { lat: -22.9068, lng: -43.1729 },
    acBounds:     { sw: { lat: -23.08, lng: -43.80 }, ne: { lat: -22.75, lng: -43.10 } },
    tariffDate:   '2 Jan 2026 (Resolu\u00e7\u00e3o SMTR N\u00ba 3784)',
    tariff: {
      MIN_FARE:          6.30,
      MIN_KM:            0,
      RATE_PER_KM:       3.85,
      FLAG_FALL:         6.30,
      WAIT_RATE_PER_MIN: 0.81, // R$48.51/hour
      NIGHT_MULTIPLIER:  1.20, // Tarifa 2 (R$4.62/km) is exactly 1.20x
      // Tarifa 1 (R$3.85/km) - confirmed via direct ratio check.
      NIGHT_START:       21,
      NIGHT_END:         6,
      LUGGAGE_PER_PIECE: 3.85,
      TOLERANCE:         5,
      STANDSTILL_FACTOR: 0.80,
    },
    rtoContact: [
      { label: 'SMTR Ouvidoria (complaints)', phone: '1746', email: 'gabinete.smtr@prefeitura.rio' },
    ],
    helpline: '1746',
    helplineLabel: 'Central 1746 (Prefeitura do Rio)',
    helplineHint: 'City hotline',
  },

  // Source: prefeitura.sp.gov.br (Sao Paulo City Hall's own official
  // announcement, via SMT/DTP), corroborated by 6 independent
  // Brazilian news outlets (ISTOE Dinheiro, Motor Show, Mobile Time,
  // Diario do Transporte, Metropoles x2). Effective 11 Aug 2025, ~11
  // months before this was built - the prior revision was Oct 2023
  // (roughly 2-year cadence), so no signs of a more recent change.
  // "Comum" (standard) category used - the most common taxi type.
  //
  // KNOWN LIMITATION: night surcharge (Bandeira 2, +30%) officially
  // applies only to the per-km portion, not the flag-fall or waiting
  // charge - this engine's NIGHT_MULTIPLIER scales the whole fare
  // uniformly, so it slightly overstates the flag-fall/wait portion at
  // night. Same class of approximation as Rio de Janeiro's tariff, and
  // bounded/small since flag-fall is a minor part of most trip totals.
  // Also same day-of-week gap as Rio: night rate applies all day
  // Sunday/holidays too, not modeled (hour-of-day window only).
  saopaulo: {
    name:         'S\u00e3o Paulo',
    slug:         'saopaulo',
    state:        'S\u00e3o Paulo',
    country:      'Brazil',
    countryCode:  'BR',
    currencyCode: 'BRL',
    currencySymbol: 'R$',
    regulatorName: 'Secretaria Municipal de Mobilidade Urbana e Transporte (SMT), S\u00e3o Paulo',
    regulatorShortName: 'SMT',
    primaryVehicleType: 'taxi',
    mapCenter:    { lat: -23.5505, lng: -46.6333 },
    acBounds:     { sw: { lat: -23.75, lng: -46.85 }, ne: { lat: -23.35, lng: -46.40 } },
    tariffDate:   '11 Aug 2025 (SMT/DTP)',
    tariff: {
      MIN_FARE:          6.55,
      MIN_KM:            0,
      RATE_PER_KM:       4.80,
      FLAG_FALL:         6.55,
      WAIT_RATE_PER_MIN: 0.93, // R$55.50/hour
      NIGHT_MULTIPLIER:  1.30, // Confirmed: 4.80 x 1.30 = 6.24, matches
      // the sourced Bandeira 2 rate exactly.
      NIGHT_START:       20,
      NIGHT_END:         6,
      LUGGAGE_PER_PIECE: 0,
      TOLERANCE:         5,
      STANDSTILL_FACTOR: 0.80,
    },
    rtoContact: [
      { label: 'SP156 Taxi Complaints (DTP)', phone: '156', email: 'ouvidoria@sptrans.com.br' },
    ],
    helpline: '156',
    helplineLabel: 'Central 156 (Prefeitura de SP)',
    helplineHint: 'City hotline',
  },

  // Source: multiple independent outlets including the Philippine News
  // Agency (a state news agency, quoting LTFRB-7 Regional Director
  // Eduardo Montealto Jr. by name), Cebu Daily News (Philippine Daily
  // Inquirer's Cebu edition), and SunStar Cebu. Unlike Manila (where
  // regular taxi fare hikes were explicitly "under deliberation" as of
  // March 2026), Cebu's rate is CONFIRMED and already in effect since
  // Jan 2025 - a genuinely different situation, not just better luck
  // with sourcing.
  cebucity: {
    name:         'Cebu City',
    slug:         'cebucity',
    state:        'Cebu',
    country:      'Philippines',
    countryCode:  'PH',
    currencyCode: 'PHP',
    currencySymbol: '\u20b1',
    regulatorName: 'Land Transportation Franchising and Regulatory Board - Region 7 (LTFRB-7)',
    regulatorShortName: 'LTFRB-7',
    primaryVehicleType: 'taxi',
    mapCenter:    { lat: 10.3157, lng: 123.8854 },
    acBounds:     { sw: { lat: 10.20, lng: 123.80 }, ne: { lat: 10.40, lng: 123.95 } },
    tariffDate:   'Jan 2025 (LTFRB-7)',
    tariff: {
      MIN_FARE:          50,
      MIN_KM:            0,
      RATE_PER_KM:       13.50,
      FLAG_FALL:         50,
      WAIT_RATE_PER_MIN: 1.00,
      NIGHT_MULTIPLIER:  1, // No night surcharge found in any source -
      // set to 1 (none) rather than assuming one exists.
      NIGHT_START:       0,
      NIGHT_END:         0,
      LUGGAGE_PER_PIECE: 0,
      TOLERANCE:         5,
      STANDSTILL_FACTOR: 0.80,
    },
    rtoContact: [
      { label: 'LTFRB-7 Cebu (direct)', phone: '0917 704 6862', email: 'complaints@ltfrb.gov.ph' },
    ],
    helpline: '1342',
    helplineLabel: 'LTFRB 24/7 Hotline',
    helplineHint: 'National hotline',
  },

  // Source: haryanatransport.gov.in (Haryana Transport Department's own
  // active notification, "Fare of auto rickshaws within the limit of
  // Municipal Corporations of Gurugram and Faridabad" - one shared
  // notification covering both cities), corroborated by cityspidey.com
  // (2019, 2020) and Hindustan Times/Pressreader (May 2022) all
  // agreeing on the same Rs12/Rs8 structure with no sign of change.
  // Genuinely stable/infrequently-revised rather than stale - Haryana
  // doesn't appear to revise as often as Maharashtra or Turkey do.
  //
  // Two-tier rate (Rs12/km for the first km, Rs8/km thereafter) is
  // structurally a progressive band, not a Mumbai-style flat rate -
  // modeled with PROGRESSIVE_BANDS, first band as flatFare (a genuine
  // minimum-fare floor for any distance within the first km, not a
  // prorated per-km charge).
  gurugram: {
    name:         'Gurugram',
    slug:         'gurugram',
    state:        'Haryana',
    country:      'India',
    countryCode:  'IN',
    stateCode:    'HR',
    currencyCode: 'INR',
    currencySymbol: '\u20b9',
    mapCenter:    { lat: 28.4595, lng: 77.0266 },
    acBounds:     { sw: { lat: 28.35, lng: 76.90 }, ne: { lat: 28.55, lng: 77.15 } },
    tariffDate:   'Haryana Transport Dept notification',
    tariff: {
      PROGRESSIVE_BANDS: [
        { upTo: 1,      flatFare: 12 },
        { upTo: 999999, perKm: 8 },
      ],
      WAIT_RATE_PER_MIN: 0.50, // Rs30/hour
      NIGHT_MULTIPLIER:  1.25,
      NIGHT_START:       23,
      NIGHT_END:         5,
      LUGGAGE_PER_PIECE: 7.50,
      TOLERANCE:         5,
      STANDSTILL_FACTOR: 0.80,
    },
    rtoContact: [
      { label: 'RTO Gurugram (HR-26)', phone: '0172-3968400', email: 'stcharyana@hry.nic.in' },
    ],
    helpline: '0172-3968400',
    helplineLabel: 'Haryana Saral Helpline',
    helplineHint: 'State hotline',
  },

  // Same Haryana Transport Dept notification as Gurugram - see comment
  // there for full sourcing.
  faridabad: {
    name:         'Faridabad',
    slug:         'faridabad',
    state:        'Haryana',
    country:      'India',
    countryCode:  'IN',
    stateCode:    'HR',
    currencyCode: 'INR',
    currencySymbol: '\u20b9',
    mapCenter:    { lat: 28.4089, lng: 77.3178 },
    acBounds:     { sw: { lat: 28.30, lng: 77.20 }, ne: { lat: 28.50, lng: 77.45 } },
    tariffDate:   'Haryana Transport Dept notification',
    tariff: {
      PROGRESSIVE_BANDS: [
        { upTo: 1,      flatFare: 12 },
        { upTo: 999999, perKm: 8 },
      ],
      WAIT_RATE_PER_MIN: 0.50,
      NIGHT_MULTIPLIER:  1.25,
      NIGHT_START:       23,
      NIGHT_END:         5,
      LUGGAGE_PER_PIECE: 7.50,
      TOLERANCE:         5,
      STANDSTILL_FACTOR: 0.80,
    },
    rtoContact: [
      { label: 'RTO Faridabad (HR-29/38/51)', phone: '0172-3968400', email: 'stcharyana@hry.nic.in' },
    ],
    helpline: '0172-3968400',
    helplineLabel: 'Haryana Saral Helpline',
    helplineHint: 'State hotline',
  },

  // Source: The Tribune (major North Indian newspaper) and
  // Babushahi.com, both citing the same UT Chandigarh Administration
  // notification, signed by Diprava Lakra, IAS, Secretary Transport,
  // dated 7 Jul 2025 - supersedes an earlier 31 Mar 2022 order.
  // Genuinely well-sourced, comparable to Bangkok/Istanbul tier.
  //
  // Explicitly a flat fare for the first 3km ("passengers pay for 3km
  // even if they travel 1km"), then per-km beyond - a progressive band
  // structure like Gurugram's, just with a longer initial flat segment.
  //
  // No night surcharge or waiting/luggage charge found in any source
  // for the 2025 revision - set to 0/none rather than assumed. Taxi
  // tariff (4+1 seater, AC/non-AC now merged per the same notification)
  // added as a dual mode, matching Mumbai/Pune/Delhi/Kolkata's pattern -
  // Chandigarh is in the docx's regulated-taxi-cities list too.
  chandigarh: {
    name:         'Chandigarh',
    slug:         'chandigarh',
    state:        'Chandigarh',
    country:      'India',
    countryCode:  'IN',
    stateCode:    'CH',
    currencyCode: 'INR',
    currencySymbol: '\u20b9',
    mapCenter:    { lat: 30.7333, lng: 76.7794 },
    acBounds:     { sw: { lat: 30.65, lng: 76.70 }, ne: { lat: 30.80, lng: 76.85 } },
    tariffDate:   '7 Jul 2025 (UT Chandigarh Administration)',
    tariff: {
      PROGRESSIVE_BANDS: [
        { upTo: 3,      flatFare: 50 },
        { upTo: 999999, perKm: 13 },
      ],
      WAIT_RATE_PER_MIN: 0, // Not found in any source for the 2025
      // revision - set to 0 rather than guessed.
      NIGHT_MULTIPLIER:  1, // No night surcharge found.
      NIGHT_START:       0,
      NIGHT_END:         0,
      LUGGAGE_PER_PIECE: 0,
      TOLERANCE:         5,
      STANDSTILL_FACTOR: 0.80,
    },
    taxiTariffDate: '7 Jul 2025 (UT Chandigarh Administration)',
    taxiTariff: {
      PROGRESSIVE_BANDS: [
        { upTo: 3,      flatFare: 90 },
        { upTo: 999999, perKm: 25 },
      ],
      WAIT_RATE_PER_MIN: 0,
      NIGHT_MULTIPLIER:  1,
      NIGHT_START:       0,
      NIGHT_END:         0,
      LUGGAGE_PER_PIECE: 0,
      TOLERANCE:         10,
      STANDSTILL_FACTOR: 0.80,
    },
    rtoContact: [
      { label: 'Registering & Licensing Authority', phone: '0172-2700341', email: 'rla-chd@nic.in' },
    ],
    helpline: '0172-2740045',
    helplineLabel: 'UT Chandigarh Transport',
    helplineHint: 'UT hotline',
  },

  // Source: All India Radio's official news portal (newsonair.gov.in,
  // a government source) reporting the J&K Cabinet's own decision
  // (14 Mar 2026, chaired by CM Omar Abdullah): 18% fare hike for all
  // passenger vehicles UT-wide. Corroborated by Rising Kashmir
  // (regional newspaper) reporting RTO Kashmir's implementing
  // notification just days before this was built, confirming the same
  // figures for both e-autos and petrol-driven auto-rickshaws.
  //
  // NOTE: this is the Kashmir Valley division's rate. Jammu division
  // (same UT, separate RTO) was NOT built alongside this - an earlier,
  // unreconciled report described Jammu's "black autos" at Rs46 for
  // the first TWO km, conflicting with this Rs25/first-km figure, and
  // it's unclear whether that predates this Cabinet decision or is a
  // genuinely separate Jammu-specific rate. Flagged rather than guessed.
  srinagar: {
    name:         'Srinagar',
    slug:         'srinagar',
    state:        'Jammu and Kashmir',
    country:      'India',
    countryCode:  'IN',
    stateCode:    'JK',
    currencyCode: 'INR',
    currencySymbol: '\u20b9',
    mapCenter:    { lat: 34.0837, lng: 74.7973 },
    acBounds:     { sw: { lat: 33.95, lng: 74.65 }, ne: { lat: 34.20, lng: 74.95 } },
    tariffDate:   '14 Mar 2026 (J&K Cabinet / RTO Kashmir)',
    tariff: {
      PROGRESSIVE_BANDS: [
        { upTo: 1,      flatFare: 25 },
        { upTo: 999999, perKm: 20 },
      ],
      WAIT_RATE_PER_MIN: 0, // Not found in any source - set to 0 rather
      // than guessed.
      NIGHT_MULTIPLIER:  1, // No night surcharge found.
      NIGHT_START:       0,
      NIGHT_END:         0,
      LUGGAGE_PER_PIECE: 0,
      TOLERANCE:         5,
      STANDSTILL_FACTOR: 0.80,
    },
    rtoContact: [
      { label: 'RTO Kashmir / J&K Transport Commissioner', phone: '0194-2506686', email: 'tptcommissionerjk@gmail.com' },
    ],
    helpline: '0194-3574-338',
    helplineLabel: 'District Srinagar Helpline',
    helplineHint: 'District hotline',
  },

  // Source: Meghalaya Transport Department's own official fare
  // schedule PDF (megtransport.gov.in), signed by the Secretary,
  // Regional Transport Authority, East Khasi Hills - a primary
  // government document, not secondary reporting. Corroborated by The
  // Shillong Times' independent report of the original Cabinet
  // decision (matching numbers exactly) and the Meghalaya government's
  // own press-release portal still hosting the same figures.
  //
  // Dated 13 Jan 2020 (six years old at build time) - genuinely
  // unusual for a city this size, but corroborated: a March 2023
  // article about fares being "reverted to old rates" post-COVID
  // confirms this remains the government's active intended baseline,
  // not something quietly superseded. No evidence of any later
  // revision found despite specific searching.
  //
  // Both auto and taxi use CEIL_TO_KM - the source's own wording is
  // "first km or part thereof, every subsequent km or part thereof",
  // verified directly against the PDF's own sample fare table (e.g.
  // "IGP to MPRO, 3.8km, Rs32" only matches if 3.8km bills as a full
  // 4km) before this capability was added to the engine.
  shillong: {
    name:         'Shillong',
    slug:         'shillong',
    state:        'Meghalaya',
    country:      'India',
    countryCode:  'IN',
    stateCode:    'ML',
    currencyCode: 'INR',
    currencySymbol: '\u20b9',
    mapCenter:    { lat: 25.5788, lng: 91.8933 },
    acBounds:     { sw: { lat: 25.50, lng: 91.80 }, ne: { lat: 25.65, lng: 91.95 } },
    tariffDate:   '13 Jan 2020 (RTA East Khasi Hills)',
    tariff: {
      PROGRESSIVE_BANDS: [
        { upTo: 1,      flatFare: 14 },
        { upTo: 999999, perKm: 6 },
      ],
      CEIL_TO_KM:        true,
      WAIT_RATE_PER_MIN: 1.2, // Rs6 per 5 minutes
      NIGHT_MULTIPLIER:  1,   // No night surcharge found in the source.
      NIGHT_START:       0,
      NIGHT_END:         0,
      LUGGAGE_PER_PIECE: 0,
      TOLERANCE:         5,
      STANDSTILL_FACTOR: 0.80,
    },
    taxiTariffDate: '13 Jan 2020 (RTA East Khasi Hills)',
    taxiTariff: {
      PROGRESSIVE_BANDS: [
        { upTo: 1,      flatFare: 26 },
        { upTo: 999999, perKm: 13 },
      ],
      CEIL_TO_KM:        true,
      WAIT_RATE_PER_MIN: 1.4, // Rs7 per 5 minutes
      NIGHT_MULTIPLIER:  1,
      NIGHT_START:       0,
      NIGHT_END:         0,
      LUGGAGE_PER_PIECE: 0,
      TOLERANCE:         5,
      STANDSTILL_FACTOR: 0.80,
    },
    rtoContact: [
      { label: 'RTA East Khasi Hills, Shillong', phone: '', email: '' },
    ],
    helpline: '1971',
    helplineLabel: 'CM Connect (Grievance Helpline)',
    helplineHint: 'State hotline, 24x7',
  },

  // Source: Free Press Journal (established Indian newspaper), 21 May
  // 2022, reporting a genuine RTA (Regional Transport Authority)
  // decision - officials quoted by name/role, night surcharge %
  // specified. No evidence found of any subsequent revision despite
  // specific searching (4 years stable, similar pattern to Haryana's
  // 2018-2022 and Meghalaya's 2020-2026 unchanged rates - plausible
  // for a state that doesn't revise as often as Maharashtra/Turkey).
  //
  // "Rs20 for the first km, Rs17/km for the subsequent journey" reads
  // as the same first-km-flat-then-per-km pattern as Gurugram/
  // Chandigarh/Srinagar/Shillong, not a Mumbai-style full-distance rate.
  indore: {
    name:         'Indore',
    slug:         'indore',
    state:        'Madhya Pradesh',
    country:      'India',
    countryCode:  'IN',
    stateCode:    'MP',
    currencyCode: 'INR',
    currencySymbol: '\u20b9',
    mapCenter:    { lat: 22.7196, lng: 75.8577 },
    acBounds:     { sw: { lat: 22.60, lng: 75.75 }, ne: { lat: 22.85, lng: 75.95 } },
    tariffDate:   '21 May 2022 (RTA Indore)',
    tariff: {
      PROGRESSIVE_BANDS: [
        { upTo: 1,      flatFare: 20 },
        { upTo: 999999, perKm: 17 },
      ],
      WAIT_RATE_PER_MIN: 0, // Not found in any source - set to 0
      // rather than guessed.
      NIGHT_MULTIPLIER:  1.20,
      NIGHT_START:       23,
      NIGHT_END:         5,
      LUGGAGE_PER_PIECE: 0,
      TOLERANCE:         5,
      STANDSTILL_FACTOR: 0.80,
    },
    rtoContact: [
      { label: 'MP Transport Dept Customer Care', phone: '0751-2971008', email: 'care.mptransport@gmail.com' },
    ],
    helpline: '0751-2971008',
    helplineLabel: 'MP Transport Customer Care',
    helplineHint: 'State hotline',
  },

  // Source: Kerala Cabinet decision, 20 Apr 2022, effective 1 May 2022
  // - corroborated by 5 independent news outlets (PTI/LatestLY,
  // ThePrint, Onmanorama, Asianet Newsable) AND the Kerala Chief
  // Minister's own official website (keralacm.gov.in, "Cabinet
  // Decisions 20-04-2022"). This is a STATEWIDE rate, not city-specific
  // - same figures as the existing Kochi entry, which already uses
  // this exact source. No evidence found of any more recent revision
  // despite specific searching; Kerala MVD's own fare-revision page is
  // still headlined with this same 2022 change and copyrighted 2026.
  thiruvananthapuram: {
    name:         'Thiruvananthapuram',
    slug:         'thiruvananthapuram',
    state:        'Kerala',
    country:      'India',
    countryCode:  'IN',
    stateCode:    'KL',
    currencyCode: 'INR',
    currencySymbol: '\u20b9',
    mapCenter:    { lat: 8.5241, lng: 76.9366 },
    acBounds:     { sw: { lat: 8.40, lng: 76.85 }, ne: { lat: 8.65, lng: 77.05 } },
    tariffDate:   'May 2022',
    tariff: {
      MIN_FARE:          30,
      MIN_KM:            1.5,
      RATE_PER_KM:       15.00,
      WAIT_RATE_PER_MIN: 1.50,
      NIGHT_MULTIPLIER:  1.50,
      NIGHT_START:       22,
      NIGHT_END:         5,
      LUGGAGE_PER_PIECE: 0,
      TOLERANCE:         5,
      STANDSTILL_FACTOR: 0.80,
    },
    rtoContact: [
      { label: 'Kerala MVD Helpdesk', phone: '91 88 96 11 00', email: 'complaints.mvd@kerala.gov.in' },
    ],
    helpline: '91 88 96 11 00',
  },

  // Same statewide Kerala Cabinet decision as Kochi/Thiruvananthapuram
  // above.
  kozhikode: {
    name:         'Kozhikode',
    slug:         'kozhikode',
    state:        'Kerala',
    country:      'India',
    countryCode:  'IN',
    stateCode:    'KL',
    currencyCode: 'INR',
    currencySymbol: '\u20b9',
    mapCenter:    { lat: 11.2588, lng: 75.7804 },
    acBounds:     { sw: { lat: 11.15, lng: 75.70 }, ne: { lat: 11.35, lng: 75.90 } },
    tariffDate:   'May 2022',
    tariff: {
      MIN_FARE:          30,
      MIN_KM:            1.5,
      RATE_PER_KM:       15.00,
      WAIT_RATE_PER_MIN: 1.50,
      NIGHT_MULTIPLIER:  1.50,
      NIGHT_START:       22,
      NIGHT_END:         5,
      LUGGAGE_PER_PIECE: 0,
      TOLERANCE:         5,
      STANDSTILL_FACTOR: 0.80,
    },
    rtoContact: [
      { label: 'Kerala MVD Helpdesk', phone: '91 88 96 11 00', email: 'complaints.mvd@kerala.gov.in' },
    ],
    helpline: '91 88 96 11 00',
  },
};

/* ── Ordered list for the dropdown ── */
const CITY_LIST = [
  'mumbai', 'delhi', 'bengaluru', 'hyderabad',
  'pune', 'kochi', 'kolkata', 'chennai', 'ahmedabad',
  'goa', 'gangtok', 'nagpur', 'nashik',
  'bangkok', 'istanbul', 'mexicocity', 'riodejaneiro', 'saopaulo',
  'cebucity', 'gurugram', 'faridabad', 'chandigarh', 'srinagar',
  'shillong', 'indore', 'thiruvananthapuram', 'kozhikode',
];

/* ════════════════════════════════════════════
   CITY DETECTION & REDIRECT
   Uses IP-based geolocation — no browser permission
   needed, works instantly on all browsers.
   Falls back to city chooser if API fails.
   ════════════════════════════════════════════ */

var GEO_CITY_MAP = {
  // Mumbai + suburbs. Maharashtra has four covered cities (Mumbai,
  // Pune, Nagpur, and Nashik), so - unlike every other state below - it can't
  // be resolved by region name alone. IP geolocation frequently returns
  // a specific suburb/locality rather than "Mumbai" itself, so this
  // list needs to
  // be broad rather than just the umbrella city name.
  'mumbai':        'mumbai',
  'navi mumbai':   'mumbai',
  'thane':         'mumbai',
  'borivali':      'mumbai',
  'dahisar':       'mumbai',
  'kandivali':     'mumbai',
  'malad':         'mumbai',
  'goregaon':      'mumbai',
  'jogeshwari':    'mumbai',
  'andheri':       'mumbai',
  'vile parle':    'mumbai',
  'santacruz':     'mumbai',
  'khar':          'mumbai',
  'bandra':        'mumbai',
  'juhu':          'mumbai',
  'versova':       'mumbai',
  'mira road':     'mumbai',
  'mira bhayandar':'mumbai',
  'bhayandar':     'mumbai',
  'vasai':         'mumbai',
  'virar':         'mumbai',
  'nalasopara':    'mumbai',
  'kalyan':        'mumbai',
  'dombivli':      'mumbai',
  'ambernath':     'mumbai',
  'ulhasnagar':    'mumbai',
  'badlapur':      'mumbai',
  'mulund':        'mumbai',
  'bhandup':       'mumbai',
  'vikhroli':      'mumbai',
  'kanjurmarg':    'mumbai',
  'ghatkopar':     'mumbai',
  'chembur':       'mumbai',
  'powai':         'mumbai',
  'kurla':         'mumbai',
  'sion':          'mumbai',
  'dadar':         'mumbai',
  'wadala':        'mumbai',
  'parel':         'mumbai',
  'worli':         'mumbai',
  'mahim':         'mumbai',
  'lower parel':   'mumbai',
  'colaba':        'mumbai',
  'fort':          'mumbai',
  'churchgate':    'mumbai',

  'delhi':        'delhi',
  'new delhi':    'delhi',
  'bengaluru':    'bengaluru',
  'bangalore':    'bengaluru',
  'hyderabad':    'hyderabad',
  'secunderabad': 'hyderabad',

  // Pune + suburbs (same reasoning as Mumbai above)
  'pune':          'pune',
  'pimpri':        'pune',
  'chinchwad':     'pune',
  'hinjewadi':     'pune',
  'wakad':         'pune',
  'baner':         'pune',
  'aundh':         'pune',
  'kothrud':       'pune',
  'hadapsar':      'pune',
  'viman nagar':   'pune',
  'kharadi':       'pune',
  'magarpatta':    'pune',
  'wagholi':       'pune',
  'nigdi':         'pune',
  'akurdi':        'pune',
  'katraj':        'pune',
  'warje':         'pune',
  'shivajinagar':  'pune',

  'nagpur':        'nagpur',

  'nashik':        'nashik',
  'nasik':         'nashik',

  'bangkok':       'bangkok',
  'krung thep':    'bangkok',

  'kochi':        'kochi',
  'ernakulam':    'kochi',
  'thrissur':     'kochi',
  'thiruvananthapuram': 'thiruvananthapuram',
  'trivandrum':   'thiruvananthapuram',
  'kozhikode':    'kozhikode',
  'calicut':      'kozhikode',
  'kolkata':      'kolkata',
  'howrah':       'kolkata',
  'chennai':      'chennai',
  'ahmedabad':    'ahmedabad',

  'panaji':       'goa',
  'panjim':       'goa',
  'margao':       'goa',
  'madgaon':      'goa',
  'vasco':        'goa',
  'mapusa':       'goa',
  'calangute':    'goa',
  'candolim':     'goa',
  'anjuna':       'goa',
  'baga':         'goa',
  'ponda':        'goa',

  'gangtok':      'gangtok',

  'istanbul':     'istanbul',

  'mexico city':  'mexicocity',
  'ciudad de mexico': 'mexicocity',
  'ciudad de méxico': 'mexicocity',
  'cdmx':         'mexicocity',

  'rio de janeiro': 'riodejaneiro',
  'sao paulo':    'saopaulo',
  'são paulo':    'saopaulo',

  'cebu city':    'cebucity',
  'cebu':         'cebucity',

  'gurugram':     'gurugram',
  'gurgaon':      'gurugram',
  'faridabad':    'faridabad',
  'chandigarh':   'chandigarh',
  'srinagar':     'srinagar',
  'shillong':     'shillong',
  'indore':       'indore',
};

// Fallback for states where we cover exactly one city - safe to use
// region alone since there's no ambiguity. (Maharashtra is excluded:
// it has four covered cities (Mumbai, Pune, Nagpur, Nashik). Kerala is
// also excluded: it now has three covered cities (Kochi,
// Thiruvananthapuram, Kozhikode). Both must be resolved via
// GEO_CITY_MAP above instead.)
//
// Brazil's two cities (Rio de Janeiro, Sao Paulo) are each their own
// STATE too (a common Brazilian naming pattern - city and state share
// the name), so unlike Maharashtra, the region string itself
// disambiguates them safely - "Sao Paulo" the region can only mean
// Sao Paulo state/city, not Rio.
var GEO_REGION_MAP = {
  'delhi':          'delhi',
  'nct of delhi':   'delhi',
  'karnataka':      'bengaluru',
  'telangana':      'hyderabad',
  'west bengal':    'kolkata',
  'tamil nadu':     'chennai',
  'gujarat':        'ahmedabad',
  'goa':            'goa',
  'sikkim':         'gangtok',
  'chandigarh':     'chandigarh',
  'meghalaya':      'shillong',
  'madhya pradesh': 'indore',
  'ciudad de mexico': 'mexicocity',
  'distrito federal': 'mexicocity',
  'rio de janeiro': 'riodejaneiro',
  'sao paulo':      'saopaulo',
  'são paulo':      'saopaulo',
};

// Country-level fallback - used only when BOTH city and region-level
// matching fail. Safe today because every covered country has exactly
// one city each; if a second city is ever added within any of these
// countries, that entry must move to city-level matching only, same
// as Maharashtra already had to do above.
//
// Brazil is deliberately EXCLUDED here (same reasoning as Maharashtra):
// it now has two covered cities (Rio, Sao Paulo), so guessing from
// country name alone would be genuinely ambiguous. City/region-level
// matching above handles it safely instead.
var GEO_COUNTRY_MAP = {
  'thailand': 'bangkok',
  'turkey':   'istanbul',
  'türkiye':  'istanbul',
  'mexico':   'mexicocity',
  'méxico':   'mexicocity',
  'philippines': 'cebucity',
};

function cityFromString(cityStr, regionStr, countryStr) {
  var lowerCity = (cityStr || '').toLowerCase();
  for (var key in GEO_CITY_MAP) {
    if (lowerCity.indexOf(key) !== -1) return GEO_CITY_MAP[key];
  }
  var lowerRegion = (regionStr || '').toLowerCase();
  for (var rkey in GEO_REGION_MAP) {
    if (lowerRegion.indexOf(rkey) !== -1) return GEO_REGION_MAP[rkey];
  }
  var lowerCountry = (countryStr || '').toLowerCase();
  for (var ckey in GEO_COUNTRY_MAP) {
    if (lowerCountry.indexOf(ckey) !== -1) return GEO_COUNTRY_MAP[ckey];
  }
  return null;
}

function detectCityAndRedirect() {
  // IP-based detection — no user permission, works on all browsers instantly
  var done = false;

  // Safety net — show chooser after 5s if API hasn't responded
  var safetyTimer = setTimeout(function() {
    if (!done) { done = true; showCityChooser(); }
  }, 5000);

  fetch('https://ipapi.co/json/')
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (done) return;
      done = true;
      clearTimeout(safetyTimer);
      // ipapi.co returns city, region, and country_name fields
      var slug = cityFromString(data.city, data.region, data.country_name);
      if (slug) {
        window.location.href = '/' + slug + '/';
      } else {
        showCityChooser();
      }
    })
    .catch(function() {
      if (done) return;
      done = true;
      clearTimeout(safetyTimer);
      showCityChooser();
    });
}

function showCityChooser() {
  var el = document.getElementById('city-chooser');
  if (el) el.style.display = 'block';
  var spinner = document.getElementById('geo-spinner');
  if (spinner) spinner.style.display = 'none';
}


function computeFare(distKm, waitMin, isNight, luggagePieces, tariff) {
  if (tariff.BANDS) return computeFareTiered(distKm, waitMin, isNight, luggagePieces, tariff);
  if (tariff.PROGRESSIVE_BANDS) return computeFareProgressive(distKm, waitMin, isNight, luggagePieces, tariff);

  const T = tariff;

  // Effective wait (subtract free minutes for cities that have them)
  const freeWaitMins = T.WAIT_FREE_MINS || 0;
  const billableWaitMin = Math.max(0, waitMin - freeWaitMins);

  // FLAG_FALL is an optional fixed charge added on top of the per-km
  // rate (distinct from MIN_FARE, which is a floor). Needed for cities
  // like Istanbul where the meter is "opening fee + per-km for the
  // whole distance", with a separate minimum-fare floor for short
  // trips - a genuinely different structure from Mumbai-style tariffs
  // where MIN_FARE alone covers the first MIN_KM. Defaults to 0, so
  // every existing tariff without this field computes exactly as before.
  let base = distKm <= T.MIN_KM
    ? T.MIN_FARE
    : Math.max(T.MIN_FARE, Math.round((T.FLAG_FALL || 0) + distKm * T.RATE_PER_KM));

  const waitCharge    = Math.round(billableWaitMin * T.WAIT_RATE_PER_MIN);
  const luggageCharge = luggagePieces * (T.LUGGAGE_PER_PIECE || 0);
  let subtotal        = base + waitCharge + luggageCharge;
  let nightAdd        = 0;

  if (isNight) {
    const withNight = Math.round(subtotal * T.NIGHT_MULTIPLIER);
    nightAdd  = withNight - subtotal;
    subtotal  = withNight;
  }

  return { base, waitCharge, luggageCharge, nightAdd, subtotal };
}

/**
 * Tiered/slab fare calculation - used by cities where the rate changes
 * by distance band and the WHOLE trip is billed at that band's rate
 * (not cumulative like income tax brackets). E.g. Sikkim's "Sikkim Cab"
 * tariff: 0-2km flat Rs100, 2-4km flat Rs200, 4-15km @ Rs40/km applied
 * to the full distance, 15-50km @ Rs38/km applied to the full distance,
 * and so on - a 10km trip costs 10 x 40 = Rs400, not a blend of bands.
 * tariff.BANDS = [{upTo, flatFare} | {upTo, perKm}, ...] sorted ascending.
 */
function computeFareTiered(distKm, waitMin, isNight, luggagePieces, tariff) {
  const T = tariff;
  const freeWaitMins = T.WAIT_FREE_MINS || 0;
  const billableWaitMin = Math.max(0, waitMin - freeWaitMins);

  let base = null;
  for (const band of T.BANDS) {
    if (distKm <= band.upTo) {
      base = (band.flatFare !== undefined) ? band.flatFare : Math.round(distKm * band.perKm);
      break;
    }
  }
  if (base === null) {
    // Distance exceeded every band (shouldn't happen if the last band's
    // upTo is a large sentinel) - fall back to the last band's rate.
    const lastBand = T.BANDS[T.BANDS.length - 1];
    base = (lastBand.flatFare !== undefined) ? lastBand.flatFare : Math.round(distKm * lastBand.perKm);
  }

  const waitCharge    = Math.round(billableWaitMin * T.WAIT_RATE_PER_MIN);
  const luggageCharge = luggagePieces * (T.LUGGAGE_PER_PIECE || 0);
  let subtotal        = base + waitCharge + luggageCharge;
  let nightAdd        = 0;

  if (isNight) {
    const withNight = Math.round(subtotal * T.NIGHT_MULTIPLIER);
    nightAdd  = withNight - subtotal;
    subtotal  = withNight;
  }

  return { base, waitCharge, luggageCharge, nightAdd, subtotal };
}

/**
 * Progressive/cumulative banded fare calculation - used by cities whose
 * meter increments continuously as distance increases, with each band
 * only charging its OWN portion (like income tax brackets), unlike
 * computeFareTiered above (which bills the whole trip at one bracket's
 * rate). E.g. Bangkok's official meter: first 1km flat 40 THB, then
 * 6.50 THB/km for km 1-10, 7.00 THB/km for km 10-20, 8.00 THB/km for
 * km 20-40, 8.50 THB/km for km 40-60. A 15km trip costs
 * 40 + (9km x 6.50) + (5km x 7.00) = 133.5 -> 134 THB, not 15 x any
 * single rate. Verified against a real-world example (~26km Bangkok
 * airport trip, sourced fare ~267 THB): this formula gives 216 THB
 * base + 50 THB airport surcharge = 266 THB, matching within rounding.
 * tariff.PROGRESSIVE_BANDS = [{upTo, flatFare} | {upTo, perKm}, ...],
 * sorted ascending, each entry describing ONLY that band's own segment.
 */
function computeFareProgressive(distKm, waitMin, isNight, luggagePieces, tariff) {
  const T = tariff;
  const freeWaitMins = T.WAIT_FREE_MINS || 0;
  const billableWaitMin = Math.max(0, waitMin - freeWaitMins);

  // CEIL_TO_KM: some cities bill "first km or part thereof, every
  // subsequent km or part thereof" - meaning a 3.8km trip is billed as
  // 4 whole km, not 3.8. Verified against Meghalaya's own official fare
  // schedule (e.g. IGP to MPRO, 3.8km, billed at the same rate as a
  // flat 4km trip) before adding this. Defaults to off, so every
  // existing progressive-band city (Bangkok, Gurugram, etc., which all
  // bill continuously/fractionally) computes exactly as before.
  const effectiveDist = T.CEIL_TO_KM ? Math.max(1, Math.ceil(distKm)) : distKm;

  let base = 0;
  let prevUpTo = 0;
  for (const band of T.PROGRESSIVE_BANDS) {
    if (effectiveDist <= prevUpTo) break;
    if (band.flatFare !== undefined) {
      base += band.flatFare;
    } else {
      const portionKm = Math.min(effectiveDist, band.upTo) - prevUpTo;
      base += portionKm * band.perKm;
    }
    prevUpTo = band.upTo;
  }
  base = Math.round(base);

  const waitCharge    = Math.round(billableWaitMin * T.WAIT_RATE_PER_MIN);
  const luggageCharge = luggagePieces * (T.LUGGAGE_PER_PIECE || 0);
  let subtotal        = base + waitCharge + luggageCharge;
  let nightAdd        = 0;

  if (isNight) {
    const withNight = Math.round(subtotal * T.NIGHT_MULTIPLIER);
    nightAdd  = withNight - subtotal;
    subtotal  = withNight;
  }

  return { base, waitCharge, luggageCharge, nightAdd, subtotal };
}

/**
 * Determine if the current hour is within night hours for this city's tariff.
 */
function isNightTime(tariff) {
  const hour = new Date().getHours();
  const s = tariff.NIGHT_START;
  const e = tariff.NIGHT_END;
  // Night wraps around midnight when START > END (e.g. 23 to 5)
  if (s > e) return hour >= s || hour < e;
  return hour >= s && hour < e;
}

