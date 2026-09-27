import type { Design, Fixture, Opening, Room, Side, Wall, Zone } from './schema';

/**
 * Derived geometry shared by every view (plan, elevations, section, 3D).
 * All units are inches; plan +y points south.
 */

export type Vec = { x: number; y: number };
export type Rect = { x0: number; y0: number; x1: number; y1: number };

export const EPS = 0.5;

export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
export const len = (a: Vec) => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: Vec): Vec => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
/** Left of travel direction on a y-down plan (e.g. heading east, left is north). */
export const leftNormal = (d: Vec): Vec => ({ x: d.y, y: -d.x });
export const near = (a: Vec, b: Vec, eps = EPS) => dist(a, b) <= eps;

// ---------------------------------------------------------------- walls

export const wallDir = (w: Wall) => norm(sub(w.end, w.start));
export const wallLength = (w: Wall) => dist(w.start, w.end);
export const pointAlong = (w: Wall, u: number) => add(w.start, mul(wallDir(w), u));

/** Distance along the wall of p's projection when p lies on the wall segment, else null. */
export function projectOnWall(w: Wall, p: Vec, eps = EPS): number | null {
  const d = wallDir(w);
  const rel = sub(p, w.start);
  const u = dot(rel, d);
  if (Math.abs(dot(rel, leftNormal(d))) > eps) return null;
  if (u < -eps || u > wallLength(w) + eps) return null;
  return u;
}

export function isParallel(a: Wall, b: Wall) {
  return Math.abs(Math.abs(dot(wallDir(a), wallDir(b))) - 1) < 1e-6;
}

const isPrimary = (w: Wall) => {
  const d = wallDir(w);
  return Math.abs(d.x) >= Math.abs(d.y);
};

/**
 * How far each wall end extends past its centerline endpoint so joins are clean without overlap:
 * - at an L corner the "primary" (east-west) wall extends to cover the corner and the other retracts;
 * - at a T junction the abutting wall stops at the host wall's face.
 */
export function wallEndExtensions(design: Design, w: Wall): [number, number] {
  const ext = (p: Vec) => {
    let tee: number | null = null;
    let corner: number | null = null;
    for (const o of design.walls) {
      if (o.id === w.id || isParallel(o, w)) continue;
      if (projectOnWall(o, p) === null) continue;
      if (near(o.start, p) || near(o.end, p)) {
        const e = isPrimary(w) ? o.thickness / 2 : -o.thickness / 2;
        corner = corner === null ? e : Math.max(corner, e);
      } else {
        tee = Math.min(tee ?? 0, -o.thickness / 2);
      }
    }
    return tee ?? corner ?? 0;
  };
  return [ext(w.start), ext(w.end)];
}

/** What a wall end meets. */
export type WallEndCondition =
  /** Nothing: the wall stops in the open. */
  | { kind: 'free' }
  /** An L corner. The `through` wall runs past the corner; the other one butts into it. */
  | { kind: 'corner'; other: Wall; through: boolean }
  /** The wall ends on the side of another wall (a T junction). */
  | { kind: 'tee'; other: Wall }
  /** The wall butts the face of a wall it does not join, such as a garage wall against the house. */
  | { kind: 'structure'; other: Wall };

/** Classifies the start (0) or end (1) of a wall, matching the joins `wallEndExtensions` draws. */
export function wallEndCondition(design: Design, w: Wall, end: 0 | 1): WallEndCondition {
  const p = end === 0 ? w.start : w.end;
  let corner: Wall | null = null;
  for (const o of design.walls) {
    if (o.id === w.id || isParallel(o, w)) continue;
    if (projectOnWall(o, p) === null) continue;
    if (near(o.start, p) || near(o.end, p)) corner ??= o;
    else return { kind: 'tee', other: o };
  }
  if (corner) return { kind: 'corner', other: corner, through: isPrimary(w) };
  for (const o of design.walls) {
    if (o.id === w.id || isParallel(o, w)) continue;
    const rel = sub(p, o.start);
    const u = dot(rel, wallDir(o));
    const off = Math.abs(dot(rel, leftNormal(wallDir(o))));
    if (Math.abs(off - o.thickness / 2) <= EPS && u > -o.thickness / 2 - EPS && u < wallLength(o) + o.thickness / 2 + EPS) {
      return { kind: 'structure', other: o };
    }
  }
  return { kind: 'free' };
}

/**
 * Walls that end against the side of `w`, with the distance along `w` to their centerline.
 * `face` marks a wall that butts the wall's face without joining it (see `wallEndCondition`).
 */
export function wallTees(design: Design, w: Wall): { u: number; wall: Wall; face: boolean }[] {
  const out: { u: number; wall: Wall; face: boolean }[] = [];
  const L = wallLength(w);
  for (const o of design.walls) {
    if (o.id === w.id || isParallel(o, w)) continue;
    for (const end of [0, 1] as const) {
      const c = wallEndCondition(design, o, end);
      if ((c.kind !== 'tee' && c.kind !== 'structure') || c.other.id !== w.id) continue;
      const u = dot(sub(end === 0 ? o.start : o.end, w.start), wallDir(w));
      if (u > EPS && u < L - EPS) out.push({ u, wall: o, face: c.kind === 'structure' });
    }
  }
  return out.sort((a, b) => a.u - b.u);
}

/** Plan polygon of a wall (four corners) including join extensions. */
export function wallPolygon(design: Design, w: Wall): Vec[] {
  const [e0, e1] = wallEndExtensions(design, w);
  const d = wallDir(w);
  const n = mul(leftNormal(d), w.thickness / 2);
  const a = sub(w.start, mul(d, e0));
  const b = add(w.end, mul(d, e1));
  return [add(a, n), add(b, n), sub(b, n), sub(a, n)];
}

export const wallById = (design: Design, id: string) => design.walls.find((w) => w.id === id);

// ---------------------------------------------------------------- openings

export const openingRange = (o: Opening): [number, number] => [o.offset - o.width / 2, o.offset + o.width / 2];
export const openingCenter = (w: Wall, o: Opening) => pointAlong(w, o.offset);
export const openingHead = (o: Opening) => o.sill + o.height;

/** Plan rectangle (4 corners) of an opening through its wall. */
export function openingPolygon(w: Wall, o: Opening, pad = 0.6): Vec[] {
  const d = wallDir(w);
  const n = mul(leftNormal(d), w.thickness / 2 + pad);
  const [u0, u1] = openingRange(o);
  const a = pointAlong(w, u0);
  const b = pointAlong(w, u1);
  return [add(a, n), add(b, n), sub(b, n), sub(a, n)];
}

/** Estimated net clear opening (w, h) for egress checks. */
export function clearOpening(o: Opening): { w: number; h: number } {
  switch (o.operation) {
    case 'casement':
    case 'awning':
      return { w: o.width - 5, h: o.height - 6 };
    case 'double-hung':
      return { w: o.width - 5, h: (o.height - 7) / 2 };
    case 'slider':
      return { w: (o.width - 7) / 2, h: o.height - 5 };
    case 'fixed':
      return { w: 0, h: 0 };
    default:
      return { w: o.width - 4, h: o.height - 2 };
  }
}

// ---------------------------------------------------------------- polygons

export function signedArea(pts: Vec[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export const polygonArea = (pts: Vec[]) => Math.abs(signedArea(pts));

export function polygonCentroid(pts: Vec[]): Vec {
  const A = signedArea(pts);
  if (Math.abs(A) < 1e-9) {
    return mul(pts.reduce((s, p) => add(s, p), { x: 0, y: 0 }), 1 / pts.length);
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * A), y: cy / (6 * A) };
}

export function bbox(pts: Vec[]): Rect {
  const r = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of pts) {
    r.x0 = Math.min(r.x0, p.x);
    r.y0 = Math.min(r.y0, p.y);
    r.x1 = Math.max(r.x1, p.x);
    r.y1 = Math.max(r.y1, p.y);
  }
  return r;
}

export const rectPoints = (r: Rect): Vec[] => [
  { x: r.x0, y: r.y0 },
  { x: r.x1, y: r.y0 },
  { x: r.x1, y: r.y1 },
  { x: r.x0, y: r.y1 },
];

export function pointInPolygon(p: Vec, pts: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export const rectsOverlap = (a: Rect, b: Rect, tol = 0) =>
  a.x0 < b.x1 - tol && b.x0 < a.x1 - tol && a.y0 < b.y1 - tol && b.y0 < a.y1 - tol;

type Line = { p: Vec; d: Vec };
function intersect(l1: Line, l2: Line): Vec {
  const cross = l1.d.x * l2.d.y - l1.d.y * l2.d.x;
  if (Math.abs(cross) < 1e-9) return l2.p;
  const t = ((l2.p.x - l1.p.x) * l2.d.y - (l2.p.y - l1.p.y) * l2.d.x) / cross;
  return add(l1.p, mul(l1.d, t));
}

/** Offset each edge i of a closed polygon by dists[i], outward or inward. */
export function offsetPolygon(pts: Vec[], dists: number[], outward: boolean): Vec[] {
  const n = pts.length;
  // On a y-down plan, positive shoelace area means the left normal points outward.
  const sign = signedArea(pts) > 0 === outward ? 1 : -1;
  const lines: Line[] = pts.map((a, i) => {
    const b = pts[(i + 1) % n];
    const d = norm(sub(b, a));
    return { p: add(a, mul(leftNormal(d), sign * dists[i])), d };
  });
  return pts.map((_, i) => intersect(lines[(i - 1 + n) % n], lines[i]));
}

// ---------------------------------------------------------------- footprint

export const houseWalls = (design: Design) => design.walls.filter((w) => !w.zone);
export const garageWalls = (design: Design) => design.walls.filter((w) => w.zone === 'garage');

/** Floor level of a zone relative to the house finished floor. */
export function zoneFloor(design: Design, zone: Zone | undefined): number {
  return zone === 'garage' ? design.garage?.floor ?? 0 : 0;
}

/** Plate height above a zone's floor. */
export function zonePlate(design: Design, zone: Zone | undefined): number {
  return zone === 'garage' && design.garage ? design.garage.plateHeight : design.levels.wallHeight;
}

/** House exterior wall centerlines chained into a closed loop, with each edge's wall thickness. */
export function exteriorLoop(design: Design): { pts: Vec[]; thick: number[] } | null {
  const ext = houseWalls(design).filter((w) => w.type === 'exterior');
  if (ext.length < 3) return null;
  const used = new Set<string>([ext[0].id]);
  const pts: Vec[] = [ext[0].start];
  const thick: number[] = [ext[0].thickness];
  let cur = ext[0].end;
  for (;;) {
    if (near(cur, pts[0])) return { pts, thick };
    const next = ext.find((w) => !used.has(w.id) && (near(w.start, cur) || near(w.end, cur)));
    if (!next) return null;
    used.add(next.id);
    pts.push(cur);
    thick.push(next.thickness);
    cur = near(next.start, cur) ? next.end : next.start;
  }
}

/** Outer face of the exterior walls (gross footprint). Falls back to wall bounds. */
export function footprint(design: Design): Vec[] {
  const loop = exteriorLoop(design);
  if (loop) return offsetPolygon(loop.pts, loop.thick.map((t) => t / 2), true);
  const pts = houseWalls(design).flatMap((w) => wallPolygon(design, w));
  return pts.length ? rectPoints(bbox(pts)) : rectPoints({ x0: 0, y0: 0, x1: 1, y1: 1 });
}

export const footprintBounds = (design: Design) => bbox(footprint(design));

/**
 * Outer outline of the garage: the bounds of its walls. The side against the house is open,
 * so this rectangle ends at the house's outer face.
 */
export function garageFootprint(design: Design): Vec[] | null {
  const walls = garageWalls(design);
  if (!walls.length) return null;
  return rectPoints(bbox(walls.flatMap((w) => wallPolygon(design, w))));
}

/** The side of the garage that sits against the house (null when there is no garage or they don't touch). */
export function garageHouseSide(design: Design): Side | null {
  const fp = garageFootprint(design);
  if (!fp) return null;
  const g = bbox(fp);
  const h = footprintBounds(design);
  const overlapY = g.y0 < h.y1 - 1 && h.y0 < g.y1 - 1;
  const overlapX = g.x0 < h.x1 - 1 && h.x0 < g.x1 - 1;
  if (overlapY && Math.abs(g.x1 - h.x0) < 1) return 'east';
  if (overlapY && Math.abs(g.x0 - h.x1) < 1) return 'west';
  if (overlapX && Math.abs(g.y1 - h.y0) < 1) return 'south';
  if (overlapX && Math.abs(g.y0 - h.y1) < 1) return 'north';
  return null;
}

/** The plan axis running along the wall the garage shares with the house. Section 2 is positioned along it. */
export function garageSharedAxis(design: Design): 'x' | 'y' | null {
  const side = garageHouseSide(design);
  if (!side) return null;
  return side === 'east' || side === 'west' ? 'y' : 'x';
}

/** Bounds of the whole building (house plus garage). */
export function buildingBounds(design: Design): Rect {
  return bbox([...footprint(design), ...(garageFootprint(design) ?? [])]);
}

/** Floor level under a plan point (garage slab or house floor). */
export function floorAt(design: Design, p: Vec): number {
  const g = garageFootprint(design);
  return g && pointInPolygon(p, g) ? zoneFloor(design, 'garage') : 0;
}

const zoneOutline = (design: Design, w: Wall) => (w.zone === 'garage' && garageFootprint(design)) || footprint(design);

/** Outward-facing side of an exterior wall (null for interior walls). */
export function wallFace(design: Design, w: Wall): Side | null {
  if (w.type !== 'exterior') return null;
  const c = polygonCentroid(zoneOutline(design, w));
  const mid = mul(add(w.start, w.end), 0.5);
  let n = leftNormal(wallDir(w));
  if (dot(n, sub(mid, c)) < 0) n = mul(n, -1);
  if (Math.abs(n.x) > Math.abs(n.y)) return n.x > 0 ? 'east' : 'west';
  return n.y > 0 ? 'south' : 'north';
}

/** Unit vector pointing out of the building for an exterior wall. */
export function outwardNormal(design: Design, w: Wall): Vec {
  const c = polygonCentroid(zoneOutline(design, w));
  const mid = mul(add(w.start, w.end), 0.5);
  const n = leftNormal(wallDir(w));
  return dot(n, sub(mid, c)) < 0 ? mul(n, -1) : n;
}

export const SIDE_NORMAL: Record<Side, Vec> = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  east: { x: 1, y: 0 },
  west: { x: -1, y: 0 },
};

// ---------------------------------------------------------------- rooms

/** Thickness of the wall running along a room edge (0 when none). */
function edgeWallThickness(design: Design, a: Vec, b: Vec): number {
  const mid = mul(add(a, b), 0.5);
  const d = norm(sub(b, a));
  for (const w of design.walls) {
    if (Math.abs(Math.abs(dot(wallDir(w), d)) - 1) > 1e-6) continue;
    if (projectOnWall(w, mid) !== null) return w.thickness;
  }
  return 0;
}

/** Room polygon inset to the finished wall faces. */
export function roomNetPolygon(design: Design, room: Room): Vec[] {
  const pts = room.polygon;
  const dists = pts.map((a, i) => edgeWallThickness(design, a, pts[(i + 1) % pts.length]) / 2);
  return offsetPolygon(pts, dists, false);
}

export function roomStats(design: Design, room: Room) {
  const net = roomNetPolygon(design, room);
  const b = bbox(net);
  return {
    net,
    area: polygonArea(net),
    width: b.x1 - b.x0,
    depth: b.y1 - b.y0,
    minDim: Math.min(b.x1 - b.x0, b.y1 - b.y0),
    center: room.label ?? polygonCentroid(net),
    /** Floor level relative to the house finished floor. */
    floor: zoneFloor(design, room.zone),
    /** Ceiling height above the room's own floor. */
    ceilingHeight: room.ceilingHeight ?? zonePlate(design, room.zone),
  };
}

/** Openings whose center sits on one of the room's edges. */
export function roomOpenings(design: Design, room: Room): { opening: Opening; wall: Wall }[] {
  const out: { opening: Opening; wall: Wall }[] = [];
  for (const o of design.openings) {
    const w = wallById(design, o.wallId);
    if (!w) continue;
    const c = openingCenter(w, o);
    const pts = room.polygon;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const seg = { id: '', type: 'interior', start: a, end: b, thickness: 1 } as Wall;
      // Room edges may sit on a wall centerline or on the face of a wall (garage against the house).
      if (dist(a, b) > 0 && projectOnWall(seg, c, w.thickness / 2 + 0.5) !== null) {
        out.push({ opening: o, wall: w });
        break;
      }
    }
  }
  return out;
}

export function roomsForOpening(design: Design, o: Opening): Room[] {
  return design.rooms.filter((r) => roomOpenings(design, r).some((x) => x.opening.id === o.id));
}

// ---------------------------------------------------------------- fixtures

export function fixtureCorners(f: Fixture): Vec[] {
  const t = (f.rotation * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [
    { x: -f.w / 2, y: -f.d / 2 },
    { x: f.w / 2, y: -f.d / 2 },
    { x: f.w / 2, y: f.d / 2 },
    { x: -f.w / 2, y: f.d / 2 },
  ].map((p) => ({ x: f.x + p.x * c - p.y * s, y: f.y + p.x * s + p.y * c }));
}

export const fixtureRect = (f: Fixture) => bbox(fixtureCorners(f));

// ---------------------------------------------------------------- roof

export type RoofFrame = ReturnType<typeof makeRoofFrame>;

type RoofSpec = {
  pitch: number;
  axis: 'x' | 'y';
  /** Eave overhangs at the low-s and high-s sides. */
  overhangs: [number, number];
  /** Rake overhangs at the low-a and high-a ends. */
  gableOverhangs: [number, number];
  thickness: number;
  /** Plan bounds of the walls under the roof. */
  bounds: Rect;
  /** Top of the wall plate, above the house FF. */
  plate: number;
  /** How far in from the outer wall face the roof underside passes through the plate height. */
  heelInset: number;
};

/** Sheathing outside the studs: a 6" exterior wall is a 5-1/2" stud plus this. */
export const WALL_SHEATHING = 0.5;

/**
 * The rafter seat: the roof underside crosses the plate height this far in from the outer
 * wall face (the sheathing plus the seat cut), so every rafter bears on the plate.
 */
export const roofHeelInset = (design: Design) => WALL_SHEATHING + design.framing.roof.seat;

/**
 * Gable roof frame. `s` is the plan coordinate across the ridge, `a` the coordinate along it.
 * The roof underside passes through the plate height `heelInset` in from the outer wall face.
 */
export function makeRoofFrame(spec: RoofSpec) {
  const { axis, bounds: b, plate, heelInset } = spec;
  const sMin = axis === 'x' ? b.y0 : b.x0;
  const sMax = axis === 'x' ? b.y1 : b.x1;
  const aMin = axis === 'x' ? b.x0 : b.y0;
  const aMax = axis === 'x' ? b.x1 : b.y1;
  const slope = spec.pitch / 12;
  const ridgeS = (sMin + sMax) / 2;
  const undersideAt = (s: number) => plate + slope * (Math.min(s - sMin, sMax - s) - heelInset);
  const tv = spec.thickness / Math.cos(Math.atan(slope));
  const eave0 = sMin - spec.overhangs[0];
  const eave1 = sMax + spec.overhangs[1];
  const a0 = aMin - spec.gableOverhangs[0];
  const a1 = aMax + spec.gableOverhangs[1];
  const sOf = (p: Vec) => (axis === 'x' ? p.y : p.x);
  const aOf = (p: Vec) => (axis === 'x' ? p.x : p.y);
  const toPlan = (s: number, a: number): Vec => (axis === 'x' ? { x: a, y: s } : { x: s, y: a });
  const ridgeUnder = undersideAt(ridgeS);
  /** The two roof slabs as (s, h) polygons. */
  const profiles: Vec[][] = [
    [
      { x: eave0, y: undersideAt(eave0) },
      { x: ridgeS, y: ridgeUnder },
      { x: ridgeS, y: ridgeUnder + tv },
      { x: eave0, y: undersideAt(eave0) + tv },
    ],
    [
      { x: ridgeS, y: ridgeUnder },
      { x: eave1, y: undersideAt(eave1) },
      { x: eave1, y: undersideAt(eave1) + tv },
      { x: ridgeS, y: ridgeUnder + tv },
    ],
  ];
  return {
    axis, sMin, sMax, aMin, aMax, a0, a1, eave0, eave1, ridgeS, slope, plate, heelInset, tv,
    undersideAt, sOf, aOf, toPlan, profiles,
    ridgeUnder,
    ridgeTop: ridgeUnder + tv,
    /** Lowest eave (for elevation bands). */
    eaveUnder: Math.min(undersideAt(eave0), undersideAt(eave1)),
    eaveTop: Math.min(undersideAt(eave0), undersideAt(eave1)) + tv,
    /** Plan rectangle of the roof including overhangs. */
    planRect: bbox([toPlan(eave0, a0), toPlan(eave1, a1)]),
  };
}

/** The house roof. */
export function roofFrame(design: Design) {
  const { roof } = design;
  return makeRoofFrame({
    pitch: roof.pitch,
    axis: roof.ridgeAxis,
    overhangs: [roof.overhang, roof.overhang],
    gableOverhangs: [roof.gableOverhang, roof.gableOverhang],
    thickness: roof.thickness,
    bounds: footprintBounds(design),
    plate: design.levels.wallHeight,
    heelInset: roofHeelInset(design),
  });
}

/**
 * The garage roof, or null when there is no garage. The edge against the house (an eave or
 * a rake, depending on which way the ridge runs) uses `houseSideOverhang`.
 */
export function garageRoofFrame(design: Design) {
  const g = design.garage;
  const fp = garageFootprint(design);
  if (!g || !fp) return null;
  const axis = g.roof.ridgeAxis;
  const house = garageHouseSide(design);
  const over = (side: Side, free: number) => (house === side ? g.roof.houseSideOverhang : free);
  const eaves: [Side, Side] = axis === 'x' ? ['north', 'south'] : ['west', 'east'];
  const rakes: [Side, Side] = axis === 'x' ? ['west', 'east'] : ['north', 'south'];
  return makeRoofFrame({
    pitch: g.roof.pitch,
    axis,
    overhangs: [over(eaves[0], g.roof.overhang), over(eaves[1], g.roof.overhang)],
    gableOverhangs: [over(rakes[0], g.roof.gableOverhang), over(rakes[1], g.roof.gableOverhang)],
    thickness: g.roof.thickness,
    bounds: bbox(fp),
    plate: g.floor + g.plateHeight,
    heelInset: roofHeelInset(design),
  });
}

/** Every roof in the design, tagged by zone. */
export function roofFrames(design: Design): { zone: Zone | undefined; frame: RoofFrame }[] {
  const out: { zone: Zone | undefined; frame: RoofFrame }[] = [{ zone: undefined, frame: roofFrame(design) }];
  const g = garageRoofFrame(design);
  if (g) out.push({ zone: 'garage', frame: g });
  return out;
}

/** The roof over a wall's zone. */
export function frameFor(design: Design, w: Wall): RoofFrame {
  return (w.zone === 'garage' && garageRoofFrame(design)) || roofFrame(design);
}

/** True when the wall runs across its roof's ridge (its top follows the roof underside for gables). */
export function isGableWall(design: Design, w: Wall) {
  const d = wallDir(w);
  return frameFor(design, w).axis === 'x' ? Math.abs(d.x) < 1e-6 : Math.abs(d.y) < 1e-6;
}

export function wallReachesRoof(design: Design, w: Wall) {
  return isGableWall(design, w) && (w.toRoof || w.type === 'exterior');
}

export type WallProfile = {
  u0: number;
  u1: number;
  /** Outline in (u, v): u along the wall from its start, v up from the house FF. Door notches included. */
  outline: Vec[];
  /** Window holes as [u0, v0, u1, v1]. */
  holes: { opening: Opening; rect: [number, number, number, number] }[];
  doors: { opening: Opening; rect: [number, number, number, number] }[];
  topAt: (u: number) => number;
};

export function wallProfile(design: Design, w: Wall): WallProfile {
  const rf = frameFor(design, w);
  const base = zoneFloor(design, w.zone);
  const [e0, e1] = wallEndExtensions(design, w);
  const L = wallLength(w);
  const u0 = -e0;
  const u1 = L + e1;
  const d = wallDir(w);
  const s0 = rf.sOf(w.start);
  const ds = rf.sOf(d);
  const toRoof = wallReachesRoof(design, w);
  // Eave walls rise to the roof underside at their inside face so the ceiling meets them.
  const eaveRise = w.type === 'exterior' && !isGableWall(design, w) ? Math.max(0, w.thickness - rf.heelInset) * rf.slope : 0;
  const flat = base + (w.height ?? zonePlate(design, w.zone) + eaveRise);
  const topAt = (u: number) => (toRoof ? Math.max(rf.undersideAt(s0 + u * ds), base) : flat);

  const openings = design.openings.filter((o) => o.wallId === w.id);
  const doors: WallProfile['doors'] = [];
  const holes: WallProfile['holes'] = [];
  for (const o of openings) {
    let [a, b] = openingRange(o);
    a = Math.max(a, u0);
    b = Math.min(b, u1);
    if (b <= a) continue;
    const rect: [number, number, number, number] = [a, base + o.sill, b, base + o.sill + o.height];
    if (o.sill < 0.5) doors.push({ opening: o, rect: [a, base, b, base + o.height] });
    else holes.push({ opening: o, rect });
  }
  doors.sort((p, q) => p.rect[0] - q.rect[0]);

  const outline: Vec[] = [{ x: u0, y: base }];
  for (const { rect } of doors) {
    outline.push({ x: rect[0], y: base }, { x: rect[0], y: rect[3] }, { x: rect[2], y: rect[3] }, { x: rect[2], y: base });
  }
  outline.push({ x: u1, y: base });
  const tops = [u1];
  if (toRoof && Math.abs(ds) > 1e-9) {
    const uR = (rf.ridgeS - s0) / ds;
    if (uR > u0 + 0.01 && uR < u1 - 0.01) tops.push(uR);
  }
  tops.push(u0);
  for (const u of tops) outline.push({ x: u, y: topAt(u) });
  return { u0, u1, outline, holes, doors, topAt };
}

// ---------------------------------------------------------------- deck, stairs, piers

export type DeckGeom = {
  rect: Rect;
  /** Unit vector pointing away from the house. */
  out: Vec;
  side: Side;
  stairs: null | {
    rect: Rect;
    risers: number;
    treads: number;
    riserHeight: number;
    tread: number;
    /** Where the stair run starts (deck edge) along `out`. */
    edge: number;
  };
};

export const TREAD = 11;

export function stairMath(totalRise: number) {
  const risers = Math.max(1, Math.ceil(totalRise / 7.5));
  const treads = risers - 1;
  return { risers, treads, riserHeight: totalRise / risers, run: treads * TREAD };
}

export type PlatformKind = 'deck' | 'porch';
type PlatformSpec = Design['deck'];

/** A deck or porch with its geometry and finish options. */
export type Platform = DeckGeom & {
  kind: PlatformKind;
  spec: PlatformSpec;
  /** Guard rails along the exposed edges. */
  railing: boolean;
  skirt: 'solid' | 'lattice' | 'none';
};

/** Every enabled platform: the deck and the porch. */
export function platforms(design: Design): Platform[] {
  const out: Platform[] = [];
  const deck = platformGeom(design, design.deck);
  if (deck) out.push({ ...deck, kind: 'deck', spec: design.deck, railing: true, skirt: 'none' });
  const porch = design.porch;
  const pg = porch && platformGeom(design, porch);
  if (porch && pg) out.push({ ...pg, kind: 'porch', spec: porch, railing: porch.railing, skirt: porch.skirt });
  return out;
}

export function deckGeom(design: Design): DeckGeom | null {
  return platformGeom(design, design.deck);
}

function platformGeom(design: Design, deck: PlatformSpec): DeckGeom | null {
  if (!deck.enabled) return null;
  const b = footprintBounds(design);
  const out = SIDE_NORMAL[deck.side];
  let rect: Rect;
  switch (deck.side) {
    case 'south':
      rect = { x0: b.x0 + deck.offset, x1: b.x0 + deck.offset + deck.width, y0: b.y1, y1: b.y1 + deck.depth };
      break;
    case 'north':
      rect = { x0: b.x0 + deck.offset, x1: b.x0 + deck.offset + deck.width, y0: b.y0 - deck.depth, y1: b.y0 };
      break;
    case 'east':
      rect = { x0: b.x1, x1: b.x1 + deck.depth, y0: b.y0 + deck.offset, y1: b.y0 + deck.offset + deck.width };
      break;
    case 'west':
      rect = { x0: b.x0 - deck.depth, x1: b.x0, y0: b.y0 + deck.offset, y1: b.y0 + deck.offset + deck.width };
      break;
  }
  let stairs: DeckGeom['stairs'] = null;
  if (deck.stairs.enabled) {
    const m = stairMath(design.levels.floorHeight);
    const along = deck.side === 'north' || deck.side === 'south';
    const c = (along ? rect.x0 : rect.y0) + deck.stairs.offset;
    const h = deck.stairs.width / 2;
    let sr: Rect;
    let edge: number;
    if (deck.side === 'south') {
      sr = { x0: c - h, x1: c + h, y0: rect.y1, y1: rect.y1 + m.run };
      edge = rect.y1;
    } else if (deck.side === 'north') {
      sr = { x0: c - h, x1: c + h, y0: rect.y0 - m.run, y1: rect.y0 };
      edge = rect.y0;
    } else if (deck.side === 'east') {
      sr = { x0: rect.x1, x1: rect.x1 + m.run, y0: c - h, y1: c + h };
      edge = rect.x1;
    } else {
      sr = { x0: rect.x0 - m.run, x1: rect.x0, y0: c - h, y1: c + h };
      edge = rect.x0;
    }
    stairs = { rect: sr, risers: m.risers, treads: m.treads, riserHeight: m.riserHeight, tread: TREAD, edge };
  }
  return { rect, out, side: deck.side, stairs };
}

/** Platform edges that are not against the house. */
export function skirtEdges(design: Design, p: DeckGeom): [Vec, Vec][] {
  const r = p.rect;
  const fb = footprintBounds(design);
  const edges: [Vec, Vec][] = [
    [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }],
    [{ x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }],
    [{ x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }],
    [{ x: r.x0, y: r.y1 }, { x: r.x0, y: r.y0 }],
  ];
  const overlap = (p0: number, p1: number, q0: number, q1: number) =>
    Math.min(Math.max(p0, p1), q1) - Math.max(Math.min(p0, p1), q0) > 1;
  // An edge against the house (on the footprint boundary and overlapping it) is not exposed.
  const fpEdge = (a: Vec, b: Vec) =>
    (Math.abs(a.y - b.y) < EPS &&
      (Math.abs(a.y - fb.y0) < EPS || Math.abs(a.y - fb.y1) < EPS) &&
      overlap(a.x, b.x, fb.x0, fb.x1)) ||
    (Math.abs(a.x - b.x) < EPS &&
      (Math.abs(a.x - fb.x0) < EPS || Math.abs(a.x - fb.x1) < EPS) &&
      overlap(a.y, b.y, fb.y0, fb.y1));
  return edges.filter(([a, b]) => !fpEdge(a, b));
}

/** Guard rail runs along a platform's exposed edges, split around the stair opening. */
export function platformRailings(design: Design, p: Platform): [Vec, Vec][] {
  if (!p.railing) return [];
  const out: [Vec, Vec][] = [];
  for (const [a, b] of skirtEdges(design, p)) {
    const s = p.stairs;
    if (s) {
      const horiz = Math.abs(a.y - b.y) < EPS;
      const onEdge = horiz ? Math.abs(a.y - s.edge) < EPS : Math.abs(a.x - s.edge) < EPS;
      if (onEdge) {
        const lo = horiz ? s.rect.x0 : s.rect.y0;
        const hi = horiz ? s.rect.x1 : s.rect.y1;
        const min = horiz ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
        const max = horiz ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
        const mk = (p: number, q: number): [Vec, Vec] =>
          horiz ? [{ x: p, y: a.y }, { x: q, y: a.y }] : [{ x: a.x, y: p }, { x: a.x, y: q }];
        if (lo - min > 1) out.push(mk(min, lo));
        if (max - hi > 1) out.push(mk(hi, max));
        continue;
      }
    }
    out.push([a, b]);
  }
  return out;
}

/** Platform surface height (relative to FF). */
export const PLATFORM_TOP = -1;

/**
 * Handrails on both sides of a platform's stairs: plan endpoints (top, bottom)
 * with heights 36" above the top and bottom nosings.
 */
export function stairHandrails(p: DeckGeom): { a: Vec; b: Vec; ha: number; hb: number }[] {
  const s = p.stairs;
  if (!s) return [];
  const horiz = Math.abs(p.out.y) > 0.5;
  const inset = 1.5;
  const run = s.treads * s.tread;
  const ha = PLATFORM_TOP + 36;
  const hb = PLATFORM_TOP - s.treads * s.riserHeight + 36;
  const sides = horiz ? [s.rect.x0 + inset, s.rect.x1 - inset] : [s.rect.y0 + inset, s.rect.y1 - inset];
  return sides.map((c) => {
    const a = horiz ? { x: c, y: s.edge } : { x: s.edge, y: c };
    return { a, b: add(a, mul(p.out, run)), ha, hb };
  });
}

/** Evenly divides a span into steps no longer than `maxSpacing`, including both ends. */
export function spaced(from: number, to: number, maxSpacing: number): number[] {
  const n = Math.max(1, Math.ceil((to - from) / maxSpacing - 1e-9));
  return Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n);
}

/** Beam lines (east-west) and pier locations for the house and deck. */
export function pierLayout(design: Design) {
  const { foundation: f } = design;
  const b = footprintBounds(design);
  const inset = f.pierSize / 2;
  // `deck` marks anything that isn't the house; `platform` says which platform.
  const beams: { a: Vec; b: Vec; deck: boolean; platform?: PlatformKind }[] = [];
  const piers: { p: Vec; deck: boolean; platform?: PlatformKind }[] = [];
  const xs = spaced(b.x0 + inset, b.x1 - inset, f.pierSpacing);
  for (const y of spaced(b.y0 + inset, b.y1 - inset, f.beamSpacing)) {
    beams.push({ a: { x: b.x0, y }, b: { x: b.x1, y }, deck: false });
    for (const x of xs) piers.push({ p: { x, y }, deck: false });
  }
  for (const dg of platforms(design)) {
    const r = dg.rect;
    const platform = dg.kind;
    const horizontal = dg.side === 'north' || dg.side === 'south';
    if (horizontal) {
      const y = dg.side === 'south' ? r.y1 - inset : r.y0 + inset;
      beams.push({ a: { x: r.x0, y }, b: { x: r.x1, y }, deck: true, platform });
      for (const x of spaced(r.x0 + inset, r.x1 - inset, f.pierSpacing)) piers.push({ p: { x, y }, deck: true, platform });
    } else {
      const x = dg.side === 'east' ? r.x1 - inset : r.x0 + inset;
      beams.push({ a: { x, y: r.y0 }, b: { x, y: r.y1 }, deck: true, platform });
      for (const y of spaced(r.y0 + inset, r.y1 - inset, f.pierSpacing)) piers.push({ p: { x, y }, deck: true, platform });
    }
  }
  return { beams, piers };
}

/** True when any wall's plan polygon overlaps the rectangle. */
export function wallsOverlapRect(design: Design, r: Rect): boolean {
  return design.walls.some((w) => rectsOverlap(bbox(wallPolygon(design, w)), r, 0.5));
}

// ---------------------------------------------------------------- garage entry

export type GarageEntry = {
  wall: Wall;
  opening: Opening;
  /** Unit vector from the shared wall into the garage. */
  into: Vec;
  /** Direction the steps run along the wall. */
  along: Vec;
  landing: Rect;
  /** Landing top, relative to the house FF. */
  landingTop: number;
  risers: number;
  treads: number;
  riserHeight: number;
  tread: number;
  width: number;
  /** Tread rectangles from the top down, with their top heights. */
  steps: { rect: Rect; top: number }[];
  /** Bounding rectangle of the whole stair run. */
  run: Rect;
};

/** Landing and steps inside the garage at the house entry door. */
export function garageEntry(design: Design): GarageEntry | null {
  const g = design.garage;
  const fp = garageFootprint(design);
  if (!g || !fp) return null;
  const opening = design.openings.find((o) => o.id === g.entry.openingId);
  const wall = opening && wallById(design, opening.wallId);
  if (!opening || !wall) return null;
  const c = openingCenter(wall, opening);
  let into = leftNormal(wallDir(wall));
  if (dot(into, sub(polygonCentroid(fp), c)) < 0) into = mul(into, -1);
  const along = SIDE_NORMAL[g.entry.stairs];
  const face = add(c, mul(into, wall.thickness / 2));
  const L = g.entry.landing;
  const halfWidth = Math.max(L, opening.width) / 2;
  const landing = bbox([add(face, mul(along, -halfWidth)), add(add(face, mul(along, halfWidth)), mul(into, L))]);
  const landingTop = 0;
  const m = stairMath(landingTop - g.floor);
  const start = add(face, mul(along, halfWidth));
  const W = g.entry.stairWidth;
  const steps = Array.from({ length: m.treads }, (_, k) => ({
    rect: bbox([add(start, mul(along, k * TREAD)), add(add(start, mul(along, (k + 1) * TREAD)), mul(into, W))]),
    top: landingTop - (k + 1) * m.riserHeight,
  }));
  const run = bbox([start, add(add(start, mul(along, m.run)), mul(into, W))]);
  return {
    wall, opening, into, along, landing, landingTop, width: W, steps, run,
    risers: m.risers, treads: m.treads, riserHeight: m.riserHeight, tread: TREAD,
  };
}

// ---------------------------------------------------------------- summary

export function designSummary(design: Design) {
  const fp = footprint(design);
  const gross = polygonArea(fp);
  const rooms = design.rooms.map((r) => ({ room: r, ...roomStats(design, r) }));
  const net = rooms.filter((r) => !r.room.zone).reduce((s, r) => s + r.area, 0);
  const gfp = garageFootprint(design);
  const gb = gfp ? bbox(gfp) : null;
  const area = (kind: PlatformKind) =>
    platforms(design)
      .filter((q) => q.kind === kind)
      .reduce((sum, q) => sum + (q.rect.x1 - q.rect.x0) * (q.rect.y1 - q.rect.y0), 0);
  const deckArea = area('deck');
  const porchArea = area('porch');
  const rf = roofFrame(design);
  const b = bbox(fp);
  return {
    gross,
    net,
    deckArea,
    porchArea,
    garageArea: gfp ? polygonArea(gfp) : 0,
    garageWidth: gb ? gb.x1 - gb.x0 : 0,
    garageDepth: gb ? gb.y1 - gb.y0 : 0,
    rooms,
    width: b.x1 - b.x0,
    depth: b.y1 - b.y0,
    plate: design.levels.wallHeight,
    ridge: rf.ridgeTop,
    ridgeAboveGrade: rf.ridgeTop + design.levels.floorHeight,
  };
}
