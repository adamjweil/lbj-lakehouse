import type { Vec } from '../geometry';
import { clipPolygon, convexHull, cross3, solidFaces, type Solid } from './solid';
import type { P3 } from './types';

/**
 * Orthographic views of the framing, for the plans, sections, and details. A view has an
 * origin and two unit axes on the paper: `a` to the right and `b` up. Depth is measured
 * toward the viewer. Plan y points south, so the building's axes are left-handed and the
 * viewer stands on the side of -(a × b).
 */
export type View = { o: P3; a: P3; b: P3 };

/** Unit vector from the paper toward the viewer. */
export const toward = (view: View): P3 => {
  const n = cross3(view.a, view.b);
  return { x: -n.x, y: -n.y, z: -n.z };
};

export type Projected<T> = {
  item: T;
  /** Outline on the paper: x along `a`, y along `b` (up). */
  poly: Vec[];
  /** Nearest and farthest points, along the view direction (larger is nearer). */
  near: number;
  far: number;
};

const dot3 = (p: P3, q: P3) => p.x * q.x + p.y * q.y + p.z * q.z;
const sub3 = (p: P3, q: P3): P3 => ({ x: p.x - q.x, y: p.y - q.y, z: p.z - q.z });

/** Looking down on the plan: x to the right, and plan y (south) down the sheet. */
export const PLAN_VIEW: View = { o: { x: 0, y: 0, z: 0 }, a: { x: 1, y: 0, z: 0 }, b: { x: 0, y: -1, z: 0 } };

/** A plumb view: `right` is the plan direction that runs to the right on the paper, so the viewer looks along its left. */
export const elevationView = (right: Vec, o: P3 = { x: 0, y: 0, z: 0 }): View => ({ o, a: { x: right.x, y: right.y, z: 0 }, b: { x: 0, y: 0, z: 1 } });

export function projectPoint(view: View, p: P3): Vec {
  const d = sub3(p, view.o);
  return { x: dot3(d, view.a), y: dot3(d, view.b) };
}

/** A solid's outline in the view. Pieces that lie flat in the view keep their true shape, notches and all. */
export function project<T extends Solid>(view: View, item: T): Projected<T> {
  const n = toward(view);
  const [back, front] = solidFaces(item);
  const depths = [...back, ...front].map((p) => dot3(sub3(p, view.o), n));
  const flat = Math.abs(Math.abs(dot3(cross3(item.u, item.v), n)) - 1) < 1e-6;
  const poly = flat ? front.map((p) => projectPoint(view, p)) : convexHull([...back, ...front].map((p) => projectPoint(view, p)));
  return { item, poly, near: Math.max(...depths), far: Math.min(...depths) };
}

/** Pieces that pass through a slab of depth, farthest first so nearer pieces draw over them. */
export function inSlab<T extends Solid>(view: View, items: T[], from: number, to: number): Projected<T>[] {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return items
    .map((m) => project(view, m))
    .filter((q) => q.near > lo + 0.01 && q.far < hi - 0.01)
    .sort((p, q) => p.near - q.near);
}

/** Trims a projected outline to a window on the paper. */
export function cropTo(poly: Vec[], w: { x0: number; y0: number; x1: number; y1: number }): Vec[] {
  let out = clipPolygon(poly, -1, 0, -w.x0);
  out = clipPolygon(out, 1, 0, w.x1);
  out = clipPolygon(out, 0, -1, -w.y0);
  out = clipPolygon(out, 0, 1, w.y1);
  return out;
}

/** Flips a paper outline for SVG, where y runs down. */
export const toSvg = (poly: Vec[]): Vec[] => poly.map((p) => ({ x: p.x, y: -p.y }));
