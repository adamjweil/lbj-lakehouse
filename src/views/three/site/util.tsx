import * as THREE from 'three';
import type { Rect } from '../../../model/geometry';
import { F, toWorld, type Frame } from '../House3D';

/** A flat rectangle on the ground (plan rect, height above house FF). */
export function flatRect(fr: Frame, r: Rect, h: number, mottle = 0) {
  const w = (r.x1 - r.x0) * F;
  const d = (r.y1 - r.y0) * F;
  // With mottle, subdivide and tint vertices with slow noise so repeating textures don't read as a grid.
  const seg = mottle ? Math.min(160, Math.max(4, Math.round(Math.max(w, d) / 12))) : 1;
  const g = new THREE.PlaneGeometry(w, d, seg, seg);
  if (mottle) {
    const pos = g.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + (r.x0 * F);
      const y = pos.getY(i) + (r.y0 * F);
      const n =
        Math.sin(x / 37 + 1.3) * Math.cos(y / 29 + 0.7) * 0.5 +
        Math.sin(x / 13 + y / 17 + 2.1) * 0.3 +
        Math.sin(x / 71 - y / 53) * 0.2;
      const k = 1 + n * mottle;
      colors[i * 3] = k;
      colors[i * 3 + 1] = k;
      colors[i * 3 + 2] = k * 0.97;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  g.rotateX(-Math.PI / 2);
  const c = toWorld(fr, { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 }, h);
  g.translate(c.x, c.y, c.z);
  return { geometry: g, w, d };
}

/** A box spanning a plan rect between two heights (above house FF). */
export function boxFor(fr: Frame, r: Rect, bottom: number, top: number) {
  const size: [number, number, number] = [(r.x1 - r.x0) * F, (top - bottom) * F, (r.y1 - r.y0) * F];
  const pos = toWorld(fr, { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 }, (bottom + top) / 2);
  return { pos, size };
}

/** Axis-aligned rect minus a hole: up to four rects covering the rest. */
export function subtractRect(r: Rect, hole: Rect): Rect[] {
  const h = {
    x0: Math.max(r.x0, hole.x0),
    x1: Math.min(r.x1, hole.x1),
    y0: Math.max(r.y0, hole.y0),
    y1: Math.min(r.y1, hole.y1),
  };
  if (h.x0 >= h.x1 || h.y0 >= h.y1) return [r];
  const out: Rect[] = [
    { x0: r.x0, x1: h.x0, y0: r.y0, y1: r.y1 },
    { x0: h.x1, x1: r.x1, y0: r.y0, y1: r.y1 },
    { x0: h.x0, x1: h.x1, y0: r.y0, y1: h.y0 },
    { x0: h.x0, x1: h.x1, y0: h.y1, y1: r.y1 },
  ];
  return out.filter((q) => q.x1 - q.x0 > 0.01 && q.y1 - q.y0 > 0.01);
}

/** Deterministic pseudo-random numbers. */
export function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A solid bar between two world points (used for rails and stringers). */
export function barMatrix(a: THREE.Vector3, b: THREE.Vector3, thickness: number, depth = thickness) {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(thickness, len, depth));
  return m;
}
