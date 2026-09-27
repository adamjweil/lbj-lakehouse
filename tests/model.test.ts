import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { produce } from 'immer';
import { parseDesignText, type Design } from '../src/model/schema';
import {
  deckGeom, designSummary, platformRailings, platforms, stairHandrails, footprint, openingCenter, pierLayout, polygonArea, roofFrame,
  roomStats, wallById, wallPolygon, wallProfile, bbox, buildingBounds, garageEntry, garageFootprint,
  garageHouseSide, garageRoofFrame, roomsForOpening, footprintBounds, pointInPolygon, roofHeelInset,
} from '../src/model/geometry';
import { validateDesign } from '../src/model/validate';
import { formatFtIn, lowerFirst, parseLength } from '../src/model/units';
import { addOpening, moveWall, setWallLength } from '../src/editor/ops';
import { stringifyDesign } from '../src/model/format';
import { siteGeom, treeConflicts } from '../src/model/site';
import { fixtureCost, formatCost, formatUsd, foundationCostRows, openingCost, roomFinishCost } from '../src/model/costs';

function load(): Design {
  const r = parseDesignText(fs.readFileSync('design/house.json', 'utf8'));
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.design;
}

/** An earlier design with the changes revision 9 made on purpose: the floor depth, the garage roof, and the W5 sill. */
function fixture(name: string): Design {
  const before = JSON.parse(fs.readFileSync(`tests/fixtures/${name}.json`, 'utf8')) as Design;
  return produce(before, (x) => {
    x.levels.floorDepth = 10;
    const w5 = x.openings.find((o) => o.tag === 'W5');
    if (w5) w5.sill = 126;
    if (x.garage) {
      x.garage.roof.pitch = 2;
      x.garage.roof.ridgeAxis = 'x';
    }
  });
}

describe('units', () => {
  it('formats feet-inches', () => {
    expect(formatFtIn(150)).toBe(`12'-6"`);
    expect(formatFtIn(150.5)).toBe(`12'-6 1/2"`);
    expect(formatFtIn(360)).toBe(`30'-0"`);
    expect(formatFtIn(11.9)).toBe(`1'-0"`);
    expect(formatFtIn(-6)).toBe(`-0'-6"`);
  });
  it('parses what people type', () => {
    expect(parseLength(`12'6"`)).toBe(150);
    expect(parseLength(`12'-6"`)).toBe(150);
    expect(parseLength(`12' 6 1/2"`)).toBe(150.5);
    expect(parseLength(`12.5'`)).toBe(150);
    expect(parseLength(`150`)).toBe(150);
    expect(parseLength(`6 1/2"`)).toBe(6.5);
    expect(parseLength(`12ft 6in`)).toBe(150);
    expect(parseLength(`abc`)).toBeNull();
  });
});

describe('starter design geometry', () => {
  const d = load();

  it('has a 30x24 footprint of 720 SF', () => {
    const fp = footprint(d);
    expect(polygonArea(fp) / 144).toBeCloseTo(720, 5);
    expect(bbox(fp)).toEqual({ x0: 0, y0: 0, x1: 360, y1: 288 });
  });

  it('joins corners without gaps', () => {
    const wn = bbox(wallPolygon(d, wallById(d, 'WN')!));
    const we = bbox(wallPolygon(d, wallById(d, 'WE')!));
    expect(wn).toEqual({ x0: 0, y0: 0, x1: 360, y1: 6 });
    expect(we).toEqual({ x0: 354, y0: 6, x1: 360, y1: 282 });
    // Interior wall stops at the exterior wall's inside face.
    expect(bbox(wallPolygon(d, wallById(d, 'P1')!))).toMatchObject({ y0: 6, y1: 282 });
  });

  it('computes net room areas', () => {
    const bath = roomStats(d, d.rooms.find((r) => r.id === 'r-bath')!);
    expect(bath.width).toBeCloseTo(357 - 3 - (264 + 2.25), 5);
    expect(bath.depth).toBeCloseTo(132 - 2.25 - 6, 5);
    const bed = roomStats(d, d.rooms.find((r) => r.id === 'r-bed')!);
    expect(bed.area / 144).toBeGreaterThan(100);
    expect(bed.area / 144).toBeLessThan(130);
  });

  it('seats the 6:12 rafters on the plate, 4" in from the wall face', () => {
    const rf = roofFrame(d);
    expect(rf.undersideAt(roofHeelInset(d))).toBe(108);
    expect(rf.ridgeUnder).toBe(108 + (144 - roofHeelInset(d)) / 2);
    expect(rf.ridgeTop).toBeCloseTo(178 + 10 / Math.cos(Math.atan(0.5)), 6);
    expect(rf.planRect).toEqual({ x0: -12, y0: -18, x1: 372, y1: 306 });
  });

  it('shapes gable walls to the roof and cuts openings', () => {
    const ww = wallProfile(d, wallById(d, 'WW')!);
    expect(Math.max(...ww.outline.map((p) => p.y))).toBe(178);
    expect(ww.holes.map((h) => h.opening.tag)).toEqual(['W5']);
    expect(ww.doors.map((h) => h.opening.tag)).toEqual(['D8']);
    const ws = wallProfile(d, wallById(d, 'WS')!);
    expect(ws.doors.map((h) => h.opening.tag)).toEqual(['D7']);
    // Eave walls rise to the roof underside at their inside face.
    expect(Math.max(...ws.outline.map((p) => p.y))).toBe(108 + (6 - roofHeelInset(d)) * 0.5);
  });

  it('places openings where the plan says', () => {
    const slider = d.openings.find((o) => o.tag === 'D7')!;
    expect(openingCenter(wallById(d, slider.wallId)!, slider)).toEqual({ x: 108, y: 285 });
  });

  it('lays out deck, stairs, railings and piers', () => {
    const dg = deckGeom(d)!;
    expect(dg.rect).toEqual({ x0: 0, y0: 288, x1: 360, y1: 408 });
    expect(dg.stairs!.risers).toBe(4);
    expect(dg.stairs!.rect).toEqual({ x0: 84, x1: 132, y0: 408, y1: 441 });
    const rails = platformRailings(d, platforms(d).find((q) => q.kind === 'deck')!);
    expect(rails).toHaveLength(4); // east, west, and two pieces beside the stairs
    const piers = pierLayout(d);
    expect(piers.piers.filter((p) => !p.deck)).toHaveLength(20);
    expect(piers.piers.filter((p) => p.platform === 'deck')).toHaveLength(5);
  });

  it('summarizes', () => {
    const s = designSummary(d);
    expect(Math.round(s.gross / 144)).toBe(720);
    expect(Math.round(s.deckArea / 144)).toBe(300);
  });
});

describe('validation', () => {
  const d = load();

  it('passes the starter design without errors or warnings', () => {
    const issues = validateDesign(d).filter((i) => i.level !== 'info');
    expect(issues).toEqual([]);
  });

  it('flags a bedroom without egress', () => {
    const bad = produce(d, (x) => {
      x.openings.find((o) => o.tag === 'W6')!.sill = 50;
    });
    expect(validateDesign(bad).map((i) => i.code)).toContain('egress');
  });

  it('flags overlapping openings and an open shell', () => {
    const bad = produce(d, (x) => {
      x.openings.find((o) => o.tag === 'W3')!.offset = 200;
      x.walls.find((w) => w.id === 'WE')!.end = { x: 357, y: 280 };
    });
    const codes = validateDesign(bad).map((i) => i.code);
    expect(codes).toContain('opening-overlap');
    expect(codes).toContain('open-shell');
  });
});

describe('editing operations', () => {
  const d = load();

  it('moving the south wall stretches the house and keeps openings in place', () => {
    const next = produce(d, (x) => moveWall(x, 'WS', { x: 0, y: 24 }));
    expect(polygonArea(footprint(next)) / 144).toBeCloseTo(720 + 60, 5);
    expect(wallById(next, 'P1')!.end).toEqual({ x: 216, y: 309 });
    expect(next.rooms.find((r) => r.id === 'r-bed')!.polygon).toContainEqual({ x: 357, y: 309 });
    // W7 on the east wall keeps its world position.
    const w7 = next.openings.find((o) => o.tag === 'W7')!;
    expect(openingCenter(wallById(next, 'WE')!, w7)).toEqual({ x: 357, y: 240 });
    // D8 on the west wall (whose start moved) also stays put.
    const d8 = next.openings.find((o) => o.tag === 'D8')!;
    expect(openingCenter(wallById(next, 'WW')!, d8)).toEqual({ x: 3, y: 200 });
    expect(validateDesign(next).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('changing a wall length drags connected walls', () => {
    const next = produce(d, (x) => setWallLength(x, 'WN', 378));
    expect(wallById(next, 'WE')!.start).toEqual({ x: 381, y: 3 });
    expect(wallById(next, 'WN')!.end).toEqual({ x: 381, y: 3 });
  });

  it('adds openings with the next tag', () => {
    const next = produce(d, (x) => {
      addOpening(x, 'WE', 60, 'window');
    });
    // Continues after the highest tag; the retired W4 is not reused.
    expect(next.openings.at(-1)!.tag).toBe('W9');
  });

  it('round-trips through the canonical JSON format', () => {
    const text = stringifyDesign(d);
    const r = parseDesignText(text);
    expect(r.ok).toBe(true);
    expect(text).toContain('{ "x": 3, "y": 3 }');
  });
});

describe('attached garage', () => {
  const d = load();
  const before = fixture('house-before-garage');

  it('leaves every house element except W4 unchanged', () => {
    for (const key of ['levels', 'foundation', 'roof', 'deck', 'materials'] as const) {
      expect(d[key]).toEqual(before[key]);
    }
    const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));
    const walls = byId(d.walls);
    for (const w of before.walls) expect(walls.get(w.id)).toEqual(w);
    const openings = byId(d.openings);
    for (const o of before.openings) {
      if (o.tag === 'W4') expect(openings.has(o.id)).toBe(false);
      else expect(openings.get(o.id)).toEqual(o);
    }
    const rooms = byId(d.rooms);
    for (const r of before.rooms) expect(rooms.get(r.id)).toEqual(r);
    const fixtures = byId(d.fixtures);
    for (const f of before.fixtures) expect(fixtures.get(f.id)).toEqual(f);
    expect(polygonArea(footprint(d)) / 144).toBeCloseTo(720, 5);
    const notPorch = (x: Design) => pierLayout(x).piers.filter((p) => p.platform !== 'porch');
    expect(notPorch(d)).toEqual(pierLayout(before).piers);
  });

  it('is a 14x24 garage (336 SF) beside the house', () => {
    const s = designSummary(d);
    expect(Math.round(s.garageArea / 144)).toBe(336);
    expect(bbox(garageFootprint(d)!)).toEqual({ x0: -168, y0: 0, x1: 0, y1: 288 });
    expect(buildingBounds(d)).toEqual({ x0: -168, y0: 0, x1: 360, y1: 288 });
  });

  it('keeps its low roof under the W5 clerestory and above the entry door', () => {
    const rf = garageRoofFrame(d)!;
    const w5 = d.openings.find((o) => o.tag === 'W5')!;
    // At least 6" between the ridge and the sill for the flashing.
    expect(w5.sill - rf.ridgeTop).toBeGreaterThan(6);
    expect(rf.undersideAt(roofHeelInset(d))).toBe(84);
  });

  it('runs its ridge east-west so both eaves shed away from the house', () => {
    const rf = garageRoofFrame(d)!;
    expect(garageHouseSide(d)).toBe('east');
    expect(rf.axis).toBe('x');
    expect(rf.ridgeS).toBe(144);
    expect([rf.eave0, rf.eave1]).toEqual([-12, 300]);
    expect(rf.a0).toBe(-180);
    expect(rf.a1).toBe(0); // the rake against the house has no overhang
  });

  it('keeps the eave overhangs when the ridge runs north-south', () => {
    const rf = garageRoofFrame(produce(d, (x) => { x.garage!.roof.ridgeAxis = 'y'; }))!;
    expect([rf.eave0, rf.eave1]).toEqual([-180, 0]);
    expect([rf.a0, rf.a1]).toEqual([-12, 300]);
  });

  it('puts garage walls on the slab', () => {
    const g1 = wallProfile(d, wallById(d, 'G1')!);
    expect(Math.min(...g1.outline.map((p) => p.y))).toBe(-26);
    // u runs along G1 from its start at x = -165, so the door spans x -153..-45.
    expect(g1.doors[0].rect).toEqual([12, -26, 120, 58]);
    expect(Math.max(...g1.outline.map((p) => p.y))).toBeCloseTo(84 + (6 - roofHeelInset(d)) / 6, 9);
    // G2 is the gable end: it follows the roof up to the ridge.
    const g2 = wallProfile(d, wallById(d, 'G2')!);
    expect(Math.max(...g2.outline.map((p) => p.y))).toBe(garageRoofFrame(d)!.ridgeUnder);
  });

  it('builds a landing and four steps down along the shared wall', () => {
    const e = garageEntry(d)!;
    expect(e.opening.tag).toBe('D8');
    expect(e.risers).toBe(4);
    expect(e.riserHeight).toBe(6.5);
    expect(e.landing).toEqual({ x0: -36, y0: 182, x1: 0, y1: 218 });
    expect(e.run).toEqual({ x0: -36, y0: 218, x1: 0, y1: 251 });
    expect(roomsForOpening(d, e.opening).map((r) => r.name).sort()).toEqual(['Garage', 'Great Room']);
  });

  it('flags a garage door into a bedroom and a roof that blocks W5', () => {
    const bedroom = produce(d, (x) => {
      x.garage!.entry.openingId = 'o-bed-east';
    });
    expect(validateDesign(bedroom).map((i) => i.code)).toContain('garage-bedroom');
    const steep = produce(d, (x) => {
      x.garage!.roof.pitch = 6;
    });
    expect(validateDesign(steep).map((i) => i.code)).toContain('garage-roof-window');
    const blocked = produce(d, (x) => {
      x.fixtures.find((f) => f.id === 'f-car')!.x = -30;
    });
    expect(validateDesign(blocked).map((i) => i.code)).toContain('garage-stairs-clear');
  });
});

describe('street-side porch', () => {
  const d = load();
  const before = fixture('house-before-porch');
  const porch = platforms(d).find((q) => q.kind === 'porch')!;

  it('leaves the house, garage, deck, and roofs unchanged', () => {
    for (const key of ['levels', 'foundation', 'roof', 'deck', 'materials', 'garage', 'walls', 'openings', 'rooms', 'fixtures'] as const) {
      expect(d[key]).toEqual(before[key]);
    }
  });

  it('runs the full front of the house with steps at the front door', () => {
    expect(porch.rect).toEqual({ x0: 0, y0: -86, x1: 360, y1: 0 });
    expect(porch.stairs!.rect).toEqual({ x0: 156, x1: 204, y0: -119, y1: -86 });
    expect(porch.stairs!.risers).toBe(4);
    const d1 = d.openings.find((o) => o.tag === 'D1')!;
    expect(openingCenter(wallById(d, d1.wallId)!, d1).x).toBe(180);
  });

  it('has a solid skirt, a guard like the deck, and handrails on both sides of the steps', () => {
    expect(porch.skirt).toBe('solid');
    expect(porch.spec.railingHeight).toBe(d.deck.railingHeight);
    // Front run split around the steps, plus both ends.
    expect(platformRailings(d, porch)).toHaveLength(4);
    const rails = stairHandrails(porch);
    expect(rails).toHaveLength(2);
    expect(rails.map((r) => r.a.x)).toEqual([157.5, 202.5]);
    expect(rails[0].b.y).toBe(-119);
  });

  it('adds a porch beam on piers and 215 SF of porch', () => {
    const piers = pierLayout(d).piers.filter((p) => p.platform === 'porch');
    expect(piers.length).toBe(5);
    expect(new Set(piers.map((p) => p.p.y))).toEqual(new Set([-80]));
    expect(Math.round(designSummary(d).porchArea / 144)).toBe(215);
  });

  it('requires a guard when the porch is more than 30 in. above grade', () => {
    expect(validateDesign(d).filter((i) => i.level === 'error')).toEqual([]);
    const high = produce(d, (x) => {
      x.levels.floorHeight = 40;
      x.porch!.railing = false;
    });
    const guard = validateDesign(high).filter((i) => i.code === 'platform-guard');
    expect(guard.map((i) => i.message.split(' ')[0])).toEqual(['Porch']);
  });
});

describe('site: lot, dock, and trees', () => {
  const d = load();
  const before = fixture('house-before-site');
  const g = siteGeom(d)!;

  it('leaves the house, garage, porch, and deck unchanged', () => {
    for (const key of ['levels', 'foundation', 'roof', 'deck', 'porch', 'materials', 'garage', 'walls', 'openings', 'rooms', 'fixtures'] as const) {
      expect(d[key]).toEqual(before[key]);
    }
  });

  it('keeps lake-side trees smaller than the street-side trees of the same species', () => {
    const lakeWall = Math.max(...d.walls.filter((w) => !w.zone).flatMap((w) => [w.start.y, w.end.y]));
    const oaks = g.trees.filter((t) => t.species === 'live-oak');
    const lake = oaks.filter((t) => t.y > lakeWall).map((t) => t.height);
    const street = oaks.filter((t) => t.y <= lakeWall).map((t) => t.height);
    expect(lake.length).toBeGreaterThan(0);
    expect(Math.max(...lake)).toBeLessThan(Math.min(...street));
  });

  it('fences the street and side lines with a gate at the driveway, leaving the shore open', () => {
    const f = g.fence!;
    expect(f).toBeTruthy();
    expect(f.runs).toHaveLength(4);
    expect(f.runs.every((r) => Math.max(r.a.y, r.b.y) <= g.shoreY)).toBe(true);
    expect(f.runs.some((r) => r.a.y === g.shoreY && r.b.y === g.shoreY)).toBe(false);
    const gate = f.gates[0];
    expect(Math.min(gate.a.x, gate.b.x)).toBeLessThanOrEqual(g.driveway!.x0);
    expect(Math.max(gate.a.x, gate.b.x)).toBeGreaterThanOrEqual(g.driveway!.x1);
  });

  it('is a 0.85 acre lot, 120 ft wide', () => {
    expect(Math.abs(g.acres - 0.85)).toBeLessThan(0.005);
    expect(g.lotRect.x1 - g.lotRect.x0).toBe(1440);
  });

  it('puts the house 60 ft from the water with 38 ft side yards', () => {
    expect(g.shoreY - footprintBounds(d).y1).toBe(720);
    const b = buildingBounds(d);
    expect(b.x0 - g.lotRect.x0).toBe(456);
    expect(g.lotRect.x1 - b.x1).toBe(456);
  });

  it('builds an open one-level dock with a slip and gangway', () => {
    const k = g.dock!;
    expect(k.gangway.y0).toBe(g.shoreY);
    expect(k.gangway.y1).toBe(k.body.y0);
    expect(k.slip.x0).toBeGreaterThanOrEqual(k.body.x0);
    expect(k.slip.x1).toBeLessThanOrEqual(k.body.x1);
    expect(k.slip.y1).toBe(k.body.y1);
    expect(k.gangway.x0).toBeGreaterThanOrEqual(k.lounge.x0);
    expect(k.body.x1 - k.body.x0).toBe(264);
    expect(k.body.y1 - k.body.y0).toBe(336);
    // No boat lift: the boat ties up in the slip.
    expect(k.lift).toHaveLength(0);
    expect(k.deckTop).toBe(g.grade);
    // One level: nothing above the deck to reach.
    expect('sundeckTop' in k).toBe(false);
  });

  it('keeps trees on the lot and clear of everything', () => {
    expect(g.trees.length).toBeGreaterThanOrEqual(25);
    expect(treeConflicts(d)).toEqual([]);
    expect(g.trees.every((t) => pointInPolygon({ x: t.x, y: t.y }, g.lot))).toBe(true);
  });

  it('validates cleanly and catches a slip that outgrows the dock', () => {
    expect(validateDesign(d).filter((i) => i.level !== 'info')).toEqual([]);
    const tooBig = produce(d, (x) => {
      x.site!.dock.slipLength = x.site!.dock.length + 24;
    });
    expect(validateDesign(tooBig).map((i) => i.code)).toContain('dock-slip');
  });
});

describe('cost estimates', () => {
  const d = load();
  it('prices every opening, room, and built-in fixture', () => {
    for (const o of d.openings) expect(openingCost(d, o).cost).toBeGreaterThan(0);
    for (const r of d.rooms) expect(roomFinishCost(d, r).total.cost).toBeGreaterThan(0);
    for (const f of d.fixtures.filter((f) => f.kind === 'sink' || f.kind === 'counter')) expect(fixtureCost(f).cost).toBeGreaterThan(0);
  });
  it('leaves furniture and the car unpriced', () => {
    const car = d.fixtures.find((f) => f.kind === 'car')!;
    const bed = d.fixtures.find((f) => f.kind === 'bed')!;
    expect(formatCost(fixtureCost(car))).toBe('N.I.C.');
    expect(formatCost(fixtureCost(bed))).toBe('Owner');
  });
  it('scales windows with area and prices exterior doors higher', () => {
    const win = d.openings.find((o) => o.kind === 'window' && o.operation === 'casement')!;
    const big = { ...win, width: win.width * 2, height: win.height * 2 };
    expect(openingCost(d, big).cost!).toBeGreaterThan(openingCost(d, win).cost!);
    expect(formatUsd(12345.6)).toBe('$12,346');
  });
});

describe('construction specs', () => {
  it('defaults specs for older designs and keeps abbreviations when continuing a sentence', () => {
    const r = parseDesignText(fs.readFileSync('tests/fixtures/house-before-site.json', 'utf8'));
    expect(r.ok && r.design.specs.roof.covering).toMatch(/standing seam/);
    expect(lowerFirst('LVL structural ridge beam')).toBe('LVL structural ridge beam');
    expect(lowerFirst('R-38 spray foam')).toBe('R-38 spray foam');
    expect(lowerFirst('Cast-in-place piers')).toBe('cast-in-place piers');
  });
});

describe('foundation cost', () => {
  const d = load();
  const rows = foundationCostRows(d);
  const row = (name: string) => rows.find((r) => r.item.includes(name))!;
  it('counts the piers and beams from the pier layout', () => {
    const { piers, beams } = pierLayout(d);
    expect(row('Concrete piers').qty).toBe(`${piers.filter((q) => !q.deck).length} ea.`);
    expect(row('Deck and porch piers').qty).toBe(`${piers.filter((q) => q.deck).length} ea.`);
    const houseBeamLf = beams.filter((b) => !b.deck).reduce((s, b) => s + Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y), 0) / 12;
    expect(row('built-up beams').qty).toBe(`${Math.round(houseBeamLf)} LF`);
  });
  it('measures framing by the footprint and the garage footing by its free edges', () => {
    expect(row('Floor joists').qty).toBe(`${Math.round(polygonArea(footprint(d)) / 144)} SF`);
    // 14' x 24' garage: three sides get a footing, the house side does not.
    expect(row('thickened-edge').qty).toBe(`52 LF`);
    expect(rows.every((r) => r.cost > 0)).toBe(true);
  });
});
