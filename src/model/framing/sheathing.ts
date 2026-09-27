import type { Design } from '../schema';
import { dot, footprintBounds, leftNormal, outwardNormal, wallDir, type Vec } from '../geometry';
import { floorFrameRect } from './floor';
import { floorLevels, roofFraming } from './levels';
import { layoutLines, type Plane } from './layout';
import { rafterLines, roofGroup, slopes } from './roof';
import { clipTo, polyArea, rect } from './solid';
import type { Panel, SheathingKind } from './types';
import type { WallInfo } from './walls';

type Hole = [number, number, number, number];

type Surface = {
  kind: SheathingKind;
  group: string;
  zone?: 'garage';
  plane: Plane;
  /** Convex outline of the surface in the plane. */
  region: Vec[];
  holes: Hole[];
  /** Framing centers along u that panel joints may land on. */
  joints: number[];
  /** Sheet size along u and along v. */
  du: number;
  dv: number;
  t: number;
  /** Shift the joints from one row to the next. */
  stagger: boolean;
  pricedOn: Panel['pricedOn'];
};

/** A rectangle less the holes that cross it, as smaller rectangles. */
function minusHoles(r: Hole, holes: Hole[]): Hole[] {
  const hit = holes.filter((h) => h[0] < r[2] && h[2] > r[0] && h[1] < r[3] && h[3] > r[1]);
  if (!hit.length) return [r];
  const clampTo = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  const xs = [...new Set([r[0], r[2], ...hit.flatMap((h) => [clampTo(h[0], r[0], r[2]), clampTo(h[2], r[0], r[2])])])].sort((a, b) => a - b);
  const ys = [...new Set([r[1], r[3], ...hit.flatMap((h) => [clampTo(h[1], r[1], r[3]), clampTo(h[3], r[1], r[3])])])].sort((a, b) => a - b);
  const out: Hole[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    // Join the open cells of each column into strips so the pieces stay few.
    let start: number | null = null;
    for (let j = 0; j + 1 <= ys.length - 1; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cy = (ys[j] + ys[j + 1]) / 2;
      const open = !hit.some((h) => cx > h[0] && cx < h[2] && cy > h[1] && cy < h[3]);
      if (open && start === null) start = ys[j];
      if (!open && start !== null) {
        out.push([xs[i], start, xs[i + 1], ys[j]]);
        start = null;
      }
    }
    if (start !== null) out.push([xs[i], start, xs[i + 1], ys[ys.length - 1]]);
  }
  return out;
}

/** Joint positions along u for one row: on framing, a sheet apart, with the end pieces as long as they can be. */
function rowJoints(u0: number, u1: number, du: number, joints: number[], avoid: number[] | null): number[] {
  const first = joints.filter((j) => j > u0 + 8 && j <= u0 + du + 1e-6);
  if (!first.length) {
    const out: number[] = [];
    for (let u = u0 + (avoid ? du / 2 : du); u < u1 - 1; u += du) out.push(u);
    return out;
  }
  const run = (j0: number) => {
    const out: number[] = [];
    for (let u = j0; u < u1 - 1e-6; u += du) out.push(u);
    return out;
  };
  const score = (list: number[]) => Math.min(list[0] - u0, u1 - list[list.length - 1]);
  const clear = (list: number[]) => !avoid || list.every((j) => avoid.every((a) => Math.abs(a - j) >= 24));
  const options = first.map(run).filter((l) => l.length);
  const usable = options.filter(clear);
  return (usable.length ? usable : options).sort((a, b) => score(b) - score(a))[0] ?? [];
}

function lay(s: Surface): Panel[] {
  const us = s.region.map((p) => p.x);
  const vs = s.region.map((p) => p.y);
  const u0 = Math.min(...us);
  const u1 = Math.max(...us);
  const v0 = Math.min(...vs);
  const v1 = Math.max(...vs);
  const out: Panel[] = [];
  let prev: number[] | null = null;
  for (let v = v0; v < v1 - 0.25; v += s.dv) {
    const joints = rowJoints(u0, u1, s.du, s.joints, s.stagger ? prev : null);
    prev = joints;
    const cols = [u0, ...joints, u1];
    for (let i = 0; i + 1 < cols.length; i++) {
      const cell: Hole = [cols[i], v, cols[i + 1], Math.min(v + s.dv, v1)];
      if (cell[2] - cell[0] < 0.25) continue;
      const parts = minusHoles(cell, s.holes)
        .map((r) => clipTo(rect(r[0], r[2], r[1], r[3]), s.region))
        .filter((p) => p.length >= 3 && polyArea(p) > 1);
      const area = parts.reduce((sum, p) => sum + polyArea(p), 0);
      if (area < 16) continue;
      out.push({
        kind: s.kind,
        group: s.group,
        zone: s.zone,
        ...s.plane,
        pieces: parts,
        t: s.t,
        area,
        coverage: area / (s.du * s.dv),
        pricedOn: s.pricedOn,
      });
    }
  }
  return out;
}

/** Wall, roof, and subfloor sheathing, sheet by sheet. */
export function sheathe(design: Design, walls: WallInfo[]): Panel[] {
  const f = design.framing;
  const out: Panel[] = [];
  const lv = floorLevels(design);

  // --- subfloor: sheets run across the joists
  const fr = floorFrameRect(design);
  const sub = f.floor.subfloor;
  out.push(
    ...lay({
      kind: 'subfloor',
      group: 'floor',
      plane: { o: { x: 0, y: 0, z: lv.joistTop + sub.thickness / 2 }, u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 1, z: 0 } },
      region: rect(fr.x0, fr.x1, fr.y0, fr.y1),
      holes: [],
      joints: layoutLines(fr.x0, fr.x1, footprintBounds(design).x0, f.floor.spacing).map(([a, b]) => (a + b) / 2),
      du: sub.length,
      dv: sub.width,
      t: sub.thickness,
      stagger: true,
      pricedOn: 'A-103',
    }),
  );

  // --- exterior walls: sheets stand on end, edges on the studs
  const ws = f.walls.sheathing;
  for (const wi of walls) {
    if (!wi.exterior) continue;
    const w = wi.wall;
    const d = wallDir(w);
    const n = leftNormal(d);
    const thick = Math.max(ws.thickness, w.thickness - wi.depth);
    const outSign = Math.sign(dot(outwardNormal(design, w), n)) || 1;
    const off = outSign * (w.thickness / 2 - thick / 2);
    const bottom = w.zone ? wi.base : wi.base + lv.joistBottom;
    const r = roofFraming(design, w.zone);
    const top = (u: number) => (wi.gable === 'none' || !r ? wi.plate : wi.under(u) + r.tv);
    const region: Vec[] = [
      { x: wi.s0, y: bottom },
      { x: wi.s1, y: bottom },
      { x: wi.s1, y: top(wi.s1) },
      ...(wi.ridgeU !== null ? [{ x: wi.ridgeU, y: top(wi.ridgeU) }] : []),
      { x: wi.s0, y: top(wi.s0) },
    ];
    const joints: number[] = [];
    for (let c = wi.origin + wi.layoutDir * wi.spacing; c > wi.s0 && c < wi.s1; c += wi.layoutDir * wi.spacing) joints.push(c);
    out.push(
      ...lay({
        kind: 'wall',
        group: w.id,
        zone: w.zone,
        plane: { o: { x: w.start.x + n.x * off, y: w.start.y + n.y * off, z: 0 }, u: { x: d.x, y: d.y, z: 0 }, v: { x: 0, y: 0, z: 1 } },
        region,
        holes: wi.openings.map((o) => [o.u0, wi.base + o.sill, o.u1, wi.base + o.head] as Hole),
        joints: joints.sort((a, b) => a - b),
        du: ws.width,
        dv: ws.length,
        t: thick,
        stagger: false,
        pricedOn: 'S-602',
      }),
    );
  }

  // --- roofs: sheets run across the rafters, from the eave to the ridge
  const rs = f.roof.sheathing;
  for (const zone of [undefined, 'garage'] as const) {
    const r = roofFraming(design, zone);
    const lines = rafterLines(design, zone);
    if (!r || !lines) continue;
    const { rf } = r;
    const centers = [...lines.lines, ...lines.fly].map(([a, b]) => (a + b) / 2).sort((a, b) => a - b);
    for (const sl of slopes(design, r)) {
      const qEave = sl.free ? -sl.overhang : 0;
      const length = ((rf.sMax - rf.sMin) / 2 - qEave) / r.cos;
      const eave = rf.toPlan(sl.s(qEave), 0);
      const zero = rf.toPlan(0, 0);
      const along = rf.toPlan(0, 1);
      const inward = rf.toPlan(sl.dir, 0);
      const ix = inward.x - zero.x;
      const iy = inward.y - zero.y;
      const lift = rs.thickness / 2;
      out.push(
        ...lay({
          kind: 'roof',
          group: roofGroup(zone),
          zone,
          plane: {
            o: { x: eave.x - ix * rf.slope * r.cos * lift, y: eave.y - iy * rf.slope * r.cos * lift, z: sl.top(qEave) + r.cos * lift },
            u: { x: along.x - zero.x, y: along.y - zero.y, z: 0 },
            v: { x: ix * r.cos, y: iy * r.cos, z: rf.slope * r.cos },
          },
          region: rect(rf.a0, rf.a1, 0, length),
          holes: [],
          joints: centers,
          du: rs.length,
          dv: rs.width,
          t: rs.thickness,
          stagger: true,
          pricedOn: 'S-602',
        }),
      );
    }
  }
  return out;
}

/** Sheets to buy for a set of panels: pieces up to half a sheet pair up from one sheet. */
export function sheetCount(panels: Panel[]): number {
  return Math.ceil(panels.reduce((s, p) => s + (p.coverage > 0.5 ? 1 : 0.5), 0) - 1e-9);
}
