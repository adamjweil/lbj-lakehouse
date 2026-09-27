import type { Vec } from '../geometry';
import type { Member, P3 } from './types';

/**
 * Solids shared by the 2D sheets and the 3D view, so both show the same cuts.
 * A solid is a polygon in a plane (origin `o`, unit axes `u` and `v`) extruded `t`
 * along the plane's normal, half to each side.
 */

export type Solid = { o: P3; u: P3; v: P3; profile: Vec[]; t: number };

export const P = (x: number, y: number, z: number): P3 => ({ x, y, z });
export const add3 = (a: P3, b: P3): P3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const mul3 = (a: P3, k: number): P3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const cross3 = (a: P3, b: P3): P3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const UP: P3 = { x: 0, y: 0, z: 1 };

export const rect = (x0: number, x1: number, y0: number, y1: number): Vec[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

export const solidNormal = (s: Solid) => cross3(s.u, s.v);

/** A profile point, moved `w` along the normal, in building coordinates. */
export function solidPoint(s: Solid, p: Vec, w: number): P3 {
  const n = solidNormal(s);
  return {
    x: s.o.x + s.u.x * p.x + s.v.x * p.y + n.x * w,
    y: s.o.y + s.u.y * p.x + s.v.y * p.y + n.y * w,
    z: s.o.z + s.u.z * p.x + s.v.z * p.y + n.z * w,
  };
}

/** The two faces of the solid: the profile at -t/2 and at +t/2. */
export function solidFaces(s: Solid): [P3[], P3[]] {
  return [s.profile.map((p) => solidPoint(s, p, -s.t / 2)), s.profile.map((p) => solidPoint(s, p, s.t / 2))];
}

export function solidBounds(s: Solid): { min: P3; max: P3 } {
  const pts = solidFaces(s).flat();
  return {
    min: P(Math.min(...pts.map((p) => p.x)), Math.min(...pts.map((p) => p.y)), Math.min(...pts.map((p) => p.z))),
    max: P(Math.max(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.z))),
  };
}

export function convexHull(points: Vec[]): Vec[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const turn = (a: Vec, b: Vec, c: Vec) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = (list: Vec[]) => {
    const h: Vec[] = [];
    for (const p of list) {
      while (h.length >= 2 && turn(h[h.length - 2], h[h.length - 1], p) <= 1e-9) h.pop();
      h.push(p);
    }
    h.pop();
    return h;
  };
  return [...half(pts), ...half(pts.reverse())];
}

/** Outline of the solid seen from above. */
export function planOutline(s: Solid): Vec[] {
  return convexHull(solidFaces(s).flat().map((p) => ({ x: p.x, y: p.y })));
}

/** The part of a polygon where nx * x + ny * y <= c. Convex pieces stay convex. */
export function clipPolygon(poly: Vec[], nx: number, ny: number, c: number): Vec[] {
  const out: Vec[] = [];
  const side = (p: Vec) => nx * p.x + ny * p.y - c;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const sa = side(a);
    const sb = side(b);
    if (sa <= 1e-9) out.push(a);
    if ((sa < -1e-9 && sb > 1e-9) || (sa > 1e-9 && sb < -1e-9)) {
      const k = sa / (sa - sb);
      out.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
    }
  }
  return out;
}

/** The part of a polygon inside a convex region. */
export function clipTo(poly: Vec[], region: Vec[]): Vec[] {
  const c = { x: region.reduce((s, p) => s + p.x, 0) / region.length, y: region.reduce((s, p) => s + p.y, 0) / region.length };
  let out = poly;
  for (let i = 0; i < region.length && out.length >= 3; i++) {
    const a = region[i];
    const b = region[(i + 1) % region.length];
    let nx = b.y - a.y;
    let ny = -(b.x - a.x);
    if (nx * (c.x - a.x) + ny * (c.y - a.y) > 0) {
      nx = -nx;
      ny = -ny;
    }
    if (Math.abs(nx) + Math.abs(ny) < 1e-9) continue;
    out = clipPolygon(out, nx, ny, nx * a.x + ny * a.y);
  }
  return out;
}

export function polyArea(poly: Vec[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** Triangles (index triples) covering a simple polygon, by ear clipping. */
export function triangulate(poly: Vec[]): [number, number, number][] {
  const n = poly.length;
  if (n < 3) return [];
  let signed = 0;
  for (let i = 0; i < n; i++) signed += poly[i].x * poly[(i + 1) % n].y - poly[(i + 1) % n].x * poly[i].y;
  const idx = poly.map((_, i) => i);
  if (signed < 0) idx.reverse();
  const crossAt = (a: Vec, b: Vec, c: Vec) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const inside = (p: Vec, a: Vec, b: Vec, c: Vec) => crossAt(a, b, p) >= -1e-9 && crossAt(b, c, p) >= -1e-9 && crossAt(c, a, p) >= -1e-9;
  const out: [number, number, number][] = [];
  let guard = n * n;
  while (idx.length > 3 && guard-- > 0) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length];
      const ib = idx[i];
      const ic = idx[(i + 1) % idx.length];
      const [a, b, c] = [poly[ia], poly[ib], poly[ic]];
      if (crossAt(a, b, c) <= 1e-9) continue;
      if (idx.some((k) => k !== ia && k !== ib && k !== ic && inside(poly[k], a, b, c))) continue;
      out.push([ia, ib, ic]);
      idx.splice(i, 1);
      cut = true;
      break;
    }
    // Degenerate (collinear) corners: drop one and carry on.
    if (!cut) idx.splice(0, 1);
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

/** Triangles of the whole solid, as flat xyz positions in building coordinates (inches). */
export function solidTriangles(s: Solid): number[] {
  const [back, front] = solidFaces(s);
  const out: number[] = [];
  const push = (...ps: P3[]) => ps.forEach((p) => out.push(p.x, p.y, p.z));
  for (const [a, b, c] of triangulate(s.profile)) {
    push(front[a], front[b], front[c]);
    push(back[a], back[c], back[b]);
  }
  const n = s.profile.length;
  let signed = 0;
  for (let i = 0; i < n; i++) signed += s.profile[i].x * s.profile[(i + 1) % n].y - s.profile[(i + 1) % n].x * s.profile[i].y;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (signed >= 0) {
      push(back[i], back[j], front[j]);
      push(back[i], front[j], front[i]);
    } else {
      push(back[i], front[j], back[j]);
      push(back[i], front[i], front[j]);
    }
  }
  return out;
}

export const memberSolid = (m: Member): Solid => m;
