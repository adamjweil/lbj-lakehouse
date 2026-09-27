import type { Design, FixtureKind, Opening, Wall } from '../model/schema';
import {
  add, dot, leftNormal, mul, near, norm, openingCenter, pointAlong, projectOnWall, sub, wallDir,
  wallLength, type Vec,
} from '../model/geometry';

/**
 * Mutating operations on an immer draft of the design.
 * They keep walls connected, room corners attached, and openings where they were.
 */

type Snapshot = Map<string, Vec>;

function openingWorldCenters(d: Design): Snapshot {
  const m: Snapshot = new Map();
  for (const o of d.openings) {
    const w = d.walls.find((x) => x.id === o.wallId);
    if (w) m.set(o.id, openingCenter(w, o));
  }
  return m;
}

/** Re-project openings onto their (possibly changed) walls, except walls that moved rigidly. */
function restoreOpenings(d: Design, before: Snapshot, rigid: Set<string>) {
  for (const o of d.openings) {
    if (rigid.has(o.wallId)) continue;
    const c = before.get(o.id);
    const w = d.walls.find((x) => x.id === o.wallId);
    if (!c || !w) continue;
    o.offset = round(dot(sub(c, w.start), wallDir(w)));
  }
}

const round = (n: number) => Math.round(n * 100) / 100;
const roundPt = (p: Vec): Vec => ({ x: round(p.x), y: round(p.y) });

/** Move every wall endpoint and room corner at `from` to `to`. */
export function movePoint(d: Design, from: Vec, to: Vec) {
  const before = openingWorldCenters(d);
  const t = roundPt(to);
  const f = { ...from };
  for (const w of d.walls) {
    if (near(w.start, f)) w.start = { ...t };
    if (near(w.end, f)) w.end = { ...t };
  }
  for (const r of d.rooms) {
    r.polygon = r.polygon.map((p) => (near(p, f) ? { ...t } : p));
  }
  restoreOpenings(d, before, new Set());
}

/** Translate a whole wall; walls that meet it (corners and tees) stretch to follow. */
export function moveWall(d: Design, wallId: string, delta: Vec) {
  const w = d.walls.find((x) => x.id === wallId);
  if (!w) return;
  const before = openingWorldCenters(d);
  const orig: Wall = JSON.parse(JSON.stringify(w));
  const onWall = (p: Vec) => projectOnWall(orig, p) !== null;
  const shift = (p: Vec) => roundPt(add(p, delta));
  for (const o of d.walls) {
    if (o.id === wallId) {
      o.start = shift(o.start);
      o.end = shift(o.end);
      continue;
    }
    if (onWall(o.start)) o.start = shift(o.start);
    if (onWall(o.end)) o.end = shift(o.end);
  }
  for (const r of d.rooms) {
    r.polygon = r.polygon.map((p) => (onWall(p) ? shift(p) : p));
  }
  restoreOpenings(d, before, new Set([wallId]));
}

/** Change a wall's length by moving its end point (connected walls follow). */
export function setWallLength(d: Design, wallId: string, length: number) {
  const w = d.walls.find((x) => x.id === wallId);
  if (!w || length <= 0) return;
  const target = add(w.start, mul(wallDir(w), length));
  movePoint(d, w.end, target);
}

export function nextId(existing: string[], prefix: string): string {
  let n = 1;
  const set = new Set(existing);
  while (set.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/** Next tag after the highest in use, so retired numbers are never reused. */
export function nextTag(existing: string[], prefix: string): string {
  const nums = existing
    .filter((t) => t.startsWith(prefix))
    .map((t) => Number(t.slice(prefix.length)))
    .filter(Number.isFinite);
  return `${prefix}${Math.max(0, ...nums) + 1}`;
}

export function addWall(d: Design, a: Vec, b: Vec, type: Wall['type']): string {
  const id = nextId(d.walls.map((w) => w.id), type === 'exterior' ? 'X' : 'P');
  d.walls.push({ id, type, start: roundPt(a), end: roundPt(b), thickness: type === 'exterior' ? 6 : 4.5 });
  return id;
}

export function deleteWall(d: Design, wallId: string) {
  d.walls = d.walls.filter((w) => w.id !== wallId);
  d.openings = d.openings.filter((o) => o.wallId !== wallId);
}

export const OPENING_DEFAULTS: Record<Opening['kind'], Pick<Opening, 'operation' | 'width' | 'height' | 'sill'>> = {
  door: { operation: 'swing', width: 32, height: 80, sill: 0 },
  window: { operation: 'casement', width: 36, height: 48, sill: 30 },
  slider: { operation: 'sliding', width: 72, height: 80, sill: 0 },
};

export function addOpening(d: Design, wallId: string, offset: number, kind: Opening['kind']): string | null {
  const w = d.walls.find((x) => x.id === wallId);
  if (!w) return null;
  const def = OPENING_DEFAULTS[kind];
  const L = wallLength(w);
  const width = Math.min(def.width, Math.max(12, L - 8));
  const center = Math.min(Math.max(offset, width / 2 + 2), L - width / 2 - 2);
  const tagPrefix = kind === 'window' ? 'W' : 'D';
  const tag = nextTag(d.openings.map((o) => o.tag), tagPrefix);
  const id = nextId(d.openings.map((o) => o.id), `o-${tag.toLowerCase()}-`);
  d.openings.push({
    id, tag, wallId, kind, ...def, width, offset: round(center),
    ...(kind === 'door' ? { hinge: 'start' as const, swing: 'left' as const } : {}),
  });
  return id;
}

export function deleteOpening(d: Design, id: string) {
  d.openings = d.openings.filter((o) => o.id !== id);
}

export const FIXTURE_DEFAULTS: Record<FixtureKind, { w: number; d: number; label?: string }> = {
  counter: { w: 72, d: 25 },
  sink: { w: 30, d: 19 },
  range: { w: 30, d: 25 },
  fridge: { w: 36, d: 30 },
  dishwasher: { w: 24, d: 24 },
  island: { w: 72, d: 36 },
  table: { w: 36, d: 60 },
  chair: { w: 30, d: 32 },
  sofa: { w: 84, d: 36 },
  'coffee-table': { w: 48, d: 24 },
  bed: { w: 60, d: 80, label: 'Queen bed' },
  nightstand: { w: 20, d: 18 },
  dresser: { w: 60, d: 20 },
  toilet: { w: 20, d: 28 },
  vanity: { w: 36, d: 21 },
  shower: { w: 36, d: 48 },
  tub: { w: 60, d: 30 },
  'washer-dryer': { w: 27, d: 30 },
  'water-heater': { w: 14, d: 8 },
  stove: { w: 24, d: 24, label: 'Wood stove' },
  'closet-rod': { w: 48, d: 22 },
  car: { w: 74, d: 192, label: 'Car' },
};

export function addFixture(d: Design, kind: FixtureKind, at: Vec): string {
  const id = nextId(d.fixtures.map((f) => f.id), `f-${kind}-`);
  const def = FIXTURE_DEFAULTS[kind];
  d.fixtures.push({ id, kind, x: round(at.x), y: round(at.y), w: def.w, d: def.d, rotation: 0, ...(def.label ? { label: def.label } : {}) });
  return id;
}

export function deleteFixture(d: Design, id: string) {
  d.fixtures = d.fixtures.filter((f) => f.id !== id);
}

export function addRoom(d: Design, a: Vec, b: Vec): string {
  const id = nextId(d.rooms.map((r) => r.id), 'r-');
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  d.rooms.push({
    id,
    name: 'New Room',
    type: 'living',
    polygon: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }].map(roundPt),
    ceiling: 'flat',
    finishes: { floor: 'TBD', walls: 'Painted gypsum board', ceiling: 'Painted gypsum board' },
  });
  return id;
}

export function deleteRoom(d: Design, id: string) {
  d.rooms = d.rooms.filter((r) => r.id !== id);
}

// ---------------------------------------------------------------- snapping

export type SnapOptions = { grid: number; points: Vec[]; radius: number; anchor?: Vec | null; ortho?: boolean };

export function snapPoint(p: Vec, opts: SnapOptions): Vec {
  for (const q of opts.points) if (near(p, q, opts.radius)) return { ...q };
  let x = Math.round(p.x / opts.grid) * opts.grid;
  let y = Math.round(p.y / opts.grid) * opts.grid;
  if (opts.anchor && opts.ortho !== false) {
    const dx = Math.abs(x - opts.anchor.x);
    const dy = Math.abs(y - opts.anchor.y);
    if (dx < dy * 0.18) x = opts.anchor.x;
    else if (dy < dx * 0.18) y = opts.anchor.y;
  }
  return { x, y };
}

/** All wall endpoints (and midpoints where other walls meet) for snapping. */
export function snapTargets(d: Design, exclude?: Vec): Vec[] {
  const pts: Vec[] = [];
  for (const w of d.walls) {
    for (const p of [w.start, w.end]) if (!exclude || !near(p, exclude)) pts.push(p);
  }
  return pts;
}

/** Nearest wall to a point, with the distance along it. */
export function nearestWall(d: Design, p: Vec, maxDist: number): { wall: Wall; u: number } | null {
  let best: { wall: Wall; u: number; dist: number } | null = null;
  for (const w of d.walls) {
    const dir = wallDir(w);
    const rel = sub(p, w.start);
    const u = dot(rel, dir);
    if (u < 0 || u > wallLength(w)) continue;
    const off = Math.abs(dot(rel, leftNormal(dir)));
    if (off > maxDist) continue;
    if (!best || off < best.dist) best = { wall: w, u, dist: off };
  }
  return best ? { wall: best.wall, u: best.u } : null;
}

export function projectDelta(delta: Vec, w: Wall): Vec {
  const n = norm(leftNormal(wallDir(w)));
  return mul(n, dot(delta, n));
}

export { pointAlong };
