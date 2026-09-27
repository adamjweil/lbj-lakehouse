import type { Design, Opening, Wall, Zone } from '../schema';
import { bbox, garageFootprint, garageHouseSide, garageRoofFrame, roomOpenings, wallFace, type Vec } from '../geometry';
import { frameModel, type WallFrame } from '../framing';
import { floorLevels, roofFraming } from '../framing/levels';
import { clipPolygon, clipTo, polyArea } from '../framing/solid';

/** The outside of one exterior wall, measured for siding, weather barrier, and insulation. Areas are in square inches. */
export type WallFaceArea = {
  wall: Wall;
  zone?: Zone;
  side: string;
  /** Outline in the wall's plane: distance along the wall, and height above the house finished floor. */
  outline: Vec[];
  gross: number;
  /** Hidden inside an attached building, such as the house wall inside the garage. */
  covered: number;
  openings: { opening: Opening; area: number; exposed: boolean }[];
  /** Exposed wall, less its openings: what the siding covers. */
  net: number;
  /** Exposed wall with its openings: what the weather barrier covers. */
  exposed: number;
  /** Length of the wall's base that is exposed. */
  base: number;
  /** Wall inside the heated space, less its openings: what the wall insulation fills. */
  insulated: number;
  /** Bottom of the siding above grade. */
  clearance: number;
};

const SIDES = { north: 'south', south: 'north', east: 'west', west: 'east' } as const;

/** The part of a house wall that an attached garage hides, as a polygon in the wall's plane. */
function hiddenByGarage(design: Design, w: WallFrame): Vec[] | null {
  const side = garageHouseSide(design);
  const gfp = garageFootprint(design);
  const gr = roofFraming(design, 'garage');
  const rf = garageRoofFrame(design);
  if (!side || !gfp || !gr || !rf || w.zone || wallFace(design, w.wall) !== SIDES[side]) return null;
  const g = bbox(gfp);
  const axis: 'x' | 'y' = side === 'east' || side === 'west' ? 'y' : 'x';
  const start = w.wall.start[axis];
  const dir = Math.sign(w.wall.end[axis] - start) || 1;
  const uOf = (c: number) => (c - start) * dir;
  const lo = axis === 'y' ? g.y0 : g.x0;
  const hi = axis === 'y' ? g.y1 : g.x1;
  const bottom = (design.garage?.floor ?? 0) - 12;
  // A gable end against the wall hides it up to the roof line; an eave hides it to the eave.
  const gable = rf.axis !== axis;
  const face = side === 'east' ? g.x1 : side === 'west' ? g.x0 : side === 'south' ? g.y1 : g.y0;
  const top = (c: number) => (gable ? rf.undersideAt(c) : rf.undersideAt(face)) + gr.tv;
  const pts = gable && rf.ridgeS > lo && rf.ridgeS < hi ? [lo, rf.ridgeS, hi] : [lo, hi];
  const poly = [{ x: uOf(lo), y: bottom }, { x: uOf(hi), y: bottom }, ...[...pts].reverse().map((c) => ({ x: uOf(c), y: top(c) }))];
  return poly;
}

/** Every exterior wall face of the house and the garage. */
export function wallFaces(design: Design): WallFaceArea[] {
  const lv = floorLevels(design);
  const grade = -design.levels.floorHeight;
  const out: WallFaceArea[] = [];
  for (const w of frameModel(design).walls) {
    if (!w.exterior) continue;
    const r = roofFraming(design, w.zone);
    const bottom = w.zone ? w.base : w.base + lv.joistBottom;
    const top = (u: number) => (w.gable === 'none' || !r ? w.plate : w.under(u));
    const outline: Vec[] = [
      { x: w.s0, y: bottom },
      { x: w.s1, y: bottom },
      { x: w.s1, y: top(w.s1) },
      ...(w.ridgeU !== null ? [{ x: w.ridgeU, y: top(w.ridgeU) }] : []),
      { x: w.s0, y: top(w.s0) },
    ];
    const gross = polyArea(outline);
    const hidden = hiddenByGarage(design, w);
    const part = hidden ? clipTo(outline, hidden) : [];
    const covered = part.length > 2 ? polyArea(part) : 0;
    const inside = (p: Vec) => !!hidden && clipTo([{ x: p.x - 0.5, y: p.y - 0.5 }, { x: p.x + 0.5, y: p.y - 0.5 }, { x: p.x + 0.5, y: p.y + 0.5 }, { x: p.x - 0.5, y: p.y + 0.5 }], hidden).length > 2;
    const openings = w.openings.map((o) => ({
      opening: o.opening,
      area: o.w * o.h,
      exposed: !inside({ x: (o.u0 + o.u1) / 2, y: w.base + (o.sill + o.head) / 2 }),
    }));
    const open = (all: boolean) => openings.filter((o) => all || o.exposed).reduce((s, o) => s + o.area, 0);
    // Where the garage hides the wall from end to end, none of its base shows.
    const us = part.map((p) => p.x);
    const hiddenBase = part.length > 2 ? Math.max(...us) - Math.min(...us) : 0;

    // The heated space stops at the ceiling where the rooms along the wall have flat ceilings.
    let insulated = 0;
    if (!w.zone) {
      const rooms = design.rooms.filter((q) => !q.zone && roomOpenings(design, q).length >= 0 && touches(q.polygon, w.wall));
      const vaulted = rooms.some((q) => q.ceiling === 'vaulted');
      let heated = clipPolygon(outline, 0, -1, -w.base);
      if (!vaulted) heated = clipPolygon(heated, 0, 1, w.plate);
      insulated = Math.max(0, polyArea(heated) - open(true));
    }
    out.push({
      wall: w.wall,
      zone: w.zone,
      side: wallFace(design, w.wall) ?? '',
      outline,
      gross,
      covered,
      openings,
      exposed: gross - covered,
      net: Math.max(0, gross - covered - open(false)),
      base: Math.max(0, w.s1 - w.s0 - hiddenBase),
      insulated,
      clearance: bottom - grade,
    });
  }
  return out;
}

/** True when a room has an edge along the wall's centerline. */
function touches(polygon: Vec[], w: Wall): boolean {
  const horizontal = Math.abs(w.end.y - w.start.y) < 0.5;
  return polygon.some((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    if (horizontal) return Math.abs(a.y - w.start.y) < 0.5 && Math.abs(b.y - w.start.y) < 0.5 && Math.abs(a.x - b.x) > 1;
    return Math.abs(a.x - w.start.x) < 0.5 && Math.abs(b.x - w.start.x) < 0.5 && Math.abs(a.y - b.y) > 1;
  });
}
