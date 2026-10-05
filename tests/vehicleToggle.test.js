/**
 * Regression tests for the Auto/Taxi toggle.
 *
 * Bug 1: clicking Taxi changed only the calculated fare. The tariff
 *        summary card, fare chart and FAQ kept rendering auto rickshaw
 *        rates, because every figure was derived once from city.tariff
 *        at build time.
 * Bug 2: hideResults() set an inline display:block on #empty-state,
 *        overriding `.empty-state { display:flex }` and shifting the
 *        tariff summary card out of its centred position.
 *
 * These run against the real built HTML in dist/ and the real app.js
 * source, so they fail if the fix is reverted.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mumbaiHtml = resolve(root, 'dist/mumbai/index.html');
const bengaluruHtml = resolve(root, 'dist/bengaluru/index.html');

let mumbai = '';
let bengaluru = '';
let appJs = '';
let css = '';

beforeAll(() => {
  if (!existsSync(mumbaiHtml)) {
    throw new Error('dist/ not built. Run `npm run build` before these tests.');
  }
  mumbai = readFileSync(mumbaiHtml, 'utf-8');
  bengaluru = readFileSync(bengaluruHtml, 'utf-8');
  appJs = readFileSync(resolve(root, 'public/app.js'), 'utf-8');
  css = readFileSync(resolve(root, 'public/style.css'), 'utf-8');
});

/* Mumbai tariff values, from public/cities.js — these are what must
   appear in the auto and taxi panes respectively. */
const AUTO = { minFare: '27', perKm: '18.22', wait: '1.82' };
const TAXI = { minFare: '33', perKm: '21.90', wait: '2.19' };

describe('taxi panes are rendered (Mumbai: has taxiTariff)', () => {
  it('renders the Auto/Taxi toggle', () => {
    expect(mumbai).toContain('setVehicleType(\'taxi\')');
  });

  it('renders both an auto pane and a taxi pane', () => {
    expect(mumbai).toContain('vt-pane--auto');
    expect(mumbai).toContain('vt-pane--taxi');
  });

  it('renders one pane pair each for card, chart and FAQ', () => {
    const autoPanes = (mumbai.match(/vt-pane--auto/g) || []).length;
    const taxiPanes = (mumbai.match(/vt-pane--taxi/g) || []).length;
    expect(autoPanes).toBe(3);
    expect(taxiPanes).toBe(3);
  });

  it('includes the taxi per-km rate, which was previously absent', () => {
    expect(mumbai).toContain(TAXI.perKm);
  });

  it('includes the taxi minimum fare', () => {
    // Scope the search to the taxi panes so the auto figures can't satisfy it.
    const taxiPanes = extractPanes(mumbai, 'taxi').join(' ');
    expect(taxiPanes).toContain(TAXI.minFare);
    expect(taxiPanes).toContain(TAXI.perKm);
  });

  it('keeps auto figures out of the taxi panes', () => {
    const taxiPanes = extractPanes(mumbai, 'taxi').join(' ');
    expect(taxiPanes).not.toContain(AUTO.perKm);
  });

  it('keeps taxi figures out of the auto panes', () => {
    const autoPanes = extractPanes(mumbai, 'auto').join(' ');
    expect(autoPanes).not.toContain(TAXI.perKm);
    expect(autoPanes).toContain(AUTO.perKm);
  });

  it('labels the taxi fare chart as Taxi, not Auto', () => {
    const taxiPanes = extractPanes(mumbai, 'taxi').join(' ');
    expect(taxiPanes).toMatch(/Taxi Fare Chart/);
  });
});

describe('cities without a taxi tariff are unaffected', () => {
  it('Bengaluru renders no taxi pane and no toggle', () => {
    expect(bengaluru).not.toContain('vt-pane--taxi');
    expect(bengaluru).not.toContain('setVehicleType(\'taxi\')');
  });

  it('Bengaluru still renders its auto panes', () => {
    expect(bengaluru).toContain('vt-pane--auto');
  });
});

describe('pane visibility is driven by data-vehicle', () => {
  it('setVehicleType sets the attribute on the document element', () => {
    expect(appJs).toMatch(/setAttribute\(\s*['"]data-vehicle['"]\s*,\s*type\s*\)/);
  });

  it('CSS hides the taxi pane unless data-vehicle is taxi', () => {
    expect(css).toMatch(/:root:not\(\[data-vehicle="taxi"\]\)\s*\.vt-pane--taxi\s*\{[^}]*display:none/);
  });

  it('CSS hides the auto pane when data-vehicle is taxi', () => {
    expect(css).toMatch(/\[data-vehicle="taxi"\]\s*\.vt-pane--auto\s*\{[^}]*display:none/);
  });

  it('server-rendered HTML carries no data-vehicle, so auto is the default view', () => {
    expect(mumbai).not.toMatch(/<html[^>]*data-vehicle=/);
  });
});

describe('empty-state no longer shifts the tariff card', () => {
  it('hideResults clears the inline display rather than setting block', () => {
    const fn = appJs.slice(appJs.indexOf('function hideResults'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain("removeProperty('display')");
    expect(body).not.toContain("style.display    = 'block'");
    expect(body).not.toMatch(/empty-state'\)\.style\.display\s*=\s*'block'/);
  });

  it('no remaining code sets empty-state display to block', () => {
    expect(appJs).not.toMatch(/getElementById\('empty-state'\)\.style\.display\s*=\s*'block'/);
  });

  it('the stylesheet still centres the empty state with flex', () => {
    expect(css).toMatch(/\.empty-state\s*\{[^}]*display:flex[^}]*align-items:center/);
  });
});

/** Pull the inner HTML of every pane of a given vehicle key. */
function extractPanes(html, key) {
  const out = [];
  const marker = `vt-pane--${key}`;
  let idx = html.indexOf(marker);
  while (idx !== -1) {
    // Walk from the pane's opening tag to its matching close by depth.
    const tagStart = html.lastIndexOf('<', idx);
    let depth = 0;
    let i = tagStart;
    let end = -1;
    const tagRe = /<(\/?)(div|table|tbody|tr|td|th|p|h2|details|summary|span|strong)\b[^>]*?(\/?)>/gi;
    tagRe.lastIndex = tagStart;
    let m;
    while ((m = tagRe.exec(html)) !== null) {
      if (m[3] === '/') continue;        // self-closing
      depth += m[1] === '/' ? -1 : 1;
      if (depth === 0) { end = m.index + m[0].length; break; }
    }
    if (end === -1) end = html.length;
    out.push(html.slice(tagStart, end));
    idx = html.indexOf(marker, idx + marker.length);
    if (out.length > 10) break;
  }
  return out;
}
