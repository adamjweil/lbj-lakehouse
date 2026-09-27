import type { Design, LumberSize, Wall, Zone } from '../schema';
import { bbox, garageRoofFrame, roofFrame, wallDir, wallLength, zoneFloor, zonePlate, type Rect } from '../geometry';
import { DRESSED } from './lumber';
import { spanLimit } from './spans';

/**
 * The flat ceiling over one zone. Its joists run with the rafters, so each pair ties
 * the rafter feet together and clears the roof at the eaves. They bear on the eave
 * walls and on the interior walls that cross them; where that span is too long, a
 * flush beam under the ridge carries them at mid-span.
 */
export type CeilingZone = {
  zone?: Zone;
  group: string;
  title: string;
  /** Plan bounds of the flat-ceiling rooms, on the wall centerlines. */
  bounds: Rect;
  /** Underside of the joists, above the house finished floor. */
  height: number;
  /** The plan axis the joists run along. */
  axis: 'x' | 'y';
  /** Interior walls the joists bear on between their ends. */
  supports: Wall[];
  /** Position along `axis` of a flush beam that carries the joists, when the walls alone leave too long a span. */
  beamAt: number | null;
  joist: LumberSize;
  spacing: number;
  /** Longest span between supports, centerline to centerline. */
  maxSpan: number;
  /** Longest clear span, between the faces of the supports. */
  clearSpan: number;
};

const lvlOf = (design: Design, zone: Zone | undefined) => (zone === 'garage' ? design.framing.garage.ridge : design.framing.roof.ridge);

const runsAlong = (w: Wall, axis: 'x' | 'y') => Math.abs(axis === 'x' ? wallDir(w).x : wallDir(w).y) > 1 - 1e-6;

/** Flat-ceiling zones of the house and the garage. */
export function ceilingZones(design: Design): CeilingZone[] {
  const out: CeilingZone[] = [];
  for (const zone of [undefined, 'garage'] as const) {
    const rooms = design.rooms.filter((r) => r.zone === zone && r.ceiling === 'flat');
    const rf = zone === 'garage' ? garageRoofFrame(design) : roofFrame(design);
    if (!rooms.length || !rf) continue;
    const bounds = bbox(rooms.flatMap((r) => r.polygon));
    const joist = zone === 'garage' ? design.framing.garage.ceilingJoist : design.framing.ceiling.joist;
    const spacing = design.framing.ceiling.spacing;
    const height = zoneFloor(design, zone) + Math.max(...rooms.map((r) => r.ceilingHeight ?? zonePlate(design, zone)));
    const axis: 'x' | 'y' = rf.axis === 'x' ? 'y' : 'x';
    const cross = rf.axis;
    const lo = axis === 'x' ? bounds.x0 : bounds.y0;
    const hi = axis === 'x' ? bounds.x1 : bounds.y1;
    const c0 = cross === 'x' ? bounds.x0 : bounds.y0;
    const c1 = cross === 'x' ? bounds.x1 : bounds.y1;
    // A wall carries the joists when it crosses them and runs the full width of the ceiling.
    const supports = design.walls
      .filter((w) => {
        if (w.zone !== zone || w.type !== 'interior' || w.bearing === false || !runsAlong(w, cross) || wallLength(w) < 1) return false;
        const at = w.start[axis];
        if (at <= lo + 1 || at >= hi - 1) return false;
        return Math.min(w.start[cross], w.end[cross]) <= c0 + 1 && Math.max(w.start[cross], w.end[cross]) >= c1 - 1;
      })
      .sort((p, q) => p.start[axis] - q.start[axis]);
    const spans = (lines: number[]) => Math.max(...lines.slice(1).map((v, i) => v - lines[i]));
    let lines = [lo, ...supports.map((w) => w.start[axis]), hi];
    const limit = spanLimit('ceilingJoist', joist, spacing) ?? Infinity;
    let beamAt: number | null = null;
    if (!supports.length && spans(lines) > limit && rf.ridgeS > lo + 1 && rf.ridgeS < hi - 1) {
      beamAt = rf.ridgeS;
      lines = [lo, beamAt, hi];
    }
    // Half the width of what carries the joists at each line: a wall's studs, or the flush beam.
    const studs = (w: Wall) => DRESSED[(w.type === 'exterior' ? design.framing.walls.exterior : design.framing.walls.interior).stud].d;
    const half = (at: number) => {
      if (at === beamAt) return (lvlOf(design, zone).plies * lvlOf(design, zone).thickness) / 2;
      const w = design.walls.find((q) => q.zone === zone && runsAlong(q, cross) && Math.abs(q.start[axis] - at) < 1);
      if (!w) return 0;
      return w.type === 'exterior' ? w.thickness / 2 : studs(w) / 2;
    };
    const clearSpan = Math.max(...lines.slice(1).map((v, i) => v - lines[i] - half(v) - half(lines[i])));
    out.push({
      zone,
      group: zone === 'garage' ? 'garage-ceiling' : 'ceiling',
      title: zone === 'garage' ? 'Garage ceiling' : 'Ceiling',
      bounds,
      height,
      axis,
      supports,
      beamAt,
      joist,
      spacing,
      maxSpan: spans(lines),
      clearSpan,
    });
  }
  return out;
}

/**
 * True when the wall carries floor, ceiling, or roof load: every exterior wall, and
 * the interior walls that ceiling joists bear on. `wall.bearing` overrides the rule.
 */
export function isBearingWall(design: Design, w: Wall): boolean {
  if (w.bearing !== undefined) return w.bearing;
  if (w.type === 'exterior') return true;
  return ceilingZones(design).some((z) => z.supports.some((s) => s.id === w.id));
}
