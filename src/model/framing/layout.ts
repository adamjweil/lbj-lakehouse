import type { Vec } from '../geometry';
import { DRESSED, type Material } from './lumber';
import { UP } from './solid';
import type { MemberDraft, P3, Role } from './types';

/** Shortest piece worth cutting. */
const MIN_PIECE = 1;

/** Every way to split a run into `count + 1` pieces no longer than `max`, cutting only at the candidates. */
function cutSets(a: number, b: number, max: number, ok: number[], count: number): number[][] {
  const out: number[][] = [];
  const pick = (from: number, start: number, cuts: number[]) => {
    if (cuts.length === count) {
      if (b - start <= max + 1e-6) out.push(cuts);
      return;
    }
    for (let i = from; i < ok.length; i++) {
      if (ok[i] - start > max + 1e-6) break;
      pick(i + 1, ok[i], [...cuts, ok[i]]);
    }
  };
  pick(0, a, []);
  return out;
}

const shortest = (a: number, b: number, cuts: number[]) => {
  const pts = [a, ...cuts, b];
  return Math.min(...pts.slice(1).map((p, i) => p - pts[i]));
};

/**
 * The ways to split a run into the fewest pieces no longer than `max`, with every splice
 * on a candidate (a stud, a joist, or a support). Longest shortest-piece first. Empty when
 * the run needs no splice, or when no set of candidates works.
 */
export function splitChoices(a: number, b: number, max: number, candidates: number[], avoid: number[] = []): number[][] {
  if (b - a <= max + 1e-6) return [];
  const ok = [...new Set(candidates)]
    .filter((c) => c > a + MIN_PIECE && c < b - MIN_PIECE && avoid.every((x) => Math.abs(x - c) >= 48))
    .sort((p, q) => p - q);
  const least = Math.ceil((b - a) / max - 1e-9) - 1;
  for (let count = least; count <= least + 2; count++) {
    const sets = cutSets(a, b, max, ok, count);
    if (sets.length) return sets.sort((p, q) => shortest(a, b, q) - shortest(a, b, p));
  }
  return [];
}

/**
 * Break points that split a run into the fewest pieces no longer than `max`. Splices land on
 * the candidates, stay 48" from the `avoid` points (the splices in the piece alongside),
 * and leave the shortest piece as long as possible.
 */
export function splitRun(a: number, b: number, max: number, candidates: number[], avoid: number[] = []): number[] {
  if (b - a <= max + 1e-6) return [];
  const sets = splitChoices(a, b, max, candidates, avoid);
  if (sets.length) return sets[0];
  // Nothing to land on: cut to the stock length.
  const cuts: number[] = [];
  for (let c = a + max; c < b - MIN_PIECE; c += max) cuts.push(c);
  return cuts;
}

export const pieces = (a: number, b: number, cuts: number[]): [number, number][] => {
  const pts = [a, ...cuts, b];
  return pts.slice(1).map((p, i) => [pts[i], p] as [number, number]).filter(([p, q]) => q - p > MIN_PIECE);
};

/**
 * Framing lines across a bay: one piece flush at each end, and the rest centered on the
 * module measured from `origin`. Returns the faces [a, b] of each piece.
 */
export function layoutLines(from: number, to: number, origin: number, spacing: number, thickness = 1.5): [number, number][] {
  const out: [number, number][] = [[from, from + thickness]];
  const first = Math.ceil((from + thickness - origin) / spacing - 1e-9);
  for (let k = first; k < first + 10000; k++) {
    const c = origin + k * spacing;
    if (c + thickness / 2 > to - thickness + 1e-6) break;
    if (c - thickness / 2 < from + thickness - 1e-6) continue;
    out.push([c - thickness / 2, c + thickness / 2]);
  }
  if (to - thickness > from + thickness - 1e-6) out.push([to - thickness, to]);
  return out;
}

/** Clear bays between pieces, given their faces. */
export function baysBetween(lines: [number, number][]): [number, number][] {
  const sorted = [...lines].sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  let edge = -Infinity;
  for (const [a, b] of sorted) {
    if (edge > -Infinity && a - edge > MIN_PIECE) out.push([edge, a]);
    edge = Math.max(edge, b);
  }
  return out;
}

export type Plane = { o: P3; u: P3; v: P3 };

/** The plumb plane of a piece running along a plan axis, through the crosswise coordinate `c`. */
export const planeAlong = (axis: 'x' | 'y', c: number): Plane =>
  axis === 'x'
    ? { o: { x: 0, y: c, z: 0 }, u: { x: 1, y: 0, z: 0 }, v: UP }
    : { o: { x: c, y: 0, z: 0 }, u: { x: 0, y: 1, z: 0 }, v: UP };

type Base = Pick<MemberDraft, 'system' | 'group' | 'zone' | 'pricedOn'>;

/** Builds pieces for one assembly. */
export function maker(base: Base, out: MemberDraft[]) {
  return (
    role: Role,
    size: string,
    material: Material,
    plane: Plane,
    profile: Vec[],
    t: number,
    length: number,
    o: { cut?: string; note?: string; b?: number; d?: number } = {},
  ) => {
    const dressed = DRESSED[size as keyof typeof DRESSED];
    out.push({
      ...base,
      role,
      size,
      material,
      b: o.b ?? dressed?.b ?? t,
      d: o.d ?? dressed?.d ?? t,
      length,
      cut: o.cut ?? 'Square',
      ...plane,
      profile,
      t,
      note: o.note,
    });
  };
}
