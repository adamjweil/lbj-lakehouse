import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { produce } from 'immer';
import { DEFAULT_FRAMING, parseDesignText, type Design } from '../src/model/schema';
import { pierLayout, roomStats, wallById, wallEndCondition, wallTees } from '../src/model/geometry';
import { validateDesign } from '../src/model/validate';
import { stringifyDesign } from '../src/model/format';
import { formatFrac } from '../src/model/units';
import { buyLineCost, dockCostRows, envelopeCostRows, estimateSummary, foundationCostRows, framingCostRows, roofingCostRows, scheduleCosts } from '../src/model/costs';
import { envelopeTakeoff, sidingPhrase, validateEnvelope } from '../src/model/envelope';
import { isSheetId, SHEET_IDS } from '../src/views/sheets/sheetList';
import { siteGeom } from '../src/model/site';
import { frameModel } from '../src/model/framing';
import { ceilingZones, isBearingWall } from '../src/model/framing/bearing';
import { validateFraming } from '../src/model/framing/checks';
import { takeoffCsv } from '../src/model/framing/csv';
import { boardFeet, DRESSED, lvlDepth, orderLength } from '../src/model/framing/lumber';
import { roofFraming } from '../src/model/framing/levels';
import { layoutLines, splitRun } from '../src/model/framing/layout';
import { roughOpeningSize } from '../src/model/framing/openings';
import { framingPhrases, specMismatches } from '../src/model/framing/phrases';
import { sheetCount } from '../src/model/framing/sheathing';
import { polyArea, solidBounds, solidTriangles, triangulate } from '../src/model/framing/solid';
import { spanLimit } from '../src/model/framing/spans';
import { packStock, takeoff } from '../src/model/framing/takeoff';
import { roofingTakeoff, roofSurfaces } from '../src/model/roofing';

function load(file = 'design/house.json'): Design {
  const r = parseDesignText(fs.readFileSync(file, 'utf8'));
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.design;
}

const d = load();
const f = d.framing;
const model = frameModel(d);
const wall = (id: string) => model.walls.find((w) => w.wall.id === id)!;
const roles = (id: string, role: string) => wall(id).members.filter((m) => m.role === role);
const assembly = (group: string) => model.assemblies.find((a) => a.group === group)!;
const of = (group: string, role: string) => assembly(group).members.filter((m) => m.role === role);
const B = 1.5;

describe('framing numbers', () => {
  it('default for designs saved before they existed', () => {
    for (const name of ['house-before-garage', 'house-before-porch', 'house-before-site']) {
      const old = load(`tests/fixtures/${name}.json`);
      expect(old.framing).toEqual(DEFAULT_FRAMING);
      const m = frameModel(old);
      expect(m.members.length).toBeGreaterThan(500);
      expect(m.members.every((x) => Number.isFinite(x.length) && x.length > 0)).toBe(true);
    }
  });

  it('round-trip through a save', () => {
    const text = stringifyDesign(d);
    expect(text).toContain('"stockLengths": [96, 120, 144, 168, 192]');
    const again = parseDesignText(text);
    expect(again.ok && again.design.framing).toEqual(d.framing);
    expect(again.ok && stringifyDesign(again.design)).toBe(text);
  });

  it('write lumber-yard fractions', () => {
    expect(formatFrac(0.4375)).toBe('7/16"');
    expect(formatFrac(92.625)).toBe('92-5/8"');
    expect(formatFrac(11.875)).toBe('11-7/8"');
    expect(formatFrac(16)).toBe('16"');
    expect(boardFeet('2x10', 192)).toBeCloseTo(26.67, 2);
    expect(lvlDepth('1-3/4" x 11-7/8" LVL')).toBe(11.875);
    expect(orderLength(226.5)).toBe(240);
  });
});

describe('rough openings', () => {
  it('match the allowances A-601 has always printed for the doors', () => {
    for (const o of d.openings.filter((q) => q.kind !== 'window')) {
      const old = o.operation === 'cased' ? [o.width + 1.5, o.height + 1] : o.operation === 'overhead' ? [o.width, o.height + 1] : [o.width + 2, o.height + 2.5];
      expect([o.tag, roughOpeningSize(d, o)]).toEqual([o.tag, { w: old[0], h: old[1] }]);
    }
  });

  it('size headers and jacks by the width of the opening', () => {
    const ro = (tag: string) => model.openings.find((r) => r.opening.tag === tag)!;
    expect(model.openings).toHaveLength(d.openings.length);
    expect(ro('W1')).toMatchObject({ w: 36.5, h: 36.5, sill: 41.75, head: 78.25, jacks: 1, bearing: true });
    expect(ro('W1').header).toMatchObject({ kind: 'sawn', size: '2x10', plies: 2, length: 36.5 + 2 * B });
    // The slider and the garage door are wider than the sawn header rule allows.
    for (const tag of ['D7', 'D9']) {
      expect(ro(tag).header).toMatchObject({ kind: 'lvl', byEngineer: true, plies: f.openings.headerOver.plies });
      expect(ro(tag).jacks).toBe(2);
    }
    // Partitions that carry nothing get a flat header.
    expect(ro('D2').header.kind).toBe('flat');
    expect(ro('D3').header.kind).toBe('sawn');
  });
});

describe('wall joins', () => {
  it('classifies corners, tees, and the garage walls that butt the house', () => {
    const wn = wallById(d, 'WN')!;
    expect(wallEndCondition(d, wn, 1)).toMatchObject({ kind: 'corner', through: true, other: { id: 'WE' } });
    expect(wallEndCondition(d, wallById(d, 'WE')!, 0)).toMatchObject({ kind: 'corner', through: false });
    expect(wallEndCondition(d, wallById(d, 'P2')!, 0)).toMatchObject({ kind: 'tee', other: { id: 'P1' } });
    expect(wallEndCondition(d, wallById(d, 'G1')!, 1)).toMatchObject({ kind: 'structure', other: { id: 'WW' } });
    expect(wallEndCondition(d, wallById(d, 'G3')!, 0)).toMatchObject({ kind: 'structure', other: { id: 'WW' } });
    expect(wallTees(d, wn).map((t) => [t.wall.id, t.u])).toEqual([['P1', 213], ['P3', 261]]);
  });

  it('finds the walls the ceiling joists bear on', () => {
    expect(d.walls.filter((w) => w.type === 'interior' && isBearingWall(d, w)).map((w) => w.id)).toEqual(['P2']);
    const [house, garage] = ceilingZones(d);
    expect(house).toMatchObject({ axis: 'y', beamAt: null, joist: '2x6' });
    expect(house.supports.map((w) => w.id)).toEqual(['P2']);
    // The garage has no wall under its ceiling, so a beam under the ridge carries the joists.
    expect(garage).toMatchObject({ axis: 'y', beamAt: 144, joist: '2x8' });
    const free = produce(d, (x) => {
      x.walls.find((w) => w.id === 'P2')!.bearing = false;
    });
    expect(isBearingWall(free, wallById(free, 'P2')!)).toBe(false);
    expect(ceilingZones(free)[0].supports).toEqual([]);
  });
});

describe('wall framing', () => {
  const stud = DRESSED[f.walls.exterior.stud];

  it('frames the north wall on the 16" module from the corner', () => {
    const w = wall('WN');
    // Framing stops at the inside of the sheathing of the walls it meets.
    expect([w.f0, w.f1, w.origin]).toEqual([-2.5, 356.5, -3]);
    const layout = layoutLines(w.f0, w.f1, w.origin, f.walls.exterior.spacing).length - 2;
    expect(layout).toBe(22);
    const studs = roles('WN', 'stud');
    // Seven layout positions fall in the three openings, and one on the corner nailer.
    expect(studs).toHaveLength(layout - 8);
    expect(studs.every((m) => m.length === d.levels.wallHeight - (1 + f.walls.topPlates) * B)).toBe(true);
    const centers = studs.map((m) => (m.profile[0].x + m.profile[1].x) / 2 - w.origin);
    expect(centers.every((c) => Math.abs(c / 16 - Math.round(c / 16)) < 1e-9)).toBe(true);
    expect(roles('WN', 'king')).toHaveLength(6);
    expect(roles('WN', 'jack')).toHaveLength(6);
    expect(roles('WN', 'end-stud')).toHaveLength(2);
    expect(roles('WN', 'corner-nailer')).toHaveLength(2);
    expect(roles('WN', 'header')).toHaveLength(3 * f.openings.header.plies);
    expect(roles('WN', 'sill')).toHaveLength(2);
    expect(roles('WN', 'header').every((m) => m.size === '2x10')).toBe(true);
  });

  it('runs plates the length of the wall, broken at the door and lapped at the partitions', () => {
    const w = wall('WN');
    const total = (role: string) => roles('WN', role).reduce((s, m) => s + m.length, 0);
    const d1 = w.openings.find((r) => r.opening.tag === 'D1')!;
    expect(total('bottom-plate')).toBeCloseTo(w.f1 - w.f0 - d1.w, 9);
    expect(total('top-plate')).toBeCloseTo(w.f1 - w.f0, 9);
    // P3 laps over this wall, so the cap plate gives way for its 3-1/2" plate. P1 is framed to the roof and does not.
    expect(total('cap-plate')).toBeCloseTo(w.f1 - w.f0 - DRESSED['2x4'].d, 9);
    const max = Math.max(...f.lumber.stockLengths);
    for (const x of model.walls) {
      for (const m of x.members) if (m.role.endsWith('plate')) expect(m.length).toBeLessThanOrEqual(max);
    }
    // Splices in the cap plate stay 4 ft from the splices in the plate below.
    const ends = (role: string) => roles('WN', role).map((m) => Math.max(...m.profile.map((p) => p.x))).filter((u) => u < w.f1 - 1);
    for (const a of ends('cap-plate')) for (const b of ends('top-plate')) expect(Math.abs(a - b)).toBeGreaterThanOrEqual(48);
  });

  it('frames gable walls to the rake, with a post under the ridge', () => {
    const w = wall('WW');
    const r = roofFraming(d, undefined)!;
    expect(w.gable).toBe('balloon');
    expect(w.ridgeU).toBe(141);
    expect(roles('WW', 'top-plate')).toHaveLength(0);
    expect(roles('WW', 'rake-plate')).toHaveLength(2 * f.walls.topPlates);
    const posts = roles('WW', 'post');
    expect(posts).toHaveLength(f.roof.ridgePostPlies);
    // The west post stands on the W5 header; the others run from the floor.
    const header = Math.max(...roles('WW', 'header').filter((m) => m.note?.startsWith('W5')).flatMap((m) => m.profile.map((p) => p.y)));
    expect(Math.min(...posts[0].profile.map((p) => p.y))).toBe(header);
    expect(Math.max(...posts[0].profile.map((p) => p.y))).toBeCloseTo(r.ridgeBottom, 9);
    expect(Math.min(...roles('P1', 'post')[0].profile.map((p) => p.y))).toBe(B);
    // Stud tops follow the underside of the rake plates.
    const s = roles('WW', 'stud')[0];
    const top = s.profile[3];
    expect(top.y).toBeCloseTo(w.topAt(top.x) - f.walls.topPlates * B * Math.hypot(1, d.roof.pitch / 12), 9);
    expect(s.cut).toMatch(/beveled/);
    expect(roles('WW', 'fireblock').length).toBeGreaterThan(10);
  });

  it('puts garage walls on treated plates, and butts them to the house', () => {
    const g1 = wall('G1');
    expect(g1.base).toBe(d.garage!.floor);
    expect(g1.plate).toBe(d.garage!.floor + d.garage!.plateHeight);
    expect([g1.f0, g1.f1]).toEqual([-2.5, 165]);
    expect(roles('G1', 'bottom-plate').every((m) => m.material === 'PT')).toBe(true);
    expect(roles('WN', 'bottom-plate').every((m) => m.material === 'SYP')).toBe(true);
    expect(roles('G1', 'end-stud').at(-1)!.note).toMatch(/WW/);
    expect(roles('G1', 'header').every((m) => m.material === 'LVL')).toBe(true);
    expect(model.hardware.find((h) => h.key === 'anchor-bolt')!.count).toBeGreaterThanOrEqual(2 * model.walls.filter((w) => w.zone).flatMap((w) => w.members).filter((m) => m.role === 'bottom-plate').length);
  });

  it('backs every partition where it meets a wall', () => {
    expect(roles('WN', 'backing').map((m) => m.note)).toEqual(expect.arrayContaining(['Ladder blocking for wall P1', 'Ladder blocking for wall P3']));
    expect(roles('WN', 'backing').every((m) => m.size === f.walls.backing.size && m.length <= 16)).toBe(true);
    expect(stud.d).toBe(5.5);
  });

  it('keeps square-cut pieces clear of each other', () => {
    const boxy = model.members.filter((m) => {
      const xs = new Set(m.profile.map((p) => p.x.toFixed(3)));
      const ys = new Set(m.profile.map((p) => p.y.toFixed(3)));
      return m.profile.length === 4 && xs.size === 2 && ys.size === 2 && [m.u, m.v].every((a) => [a.x, a.y, a.z].filter((c) => Math.abs(c) > 1e-6).length === 1);
    });
    expect(boxy.length).toBeGreaterThan(1000);
    const boxes = boxy.map((m) => ({ m, b: solidBounds(m) }));
    const clashes: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const p = boxes[i].b;
        const q = boxes[j].b;
        const over = (k: 'x' | 'y' | 'z') => Math.min(p.max[k], q.max[k]) - Math.max(p.min[k], q.min[k]) > 0.05;
        if (!over('x') || !over('y') || !over('z')) continue;
        // Deck boards are notched around the guard posts.
        const pair = [boxes[i].m.role, boxes[j].m.role].sort().join('+');
        if (pair !== 'decking+guard-post') clashes.push(`${boxes[i].m.id} and ${boxes[j].m.id}`);
      }
    }
    expect(clashes).toEqual([]);
  });
});

describe('floor framing', () => {
  it('runs 24 joist lines across four beam lines, spliced over alternating beams', () => {
    const joists = of('floor', 'joist');
    const lines = new Set(joists.map((m) => m.o.x));
    // 24 on the module, plus two under P1 and one each under P3 and P5.
    expect(lines.size).toBe(24 + 4);
    expect(joists).toHaveLength(54);
    const beams = pierLayout(d).beams.filter((b) => !b.deck).map((b) => b.a.y);
    expect(beams).toEqual([6, 98, 190, 282]);
    expect([...new Set(joists.map((m) => m.length))].sort((a, b) => a - b)).toEqual([92, 96, 188]);
    const breaks = (x: number) => joists.filter((m) => m.o.x === x).map((m) => Math.max(...m.profile.map((p) => p.x))).filter((y) => y < 280);
    const xs = [...lines].sort((a, b) => a - b);
    expect(breaks(xs[0])).not.toEqual(breaks(xs[1]));
    expect(joists.every((m) => m.material === 'PT' && m.pricedOn === 'A-103')).toBe(true);
  });

  it('builds the beams from three plies that break over the piers', () => {
    const plies = of('floor', 'beam');
    expect(plies).toHaveLength(4 * 7);
    const piers = [6, 93, 180, 267, 354];
    for (const m of plies) {
      const end = Math.max(...m.profile.map((p) => p.x));
      expect(end === 359.5 || piers.includes(end)).toBe(true);
      expect(m.length).toBeLessThanOrEqual(192);
    }
  });
});

describe('roof framing', () => {
  const r = roofFraming(d, undefined)!;

  it('sets 24 rafters on each slope, cut to the ridge beam', () => {
    const rafters = of('roof', 'rafter');
    expect(rafters).toHaveLength(48);
    expect(of('roof', 'fly-rafter')).toHaveLength(4);
    const run = (r.rf.sMax - r.rf.sMin) / 2 - r.half + d.roof.overhang - DRESSED[f.roof.subFascia].b;
    const length = run * Math.hypot(1, 0.5) + DRESSED[f.roof.rafter].d * 0.5;
    expect(rafters.every((m) => Math.abs(m.length - length) < 1e-9)).toBe(true);
    expect(length).toBeLessThan(192);
    expect(rafters[0].cut).toBe('Plumb cut both ends, 6:12; birdsmouth with a 3-1/2" seat');
    // The seat is level on the plate, from the outside of the studs in.
    const seat = rafters[0].profile.filter((p) => p.y === d.levels.wallHeight).map((p) => p.x);
    expect(seat).toEqual([0.5, 0.5 + f.roof.seat]);
  });

  it('carries the rafters on an LVL ridge, broken over the post in P1', () => {
    const ridge = of('roof', 'ridge');
    expect(ridge).toHaveLength(2 * f.roof.ridge.plies);
    expect(ridge.every((m) => m.material === 'LVL')).toBe(true);
    expect([...new Set(ridge.map((m) => m.length))]).toEqual([226.5, 154.5]);
    expect(r.ridgeTop - r.ridgeBottom).toBe(f.roof.ridge.depth);
    expect(r.ridgeBottom).toBeLessThan(r.rf.ridgeUnder);
  });

  it('frames the garage roof against the house without a rake overhang there', () => {
    const rafters = of('garage-roof', 'rafter');
    expect(rafters).toHaveLength(24);
    expect(of('garage-roof', 'fly-rafter')).toHaveLength(2);
    const xs = rafters.map((m) => solidBounds(m)).map((b) => b.max.x);
    expect(Math.max(...xs)).toBeCloseTo(0, 9);
    expect(of('garage-roof', 'ridge').every((m) => m.length === 178.5)).toBe(true);
  });

  it('laps the ceiling joists over P2 and hangs the garage joists from a beam', () => {
    const joists = of('ceiling', 'ceiling-joist');
    expect(joists.every((m) => m.size === '2x6')).toBe(true);
    const lap = joists.filter((m) => m.note?.startsWith('Beside')).map((m) => solidBounds(m));
    const north = lap.filter((b) => b.min.y < 1);
    const south = lap.filter((b) => b.max.y > 287);
    expect(Math.max(...north.map((b) => b.max.y))).toBeGreaterThan(Math.min(...south.map((b) => b.min.y)));
    expect(of('garage-ceiling', 'beam')).toHaveLength(f.garage.ridge.plies);
    expect(model.hardware.find((h) => h.key === 'garage-ceiling-hanger')!.count).toBe(of('garage-ceiling', 'ceiling-joist').length);
  });
});

describe('decks and porches', () => {
  it('frames both platforms with a ledger, joists, a rim, and a beam on posts', () => {
    for (const kind of ['deck', 'porch']) {
      expect(of(kind, 'joist')).toHaveLength(24);
      expect(of(kind, 'beam')).toHaveLength(7);
      expect(of(kind, 'deck-post')).toHaveLength(5);
      expect(of(kind, 'stringer')).toHaveLength(4);
      expect(of(kind, 'ledger').reduce((s, m) => s + m.length, 0)).toBe(360);
      expect(of(kind, 'beam').every((m) => m.pricedOn === 'A-103')).toBe(true);
      expect(of(kind, 'joist').every((m) => m.material === 'PT' && m.pricedOn === 'S-602')).toBe(true);
    }
    expect(of('deck', 'joist')[0].length).toBe(d.deck.depth - 2 * B);
    // Balusters leave less than 4" clear.
    const b = of('deck', 'baluster').map((m) => solidBounds(m)).filter((q) => q.max.y > 400).sort((p, q) => p.min.x - q.min.x);
    for (let i = 1; i < b.length; i++) if (b[i].min.x - b[i - 1].max.x < 10) expect(b[i].min.x - b[i - 1].max.x).toBeLessThan(4);
  });
});

describe('sheathing', () => {
  it('counts the sheets from a panel layout', () => {
    const count = (kind: string) => sheetCount(model.panels.filter((p) => p.kind === kind));
    expect(count('subfloor')).toBe(24);
    expect(count('wall')).toBeGreaterThan(55);
    expect(count('wall')).toBeLessThan(75);
    expect(count('roof')).toBeGreaterThan(45);
    expect(count('roof')).toBeLessThan(56);
    // Panels cover the surface once: the roof panels add up to the roof area.
    const roof = model.panels.filter((p) => p.kind === 'roof').reduce((s, p) => s + p.area, 0);
    expect(roof).toBeCloseTo(roofSurfaces(d).reduce((s, q) => s + q.area, 0), 3);
    expect(model.panels.every((p) => p.coverage > 0 && p.coverage <= 1 + 1e-9)).toBe(true);
    // Openings are cut out of the wall panels.
    const wn = model.panels.filter((p) => p.group === 'WN').reduce((s, p) => s + p.area, 0);
    const holes = wall('WN').openings.reduce((s, o) => s + o.w * o.h, 0);
    expect(wn).toBeCloseTo(360 * (d.levels.wallHeight + 10) - holes, 3);
  });
});

describe('solids', () => {
  it('triangulate notched profiles without losing area', () => {
    const rafter = of('roof', 'rafter')[0];
    const tris = triangulate(rafter.profile);
    const area = tris.reduce((s, [a, b, c]) => s + polyArea([rafter.profile[a], rafter.profile[b], rafter.profile[c]]), 0);
    expect(area).toBeCloseTo(polyArea(rafter.profile), 6);
    expect(solidTriangles(rafter).length % 9).toBe(0);
  });
});

describe('takeoff', () => {
  const t = takeoff(d, model);

  it('places every cut once and never overfills a stick', () => {
    const sticks = packStock(d, model.members);
    const placed = sticks.reduce((s, x) => s + x.cuts.length, 0);
    expect(placed).toBe(model.members.length);
    for (const s of sticks) {
      const need = s.cuts.reduce((sum, c) => sum + c.length, 0) + (s.cuts.length - 1) * f.lumber.kerf;
      expect(need).toBeLessThanOrEqual(s.stock + 1e-6);
      expect(s.used).toBeCloseTo(need, 6);
      if (s.kind === 'stock') expect(f.lumber.stockLengths).toContain(s.stock);
      if (s.kind === 'precut') expect(f.lumber.studLengths).toContain(s.stock);
    }
    const marks = new Map<string, number>();
    for (const s of sticks) for (const c of s.cuts) marks.set(c.mark, (marks.get(c.mark) ?? 0) + 1);
    for (const c of t.cuts) expect(marks.get(c.mark)).toBe(c.count);
  });

  it('buys studs precut and LVL to length', () => {
    const precut = t.buy.filter((b) => b.kind === 'precut');
    expect(precut.map((b) => b.stock)).toContain(104.625);
    expect(t.buy.filter((b) => b.material === 'LVL').every((b) => b.kind === 'order' && b.extra === 0 && b.stock % 24 === 0)).toBe(true);
    expect(t.totals.pieces).toBe(model.members.length);
    expect(t.cuts.reduce((s, c) => s + c.count, 0)).toBe(model.members.length);
    expect(t.buy.every((b) => b.yield > 0 && b.yield <= 1)).toBe(true);
  });

  it('prices every material on exactly one sheet', () => {
    // The house floor and every beam on piers belong to the foundation plan.
    for (const m of model.members) {
      const onFoundation = m.system === 'floor' || (m.system === 'platform' && m.role === 'beam');
      expect([m.id, m.pricedOn]).toEqual([m.id, onFoundation ? 'A-103' : 'S-602']);
    }
    expect(model.panels.every((p) => (p.pricedOn === 'A-103') === (p.kind === 'subfloor'))).toBe(true);
    const rows = framingCostRows(d);
    const lumber = rows.filter((r) => /lumber|LVL|Composite/.test(r.item)).reduce((s, r) => s + r.cost, 0);
    const mine = t.buy.filter((b) => b.pricedOn === 'S-602').reduce((s, b) => s + buyLineCost(b), 0);
    expect(Math.abs(lumber - mine)).toBeLessThan(30);
    expect(rows.some((r) => /subfloor|Floor joist|beam/i.test(r.item) && !/LVL/.test(r.item))).toBe(false);
    // A-103 prices the floor framing and the subfloor by the square foot.
    const foundation = foundationCostRows(d);
    expect(foundation.find((r) => r.item.startsWith('Floor joists'))!.rate).toBe('$2.75/SF');
    expect(foundation.find((r) => r.item.startsWith('Subfloor'))!.rate).toBe('$1.75/SF');
    expect(rows.every((r) => r.cost > 0)).toBe(true);
    expect(roofingCostRows(d).every((r) => r.cost > 0)).toBe(true);
  });

  it('measures the roofing from the roof frames', () => {
    const items = roofingTakeoff(d);
    const qty = (key: string) => items.find((i) => i.key === key)!.qty;
    const [house, garage] = roofSurfaces(d);
    expect(house.area / 144).toBeCloseTo((384 * 2 * 162 * Math.hypot(1, 0.5)) / 144, 6);
    expect([garage.freeEaves, garage.freeRakes]).toEqual([2, 1]);
    expect(qty('panels')).toBeCloseTo((house.area + garage.area) / 144, 6);
    expect(qty('ridge')).toBe((384 + 180) / 12);
    expect(qty('wall')).toBeCloseTo((2 * 156 * Math.hypot(1, 1 / 6)) / 12, 6);
    expect(qty('gutter')).toBe((2 * 384 + 2 * 180) / 12);
  });

  it('exports the takeoff as CSV', () => {
    const csv = takeoffCsv(d);
    expect(Object.keys(csv)).toEqual(['cut-list.csv', 'buy-list.csv', 'pieces.csv', 'rough-openings.csv', 'sheet-goods.csv', 'hardware.csv', 'roofing.csv', 'envelope.csv']);
    expect(csv['pieces.csv'].trim().split('\n')).toHaveLength(model.members.length + 1);
    expect(csv['rough-openings.csv']).toContain('D7,WS,96,80,98,82.5,0,82.5,"(2) 1-3/4"" x 11-7/8"" LVL"');
  });
});

describe('framing checks', () => {
  const issues = validateFraming(d);
  const codes = issues.map((i) => i.code);

  it('leave the design checks clean and list the items for the engineer', () => {
    expect(validateDesign(d).filter((i) => i.level !== 'info')).toEqual([]);
    expect(issues.every((i) => i.level !== 'error')).toBe(true);
    expect(codes).toEqual(expect.arrayContaining(['header-span', 'tall-studs', 'ridge-post-opening', 'ridge-post-bearing', 'ceiling-span', 'ceiling-beam']));
    expect(issues.filter((i) => i.code === 'header-span').map((i) => i.ref?.id).sort()).toEqual(['o-garage-door', 'o-slider']);
    expect(issues.find((i) => i.code === 'tall-studs' && i.ref?.id === 'P1')!.message).toMatch(/slender/);
    for (const i of issues.filter((q) => q.level === 'warning' && q.code !== 'spec-mismatch')) expect(i.message).toMatch(/verify with engineer$/);
  });

  it('agree with the printed specs, and say so when they do not', () => {
    expect(specMismatches(d)).toEqual([]);
    expect(framingPhrases(d).framing.rafters).toBe(d.specs.framing.rafters);
    expect(framingPhrases(d).foundation.joists).toBe(d.specs.foundation.joists);
    const changed = produce(d, (x) => {
      x.framing.roof.rafter = '2x12';
      x.framing.walls.exterior.spacing = 24;
    });
    const found = validateFraming(changed).filter((i) => i.code === 'spec-mismatch');
    expect(found.map((i) => i.message)).toEqual([
      'specs.framing.exteriorWalls reads "2x6 studs @ 16" o.c.", but the framing numbers call for "2x6 studs @ 24" o.c."',
      'specs.framing.rafters reads "2x10 rafters @ 16" o.c.", but the framing numbers call for "2x12 rafters @ 16" o.c."',
    ]);
    expect(validateFraming(changed).map((i) => i.code)).toContain('roof-depth');
  });

  it('flag an opening with no room for its studs, and spans past the table', () => {
    const tight = produce(d, (x) => {
      x.openings.find((o) => o.tag === 'W1')!.offset = 22;
    });
    expect(validateFraming(tight).map((i) => i.code)).toContain('framing-opening-end');
    expect(spanLimit('floorJoist', '2x10', 16)).toBe(168);
    expect(spanLimit('ceilingJoist', '2x6', 16)).toBe(144);
    const wide = produce(d, (x) => {
      x.foundation.beamSpacing = 300;
    });
    expect(validateFraming(wide).map((i) => i.code)).toContain('joist-span');
    expect(codes).not.toContain('joist-span');
    expect(codes).not.toContain('rafter-span');
    const turned = produce(d, (x) => {
      x.garage!.roof.ridgeAxis = 'y';
    });
    expect(validateFraming(turned).map((i) => i.code)).toContain('roof-low-edge');
  });
});

describe('plate splices', () => {
  it('land on studs and leave the shortest piece as long as it can be', () => {
    expect(splitRun(0, 100, 192, [16, 32])).toEqual([]);
    expect(splitRun(0, 360, 192, [96, 176, 192, 208])).toEqual([176]);
    expect(splitRun(0, 360, 192, [176], [180])).toEqual([192]);
  });
});

describe('exterior envelope', () => {
  const env = envelopeTakeoff(d);
  const face = (id: string) => env.faces.find((q) => q.wall.id === id)!;
  const item = (key: string) => env.items.find((i) => i.key === key)!;

  it('measures each wall face, and leaves the house wall inside the garage unsided', () => {
    expect(env.faces.map((q) => q.wall.id)).toEqual(['WN', 'WE', 'WS', 'WW', 'G1', 'G2', 'G3']);
    const wn = face('WN');
    expect(wn.gross).toBe(360 * (d.levels.wallHeight + d.levels.floorDepth));
    expect(wn.net).toBeCloseTo(wn.gross - model.openings.filter((o) => o.wall.id === 'WN').reduce((s, o) => s + o.w * o.h, 0), 6);
    const ww = face('WW');
    expect(ww.covered).toBeGreaterThan(ww.gross * 0.6);
    expect(ww.openings.map((o) => [o.opening.tag, o.exposed])).toEqual([['D8', false], ['W5', true]]);
    expect(ww.base).toBe(0);
    // The garage is not heated; the house wall beside it is.
    expect(face('G2').insulated).toBe(0);
    expect(ww.insulated).toBeGreaterThan(face('WE').insulated);
  });

  it('counts siding by the board and insulation by the room', () => {
    const net = env.faces.reduce((s, q) => s + q.net, 0);
    expect(item('siding').qty).toBeGreaterThan(net / 144);
    expect(item('battens').qty).toBe(item('siding').qty);
    const flat = d.rooms.filter((q) => !q.zone && q.ceiling === 'flat').reduce((s, q) => s + roomStats(d, q).area, 0);
    expect(item('attic').qty).toBeCloseTo(flat / 144, 6);
    expect(item('fascia').qty).toBe(roofingTakeoff(d).find((i) => i.key === 'eave')!.qty);
    expect(sidingPhrase(d)).toBe('1x12 board-and-batten siding (1x3 battens) on rain-screen furring');
    expect(validateEnvelope(d).map((i) => i.code)).toEqual(['siding-clearance']);
  });

  it('adds up to the estimate summary without pricing anything twice', () => {
    const s = estimateSummary(d);
    const sum = (rows: { cost: number }[]) => rows.reduce((a, r) => a + r.cost, 0);
    expect(s.rows.map((r) => r.sheet)).toEqual(['A-103', 'S-602', 'S-602', 'A-602', 'A-601', 'A-601', 'A-601', 'A-100']);
    expect(s.total).toBe(sum(foundationCostRows(d)) + sum(framingCostRows(d)) + sum(roofingCostRows(d)) + sum(envelopeCostRows(d)) + scheduleCosts(d).total + sum(dockCostRows(d)));
    expect(s.building + s.site).toBe(s.total);
    expect(s.perSf).toBeCloseTo(s.building / 720, 6);
    // Sheathing is framing, insulation under the floor is foundation, and neither is envelope.
    expect(envelopeCostRows(d).some((r) => /sheathing|floor/i.test(r.item))).toBe(false);
  });
});

describe('material estimates', () => {
  const all = [...foundationCostRows(d), ...framingCostRows(d), ...roofingCostRows(d), ...envelopeCostRows(d), ...dockCostRows(d)];

  it('price material only: no row is labor or installation', () => {
    expect(all.filter((r) => /labor|install/i.test(r.item)).map((r) => r.item)).toEqual([]);
    expect(all.every((r) => r.cost > 0)).toBe(true);
  });

  it('keep the boat dock under $20,000, with each pile counted once and no lift', () => {
    const dock = dockCostRows(d).reduce((s, r) => s + r.cost, 0);
    expect(dock).toBeGreaterThan(12_000);
    expect(dock).toBeLessThan(20_000);
    expect(dockCostRows(d).some((r) => /lift/i.test(r.item))).toBe(false);
    const lifted = produce(d, (x) => {
      x.site!.dock.lift = true;
    });
    expect(dockCostRows(lifted).some((r) => r.item === 'Boat lift')).toBe(true);
    const piles = siteGeom(d)!.dock!.piles;
    expect(new Set(piles.map((q) => `${q.x},${q.y}`)).size).toBe(piles.length);
    expect(dockCostRows(d)[0].qty).toBe(`${piles.length} ea.`);
    expect(estimateSummary(d).site).toBe(dock);
  });
});

describe('sheet set', () => {
  it('lists every sheet once, grouped by discipline', () => {
    expect(new Set(SHEET_IDS).size).toBe(SHEET_IDS.length);
    expect(SHEET_IDS).toHaveLength(21);
    const order = SHEET_IDS.map((id) => id[0]).join('');
    expect(order).toMatch(/^G+A+S+$/);
    expect(isSheetId('S-601')).toBe(true);
    expect(isSheetId('S-999')).toBe(false);
  });
});
