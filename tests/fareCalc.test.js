import { describe, it, expect, beforeAll } from 'vitest';
import { loadCitiesJs } from './helpers/loadCitiesJs.js';

let sandbox;

beforeAll(() => {
  sandbox = loadCitiesJs();
});

describe('computeFare - flat-rate cities', () => {
  it('matches Maharashtra MVD\'s own worked example (2.40km => Rs 41)', () => {
    // Straight from the official Mumbai tariff card: "for 2.40 KMs the
    // fare will be 17.14 x 2.40 = 41.13 i.e. Rs. 41"
    const T = sandbox.CITIES.mumbai.tariff;
    const fare = sandbox.computeFare(2.4, 0, false, 0, T);
    expect(fare.subtotal).toBe(41);
  });

  it('charges the minimum fare for trips at or under MIN_KM', () => {
    const T = sandbox.CITIES.mumbai.tariff; // MIN_FARE 26, MIN_KM 1.5
    expect(sandbox.computeFare(1.5, 0, false, 0, T).subtotal).toBe(26);
    expect(sandbox.computeFare(0.5, 0, false, 0, T).subtotal).toBe(26);
  });

  it('never charges less than the minimum fare even if distance*rate is lower', () => {
    const T = sandbox.CITIES.mumbai.tariff;
    // 1.6km * 17.14 = 27.4 -> rounds to 27, still above min, sanity check
    // the Math.max(MIN_FARE, ...) guard with a rate that WOULD dip below
    const lowRateTariff = { ...T, RATE_PER_KM: 1 }; // 1.6km * 1 = 1.6 -> 2
    expect(sandbox.computeFare(1.6, 0, false, 0, lowRateTariff).subtotal).toBe(T.MIN_FARE);
  });

  it('applies the night surcharge multiplicatively on top of base+wait+luggage', () => {
    const T = sandbox.CITIES.mumbai.tariff; // 25% night multiplier
    const day = sandbox.computeFare(5, 0, false, 0, T);
    const night = sandbox.computeFare(5, 0, true, 0, T);
    expect(night.subtotal).toBe(Math.round(day.subtotal * 1.25));
    expect(night.nightAdd).toBe(night.subtotal - day.subtotal);
  });

  it('adds waiting charge based on WAIT_RATE_PER_MIN', () => {
    const T = sandbox.CITIES.mumbai.tariff; // 1.714/min
    const fare = sandbox.computeFare(1.5, 10, false, 0, T); // min-fare distance + 10 min wait
    expect(fare.waitCharge).toBe(Math.round(10 * T.WAIT_RATE_PER_MIN));
    expect(fare.subtotal).toBe(T.MIN_FARE + fare.waitCharge);
  });

  it('adds luggage charge per piece', () => {
    const T = sandbox.CITIES.mumbai.tariff; // Rs 6/piece
    const noLuggage = sandbox.computeFare(1.5, 0, false, 0, T);
    const withLuggage = sandbox.computeFare(1.5, 0, false, 2, T);
    expect(withLuggage.luggageCharge).toBe(2 * T.LUGGAGE_PER_PIECE);
    expect(withLuggage.subtotal).toBe(noLuggage.subtotal + withLuggage.luggageCharge);
  });

  it('respects WAIT_FREE_MINS when a tariff defines free waiting minutes', () => {
    const T = { ...sandbox.CITIES.mumbai.tariff, WAIT_FREE_MINS: 5 };
    const fare = sandbox.computeFare(1.5, 5, false, 0, T); // exactly the free allowance
    expect(fare.waitCharge).toBe(0);
    const fareOver = sandbox.computeFare(1.5, 8, false, 0, T); // 3 billable minutes
    expect(fareOver.waitCharge).toBe(Math.round(3 * T.WAIT_RATE_PER_MIN));
  });
});

describe('computeFare - tiered/band cities (Gangtok/Sikkim)', () => {
  // Verified by hand against the official "Sikkim Cab" tariff notification
  // before this data went live - see cities.js CHANGELOG for the source.
  const T = () => sandbox.CITIES.gangtok.tariff;

  it('charges the flat 0-2km band fare regardless of exact distance within it', () => {
    expect(sandbox.computeFare(1.5, 0, false, 0, T()).subtotal).toBe(100);
    expect(sandbox.computeFare(2, 0, false, 0, T()).subtotal).toBe(100);
  });

  it('charges the flat 2-4km band fare', () => {
    expect(sandbox.computeFare(3, 0, false, 0, T()).subtotal).toBe(200);
  });

  it('applies the per-km rate to the FULL trip distance, not incrementally by band', () => {
    // 10km falls in the 4-15km band (Rs 40/km) - the whole 10km is
    // billed at 40/km, not a blend of the cheaper bands below it.
    expect(sandbox.computeFare(10, 0, false, 0, T()).subtotal).toBe(400); // 10 * 40
    expect(sandbox.computeFare(60, 0, false, 0, T()).subtotal).toBe(1980); // 60 * 33
    expect(sandbox.computeFare(100, 0, false, 0, T()).subtotal).toBe(2400); // 100 * 24
  });

  it('applies the night surcharge on top of the tiered base fare', () => {
    const day = sandbox.computeFare(10, 0, false, 0, T());
    const night = sandbox.computeFare(10, 0, true, 0, T());
    expect(day.subtotal).toBe(400);
    expect(night.subtotal).toBe(Math.round(400 * T().NIGHT_MULTIPLIER)); // 600 at 1.5x
  });

  it('falls back to the last band\'s rate for a distance beyond every defined upTo', () => {
    const weirdTariff = { ...T(), BANDS: [{ upTo: 5, perKm: 10 }] };
    const fare = sandbox.computeFare(50, 0, false, 0, weirdTariff);
    expect(fare.subtotal).toBe(500); // 50 * 10, using the only (last) band
  });
});

describe('computeFare - flat vs tiered dispatch', () => {
  it('routes to the tiered calculator only when tariff.BANDS is present', () => {
    const flatResult = sandbox.computeFare(10, 0, false, 0, sandbox.CITIES.mumbai.tariff);
    const tieredResult = sandbox.computeFare(10, 0, false, 0, sandbox.CITIES.gangtok.tariff);
    // Same distance, genuinely different pricing models - just a smoke
    // test that dispatch actually branches rather than always taking one path.
    expect(flatResult.subtotal).not.toBe(tieredResult.subtotal);
  });
});

describe('computeFare - flat-rate with optional FLAG_FALL (Istanbul)', () => {
  // Verified against 3 independent major Turkish news outlets (Hürriyet,
  // Milliyet, Sabah) reporting the same İBB Meclis decision, effective
  // 16 Feb 2026: 65.40 TL flag-fall + 43.56 TL/km, 210 TL minimum fare.
  const istanbulTariff = {
    MIN_FARE: 210, MIN_KM: 0, RATE_PER_KM: 43.56, FLAG_FALL: 65.40,
    WAIT_RATE_PER_MIN: 9.07, NIGHT_MULTIPLIER: 1, LUGGAGE_PER_PIECE: 0,
  };

  it('floors short trips at the minimum fare even with a flag-fall added', () => {
    expect(sandbox.computeFare(0.5, 0, false, 0, istanbulTariff).subtotal).toBe(210);
    expect(sandbox.computeFare(1,   0, false, 0, istanbulTariff).subtotal).toBe(210);
  });

  it('adds the flag-fall on top of per-km rate for the whole distance once above the floor', () => {
    // 5km: 65.40 + 5x43.56 = 283.20 -> 283
    expect(sandbox.computeFare(5, 0, false, 0, istanbulTariff).subtotal).toBe(283);
    // 10km: 65.40 + 10x43.56 = 501.00 -> 501
    expect(sandbox.computeFare(10, 0, false, 0, istanbulTariff).subtotal).toBe(501);
  });

  it('does not affect flat-rate cities with no FLAG_FALL defined (backward compatibility)', () => {
    // Same Maharashtra MVD worked example used elsewhere in this file -
    // must still compute identically now that FLAG_FALL exists as a
    // possible field, since Mumbai's tariff never sets it.
    const mumbaiTariff = { MIN_FARE: 27, MIN_KM: 1.5, RATE_PER_KM: 18.22, WAIT_RATE_PER_MIN: 1.822, NIGHT_MULTIPLIER: 1.25, LUGGAGE_PER_PIECE: 6 };
    expect(sandbox.computeFare(2.4, 0, false, 0, mumbaiTariff).subtotal).toBe(41);
  });

  it('matches Mexico City\'s sourced day/night ratio exactly (20% night surcharge)', () => {
    const mxTariff = sandbox.CITIES.mexicocity.tariff;
    const day = sandbox.computeFare(5, 0, false, 0, mxTariff);
    const night = sandbox.computeFare(5, 0, true, 0, mxTariff);
    expect(day.subtotal).toBe(30); // 8.74 + 5*4.28 = 30.14 -> 30
    expect(night.subtotal / day.subtotal).toBeCloseTo(1.20, 2);
  });
});

describe('computeFare - progressive bands with CEIL_TO_KM (Shillong)', () => {
  // Verified directly against Meghalaya's own official fare schedule
  // PDF (megtransport.gov.in), which lists specific route distances
  // and fares - e.g. "IGP to MPRO, 3.8km, Rs32" only matches if 3.8km
  // is billed as a full 4km, not continuously. "First km or part
  // thereof, every subsequent km or part thereof" is explicit in the
  // source document's own wording.
  const shillongAuto = {
    PROGRESSIVE_BANDS: [{ upTo: 1, flatFare: 14 }, { upTo: 999999, perKm: 6 }],
    CEIL_TO_KM: true,
    WAIT_RATE_PER_MIN: 1.2,
    NIGHT_MULTIPLIER: 1,
    LUGGAGE_PER_PIECE: 0,
  };

  it('rounds any partial km up to a full km before billing', () => {
    // Real sample fares from the source PDF
    expect(sandbox.computeFare(3.8, 0, false, 0, shillongAuto).subtotal).toBe(32);
    expect(sandbox.computeFare(8.99, 0, false, 0, shillongAuto).subtotal).toBe(62);
  });

  it('bills whole-km distances at exactly their own rate, no extra rounding', () => {
    expect(sandbox.computeFare(2, 0, false, 0, shillongAuto).subtotal).toBe(20);
    expect(sandbox.computeFare(1, 0, false, 0, shillongAuto).subtotal).toBe(14);
  });

  it('bills any distance under 1km at the full first-km rate', () => {
    expect(sandbox.computeFare(0.1, 0, false, 0, shillongAuto).subtotal).toBe(14);
    expect(sandbox.computeFare(0.99, 0, false, 0, shillongAuto).subtotal).toBe(14);
  });

  it('does not affect progressive-band cities without CEIL_TO_KM (backward compatibility)', () => {
    // Bangkok bills continuously/fractionally - must be unaffected by
    // this new capability existing.
    const bangkokTariff = sandbox.CITIES.bangkok.tariff;
    expect(sandbox.computeFare(5, 0, false, 0, bangkokTariff).subtotal).toBe(66);
  });
});

describe('computeFare - progressive/cumulative banded cities (Bangkok)', () => {
  // Verified against 5 independent contemporaneous news sources reporting
  // the same Jan 2023 Royal Gazette announcement, and cross-checked
  // against a real-world example: a ~26km Suvarnabhumi-area Bangkok trip
  // reported at "approximately 267 THB" - this tariff's own formula
  // gives 217 THB base + 50 THB airport surcharge = 267 THB exactly.
  const bangkokTariff = {
    PROGRESSIVE_BANDS: [
      { upTo: 1,  flatFare: 40 },
      { upTo: 10, perKm: 6.5 },
      { upTo: 20, perKm: 7.0 },
      { upTo: 40, perKm: 8.0 },
      { upTo: 60, perKm: 8.5 },
    ],
    WAIT_RATE_PER_MIN: 3,
    NIGHT_MULTIPLIER: 1,
    LUGGAGE_PER_PIECE: 0,
  };

  it('charges the flat flag-fall for any distance within the first band', () => {
    expect(sandbox.computeFare(0.5, 0, false, 0, bangkokTariff).subtotal).toBe(40);
    expect(sandbox.computeFare(1,   0, false, 0, bangkokTariff).subtotal).toBe(40);
  });

  it('only charges each band its OWN portion, unlike the Sikkim-style tiered model', () => {
    // 15km = 40 (first km) + 9km@6.5 (km 1-10) + 5km@7.0 (km 10-15) = 133.5 -> 134
    expect(sandbox.computeFare(15, 0, false, 0, bangkokTariff).subtotal).toBe(134);
  });

  it('matches the real-world sourced example (~26km, ~267 THB incl. 50 THB airport surcharge)', () => {
    const fare = sandbox.computeFare(26, 0, false, 0, bangkokTariff);
    expect(fare.subtotal + 50).toBe(267);
  });

  it('crosses multiple bands correctly in one trip', () => {
    // 45km spans all 5 bands: 40 + 9x6.5 + 10x7 + 20x8 + 5x8.5
    // = 40 + 58.5 + 70 + 160 + 42.5 = 371 exactly
    expect(sandbox.computeFare(45, 0, false, 0, bangkokTariff).subtotal).toBe(371);
  });
});

describe('isNightTime', () => {
  it('handles a normal (non-wraparound) night window', () => {
    // Ahmedabad-style pattern used as a hypothetical non-wraparound
    // window for this test: 22:00-06:00 wraps too, so use a synthetic
    // same-day window to isolate the non-wraparound branch.
    const T = { NIGHT_START: 13, NIGHT_END: 18 };
    sandbox.__setMockHour(15); // 3 PM, inside window
    expect(sandbox.isNightTime(T)).toBe(true);
    sandbox.__setMockHour(20); // 8 PM, outside window
    expect(sandbox.isNightTime(T)).toBe(false);
  });

  it('handles a midnight-wraparound night window (e.g. Mumbai 12AM-5AM)', () => {
    const T = sandbox.CITIES.mumbai.tariff; // NIGHT_START 0, NIGHT_END 5
    sandbox.__setMockHour(2); // 2 AM - inside
    expect(sandbox.isNightTime(T)).toBe(true);
    sandbox.__setMockHour(12); // noon - outside
    expect(sandbox.isNightTime(T)).toBe(false);
  });

  it('handles a wraparound window starting late in the day (Delhi 11PM-5AM)', () => {
    const T = sandbox.CITIES.delhi.tariff; // NIGHT_START 23, NIGHT_END 5
    sandbox.__setMockHour(23); // 11 PM - inside
    expect(sandbox.isNightTime(T)).toBe(true);
    sandbox.__setMockHour(4); // 4 AM - inside
    expect(sandbox.isNightTime(T)).toBe(true);
    sandbox.__setMockHour(10); // 10 AM - outside
    expect(sandbox.isNightTime(T)).toBe(false);
  });
});

describe('cityFromString - geo-detection matching', () => {
  it('matches the exact regression case that motivated the geo-fix (Borivali -> mumbai)', () => {
    // ipapi.co returned city:"Borivali", region:"Maharashtra" for a real
    // Mumbai visitor; the original GEO_CITY_MAP only had 'mumbai',
    // 'navi mumbai', 'thane' and missed this, sending them to the manual
    // chooser instead of auto-redirecting. See cities.js CHANGELOG.
    expect(sandbox.cityFromString('Borivali', 'Maharashtra')).toBe('mumbai');
  });

  it('matches other Mumbai/Pune suburbs directly by name', () => {
    expect(sandbox.cityFromString('Andheri', 'Maharashtra')).toBe('mumbai');
    expect(sandbox.cityFromString('Baner', 'Maharashtra')).toBe('pune');
    expect(sandbox.cityFromString('Hinjewadi', 'Maharashtra')).toBe('pune');
  });

  it('falls back to region-level matching for single-city states', () => {
    // Koramangala isn't itself in GEO_CITY_MAP, but Karnataka has exactly
    // one covered city, so the region fallback safely resolves it.
    expect(sandbox.cityFromString('Koramangala', 'Karnataka')).toBe('bengaluru');
    expect(sandbox.cityFromString('Whitefield', 'Karnataka')).toBe('bengaluru');
    expect(sandbox.cityFromString('Dwarka', 'Delhi')).toBe('delhi');
  });

  it('does NOT use region fallback for Maharashtra (ambiguous: Mumbai vs Pune)', () => {
    // This is the one state where guessing wrong would actually be worse
    // than showing the manual chooser - Maharashtra covers both Mumbai
    // and Pune, so an unrecognized suburb must return null, not guess.
    expect(sandbox.cityFromString('SomeRandomVillage', 'Maharashtra')).toBeNull();
  });

  it('returns null for a city/region with no coverage at all', () => {
    expect(sandbox.cityFromString('Springfield', 'Illinois')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(sandbox.cityFromString('BORIVALI', 'MAHARASHTRA')).toBe('mumbai');
    expect(sandbox.cityFromString('borivali', 'maharashtra')).toBe('mumbai');
  });

  it('falls back to country-level matching when city and region both miss (Bangkok pilot)', () => {
    // A Bangkok suburb ipapi.co doesn't have in GEO_CITY_MAP, with a
    // region name that also doesn't match anything - only the country
    // resolves it. Safe today because Thailand has exactly one covered
    // city, mirroring how single-city-state region fallback works.
    expect(sandbox.cityFromString('Nonthaburi', 'Nonthaburi Province', 'Thailand')).toBe('bangkok');
  });

  it('matches Bangkok directly by city name too', () => {
    expect(sandbox.cityFromString('Bangkok', 'Bangkok', 'Thailand')).toBe('bangkok');
  });

  it('does not false-positive match short substrings from unrelated places (Ontario contains "rio")', () => {
    // Caught during Rio de Janeiro's build: a bare 'rio' key in
    // GEO_CITY_MAP would have matched "Ontario" as a substring,
    // incorrectly redirecting Canadian visitors to Rio de Janeiro.
    expect(sandbox.cityFromString('Toronto', 'Ontario', 'Canada')).toBeNull();
  });

  it('resolves Brazil safely now that it has two cities - via distinct state-level region names, never a country-level guess', () => {
    // Brazil's city and state names coincide (Rio de Janeiro city is in
    // Rio de Janeiro state; Sao Paulo city is in Sao Paulo state), so
    // unlike Maharashtra, the region string itself safely disambiguates
    // - "Sao Paulo" the region can only mean Sao Paulo.
    expect(sandbox.cityFromString('Some Suburb', 'Rio de Janeiro', 'Brazil')).toBe('riodejaneiro');
    expect(sandbox.cityFromString('Some Suburb', 'Sao Paulo', 'Brazil')).toBe('saopaulo');
    // Country-level alone (both city and region unrecognized) must NOT
    // guess between the two - Brazil was deliberately removed from
    // GEO_COUNTRY_MAP for exactly this reason.
    expect(sandbox.cityFromString('Unknown City', 'Unknown State', 'Brazil')).toBeNull();
  });

  it('does not misdirect Gurugram/Faridabad to Delhi (each now has its own real tariff page)', () => {
    // Caught while building Gurugram/Faridabad: a stale mapping from
    // before these cities had dedicated pages sent them to Delhi's
    // page instead - a different jurisdiction with a different tariff.
    expect(sandbox.cityFromString('Gurugram', 'Haryana')).toBe('gurugram');
    expect(sandbox.cityFromString('Gurgaon', 'Haryana')).toBe('gurugram');
    expect(sandbox.cityFromString('Faridabad', 'Haryana')).toBe('faridabad');
  });

  it('does not misdirect Noida/Ghaziabad to Delhi (different state, unconfirmed tariff)', () => {
    // Noida and Ghaziabad are in Uttar Pradesh, not Delhi (NCT) - they
    // used to silently redirect to Delhi's page, showing a possibly
    // different state's tariff with false confidence. Removed until a
    // dedicated, verified UP tariff is built - falling through to the
    // manual chooser is safer than a confident wrong answer.
    expect(sandbox.cityFromString('Noida', 'Uttar Pradesh')).toBeNull();
    expect(sandbox.cityFromString('Ghaziabad', 'Uttar Pradesh')).toBeNull();
  });

  it('does not extend Srinagar\'s rate to Jammu via a region-level guess', () => {
    // Srinagar (Kashmir division) and Jammu (Jammu division) share a
    // union territory but have separate RTOs, and a real conflicting
    // report suggested Jammu's black-auto rate may differ from
    // Srinagar's Cabinet-approved rate. No "jammu and kashmir"
    // region-level fallback was added for exactly this reason - a
    // Jammu visitor with an unrecognized city name must fall through
    // to the manual chooser, not get Srinagar's rate by default.
    expect(sandbox.cityFromString('Some Jammu Suburb', 'Jammu and Kashmir')).toBeNull();
    expect(sandbox.cityFromString('Srinagar', 'Jammu and Kashmir')).toBe('srinagar');
  });

  it('resolves Kerala safely now that it has three cities - never a region-level guess', () => {
    // Kerala went from one covered city (Kochi) to three (Kochi,
    // Thiruvananthapuram, Kozhikode) in the same build - the old
    // 'kerala' -> 'kochi' region-level fallback became unsafe the
    // moment the second city was added, same pattern as Maharashtra.
    expect(sandbox.cityFromString('Kochi', 'Kerala')).toBe('kochi');
    expect(sandbox.cityFromString('Trivandrum', 'Kerala')).toBe('thiruvananthapuram');
    expect(sandbox.cityFromString('Calicut', 'Kerala')).toBe('kozhikode');
    expect(sandbox.cityFromString('Some Unrecognized Town', 'Kerala')).toBeNull();
  });

  it('does not let country-level fallback override a real city/region match', () => {
    // Sanity check: an Indian city match should never fall through to
    // country matching even if a country string is passed alongside it.
    expect(sandbox.cityFromString('Mumbai', 'Maharashtra', 'India')).toBe('mumbai');
  });
});

describe('city data integrity', () => {
  it('every city in CITY_LIST exists in CITIES', () => {
    for (const slug of sandbox.CITY_LIST) {
      expect(sandbox.CITIES[slug], `CITY_LIST references missing city "${slug}"`).toBeDefined();
    }
  });

  it('every city has a country and currency (explicit, not relying on template defaults)', () => {
    for (const [slug, city] of Object.entries(sandbox.CITIES)) {
      expect(city.country, `${slug}.country`).toBeTruthy();
      expect(city.countryCode, `${slug}.countryCode`).toBeTruthy();
      expect(city.currencyCode, `${slug}.currencyCode`).toBeTruthy();
      expect(city.currencySymbol, `${slug}.currencySymbol`).toBeTruthy();
    }
  });

  it('every tariff is flat, tiered, OR progressive - never more than one shape at once', () => {
    for (const [slug, city] of Object.entries(sandbox.CITIES)) {
      const T = city.tariff;
      const shapes = [
        T.MIN_FARE !== undefined && T.RATE_PER_KM !== undefined,
        Array.isArray(T.BANDS) && T.BANDS.length > 0,
        Array.isArray(T.PROGRESSIVE_BANDS) && T.PROGRESSIVE_BANDS.length > 0,
      ].filter(Boolean).length;
      expect(shapes, `${slug}.tariff matches ${shapes} fare shapes, expected exactly 1`).toBe(1);
    }
  });

  it('every city has the fields the UI/layout depends on', () => {
    for (const [slug, city] of Object.entries(sandbox.CITIES)) {
      expect(city.name, `${slug}.name`).toBeTruthy();
      expect(city.state, `${slug}.state`).toBeTruthy();
      expect(city.tariffDate, `${slug}.tariffDate`).toBeTruthy();
      expect(city.tariff, `${slug}.tariff`).toBeTruthy();
      expect(city.rtoContact, `${slug}.rtoContact`).toSatisfy(Array.isArray);
      expect(city.helpline, `${slug}.helpline`).toBeTruthy();
    }
  });


  it('tiered tariffs have bands sorted ascending by upTo with no gaps', () => {
    for (const [slug, city] of Object.entries(sandbox.CITIES)) {
      const bands = city.tariff.BANDS;
      if (!bands) continue;
      for (let i = 1; i < bands.length; i++) {
        expect(bands[i].upTo, `${slug} BANDS not ascending at index ${i}`).toBeGreaterThan(bands[i - 1].upTo);
      }
    }
  });

  it('cities with primaryVehicleType "taxi" have no auto-only vehicle-toggle expectation (no taxiTariff needed)', () => {
    // Taxi-primary cities (Goa, Gangtok) use `tariff` directly as the
    // taxi rate - they should NOT also define taxiTariff, since that
    // field means "this city has BOTH auto and taxi" in the toggle sense.
    for (const [slug, city] of Object.entries(sandbox.CITIES)) {
      if (city.primaryVehicleType === 'taxi') {
        expect(city.taxiTariff, `${slug} is taxi-primary but also has taxiTariff (ambiguous)`).toBeUndefined();
      }
    }
  });
});
