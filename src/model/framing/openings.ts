import type { Design, Opening, Wall } from '../schema';
import { wallById } from '../geometry';
import { isBearingWall } from './bearing';
import { DRESSED, lvlSize } from './lumber';
import type { HeaderSpec, RoughOpening } from './types';

/** Thickness of a jack or king stud. */
const STUD_B = 1.5;

/** Rough opening size for a door or window unit: the unit plus the allowance for its type. */
export function roughOpeningSize(design: Design, o: Opening): { w: number; h: number } {
  const ro = design.framing.openings.roughOpening;
  // A pocket door needs room for the door and its pocket, plus the track above.
  if (o.operation === 'pocket') return { w: o.width * 2 + 1, h: o.height + 4.5 };
  const a = o.operation === 'cased' ? ro.cased : o.operation === 'overhead' ? ro.overhead : o.kind === 'window' ? ro.window : ro.door;
  return { w: o.width + a.w, h: o.height + a.h };
}

/** Jack studs at each side of a rough opening of the given width. */
export function jackCount(design: Design, width: number): number {
  const rules = [...design.framing.openings.jacks].sort((a, b) => a.maxSpan - b.maxSpan);
  const rule = rules.find((r) => width <= r.maxSpan + 1e-6);
  return rule ? rule.count : rules[rules.length - 1].count + 1;
}

function headerFor(design: Design, wall: Wall, width: number, jacks: number, bearing: boolean): HeaderSpec {
  const f = design.framing;
  const length = width + 2 * jacks * STUD_B;
  if (!bearing) {
    const size = wall.type === 'exterior' ? f.walls.exterior.stud : f.walls.interior.stud;
    // Laid flat: the stud's depth lies across the wall and its thickness is the header's height.
    return { kind: 'flat', size, material: 'SYP', plies: 1, b: DRESSED[size].d, d: DRESSED[size].b, length, byEngineer: false };
  }
  if (width <= f.openings.header.maxSpan + 1e-6) {
    const { size, plies } = f.openings.header;
    return { kind: 'sawn', size, material: 'SYP', plies, b: DRESSED[size].b, d: DRESSED[size].d, length, byEngineer: false };
  }
  const l = f.openings.headerOver;
  return { kind: 'lvl', size: lvlSize(l), material: 'LVL', plies: l.plies, b: l.thickness, d: l.depth, length, byEngineer: true };
}

export function roughOpening(design: Design, o: Opening, wall: Wall): RoughOpening {
  const { w, h } = roughOpeningSize(design, o);
  const bearing = isBearingWall(design, wall);
  const jacks = bearing ? jackCount(design, w) : 1;
  // A window's allowance is split around the unit; a door's is all at the head.
  const sill = o.kind === 'window' && o.sill > 0.5 ? o.sill - (h - o.height) / 2 : 0;
  return {
    opening: o,
    wall,
    w,
    h,
    u0: o.offset - w / 2,
    u1: o.offset + w / 2,
    sill,
    head: sill + h,
    header: headerFor(design, wall, w, jacks, bearing),
    jacks,
    bearing,
  };
}

const byTag = (a: RoughOpening, b: RoughOpening) => a.opening.tag.localeCompare(b.opening.tag, undefined, { numeric: true });

/** Every rough opening in the design, in tag order. */
export function roughOpenings(design: Design): RoughOpening[] {
  const out: RoughOpening[] = [];
  for (const o of design.openings) {
    const wall = wallById(design, o.wallId);
    if (wall) out.push(roughOpening(design, o, wall));
  }
  return out.sort(byTag);
}

/** Header callout, e.g. (2) 2x10 or (2) 1-3/4" x 11-7/8" LVL. */
export function headerLabel(h: HeaderSpec): string {
  if (h.kind === 'flat') return `${h.size} flat`;
  return `(${h.plies}) ${h.size}`;
}
