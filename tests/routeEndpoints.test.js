/**
 * Where a route STARTS and ENDS.
 *
 * The bug these cover: app.js built every Routes API request from the
 * text sitting in the pickup/dropoff boxes, so Google re-geocoded a
 * name the user had already resolved by picking it from the dropdown.
 * The point it chose need not be the one the user meant, and the
 * distance then disagreed with Google Maps for the same journey —
 * 10.6 km against 9.1 km for Oberoi Maxima → Karan Apartments.
 *
 * A place id pins the endpoint exactly. These tests pin that the id is
 * used when it exists, that coordinates are the next best thing, that
 * free text still works for someone who never picks a prediction, and
 * — the part most likely to break later — that a remembered place is
 * dropped the moment the text stops matching it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { loadAppJs } from './helpers/loadAppJs.js';

/** A fetch stub shaped like the Routes API, recording what was sent. */
function routesStub() {
  return () => Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ routes: [] }),
  });
}

let app;
beforeEach(() => {
  app = loadAppJs({ fetchImpl: routesStub() });
  app.resolvedPoints.pickup = null;
  app.resolvedPoints.dropoff = null;
});

describe('withCityContext', () => {
  it('appends the city when the text does not name it', () => {
    expect(app.withCityContext('Juhu Beach', 'Mumbai')).toBe('Juhu Beach, Mumbai, India');
  });

  it('leaves text alone when the city is already in it, in any case', () => {
    expect(app.withCityContext('Juhu Beach, mumbai', 'Mumbai')).toBe('Juhu Beach, mumbai');
    expect(app.withCityContext('Juhu Beach, MUMBAI', 'Mumbai')).toBe('Juhu Beach, MUMBAI');
  });

  it('survives empty and missing values without throwing', () => {
    expect(() => app.withCityContext(null, 'Mumbai')).not.toThrow();
    expect(app.withCityContext(null, 'Mumbai')).toBe(', Mumbai, India');
    expect(app.withCityContext('Juhu', '')).toBe('Juhu');
    expect(app.withCityContext('Juhu', null)).toBe('Juhu');
  });
});

describe('isUsableCoordPair', () => {
  it('accepts a real Mumbai coordinate', () => {
    expect(app.isUsableCoordPair(19.1076, 72.8263)).toBe(true);
  });

  it('rejects the values Number() would silently turn into zero', () => {
    // Number(null), Number('') and Number(false) are all 0, which is a
    // real point in the Gulf of Guinea. A truthiness check would have
    // let a missing coordinate through as a route endpoint.
    for (const bad of [null, undefined, '', false, NaN, 'abc', {}]) {
      expect(app.isUsableCoordPair(bad, 72.8), String(bad)).toBe(false);
      expect(app.isUsableCoordPair(19.1, bad), String(bad)).toBe(false);
    }
  });

  it('rejects 0,0 outright', () => {
    expect(app.isUsableCoordPair(0, 0)).toBe(false);
  });

  it('rejects out-of-range values', () => {
    expect(app.isUsableCoordPair(91, 72.8)).toBe(false);
    expect(app.isUsableCoordPair(19.1, 181)).toBe(false);
  });
});

describe('routeWaypoint — precision order', () => {
  it('prefers a place id above everything else', () => {
    const point = { placeId: 'ChIJtest', lat: 19.1, lng: 72.8, text: 'Karan Apartments' };
    expect(app.routeWaypoint(point, 'Karan Apartments', 'Mumbai')).toEqual({ placeId: 'ChIJtest' });
  });

  it('falls back to coordinates when there is no place id', () => {
    const point = { placeId: null, lat: 19.1076, lng: 72.8263, text: 'my location' };
    expect(app.routeWaypoint(point, 'my location', 'Mumbai')).toEqual({
      location: { latLng: { latitude: 19.1076, longitude: 72.8263 } },
    });
  });

  it('falls back to text when nothing was resolved', () => {
    expect(app.routeWaypoint(null, 'Karan Apartments', 'Mumbai'))
      .toEqual({ address: 'Karan Apartments, Mumbai, India' });
  });

  it('falls back to text when the stored point has neither id nor usable coordinates', () => {
    const broken = { placeId: null, lat: undefined, lng: undefined, text: 'Somewhere' };
    expect(app.routeWaypoint(broken, 'Somewhere', 'Mumbai'))
      .toEqual({ address: 'Somewhere, Mumbai, India' });
  });
});

describe('resolvedPointFor — a stale pick must never be used', () => {
  it('returns the point while the text still matches', () => {
    app.resolvedPoints.pickup = { placeId: 'ChIJa', text: 'Juhu Beach, Mumbai' };
    expect(app.resolvedPointFor('pickup', 'Juhu Beach, Mumbai')).not.toBeNull();
  });

  it('ignores differences in case and surrounding whitespace', () => {
    app.resolvedPoints.pickup = { placeId: 'ChIJa', text: 'Juhu Beach, Mumbai' };
    expect(app.resolvedPointFor('pickup', '  juhu beach,   Mumbai ')).not.toBeNull();
  });

  it('drops the point once the user edits the text', () => {
    // This is the dangerous case: without it, someone picks Juhu Beach,
    // retypes the box as Bandra, and gets routed to Juhu anyway.
    app.resolvedPoints.pickup = { placeId: 'ChIJa', text: 'Juhu Beach, Mumbai' };
    expect(app.resolvedPointFor('pickup', 'Bandra Station')).toBeNull();
  });

  it('returns null when nothing was ever picked', () => {
    expect(app.resolvedPointFor('pickup', 'anything')).toBeNull();
  });
});

describe('computeRoutesAPI — what actually goes on the wire', () => {
  async function sentBody(pickup, dropoff) {
    await app.computeRoutesAPI(pickup, dropoff);
    const call = app.calls[app.calls.length - 1];
    return JSON.parse(call.opts.body);
  }

  it('sends place ids for both ends when both were picked', async () => {
    app.resolvedPoints.pickup  = { placeId: 'ChIJoberoi', text: 'Oberoi Maxima' };
    app.resolvedPoints.dropoff = { placeId: 'ChIJkaran',  text: 'Karan Apartments' };

    const body = await sentBody('Oberoi Maxima', 'Karan Apartments');
    expect(body.origin).toEqual({ placeId: 'ChIJoberoi' });
    expect(body.destination).toEqual({ placeId: 'ChIJkaran' });
    // No address field anywhere — that was the whole problem.
    expect(JSON.stringify(body)).not.toContain('address');
  });

  it('mixes forms per end — a GPS pickup and a picked dropoff', async () => {
    app.resolvedPoints.pickup  = { placeId: null, lat: 19.1364, lng: 72.8296, text: 'Andheri East' };
    app.resolvedPoints.dropoff = { placeId: 'ChIJkaran', text: 'Karan Apartments' };

    const body = await sentBody('Andheri East', 'Karan Apartments');
    expect(body.origin).toEqual({ location: { latLng: { latitude: 19.1364, longitude: 72.8296 } } });
    expect(body.destination).toEqual({ placeId: 'ChIJkaran' });
  });

  it('still sends plain text for someone who never picks a prediction', async () => {
    const body = await sentBody('Oberoi Maxima', 'Karan Apartments');
    expect(body.origin).toEqual({ address: 'Oberoi Maxima, Mumbai, India' });
    expect(body.destination).toEqual({ address: 'Karan Apartments, Mumbai, India' });
  });

  it('ignores a remembered place once the box has been retyped', async () => {
    app.resolvedPoints.dropoff = { placeId: 'ChIJkaran', text: 'Karan Apartments' };
    const body = await sentBody('Oberoi Maxima', 'Bandra Station');
    expect(body.destination).toEqual({ address: 'Bandra Station, Mumbai, India' });
  });

  it('leaves the rest of the request untouched', async () => {
    // Routing preference and field mask decide the fare and the billing
    // tier. This change was about endpoints only.
    const body = await sentBody('A', 'B');
    expect(body.travelMode).toBe('DRIVE');
    expect(body.routingPreference).toBe('TRAFFIC_AWARE');
    expect(body.computeAlternativeRoutes).toBe(false);
    expect(body.units).toBe('METRIC');

    const headers = app.calls[app.calls.length - 1].opts.headers;
    expect(headers['X-Goog-FieldMask']).toContain('routes.distanceMeters');
    expect(headers['X-Goog-FieldMask']).toContain('routes.legs.startLocation');
  });
});
