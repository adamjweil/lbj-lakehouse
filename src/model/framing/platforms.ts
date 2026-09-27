import type { Design } from '../schema';
import { footprintBounds, pierLayout, platformRailings, platforms, type Platform, type Vec } from '../geometry';
import { formatFrac } from '../units';
import { beamPlies } from './floor';
import { DRESSED } from './lumber';
import { platformLevels } from './levels';
import { layoutLines, maker, pieces, planeAlong, splitChoices, splitRun } from './layout';
import { rect } from './solid';
import type { MemberDraft } from './types';

const B = 1.5;
/** Balusters are 2x2; the clear space between them stays under 4". */
const BALUSTER = 1.5;
const BALUSTER_GAP = 3.875;
/** Bottom rail above the deck surface, and rail thickness. */
const RAIL_LIFT = 3.5;

/** Nominal name of a deck board, e.g. 5/4x6. */
export function deckBoardSize(design: Design): string {
  const d = design.framing.platforms.decking;
  const thick = d.thickness >= 1.4 ? '2' : d.thickness >= 0.9 ? '5/4' : '1';
  return `${thick}x${Math.round(d.width + 0.5)}`;
}

/**
 * A platform's own coordinates: `t` runs along the house and `q` runs out from it.
 * `W` and `T` turn them into plan coordinates on the axes the platform uses.
 */
export function platformAxes(p: Platform) {
  const r = p.rect;
  const horizontal = p.side === 'north' || p.side === 'south';
  const tAxis: 'x' | 'y' = horizontal ? 'x' : 'y';
  const qAxis: 'x' | 'y' = horizontal ? 'y' : 'x';
  const t0 = horizontal ? r.x0 : r.y0;
  const t1 = horizontal ? r.x1 : r.y1;
  const depth = horizontal ? r.y1 - r.y0 : r.x1 - r.x0;
  const W = (q: number) => (p.side === 'south' ? r.y0 + q : p.side === 'north' ? r.y1 - q : p.side === 'east' ? r.x0 + q : r.x1 - q);
  /** Faces of a piece between two distances from the house, in plan coordinates (low first). */
  const span = (qa: number, qb: number): [number, number] => [Math.min(W(qa), W(qb)), Math.max(W(qa), W(qb))];
  const tOf = (v: Vec) => (horizontal ? v.x : v.y);
  const qOf = (v: Vec) => {
    const w = horizontal ? v.y : v.x;
    return p.side === 'south' ? w - r.y0 : p.side === 'north' ? r.y1 - w : p.side === 'east' ? w - r.x0 : r.x1 - w;
  };
  return { horizontal, tAxis, qAxis, t0, t1, depth, W, span, tOf, qOf };
}

/** Deck and porch framing: ledger, joists, rim, beam on posts, decking, guards, and stairs. */
export function framePlatform(design: Design, p: Platform): MemberDraft[] {
  const out: MemberDraft[] = [];
  const f = design.framing.platforms;
  const lv = platformLevels(design);
  const make = maker({ system: 'platform', group: p.kind, pricedOn: 'S-602' }, out);
  const makeBeam = maker({ system: 'platform', group: p.kind, pricedOn: 'A-103' }, out);
  const ax = platformAxes(p);
  const { tAxis, qAxis, t0, t1, depth, W, span } = ax;
  const max = Math.max(...design.framing.lumber.stockLengths);
  const jd = DRESSED[f.joist];
  const fb = footprintBounds(design);

  // --- joists, square to the house
  const lines = layoutLines(t0, t1, t0, f.spacing);
  const centers = lines.map(([a, b]) => (a + b) / 2);
  const [ja, jb] = span(B, depth - B);
  for (const [a, b] of lines) {
    make('joist', f.joist, 'PT', planeAlong(qAxis, (a + b) / 2), rect(ja, jb, lv.joistBottom, lv.joistTop), b - a, jb - ja, {
      note: 'Hung on the ledger; bears on the beam',
    });
  }

  // --- ledger on the house, and the rim across the joist ends
  const h0 = Math.max(t0, tAxis === 'x' ? fb.x0 : fb.y0);
  const h1 = Math.min(t1, tAxis === 'x' ? fb.x1 : fb.y1);
  const across = (role: 'ledger' | 'rim', qa: number, a: number, b: number, note: string) => {
    const [c0, c1] = span(qa, qa + B);
    for (const [u0, u1] of pieces(a, b, splitRun(a, b, max, centers))) {
      make(role, f.joist, 'PT', planeAlong(tAxis, (c0 + c1) / 2), rect(u0, u1, lv.joistBottom, lv.joistTop), B, u1 - u0, { note });
    }
  };
  if (h1 - h0 > 1) across('ledger', 0, h0, h1, 'Bolted to the house rim through the sheathing, with flashing over');
  across('rim', depth - B, t0, t1, 'Across the joist ends');

  // --- dropped beam on posts over the piers
  const piers = pierLayout(design).piers.filter((q) => q.platform === p.kind);
  if (piers.length) {
    const bd = DRESSED[f.beam.size];
    const at = ax.qOf(piers[0].p);
    const ts = piers.map((q) => ax.tOf(q.p)).sort((a, b) => a - b);
    const plies = beamPlies(t0, t1, ts.slice(1, -1), f.beam.plies, max);
    plies.forEach((ply, i) => {
      const c = W(at) + (i - (plies.length - 1) / 2) * bd.b;
      for (const [a, b] of ply) {
        makeBeam('beam', f.beam.size, 'PT', planeAlong(tAxis, c), rect(a, b, lv.beamBottom, lv.beamTop), bd.b, b - a, {
          note: `Ply ${i + 1} of ${plies.length}; splice over a post`,
        });
      }
    });
    const pd = DRESSED[f.post];
    const height = lv.beamBottom - lv.footingTop;
    if (height > 1) {
      for (const t of ts) {
        make('deck-post', f.post, 'PT', planeAlong(tAxis, W(at)), rect(t - pd.b / 2, t + pd.b / 2, lv.footingTop, lv.beamBottom), pd.d, height, {
          note: 'On a post base, with a cap to the beam',
        });
      }
    }
  }

  // --- deck boards, laid along the house
  const board = f.decking;
  const size = deckBoardSize(design);
  const joints = splitChoices(t0, t1, max, centers);
  let row = 0;
  for (let q = 0; q < depth - 1; q += board.width + board.gap, row++) {
    const width = Math.min(board.width, depth - q);
    const [c0, c1] = span(q, q + width);
    // Butt joints land on a joist and move from row to row.
    const cuts = joints.length ? joints[(row * 2) % Math.min(joints.length, 5)] : splitRun(t0, t1, max, centers);
    for (const [a, b] of pieces(t0, t1, cuts)) {
      make('decking', size, 'COMP', planeAlong(tAxis, (c0 + c1) / 2), rect(a, b, lv.joistTop, lv.top), c1 - c0, b - a, {
        b: board.thickness,
        d: width,
        cut: width < board.width - 0.01 ? `Square; ripped to ${formatFrac(width)}` : 'Square',
      });
    }
  }

  // --- guard: posts inside the rim, rails between them, and balusters
  if (p.railing) {
    const gp = DRESSED[f.guardPost];
    const inset = B + gp.b / 2;
    const r = p.rect;
    const clamp = (v: Vec): Vec => ({
      x: Math.min(Math.max(v.x, r.x0 + inset), r.x1 - inset),
      y: Math.min(Math.max(v.y, r.y0 + inset), r.y1 - inset),
    });
    const railTop = lv.top + p.spec.railingHeight;
    const seen = new Set<string>();
    for (const [a, b] of platformRailings(design, p)) {
      const pa = clamp(a);
      const pb = clamp(b);
      const axis: 'x' | 'y' = Math.abs(pb.x - pa.x) > Math.abs(pb.y - pa.y) ? 'x' : 'y';
      const c = axis === 'x' ? pa.y : pa.x;
      const lo = Math.min(pa[axis], pb[axis]);
      const hi = Math.max(pa[axis], pb[axis]);
      const n = Math.max(1, Math.ceil((hi - lo) / f.guardSpacing - 1e-9));
      // A post that lands on a joist moves over to sit against its face.
      const clear = (at: number) => {
        if (axis !== tAxis) return at;
        const hit = lines.find(([ja0, jb0]) => at - gp.b / 2 < jb0 - 0.01 && at + gp.b / 2 > ja0 + 0.01);
        if (!hit) return at;
        return at < (hit[0] + hit[1]) / 2 ? hit[0] - gp.b / 2 : hit[1] + gp.b / 2;
      };
      const posts = Array.from({ length: n + 1 }, (_, i) => clear(lo + ((hi - lo) * i) / n));
      for (const at of posts) {
        const key = axis === 'x' ? `${at.toFixed(1)},${c.toFixed(1)}` : `${c.toFixed(1)},${at.toFixed(1)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        make('guard-post', f.guardPost, 'PT', planeAlong(axis, c), rect(at - gp.b / 2, at + gp.b / 2, lv.joistBottom, railTop), gp.d, railTop - lv.joistBottom, {
          note: 'Bolted inside the rim; blocked to the joists',
        });
      }
      for (let i = 0; i < n; i++) {
        const u0 = posts[i] + gp.b / 2;
        const u1 = posts[i + 1] - gp.b / 2;
        if (u1 - u0 < 2) continue;
        for (const z of [railTop - B, lv.top + RAIL_LIFT]) {
          make('rail', '2x4', 'PT', planeAlong(axis, c), rect(u0, u1, z, z + B), DRESSED['2x4'].d, u1 - u0, { note: z > lv.top + 12 ? 'Top rail' : 'Bottom rail' });
        }
        const count = Math.max(0, Math.ceil((u1 - u0 - BALUSTER_GAP) / (BALUSTER + BALUSTER_GAP) - 1e-9));
        const gap = (u1 - u0 - count * BALUSTER) / (count + 1);
        const z0 = lv.top + RAIL_LIFT + B;
        for (let k = 0; k < count; k++) {
          const at = u0 + gap * (k + 1) + BALUSTER * k;
          make('baluster', '2x2', 'PT', planeAlong(axis, c), rect(at, at + BALUSTER, z0, railTop - B), BALUSTER, railTop - B - z0, { b: BALUSTER, d: BALUSTER });
        }
      }
    }
  }

  // --- stairs: notched stringers and two boards to a tread
  const st = p.stairs;
  if (st) {
    const sd = DRESSED[f.stringer];
    const sLo = ax.horizontal ? st.rect.x0 : st.rect.y0;
    const sHi = ax.horizontal ? st.rect.x1 : st.rect.y1;
    const rise = st.riserHeight;
    const run = st.tread;
    const tt = board.thickness;
    const cos = run / Math.hypot(run, rise);
    const plumb = sd.d / cos;
    /** Level cut under tread i (1 at the top). */
    const seat = (i: number) => lv.top - i * rise - tt;
    /** Underside of the board, below the line through the notch corners. */
    const soffit = (x: number) => seat(1) + rise - (x * rise) / run - plumb;
    const foot = st.treads * run;
    const pts: Vec[] = [];
    for (let i = 1; i <= st.treads; i++) {
      pts.push({ x: (i - 1) * run, y: seat(i) }, { x: i * run, y: seat(i) });
    }
    const toe = Math.min(foot, Math.max(0, ((seat(1) + rise - plumb - lv.grade) * run) / rise));
    pts.push({ x: foot, y: lv.grade }, { x: toe, y: lv.grade }, { x: 0, y: soffit(0) });
    const length = Math.hypot(foot, seat(1) + rise - lv.grade);
    const count = Math.max(2, Math.floor((sHi - sLo) / f.stringerSpacing + 1e-9) + 1);
    for (let k = 0; k < count; k++) {
      const t = sLo + B / 2 + ((sHi - sLo - B) * k) / (count - 1);
      make('stringer', f.stringer, 'PT', planeAlong(qAxis, t), pts.map((q) => ({ x: W(depth + q.x), y: q.y })), B, length, {
        cut: `Notched: ${st.treads} treads, ${formatFrac(rise)} rise, ${formatFrac(run)} run; level foot`,
        note: 'Hung from the drop header; bears on a concrete pad',
      });
    }
    // The first notch sits below the rim, so the stringers hang from a header dropped under it.
    const [d0, d1] = span(depth - B, depth);
    make('rim', f.joist, 'PT', planeAlong(tAxis, (d0 + d1) / 2), rect(sLo, sHi, lv.joistBottom - jd.d, lv.joistBottom), B, sHi - sLo, {
      note: 'Drop header for the stair stringers',
    });
    for (let i = 1; i <= st.treads; i++) {
      for (let k = 0; k * board.width < run - 0.01; k++) {
        const [c0, c1] = span(depth + (i - 1) * run + k * board.width, depth + (i - 1) * run + Math.min(run, (k + 1) * board.width));
        make('tread', size, 'COMP', planeAlong(tAxis, (c0 + c1) / 2), rect(sLo, sHi, seat(i), seat(i) + tt), c1 - c0, sHi - sLo, {
          b: board.thickness,
          d: c1 - c0,
        });
      }
    }
  }
  return out;
}

export function framePlatforms(design: Design): { platform: Platform; drafts: MemberDraft[] }[] {
  return platforms(design).map((p) => ({ platform: p, drafts: framePlatform(design, p) }));
}
