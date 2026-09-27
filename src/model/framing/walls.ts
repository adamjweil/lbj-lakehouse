import type { Design, Wall } from '../schema';
import {
  dist, dot, frameFor, leftNormal, outwardNormal, sub, wallDir, wallEndCondition, wallLength, wallReachesRoof, wallTees,
  zoneFloor, zonePlate, type Vec, type WallEndCondition,
} from '../geometry';
import { formatPitch } from '../units';
import { isBearingWall } from './bearing';
import { DRESSED, type Material } from './lumber';
import { roofFraming } from './levels';
import { roughOpening } from './openings';
import { pieces, splitRun } from './layout';
import { rect } from './solid';
import type { MemberDraft, P3, Role, RoughOpening, WallFrame } from './types';

/** Thickness of 2x lumber. */
const B = 1.5;
/** Shortest plate or block worth cutting. */
const MIN_PIECE = 1;

export type WallInfo = Omit<WallFrame, 'members'> & {
  /** Offset of the framing centerline from the wall centerline, along the wall's left normal. */
  side: number;
  /** Half the width of the ridge beam over the wall, and the underside of that beam. */
  ridgeHalf: number;
  ridgeBottom: number;
  slope: number;
};

const studOf = (design: Design, w: Wall) => (w.type === 'exterior' ? design.framing.walls.exterior : design.framing.walls.interior);
const depthOf = (design: Design, w: Wall) => DRESSED[studOf(design, w).stud].d;
/** Sheathing or wallboard outside the studs at a wall's faces. */
const finishOf = (design: Design, w: Wall) => {
  const extra = Math.max(0, w.thickness - depthOf(design, w));
  return w.type === 'exterior' ? { outer: extra, inner: 0 } : { outer: extra / 2, inner: extra / 2 };
};

/** Gable walls are balloon framed: the studs run from the floor to the rake. */
const gableType = (design: Design, w: Wall): WallFrame['gable'] => (wallReachesRoof(design, w) ? 'balloon' : 'none');

export function wallInfo(design: Design, w: Wall): WallInfo {
  const { stud, spacing } = studOf(design, w);
  const depth = DRESSED[stud].d;
  const L = wallLength(w);
  const n = leftNormal(wallDir(w));
  const exterior = w.type === 'exterior';
  const outSign = exterior ? Math.sign(dot(outwardNormal(design, w), n)) || 1 : 0;
  const ends: [WallEndCondition, WallEndCondition] = [wallEndCondition(design, w, 0), wallEndCondition(design, w, 1)];

  /** How far the framing runs past the wall's end point. */
  const frameExt = (c: WallEndCondition) => {
    if (c.kind === 'corner' && c.through) return c.other.thickness / 2 - finishOf(design, c.other).outer;
    if (c.kind === 'corner' || c.kind === 'tee') return -c.other.thickness / 2 + finishOf(design, c.other).inner;
    return 0;
  };
  const sheathExt = (c: WallEndCondition) => {
    if (c.kind !== 'corner' || c.other.type !== 'exterior') return frameExt(c);
    return c.through ? c.other.thickness / 2 : c.other.thickness / 2 - finishOf(design, c.other).outer;
  };
  const cornerExt = (c: WallEndCondition) => (exterior && c.kind === 'corner' && c.other.type === 'exterior' ? c.other.thickness / 2 : frameExt(c));

  const f0 = -frameExt(ends[0]);
  const f1 = L + frameExt(ends[1]);
  const layoutDir = w.layoutFrom === 'end' ? -1 : 1;
  const origin = layoutDir === 1 ? -cornerExt(ends[0]) : L + cornerExt(ends[1]);

  const base = zoneFloor(design, w.zone);
  const plate = base + (w.height ?? zonePlate(design, w.zone));
  const gable = gableType(design, w);
  const rf = frameFor(design, w);
  const s0 = rf.sOf(w.start);
  const ds = rf.sOf(wallDir(w));
  const under = (u: number) => rf.undersideAt(s0 + u * ds);
  const rfr = roofFraming(design, w.zone);
  let ridgeU: number | null = null;
  if (gable !== 'none' && Math.abs(ds) > 1e-9) {
    const u = (rf.ridgeS - s0) / ds;
    if (u > f0 + B && u < f1 - B) ridgeU = u;
  }
  return {
    wall: w,
    zone: w.zone,
    base,
    plate,
    f0,
    f1,
    s0: -sheathExt(ends[0]),
    s1: L + sheathExt(ends[1]),
    stud,
    depth,
    spacing,
    origin,
    layoutDir,
    ends,
    gable,
    bearing: isBearingWall(design, w),
    exterior,
    topAt: (u: number) => (gable === 'none' ? plate : Math.max(plate, under(u))),
    ridgeU,
    tees: wallTees(design, w),
    openings: [],
    side: (-outSign * (w.thickness - depth)) / 2,
    under,
    tvOf: B * Math.hypot(1, rf.slope),
    ridgeHalf: rfr?.half ?? 0,
    ridgeBottom: rfr?.ridgeBottom ?? plate,
    slope: rf.slope,
  };
}

type Vertical = { a: number; b: number; z0: number; z1: number; role: Role };

/** Every piece of one wall. `all` gives the framing of the walls it meets. */
export function frameWall(design: Design, wi: WallInfo, all: Map<string, WallInfo>): { openings: RoughOpening[]; drafts: MemberDraft[] } {
  const f = design.framing;
  const w = wi.wall;
  const { f0, f1, base, plate, depth: D } = wi;
  const d = wallDir(w);
  const n = leftNormal(d);
  const maxStock = Math.max(...f.lumber.stockLengths);
  const out: MemberDraft[] = [];
  const pitch = formatPitch(wi.slope * 12);

  const at = (across: number): P3 => ({ x: w.start.x + n.x * (wi.side + across), y: w.start.y + n.y * (wi.side + across), z: 0 });
  const piece = (
    role: Role,
    profile: Vec[],
    length: number,
    o: { size?: string; material?: Material; t?: number; across?: number; cut?: string; note?: string; b?: number; d?: number } = {},
  ) => {
    const size = o.size ?? wi.stud;
    const dressed = DRESSED[size as keyof typeof DRESSED];
    out.push({
      system: 'wall',
      group: w.id,
      zone: w.zone,
      role,
      size,
      material: o.material ?? 'SYP',
      b: o.b ?? dressed?.b ?? B,
      d: o.d ?? dressed?.d ?? D,
      length,
      cut: o.cut ?? 'Square',
      o: at(o.across ?? 0),
      u: { x: d.x, y: d.y, z: 0 },
      v: { x: 0, y: 0, z: 1 },
      profile,
      t: o.t ?? D,
      pricedOn: 'S-602',
      note: o.note,
    });
  };

  const balloon = wi.gable === 'balloon';
  const nTop = f.walls.topPlates;
  const zb = base + B;
  /** Underside of the top plates above a point along the wall. */
  const studTop = (u: number) => (balloon ? wi.under(u) - nTop * wi.tvOf : plate - nTop * B);
  const bevelCut = `Square bottom; top beveled to the ${pitch} rake`;

  const verts: Vertical[] = [];
  const clash = (a: number, b: number, z0 = -Infinity, z1 = Infinity) =>
    verts.some((q) => a < q.b - 0.01 && b > q.a + 0.01 && z0 < q.z1 - 0.01 && z1 > q.z0 + 0.01);
  /** A plumb piece between u = a and b, from z0 up to `top` (a level, or the rake when omitted). */
  const vertical = (role: Role, a: number, b: number, z0: number, top?: number, o: Parameters<typeof piece>[3] = {}) => {
    const ta = top ?? studTop(a);
    const tb = top ?? studTop(b);
    if (Math.max(ta, tb) - z0 < MIN_PIECE) return;
    const beveled = top === undefined && balloon && Math.abs(ta - tb) > 1e-6;
    piece(role, [{ x: a, y: z0 }, { x: b, y: z0 }, { x: b, y: tb }, { x: a, y: ta }], Math.max(ta, tb) - z0, {
      cut: beveled ? bevelCut : 'Square',
      ...o,
    });
    verts.push({ a, b, z0, z1: Math.min(ta, tb), role });
  };

  // --- rough openings inside the framing
  const ros = design.openings
    .filter((o) => o.wallId === w.id)
    .map((o) => roughOpening(design, o, w))
    .filter((r) => r.u1 > f0 && r.u0 < f1)
    .sort((p, q) => p.u0 - q.u0);
  const headerRange = (r: RoughOpening): [number, number] => [r.u0 - r.jacks * B, r.u1 + r.jacks * B];
  const headerTop = (r: RoughOpening) => base + r.head + r.header.d;

  // --- ends and corners
  for (const end of [0, 1] as const) {
    const c = wi.ends[end];
    const a = end === 0 ? f0 : f1 - B;
    vertical('end-stud', a, a + B, zb, undefined, c.kind === 'structure' ? { note: `Fasten to the ${c.other.id} wall framing` } : {});
    if (c.kind === 'corner' && c.through) {
      // California corner: a stud laid flat against the inside face backs the wallboard and leaves the corner open to insulate.
      const p = end === 0 ? w.start : w.end;
      const far = dist(c.other.start, p) > dist(c.other.end, p) ? c.other.start : c.other.end;
      const toward = Math.sign(dot(sub(far, p), n)) || 1;
      const na = end === 0 ? f0 + B : f1 - B - D;
      const ta = studTop(na);
      const tb = studTop(na + D);
      piece('corner-nailer', [{ x: na, y: zb }, { x: na + D, y: zb }, { x: na + D, y: tb }, { x: na, y: ta }], Math.max(ta, tb) - zb, {
        t: B,
        across: toward * (D / 2 - B / 2),
        cut: balloon && Math.abs(ta - tb) > 1e-6 ? bevelCut : 'Square',
        note: 'Laid flat at the inside corner',
      });
      verts.push({ a: na, b: na + D, z0: zb, z1: Math.min(ta, tb), role: 'corner-nailer' });
    }
  }

  // --- ridge posts
  const postPlies = f.roof.ridgePostPlies;
  const postRange: [number, number] | null = wi.ridgeU === null ? null : [wi.ridgeU - (postPlies * B) / 2, wi.ridgeU + (postPlies * B) / 2];
  if (postRange) {
    const under = ros.find((r) => headerRange(r)[0] < postRange[1] && headerRange(r)[1] > postRange[0]);
    const note = under
      ? `Ridge post bears on the ${under.opening.tag} header; by engineer`
      : 'Built-up ridge post; by engineer';
    for (let i = 0; i < postPlies; i++) {
      const a = postRange[0] + i * B;
      vertical('post', a, a + B, under ? headerTop(under) : zb, wi.ridgeBottom, { note });
    }
  }

  // --- kings and jacks
  for (const r of ros) {
    const [h0, h1] = headerRange(r);
    for (const [a, b] of [[h0 - B, h0], [h1, h1 + B]]) {
      if (!clash(a, b)) vertical('king', a, b, zb);
    }
    for (let i = 0; i < r.jacks; i++) {
      vertical('jack', r.u0 - (i + 1) * B, r.u0 - i * B, zb, base + r.head);
      vertical('jack', r.u1 + i * B, r.u1 + (i + 1) * B, zb, base + r.head);
    }
  }

  // --- layout studs and cripples
  const centers: number[] = [];
  for (let k = 1; k < 1000; k++) {
    const c = wi.origin + wi.layoutDir * wi.spacing * k;
    if (c - B / 2 < f0 - 1e-6 || c + B / 2 > f1 + 1e-6) {
      if (wi.layoutDir === 1 ? c > f1 : c < f0) break;
      continue;
    }
    centers.push(c);
  }
  for (const c of centers) {
    const a = c - B / 2;
    const b = c + B / 2;
    const r = ros.find((q) => a < headerRange(q)[1] && b > headerRange(q)[0]);
    if (!r) {
      if (!clash(a, b)) vertical('stud', a, b, zb);
      continue;
    }
    const [h0, h1] = headerRange(r);
    if (a < h0 - 1e-6 || b > h1 + 1e-6) continue;
    if (!clash(a, b, headerTop(r), Infinity)) vertical('cripple', a, b, headerTop(r), undefined, { note: `Above the ${r.opening.tag} header` });
    if (r.sill > 0.5 && a >= r.u0 + B - 1e-6 && b <= r.u1 - B + 1e-6) {
      vertical('cripple', a, b, zb, base + r.sill - B, { note: `Below the ${r.opening.tag} sill` });
    }
  }

  // --- headers, sills, and the cripples under each end of a sill
  for (const r of ros) {
    const [h0, h1] = headerRange(r);
    const h = r.header;
    const note = `${r.opening.tag} header${h.byEngineer ? '; size by engineer' : ''}`;
    if (h.kind === 'flat') {
      piece('header', rect(h0, h1, base + r.head, base + r.head + h.d), h.length, { size: h.size, b: B, d: D, note });
    } else {
      // Plies go to the faces of the wall; any space between them is filled with insulation or a spacer.
      for (let i = 0; i < h.plies; i++) {
        const span = D - h.b;
        const across = h.plies === 1 ? 0 : -span / 2 + (span * i) / (h.plies - 1);
        piece('header', rect(h0, h1, base + r.head, base + r.head + h.d), h.length, {
          size: h.size, material: h.material, t: h.b, across, b: h.b, d: h.d, note,
        });
      }
    }
    if (r.sill > 0.5) {
      piece('sill', rect(r.u0, r.u1, base + r.sill - B, base + r.sill), r.w, { note: `${r.opening.tag} rough sill` });
      for (const a of [r.u0, r.u1 - B]) {
        vertical('cripple', a, a + B, zb, base + r.sill - B, { note: `Below the ${r.opening.tag} sill` });
      }
    }
  }

  // Plate splices land on the pieces that reach the plate.
  const centersOf = (list: Vertical[]) => list.map((q) => (q.a + q.b) / 2).sort((p, q) => p - q);
  const underTop = centersOf(verts.filter((q) => q.z1 >= studTop(q.a) - 0.01 && q.b - q.a < B + 0.01));
  const onBottom = centersOf(verts.filter((q) => q.z0 <= zb + 0.01 && q.b - q.a < B + 0.01));

  // --- bottom plates, cut out at the doors
  const plateMaterial: Material = w.zone === 'garage' ? 'PT' : 'SYP';
  let run = f0;
  const doors = ros.filter((r) => r.sill <= 0.5);
  for (const r of [...doors, null]) {
    const end = r ? r.u0 : f1;
    if (end - run > MIN_PIECE) {
      for (const [a, b] of pieces(run, end, splitRun(run, end, maxStock, onBottom))) {
        piece('bottom-plate', rect(a, b, base, base + B), b - a, {
          material: plateMaterial,
          note: plateMaterial === 'PT' ? 'On the slab, with anchor bolts' : undefined,
        });
      }
    }
    if (r) run = r.u1;
  }

  // --- top plates
  const flat = (o: Wall) => {
    const q = all.get(o.id);
    return !!q && q.gable !== 'balloon' && Math.abs(q.plate - plate) < 0.01;
  };
  if (!balloon) {
    const topZ = plate - nTop * B;
    const topCuts = splitRun(f0, f1, maxStock, underTop);
    for (const [a, b] of pieces(f0, f1, topCuts)) piece('top-plate', rect(a, b, topZ, topZ + B), b - a);
    if (nTop > 1) {
      // The cap plate laps over the walls this one meets, and gives way where they lap over it.
      const lap = (c: WallEndCondition) => {
        if ((c.kind !== 'corner' && c.kind !== 'tee') || !flat(c.other)) return 0;
        const od = all.get(c.other.id)!.depth;
        return c.kind === 'corner' && c.through ? -od : od;
      };
      const c0 = f0 - lap(wi.ends[0]);
      const c1 = f1 + lap(wi.ends[1]);
      const gaps = wi.tees
        .filter((t) => !t.face && flat(t.wall))
        .map((t) => [t.u - all.get(t.wall.id)!.depth / 2, t.u + all.get(t.wall.id)!.depth / 2] as [number, number]);
      let start = c0;
      for (const g of [...gaps, null]) {
        const end = g ? g[0] : c1;
        if (end - start > MIN_PIECE) {
          for (const [a, b] of pieces(start, end, splitRun(start, end, maxStock, underTop, topCuts))) {
            piece('cap-plate', rect(a, b, plate - B, plate), b - a);
          }
        }
        if (g) start = g[1];
      }
    }
  }

  // --- rake plates
  const rakeRuns: [number, number][] = wi.ridgeU === null ? [[f0, f1]] : [[f0, wi.ridgeU - wi.ridgeHalf], [wi.ridgeU + wi.ridgeHalf, f1]];
  const cos = 1 / Math.hypot(1, wi.slope);
  const rakePlate = (a: number, b: number, layer: number) => {
    const top = (u: number) => wi.under(u) - layer * wi.tvOf;
    const profile: Vec[] = [
      { x: a, y: top(a) - wi.tvOf },
      { x: b, y: top(b) - wi.tvOf },
      { x: b, y: top(b) },
      { x: a, y: top(a) },
    ];
    piece('rake-plate', profile, (b - a) / cos + B * wi.slope, { cut: `Plumb cut both ends, ${pitch}`, note: 'Follows the underside of the rafters' });
  };
  if (balloon) {
    for (const [a, b] of rakeRuns) {
      if (b - a < MIN_PIECE) continue;
      const count = Math.max(1, Math.ceil(((b - a) / cos + B * wi.slope) / maxStock - 1e-9));
      for (let i = 0; i < count; i++) {
        for (let k = 0; k < nTop; k++) rakePlate(a + ((b - a) * i) / count, a + ((b - a) * (i + 1)) / count, k);
      }
    }
  }

  // --- blocking between studs
  const voidAt = (u: number, z0: number, z1: number) =>
    ros.some((r) => u > r.u0 - r.jacks * B && u < r.u1 + r.jacks * B && z0 < headerTop(r) && z1 > base + r.sill - (r.sill > 0.5 ? B : 0));
  /** Clear bays at a height, between the plumb pieces that pass through it. */
  const bays = (z0: number, z1: number): [number, number][] => {
    const through = verts.filter((q) => q.z0 <= z0 + 0.01 && q.z1 >= z1 - 0.01).sort((p, q) => p.a - q.a);
    const res: [number, number][] = [];
    let edge = -Infinity;
    for (const q of through) {
      if (edge > -Infinity && q.a - edge > MIN_PIECE && !voidAt((edge + q.a) / 2, z0, z1)) res.push([edge, q.a]);
      edge = Math.max(edge, q.b);
    }
    return res;
  };

  const backing = f.walls.backing;
  const bd = DRESSED[backing.size];
  for (const t of wi.tees) {
    const other = all.get(t.wall.id);
    if (!other) continue;
    const far = Math.abs(dot(sub(t.wall.start, w.start), n)) > Math.abs(dot(sub(t.wall.end, w.start), n)) ? t.wall.start : t.wall.end;
    const toward = Math.sign(dot(sub(far, w.start), n)) || 1;
    const lo = t.u - other.depth / 2 - 1;
    const hi = t.u + other.depth / 2 + 1;
    for (let z = zb + backing.spacing; z + bd.d / 2 <= studTop(t.u) - 1; z += backing.spacing) {
      for (const [a, b] of bays(z - bd.d / 2, z + bd.d / 2)) {
        if (b <= lo || a >= hi || b - a > wi.spacing + 2) continue;
        piece('backing', rect(a, b, z - bd.d / 2, z + bd.d / 2), b - a, {
          size: backing.size,
          t: bd.b,
          across: toward * (D / 2 - bd.b / 2),
          note: `Ladder blocking for wall ${t.wall.id}`,
        });
      }
    }
  }

  // Balloon-framed walls get fire blocking at the ceiling line, which also keeps tall studs within 10 ft between blocks.
  if (balloon) {
    const z1 = base + zonePlate(design, w.zone);
    for (const [a, b] of bays(z1 - B, z1)) {
      if (b - a > wi.spacing + 2 || studTop((a + b) / 2) - z1 < 3) continue;
      piece('fireblock', rect(a, b, z1 - B, z1), b - a, { note: 'Fire blocking at the plate line' });
    }
  }

  return { openings: ros, drafts: out };
}

/** The framing of every wall. */
export function frameWalls(design: Design): { info: WallInfo; openings: RoughOpening[]; drafts: MemberDraft[] }[] {
  const infos = design.walls.filter((w) => wallLength(w) > 1).map((w) => wallInfo(design, w));
  const all = new Map(infos.map((i) => [i.wall.id, i]));
  return infos.map((info) => ({ info, ...frameWall(design, info, all) }));
}
