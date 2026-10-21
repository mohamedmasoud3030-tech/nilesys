import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEMO_ACCOUNTS } from '../../engines/platform/src/demo-seed.js';
import {
  ALL_OFFERINGS,
  SITES,
  SYSTEMS,
  UNVERIFIED_PROTOTYPE_CLAIMS,
  WINDOWS,
  cardStatus,
  findOffering,
  type Offering,
} from './offerings.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const HOME_JS = read('prototypes/nilesys/public/assets/js/home.js');

/** Extract the top-level `id:` values of `const NAME = [ ... ];` in home.js, in order. */
function prototypeIds(name: 'SYSTEMS' | 'SITES' | 'WINDOWS'): string[] {
  const start = HOME_JS.indexOf(`const ${name} = [`);
  expect(start, `home.js must declare ${name}`).toBeGreaterThanOrEqual(0);
  const end = HOME_JS.indexOf('\n  ];', start);
  const block = HOME_JS.slice(start, end);
  return [...block.matchAll(/\bid: '([a-z]+)'/g)].map((m) => m[1]!);
}

describe('inventory counts match the advertised catalogue', () => {
  it('has exactly 7 systems, 7 websites and 5 Windows entries', () => {
    expect(SYSTEMS).toHaveLength(7);
    expect(SITES).toHaveLength(7);
    expect(WINDOWS).toHaveLength(5);
    expect(ALL_OFFERINGS).toHaveLength(19);
  });

  it('ids are unique within each kind', () => {
    for (const list of [SYSTEMS, SITES, WINDOWS]) {
      const ids = list.map((o) => o.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('registry cannot drift from repository evidence', () => {
  it('ids and order equal the prototype homepage cards', () => {
    expect(SYSTEMS.map((o) => o.id)).toEqual(prototypeIds('SYSTEMS'));
    expect(SITES.map((o) => o.id)).toEqual(prototypeIds('SITES'));
    expect(WINDOWS.map((o) => o.id)).toEqual(prototypeIds('WINDOWS'));
  });

  it('card names are the exact strings the prototype shows', () => {
    for (const o of ALL_OFFERINGS) {
      expect(HOME_JS, `${o.kind}:${o.id} ar`).toContain(`'${o.name.ar}'`);
      expect(HOME_JS, `${o.kind}:${o.id} en`).toContain(`'${o.name.en}'`);
    }
  });

  it('system ids equal the systems seeded with demo roles in the platform engine', () => {
    const seeded = [...new Set(DEMO_ACCOUNTS.map((a) => a.system))].sort();
    expect(SYSTEMS.map((o) => o.id).sort()).toEqual(seeded);
  });

  it('site ids equal the lead sources in the catalog engine', () => {
    const src = read('engines/catalog/src/catalog.ts');
    const m = src.match(/export type LeadSource = ([^;]+);/);
    expect(m).not.toBeNull();
    const sources = [...m![1]!.matchAll(/'([a-z]+)'/g)].map((x) => x[1]).sort();
    expect(SITES.map((o) => o.id).sort()).toEqual(sources);
  });

  it('every Windows entry packages an existing system', () => {
    const systemIds = new Set<string>(SYSTEMS.map((o) => o.id));
    for (const w of WINDOWS) expect(systemIds.has(w.id), w.id).toBe(true);
  });

  it('every evidence and engine path exists in this repository', () => {
    for (const o of ALL_OFFERINGS) {
      for (const p of o.evidence) expect(existsSync(resolve(ROOT, p)), `${o.kind}:${o.id} evidence ${p}`).toBe(true);
      for (const e of o.engines) expect(existsSync(resolve(ROOT, e.path)), `${o.kind}:${o.id} engine ${e.path}`).toBe(true);
    }
  });

  it('listed unverified prototype claims are still present (delete the entry once corrected)', () => {
    for (const c of UNVERIFIED_PROTOTYPE_CLAIMS) expect(read(c.file)).toContain(c.excerpt);
  });
});

describe('status honesty rules', () => {
  it('only POS (primary agent) and the admin/HR service layers (parallel agent) are in progress', () => {
    const inProgress = ALL_OFFERINGS.filter((o) => o.production === 'in-progress').map((o) => `${o.kind}:${o.id}`);
    expect(inProgress).toEqual(['system:pos', 'system:hr', 'system:admin']);
    expect(findOffering('system', 'pos')?.owner).toBe('primary-agent');
    for (const o of ALL_OFFERINGS) {
      if (o.production === 'in-progress') expect(o.owner).not.toBe('unassigned');
      else expect(o.owner).toBe('unassigned');
    }
  });

  it('an in-progress claim cites at least one production-path file (engines/ or apps/) as evidence', () => {
    for (const o of ALL_OFFERINGS.filter((x) => x.production === 'in-progress')) {
      expect(o.evidence.some((p) => /^(engines|apps)\//.test(p)), `${o.kind}:${o.id}`).toBe(true);
    }
  });

  it('only POS has a working legacy prototype screen, and that screen exists', () => {
    const working = ALL_OFFERINGS.filter((o) => o.prototype === 'working-legacy').map((o) => `${o.kind}:${o.id}`);
    expect(working).toEqual(['system:pos']);
    expect(existsSync(resolve(ROOT, 'prototypes/nilesys/public/systems/pos.html'))).toBe(true);
  });

  it('no offering has a destination without HTTP 200 evidence — and none is verified today', () => {
    for (const o of ALL_OFFERINGS) {
      if (o.destination) {
        expect(o.destination.url).toMatch(/^https:\/\//);
        expect(o.destination.httpStatus).toBe(200);
        expect(o.destination.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
    expect(ALL_OFFERINGS.filter((o) => o.destination !== null)).toEqual([]);
  });

  it('Windows entries carry no size, OS, trial or download facts', () => {
    for (const w of WINDOWS) {
      const blob = JSON.stringify({ ...w, mustNotClaim: [] });
      expect(blob, w.id).not.toMatch(/\b\d+\s?MB\b|Windows 1[01]|days? trial|\.exe|\.msi/i);
      expect(w.destination).toBeNull();
    }
  });

  it('every offering states a next step and what a card must not claim', () => {
    for (const o of ALL_OFFERINGS) {
      expect(o.nextStep.length, `${o.kind}:${o.id}`).toBeGreaterThan(20);
      expect(o.mustNotClaim.length, `${o.kind}:${o.id}`).toBeGreaterThan(0);
      expect(o.purpose.length).toBeGreaterThan(10);
    }
  });
});

describe('cardStatus', () => {
  const fake = (patch: Partial<Offering>): Offering => ({ ...(SITES[0] as Offering), ...patch });

  it('renders in-progress systems as in development and everything else as planned, with no link', () => {
    for (const id of ['pos', 'hr', 'admin']) {
      expect(cardStatus(findOffering('system', id)!, 'en')).toEqual({ tone: 'building', label: 'In development', href: null });
      expect(cardStatus(findOffering('system', id)!, 'ar').label).toBe('قيد التنفيذ');
    }
    for (const o of ALL_OFFERINGS.filter((x) => !(x.kind === 'system' && ['pos', 'hr', 'admin'].includes(x.id)))) {
      expect(cardStatus(o, 'en'), `${o.kind}:${o.id}`).toEqual({ tone: 'planned', label: 'Planned', href: null });
      expect(cardStatus(o, 'ar').label).toBe('مخطط');
    }
  });

  it('"available" requires a verified destination, and a working prototype alone never qualifies', () => {
    expect(cardStatus(fake({ prototype: 'working-legacy', production: 'in-progress' }), 'en').tone).toBe('building');
    const live = fake({ destination: { url: 'https://example.test', httpStatus: 200, checkedAt: '2026-10-18' } });
    expect(cardStatus(live, 'en')).toEqual({ tone: 'available', label: 'Available to try', href: 'https://example.test' });
  });
});
