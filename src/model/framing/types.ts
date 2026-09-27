import type { Opening, Wall, Zone } from '../schema';
import type { Vec, WallEndCondition } from '../geometry';
import type { Material } from './lumber';

/** A point in the building: plan x and y, and z up from the house finished floor. Inches. */
export type P3 = { x: number; y: number; z: number };

export type System = 'wall' | 'floor' | 'ceiling' | 'roof' | 'platform';

export type Role =
  // walls
  | 'bottom-plate' | 'top-plate' | 'cap-plate' | 'rake-plate'
  | 'stud' | 'end-stud' | 'corner-nailer' | 'king' | 'jack' | 'cripple'
  | 'header' | 'sill' | 'backing' | 'fireblock' | 'post'
  // floor
  | 'beam' | 'joist' | 'rim' | 'blocking'
  // ceiling
  | 'ceiling-joist' | 'ledger'
  // roof
  | 'rafter' | 'fly-rafter' | 'ridge' | 'lookout' | 'sub-fascia'
  // decks and porches
  | 'deck-post' | 'decking' | 'guard-post' | 'rail' | 'baluster' | 'stringer' | 'tread';

/** Which sheet prices a piece, so nothing is priced twice. */
export type PricedOn = 'S-602' | 'A-103';

/**
 * One piece of framing. Its solid is the polygon `profile`, drawn in the plane through `o`
 * spanned by the unit vectors `u` and `v`, and extruded `t` along u × v (half to each side).
 * Wall pieces use the wall's own plane: u runs along the wall from its start and v is up,
 * so their profiles are the wall framing elevation.
 */
export type Member = {
  id: string;
  /** Piece mark shared by identical pieces, e.g. S1. Assigned once the whole frame is generated. */
  mark: string;
  system: System;
  /** The assembly it belongs to: a wall id, or floor, ceiling, roof, garage-roof, deck, porch. */
  group: string;
  zone?: Zone;
  role: Role;
  /** Size label: 2x6, or 1-3/4" x 14" LVL. */
  size: string;
  material: Material;
  /** Actual section: thickness and depth. */
  b: number;
  d: number;
  /** Cut length, measured to the longest point. */
  length: number;
  /** End cuts and notches in words. */
  cut: string;
  o: P3;
  u: P3;
  v: P3;
  profile: Vec[];
  t: number;
  pricedOn: PricedOn;
  note?: string;
};

/** A piece before its id and mark are assigned. */
export type MemberDraft = Omit<Member, 'id' | 'mark'>;

export type SheathingKind = 'wall' | 'roof' | 'subfloor';

/** One sheet of sheathing, or the part of it that lands on the surface. Same solid convention as `Member`. */
export type Panel = {
  kind: SheathingKind;
  group: string;
  zone?: Zone;
  o: P3;
  u: P3;
  v: P3;
  /** Convex pieces of the sheet after it is trimmed to the surface and cut around openings. */
  pieces: Vec[][];
  t: number;
  /** Net area of the pieces, in square inches. */
  area: number;
  /** Share of a full sheet that the pieces cover. */
  coverage: number;
  pricedOn: PricedOn;
};

export type HardwareItem = {
  key: string;
  item: string;
  /** Where it goes. */
  use: string;
  count: number;
  pricedOn: PricedOn;
};

export type HeaderSpec = {
  /** `flat` is a single plate laid flat in a wall that carries no load. */
  kind: 'sawn' | 'lvl' | 'flat';
  size: string;
  material: Material;
  plies: number;
  /** One ply: thickness and depth as installed. */
  b: number;
  d: number;
  length: number;
  byEngineer: boolean;
};

/** The framed hole for a door or window. Heights are above the floor of the wall's zone. */
export type RoughOpening = {
  opening: Opening;
  wall: Wall;
  w: number;
  h: number;
  /** Edges of the rough opening along the wall, from its start. */
  u0: number;
  u1: number;
  /** Bottom of the rough opening (0 at a door). */
  sill: number;
  /** Top of the rough opening, which is the underside of the header. */
  head: number;
  header: HeaderSpec;
  /** Jack studs at each side. */
  jacks: number;
  bearing: boolean;
};

export type WallEnd = WallEndCondition;

/** How one wall is framed: its extents, levels, and pieces. */
export type WallFrame = {
  wall: Wall;
  zone?: Zone;
  /** Floor the wall stands on, relative to the house finished floor. */
  base: number;
  /** Top of the level top plates. */
  plate: number;
  /** Ends of the framing along the wall, measured from the wall's start point. */
  f0: number;
  f1: number;
  /** Ends of the sheathing along the wall (exterior walls). */
  s0: number;
  s1: number;
  stud: string;
  /** Stud depth, across the wall. */
  depth: number;
  spacing: number;
  /** Where the stud layout is measured from, and the direction it runs (1 from the start, -1 from the end). */
  origin: number;
  layoutDir: 1 | -1;
  ends: [WallEnd, WallEnd];
  /** `balloon`: the wall reaches the roof, and its studs run from the floor to the rake. */
  gable: 'none' | 'balloon';
  bearing: boolean;
  exterior: boolean;
  /** Top of the framing at a point along the wall. */
  topAt: (u: number) => number;
  /** Underside of the roof above a point along the wall. */
  under: (u: number) => number;
  /** Plumb thickness of one rake plate. */
  tvOf: number;
  /** Where the roof ridge crosses the wall, if it does. */
  ridgeU: number | null;
  tees: { u: number; wall: Wall; face: boolean }[];
  openings: RoughOpening[];
  members: Member[];
};

/** A roof, floor, ceiling, or platform assembly with the facts the drawings label. */
export type Assembly = {
  group: string;
  system: System;
  zone?: Zone;
  title: string;
  members: Member[];
};

export type FrameModel = {
  walls: WallFrame[];
  assemblies: Assembly[];
  /** Every piece, walls first. */
  members: Member[];
  panels: Panel[];
  hardware: HardwareItem[];
  openings: RoughOpening[];
};
