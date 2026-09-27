import type { Framing, LumberSize } from '../schema';
import { formatFrac } from '../units';

/**
 * Lumber sizes and stock. Nominal sizes name the piece; dressed sizes are what it measures.
 * `b` is the thickness (the narrow face) and `d` the depth.
 */
export const DRESSED: Record<LumberSize, { b: number; d: number }> = {
  '2x4': { b: 1.5, d: 3.5 },
  '2x6': { b: 1.5, d: 5.5 },
  '2x8': { b: 1.5, d: 7.25 },
  '2x10': { b: 1.5, d: 9.25 },
  '2x12': { b: 1.5, d: 11.25 },
  '4x4': { b: 3.5, d: 3.5 },
  '4x6': { b: 3.5, d: 5.5 },
  '6x6': { b: 5.5, d: 5.5 },
};

export type Material =
  /** No. 2 southern yellow pine. */
  | 'SYP'
  /** Pressure-treated southern yellow pine. */
  | 'PT'
  /** Laminated veneer lumber, ordered to length. */
  | 'LVL'
  /** Composite deck boards. */
  | 'COMP';

export const MATERIAL_NAMES: Record<Material, string> = {
  SYP: 'No. 2 SYP',
  PT: 'P.T. SYP',
  LVL: 'LVL',
  COMP: 'Composite',
};

export type Lvl = Framing['roof']['ridge'];

/** Size label for one LVL ply, e.g. 1-3/4" x 11-7/8" LVL. */
export const lvlSize = (l: Lvl) => `${formatFrac(l.thickness)} x ${formatFrac(l.depth)} LVL`;

export const isLvlSize = (size: string) => /LVL$/.test(size);

/** Depth of an LVL ply from its size label. */
export function lvlDepth(size: string): number {
  const m = size.match(/x (\d+)(?:-(\d+)\/(\d+))?" LVL$/);
  return m ? Number(m[1]) + (m[2] ? Number(m[2]) / Number(m[3]) : 0) : 0;
}

/** Nominal thickness and width of a sawn size, e.g. 2x10 -> [2, 10]. */
export function nominal(size: string): [number, number] | null {
  const m = size.match(/^(\d+)x(\d+)$/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** Board feet in a piece of sawn lumber; 0 for engineered and composite pieces, which sell by the foot. */
export function boardFeet(size: string, lengthInches: number): number {
  const n = nominal(size);
  return n ? (n[0] * n[1] * lengthInches) / 144 : 0;
}

/** The shortest stock length that yields the piece, or null when the piece is longer than any stock. */
export function stockFor(lengths: number[], piece: number): number | null {
  return [...lengths].sort((a, b) => a - b).find((l) => l >= piece - 1e-6) ?? null;
}

/** Engineered lumber is ordered to length, rounded up to the next even foot. */
export const orderLength = (inches: number) => Math.ceil((inches - 1e-6) / 24) * 24;

/** Rounds a cut length to the nearest 1/16" so equal pieces group together. */
export const roundCut = (inches: number) => Math.round(inches * 16) / 16;
