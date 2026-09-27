import type { Design } from '../schema';
import { footprintBounds, houseWalls, pierLayout, wallDir, type Rect } from '../geometry';
import { DRESSED, type Material } from './lumber';
import { floorLevels } from './levels';
import { baysBetween, layoutLines, maker, pieces, planeAlong, splitChoices, splitRun } from './layout';
import { rect } from './solid';
import type { MemberDraft } from './types';

const B = 1.5;

/** Sheathing outside the studs of the house's exterior walls. */
export function houseSheathing(design: Design): number {
  const w = houseWalls(design).find((q) => q.type === 'exterior');
  return w ? Math.max(0, w.thickness - DRESSED[design.framing.walls.exterior.stud].d) : 0;
}

/** Outline of the floor framing: the footprint less the wall sheathing, which laps over the rim. */
export function floorFrameRect(design: Design): Rect {
  const b = footprintBounds(design);
  const sh = houseSheathing(design);
  return { x0: b.x0 + sh, y0: b.y0 + sh, x1: b.x1 - sh, y1: b.y1 - sh };
}

/**
 * Built-up beam plies with staggered splices: each ply breaks only over a support, and
 * neighboring plies break over different supports where the spans allow it.
 */
export function beamPlies(a: number, b: number, supports: number[], plies: number, max: number): [number, number][][] {
  const choices = splitChoices(a, b, max, supports);
  const out: [number, number][][] = [];
  let last: number[] | null = null;
  for (let i = 0; i < plies; i++) {
    if (!choices.length) {
      out.push(pieces(a, b, splitRun(a, b, max, supports)));
      continue;
    }
    // Prefer splices that share no support with the ply alongside, even if that takes one more piece.
    const prev: number[] = last ?? [];
    const apart = splitChoices(a, b, max, supports.filter((x) => !prev.includes(x)));
    const cuts: number[] = apart[0] ?? choices[i % choices.length];
    out.push(pieces(a, b, cuts));
    last = cuts;
  }
  return out;
}

/** House floor framing: beams on the piers, joists across them, rims, and blocking. */
export function frameFloor(design: Design): MemberDraft[] {
  const out: MemberDraft[] = [];
  const f = design.framing;
  const make = maker({ system: 'floor', group: 'floor', pricedOn: 'A-103' }, out);
  const material: Material = f.floor.treated ? 'PT' : 'SYP';
  const r = floorFrameRect(design);
  const lv = floorLevels(design);
  const max = Math.max(...f.lumber.stockLengths);
  const layout = pierLayout(design);
  const beams = layout.beams.filter((b) => !b.deck).sort((p, q) => p.a.y - q.a.y);
  const fb = footprintBounds(design);

  // --- beams, along x
  const bd = DRESSED[f.floor.beam.size];
  for (const bm of beams) {
    const y = bm.a.y;
    const piers = layout.piers.filter((q) => !q.deck && Math.abs(q.p.y - y) < 0.5).map((q) => q.p.x).sort((p, q) => p - q);
    const plies = beamPlies(r.x0, r.x1, piers.slice(1, -1), f.floor.beam.plies, max);
    plies.forEach((ply, i) => {
      const c = y + (i - (plies.length - 1) / 2) * bd.b;
      for (const [a, b] of ply) {
        make('beam', f.floor.beam.size, material, planeAlong('x', c), rect(a, b, lv.beamBottom, lv.beamTop), bd.b, b - a, {
          note: `Ply ${i + 1} of ${plies.length}; splice over a pier`,
        });
      }
    });
  }

  // --- joists, along y
  const j0 = r.y0 + B;
  const j1 = r.y1 - B;
  const lines = layoutLines(r.x0, r.x1, fb.x0, f.floor.spacing);
  // Joists break over the beams away from the rims, on a different beam from the joist alongside.
  const over = beams.map((b) => b.a.y).filter((y) => y > j0 + 12 && y < j1 - 12);
  const spliced = new Set<number>();
  const joist = (x0: number, x1: number, a: number, b: number, index: number, note?: string) => {
    const options = splitChoices(a, b, max, over);
    const cuts = b - a <= max + 1e-6 ? [] : options.length ? options[index % options.length] : splitRun(a, b, max, over);
    cuts.forEach((c) => spliced.add(c));
    for (const [p, q] of pieces(a, b, cuts)) {
      make('joist', f.floor.joist, material, planeAlong('y', (x0 + x1) / 2), rect(p, q, lv.joistBottom, lv.joistTop), x1 - x0, q - p, { note });
    }
  };
  lines.forEach(([x0, x1], i) => joist(x0, x1, j0, j1, i));

  // --- extra joists under the partitions that run with the joists
  const extra: [number, number][] = [];
  const stops = [j0, ...over, j1];
  for (const w of houseWalls(design)) {
    if (w.type !== 'interior' || Math.abs(wallDir(w).y) < 1 - 1e-6) continue;
    const x = w.start.x;
    if (lines.some(([a, b]) => Math.abs((a + b) / 2 - x) < 1)) continue;
    const lo = Math.min(w.start.y, w.end.y) + 6;
    const hi = Math.max(w.start.y, w.end.y) - 6;
    const a = Math.max(...stops.filter((s) => s <= lo));
    const b = Math.min(...stops.filter((s) => s >= hi));
    const count = w.toRoof || w.bearing ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const x0 = x - (count * B) / 2 + k * B;
      joist(x0, x0 + B, a, b, k, `Under wall ${w.id}`);
      extra.push([x0, x0 + B]);
    }
  }

  // --- rims along the joist ends
  const joistCenters = lines.map(([a, b]) => (a + b) / 2);
  for (const y of [r.y0, r.y1 - B]) {
    for (const [a, b] of pieces(r.x0, r.x1, splitRun(r.x0, r.x1, max, joistCenters))) {
      make('rim', f.floor.rim, material, planeAlong('x', y + B / 2), rect(a, b, lv.joistBottom, lv.joistTop), B, b - a);
    }
  }

  // --- solid blocking over the beams where the joists break
  for (const y of [...spliced].sort((p, q) => p - q)) {
    for (const [a, b] of baysBetween([...lines, ...extra])) {
      if (b - a < 3) continue;
      make('blocking', f.floor.joist, material, planeAlong('x', y), rect(a, b, lv.joistBottom, lv.joistTop), B, b - a, {
        note: 'Over the beam, between the joist splices',
      });
    }
  }
  return out;
}
