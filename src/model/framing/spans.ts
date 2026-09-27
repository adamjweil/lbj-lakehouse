import type { LumberSize } from '../schema';

/**
 * Span limits for preliminary checks, in inches, for No. 2 southern pine, from the
 * 2021 IRC prescriptive span tables. They flag members to look at; the engineer
 * sizes every member. Keys are the on-center spacing in inches.
 */
type SpanTable = Partial<Record<LumberSize, Record<number, number>>>;

const ft = (feet: number, inches = 0) => feet * 12 + inches;

/** Floor joists: living areas, 40 psf live, 10 psf dead, L/360 (Table R502.3.1(2)). */
const FLOOR_JOIST: SpanTable = {
  '2x6': { 12: ft(10, 3), 16: ft(9, 4), 24: ft(7, 7) },
  '2x8': { 12: ft(13, 6), 16: ft(11, 10), 24: ft(9, 8) },
  '2x10': { 12: ft(16, 2), 16: ft(14, 0), 24: ft(11, 5) },
  '2x12': { 12: ft(19, 1), 16: ft(16, 6), 24: ft(13, 6) },
};

/** Ceiling joists: attic with limited storage, 20 psf live, 10 psf dead, L/240 (Table R802.5.1(2)). */
const CEILING_JOIST: SpanTable = {
  '2x4': { 12: ft(9, 3), 16: ft(8, 0), 24: ft(6, 7) },
  '2x6': { 12: ft(13, 11), 16: ft(12, 0), 24: ft(9, 10) },
  '2x8': { 12: ft(17, 7), 16: ft(15, 3), 24: ft(12, 6) },
  '2x10': { 12: ft(20, 11), 16: ft(18, 1), 24: ft(14, 9) },
};

/** Rafters: 20 psf roof live load, 10 psf dead, ceiling attached to the rafters, L/240 (Table R802.4.1(2)). Horizontal span. */
const RAFTER: SpanTable = {
  '2x6': { 12: ft(14, 9), 16: ft(13, 5), 24: ft(11, 0) },
  '2x8': { 12: ft(19, 6), 16: ft(17, 1), 24: ft(13, 11) },
  '2x10': { 12: ft(23, 5), 16: ft(20, 3), 24: ft(16, 6) },
  '2x12': { 12: ft(26, 0), 16: ft(23, 10), 24: ft(19, 6) },
};

/** Deck joists: 40 psf live, 10 psf dead, wet service (Table R507.6). */
const DECK_JOIST: SpanTable = {
  '2x6': { 12: ft(9, 11), 16: ft(9, 0), 24: ft(7, 7) },
  '2x8': { 12: ft(13, 1), 16: ft(11, 10), 24: ft(9, 8) },
  '2x10': { 12: ft(16, 2), 16: ft(14, 0), 24: ft(11, 5) },
  '2x12': { 12: ft(18, 0), 16: ft(16, 6), 24: ft(13, 6) },
};

export const SPAN_TABLES = {
  floorJoist: FLOOR_JOIST,
  ceilingJoist: CEILING_JOIST,
  rafter: RAFTER,
  deckJoist: DECK_JOIST,
};

export type SpanUse = keyof typeof SPAN_TABLES;

/** The span limit for a size at a spacing (the next wider tabulated spacing), or null when it is not tabulated. */
export function spanLimit(use: SpanUse, size: string, spacing: number): number | null {
  const row = SPAN_TABLES[use][size as LumberSize];
  if (!row) return null;
  const key = Object.keys(row).map(Number).sort((a, b) => a - b).find((s) => s >= spacing - 1e-6);
  return key === undefined ? null : row[key];
}
