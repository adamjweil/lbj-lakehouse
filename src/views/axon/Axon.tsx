import type { ReactNode } from 'react';
import type { Design } from '../../model/schema';
import {
  bbox, footprint, platformRailings, platforms, skirtEdges, footprintBounds, garageFootprint, outwardNormal, pointAlong, polygonCentroid,
  roofFrames, signedArea, wallEndExtensions, wallLength, wallProfile, SIDE_NORMAL, add, mul, norm, sub, type Vec,
} from '../../model/geometry';

/** 3D point: plan x, height, plan y. */
type P3 = [number, number, number];
type Face = {
  pts: P3[];
  fill: string;
  stroke?: string;
  width?: number;
  cat: number;
  normal?: P3;
  lines?: { a: P3; b: P3; color?: string; width?: number }[];
  children?: Face[];
};

function shade(hex: string, k: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const sub3 = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a: P3, b: P3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit3 = (a: P3): P3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * A shaded axonometric view of the cabin, built from the same geometry as the drawings.
 * Rendered in paper units into `box`.
 */
export function AxonView({ design, box }: { design: Design; box: { x: number; y: number; w: number; h: number } }) {
  const m = design.materials;
  const lake = SIDE_NORMAL[design.meta.lakeSide];
  // Look from the lake-side corner, turned toward the garage when there is one so it shows.
  const gfp = garageFootprint(design);
  const toGarage = gfp ? sub(polygonCentroid(gfp), polygonCentroid(footprint(design))) : null;
  const across = design.meta.lakeSide === 'east' || design.meta.lakeSide === 'west' ? SIDE_NORMAL.south : SIDE_NORMAL.east;
  const side = toGarage && Math.abs(toGarage.x * across.x + toGarage.y * across.y) > 1
    ? mul(across, Math.sign(toGarage.x * across.x + toGarage.y * across.y))
    : across;
  const hd = norm(add(lake, side));
  const elev = (32 * Math.PI) / 180;
  const ce = Math.cos(elev);
  const se = Math.sin(elev);
  // Viewer looks along -hd; screen-right is 90 degrees clockwise from that on the plan.
  const rv: Vec = { x: hd.y, y: -hd.x };
  const toViewer: P3 = [hd.x * ce, se, hd.y * ce];
  const light = unit3([-0.4, 0.8, 0.45]);

  const proj = (p: P3): Vec => ({
    x: p[0] * rv.x + p[2] * rv.y,
    y: (p[0] * hd.x + p[2] * hd.y) * se - p[1] * ce,
  });
  const depth = (p: P3) => (p[0] * hd.x + p[2] * hd.y) * ce + p[1] * se;

  const faces: Face[] = [];
  const at = (q: Vec, h: number): P3 => [q.x, h, q.y];
  const grade = -design.levels.floorHeight;

  // Base skirt
  const fp = footprint(design);
  const ccw = signedArea(fp) > 0;
  fp.forEach((a, i) => {
    const b = fp[(i + 1) % fp.length];
    const d = norm({ x: b.x - a.x, y: b.y - a.y });
    const n = ccw ? { x: d.y, y: -d.x } : { x: -d.y, y: d.x };
    faces.push({ pts: [at(a, grade), at(b, grade), at(b, 0), at(a, 0)], fill: '#cfc8b8', cat: 0, normal: [n.x, 0, n.y] });
  });

  // Garage slab edge (the side against the house is hidden)
  if (gfp && design.garage) {
    const top = design.garage.floor;
    const hb = footprintBounds(design);
    const g = bbox(gfp);
    const ring: Vec[] = [{ x: g.x0, y: g.y0 }, { x: g.x1, y: g.y0 }, { x: g.x1, y: g.y1 }, { x: g.x0, y: g.y1 }];
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % 4];
      const d = norm({ x: b.x - a.x, y: b.y - a.y });
      const n = { x: d.y, y: -d.x };
      const mid = { x: (a.x + b.x) / 2 + n.x * 2, y: (a.y + b.y) / 2 + n.y * 2 };
      if (mid.x > hb.x0 && mid.x < hb.x1 && mid.y > hb.y0 && mid.y < hb.y1) return;
      faces.push({ pts: [at(a, grade), at(b, grade), at(b, top), at(a, top)], fill: '#bdb9b0', cat: 0, normal: [n.x, 0, n.y] });
    });
  }

  // Walls
  for (const w of design.walls) {
    if (w.type !== 'exterior') continue;
    const prof = wallProfile(design, w);
    const [e0, e1] = wallEndExtensions(design, w);
    const ua = e0 < 0 ? e0 : prof.u0;
    const ub = e1 < 0 ? wallLength(w) - e1 : prof.u1;
    const base = prof.outline[0].y;
    const widen = (q: Vec): Vec =>
      Math.abs(q.x - prof.u0) < 1e-6 ? { x: ua, y: q.y > base + 1e-6 ? prof.topAt(ua) : q.y }
      : Math.abs(q.x - prof.u1) < 1e-6 ? { x: ub, y: q.y > base + 1e-6 ? prof.topAt(ub) : q.y }
      : q;
    const on = outwardNormal(design, w);
    const off = mul(on, w.thickness / 2);
    const P = (u: number, v: number, extra = 0) => at(add(add(pointAlong(w, u), off), mul(on, extra)), v);
    const lines: Face['lines'] = [];
    for (let u = Math.ceil(prof.u0 / 12) * 12; u < prof.u1; u += 12) {
      lines.push({ a: P(u, base, 0.3), b: P(u, prof.topAt(u) - 0.5, 0.3), color: shade(m.siding, 0.7), width: 0.35 });
    }
    const children: Face[] = [...prof.holes, ...prof.doors].map(({ opening: o, rect }) => {
      const fill = o.kind === 'door' && o.operation !== 'cased' ? m.door : shade(m.glass, 0.55);
      return {
        pts: [P(rect[0], rect[1], 0.6), P(rect[2], rect[1], 0.6), P(rect[2], rect[3], 0.6), P(rect[0], rect[3], 0.6)],
        fill,
        stroke: m.trim,
        width: 1.3,
        cat: 1,
        lines:
          o.kind === 'slider'
            ? [{ a: P((rect[0] + rect[2]) / 2, rect[1], 0.8), b: P((rect[0] + rect[2]) / 2, rect[3], 0.8), color: m.trim, width: 1 }]
            : o.operation === 'double-hung'
              ? [{ a: P(rect[0], (rect[1] + rect[3]) / 2, 0.8), b: P(rect[2], (rect[1] + rect[3]) / 2, 0.8), color: m.trim, width: 1 }]
              : [],
      };
    });
    faces.push({
      pts: prof.outline.map(widen).map((q) => P(q.x, q.y)),
      fill: m.siding,
      cat: 1,
      normal: [on.x, 0, on.y],
      lines,
      children,
    });
  }

  // Roofs
  const frames = roofFrames(design);
  // The house roof carries the stovepipe.
  const rf = frames[0].frame;
  for (const { frame } of frames) {
    const R = (s: number, a: number, h: number) => at(frame.toPlan(s, a), h);
    for (const poly of frame.profiles) {
      const [under0, under1, top1, top0] = poly;
      const seams: Face['lines'] = [];
      for (let a = frame.a0 + design.roof.seamSpacing; a < frame.a1 - 1; a += design.roof.seamSpacing) {
        seams.push({ a: R(top0.x, a, top0.y + 0.3), b: R(top1.x, a, top1.y + 0.3), color: shade(m.roof, 1.5), width: 0.35 });
      }
      const topFace: P3[] = [R(top0.x, frame.a0, top0.y), R(top1.x, frame.a0, top1.y), R(top1.x, frame.a1, top1.y), R(top0.x, frame.a1, top0.y)];
      faces.push({ pts: topFace, fill: m.roof, cat: 2, lines: seams });
      const eaveS = under0.x === frame.ridgeS ? under1 : under0;
      const eaveT = under0.x === frame.ridgeS ? top1 : top0;
      faces.push({
        pts: [R(eaveS.x, frame.a0, eaveS.y), R(eaveS.x, frame.a1, eaveS.y), R(eaveT.x, frame.a1, eaveT.y), R(eaveT.x, frame.a0, eaveT.y)],
        fill: m.trim,
        cat: 2,
        normal: frame.axis === 'x' ? [0, 0, Math.sign(eaveS.x - frame.ridgeS)] : [Math.sign(eaveS.x - frame.ridgeS), 0, 0],
      });
      for (const a of [frame.a0, frame.a1]) {
        const sign = a === frame.a0 ? -1 : 1;
        faces.push({
          pts: poly.map((q) => R(q.x, a, q.y)),
          fill: m.trim,
          cat: 2,
          normal: frame.axis === 'x' ? [sign, 0, 0] : [0, 0, sign],
        });
      }
    }
  }
  // Stovepipe
  const stove = design.fixtures.find((f) => f.kind === 'stove');
  if (stove) {
    const s = rf.sOf(stove);
    const base = rf.undersideAt(s) + rf.tv;
    const top = Math.max(base + 30, rf.ridgeTop + 24);
    const c = { x: stove.x, y: stove.y };
    const half = mul(rv, 5);
    faces.push({
      pts: [at(add(c, mul(half, -1)), base - 4), at(add(c, half), base - 4), at(add(c, half), top), at(add(c, mul(half, -1)), top)],
      fill: '#8a8f94',
      cat: 2,
    });
  }

  // Decks and porches
  const houseC = polygonCentroid(footprint(design));
  for (const dg of platforms(design)) {
    const r = dg.rect;
    // A platform on the far side of the house is drawn before the house so the house hides it.
    const toPlatform = sub({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 }, houseC);
    const pcat = toPlatform.x * hd.x + toPlatform.y * hd.y < 0 ? -1 : 3;
    const corners: Vec[] = [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }];
    const boards: Face['lines'] = [];
    const horiz = dg.side === 'north' || dg.side === 'south';
    for (let t = 5.75; t < (horiz ? r.y1 - r.y0 : r.x1 - r.x0); t += 5.75) {
      boards.push(
        horiz
          ? { a: [r.x0, -0.7, r.y0 + t], b: [r.x1, -0.7, r.y0 + t], color: shade(m.deck, 0.8), width: 0.3 }
          : { a: [r.x0 + t, -0.7, r.y0], b: [r.x0 + t, -0.7, r.y1], color: shade(m.deck, 0.8), width: 0.3 },
      );
    }
    faces.push({ pts: corners.map((q) => at(q, -1)), fill: m.deck, cat: pcat, normal: [0, 1, 0], lines: boards });
    corners.forEach((a, i) => {
      const b = corners[(i + 1) % 4];
      const d = norm({ x: b.x - a.x, y: b.y - a.y });
      const n = { x: d.y, y: -d.x };
      faces.push({ pts: [at(a, -12.25), at(b, -12.25), at(b, -1), at(a, -1)], fill: shade(m.deck, 0.8), cat: pcat, normal: [n.x, 0, n.y] });
    });
    if (dg.skirt === 'solid') {
      for (const [a, b] of skirtEdges(design, dg)) {
        const d = norm({ x: b.x - a.x, y: b.y - a.y });
        const n = { x: d.y, y: -d.x };
        const lines: Face['lines'] = [];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        for (let t = 12; t < len; t += 12) {
          const q = add(a, mul(d, t));
          lines.push({ a: at(q, grade), b: at(q, -12.25), color: shade(m.siding, 0.7), width: 0.35 });
        }
        faces.push({ pts: [at(a, grade), at(b, grade), at(b, -12.25), at(a, -12.25)], fill: m.siding, cat: pcat, normal: [n.x, 0, n.y], lines });
      }
    }
    const rail = dg.spec.railingHeight;
    for (const [a, b] of platformRailings(design, dg)) {
      const lines: Face['lines'] = [];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const d = norm({ x: b.x - a.x, y: b.y - a.y });
      for (let t = 0; t <= len; t += 5) {
        const q = add(a, mul(d, t));
        lines.push({ a: at(q, -1), b: at(q, rail), color: shade(m.trim, 0.8), width: 0.35 });
      }
      const posts = Math.max(1, Math.ceil(len / 72));
      for (let k = 0; k <= posts; k++) {
        const q = add(a, mul(d, (len * k) / posts));
        lines.push({ a: at(q, -1), b: at(q, rail + 1), color: m.trim, width: 1.6 });
      }
      lines.push({ a: at(a, rail), b: at(b, rail), color: m.trim, width: 1.6 });
      faces.push({ pts: [at(a, -1), at(b, -1), at(b, rail), at(a, rail)], fill: 'none', cat: pcat, lines });
    }
    const st = dg.stairs;
    if (st) {
      const out = dg.out;
      const sr = st.rect;
      const along = horiz ? { x: 1, y: 0 } : { x: 0, y: 1 };
      const w0 = horiz ? sr.x0 : sr.y0;
      const w1 = horiz ? sr.x1 : sr.y1;
      for (let i = 1; i <= st.risers; i++) {
        const h = -1 - i * st.riserHeight;
        const t0 = (i - 1) * st.tread;
        const t1 = i * st.tread;
        const base = horiz ? { x: 0, y: st.edge } : { x: st.edge, y: 0 };
        const p = (w: number, t: number) => add(add(base, mul(along, w)), mul(out, t));
        faces.push({ pts: [at(p(w0, t0), h + st.riserHeight), at(p(w1, t0), h + st.riserHeight), at(p(w1, t0), h), at(p(w0, t0), h)], fill: shade(m.deck, 0.75), cat: pcat, normal: [out.x, 0, out.y] });
        if (i < st.risers) {
          faces.push({ pts: [at(p(w0, t0), h), at(p(w1, t0), h), at(p(w1, t1), h), at(p(w0, t1), h)], fill: m.deck, cat: pcat, normal: [0, 1, 0] });
        }
      }
    }
  }

  // Sort and cull
  const visible = faces.filter((f) => {
    const n = f.normal ?? faceNormal(f.pts);
    if (f.fill === 'none') return true;
    return dot3(n, toViewer) > 1e-6;
  });
  visible.sort((a, b) => a.cat - b.cat || centroidDepth(a) - centroidDepth(b));
  function centroidDepth(f: Face) {
    return f.pts.reduce((s, p) => s + depth(p), 0) / f.pts.length;
  }
  function faceNormal(pts: P3[]): P3 {
    let n = unit3(cross(sub3(pts[1], pts[0]), sub3(pts[2], pts[0])));
    if (n[1] < 0) n = [-n[0], -n[1], -n[2]];
    return n;
  }

  // Fit to box
  const all = visible.flatMap((f) => f.pts.map(proj));
  const minX = Math.min(...all.map((q) => q.x));
  const maxX = Math.max(...all.map((q) => q.x));
  const minY = Math.min(...all.map((q) => q.y));
  const maxY = Math.max(...all.map((q) => q.y));
  const k = Math.min(box.w / (maxX - minX), box.h / (maxY - minY));
  const ox = box.x + (box.w - (maxX - minX) * k) / 2 - minX * k;
  const oy = box.y + (box.h - (maxY - minY) * k) / 2 - minY * k;
  const S = (p: P3) => {
    const q = proj(p);
    return `${(ox + q.x * k).toFixed(2)},${(oy + q.y * k).toFixed(2)}`;
  };

  const renderFace = (f: Face, key: string): ReactNode => {
    const n = f.normal ?? faceNormal(f.pts);
    const lit = 0.72 + 0.35 * Math.max(0, dot3(n, light));
    return (
      <g key={key}>
        <polygon
          points={f.pts.map(S).join(' ')}
          fill={f.fill === 'none' ? 'none' : shade(f.fill, lit)}
          stroke={f.fill === 'none' ? 'none' : f.stroke ?? '#1d1d1d'}
          strokeWidth={f.width ?? 0.8}
          strokeLinejoin="round"
        />
        {f.lines?.map((l, i) => {
          const [a, b] = [S(l.a).split(','), S(l.b).split(',')];
          return <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={l.color ?? '#1d1d1d'} strokeWidth={l.width ?? 0.5} />;
        })}
        {f.children?.map((c, i) => renderFace(c, `${key}-${i}`))}
      </g>
    );
  };

  return <g>{visible.map((f, i) => renderFace(f, String(i)))}</g>;
}
