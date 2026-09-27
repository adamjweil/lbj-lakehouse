import type { Design, Zone } from '../schema';
import { wallReachesRoof, type Vec } from '../geometry';
import { formatFrac, formatPitch } from '../units';
import { houseSheathing } from './floor';
import { DRESSED, lvlSize } from './lumber';
import { roofFraming, type RoofFraming } from './levels';
import { baysBetween, layoutLines, maker, pieces, planeAlong, splitRun, type Plane } from './layout';
import { rect } from './solid';
import type { MemberDraft } from './types';

const B = 1.5;
/** Longest engineered beam delivered in one piece before it is broken over a post. */
const MAX_LVL = 288;
/** Bays narrower than this are packed with scrap, not blocked. */
const MIN_BLOCK = 3;

export const roofGroup = (zone: Zone | undefined) => (zone === 'garage' ? 'garage-roof' : 'roof');

/** Walls of the zone that carry a ridge post: they cross the ridge and reach the roof. */
const postWalls = (design: Design, zone: Zone | undefined) => design.walls.filter((w) => w.zone === zone && wallReachesRoof(design, w));

/**
 * Where the rafters sit along the ridge: an end rafter over each gable wall (or against the
 * house), commons on the module measured from the corner, and fly rafters at the rake overhangs.
 */
export function rafterLines(design: Design, zone: Zone | undefined) {
  const r = roofFraming(design, zone);
  if (!r) return null;
  const { rf } = r;
  const sh = houseSheathing(design);
  const walls = postWalls(design, zone).map((w) => rf.aOf(w.start));
  // A gable wall at the end sets the rafter in by the wall sheathing; an end against the house does not.
  const a0 = rf.aMin + (walls.some((a) => a - rf.aMin < 12) ? sh : 0);
  const a1 = rf.aMax - (walls.some((a) => rf.aMax - a < 12) ? sh : 0);
  const lines = layoutLines(a0, a1, rf.aMin, design.framing.roof.spacing);
  const fly: [number, number][] = [];
  if (rf.a0 < rf.aMin - 0.5) fly.push([rf.a0, rf.a0 + B]);
  if (rf.a1 > rf.aMax + 0.5) fly.push([rf.a1 - B, rf.a1]);
  return { a0, a1, lines, fly };
}

/** The two slopes of a roof. `q` measures in from the outer face of the eave wall toward the ridge. */
export function slopes(design: Design, r: RoofFraming) {
  const { rf } = r;
  const sh = houseSheathing(design);
  const sub = DRESSED[design.framing.roof.subFascia];
  return [0, 1].map((side) => {
    const wall = side === 0 ? rf.sMin : rf.sMax;
    const dir = side === 0 ? 1 : -1;
    const overhang = side === 0 ? rf.sMin - rf.eave0 : rf.eave1 - rf.sMax;
    const free = overhang > 0.5;
    return {
      side,
      dir,
      wall,
      overhang,
      free,
      /** Tail and ridge ends of the rafter. */
      qTail: free ? -overhang + sub.b : sh,
      qRidge: (rf.sMax - rf.sMin) / 2 - r.half,
      under: (q: number) => rf.plate + rf.slope * (q - rf.heelInset),
      top: (q: number) => rf.plate + rf.slope * (q - rf.heelInset) + r.tv,
      s: (q: number) => wall + dir * q,
    };
  });
}

export type Slope = ReturnType<typeof slopes>[number];

/**
 * One roof: rafters with a birdsmouth at the plate, fly rafters and lookouts at the rakes,
 * sub-fascia at the eaves, blocking over the eave walls, and the ridge beam.
 * `joists` gives the ceiling joists at each eave so the blocking fits between them.
 */
export function frameRoof(design: Design, zone: Zone | undefined, joists: [number, number][][] = [[], []]): MemberDraft[] {
  const out: MemberDraft[] = [];
  const r = roofFraming(design, zone);
  const lay = rafterLines(design, zone);
  if (!r || !lay) return out;
  const f = design.framing;
  const { rf } = r;
  const make = maker({ system: 'roof', group: roofGroup(zone), zone, pricedOn: 'S-602' }, out);
  const sh = houseSheathing(design);
  const max = Math.max(...f.lumber.stockLengths);
  const pitch = formatPitch(rf.slope * 12);
  const seat = f.roof.seat;
  const centers = lay.lines.map(([a, b]) => (a + b) / 2);

  for (const sl of slopes(design, r)) {
    const { qTail, qRidge, under, top } = sl;
    /** The plumb plane of a rafter at `a`, with its u axis pointing in toward the ridge. */
    const plane = (a: number): Plane => {
      const o = rf.toPlan(sl.wall, a);
      const d = rf.toPlan(sl.dir, 0);
      const z = rf.toPlan(0, 0);
      return { o: { x: o.x, y: o.y, z: 0 }, u: { x: d.x - z.x, y: d.y - z.y, z: 0 }, v: { x: 0, y: 0, z: 1 } };
    };
    const plain: Vec[] = [
      { x: qTail, y: under(qTail) },
      { x: qRidge, y: under(qRidge) },
      { x: qRidge, y: top(qRidge) },
      { x: qTail, y: top(qTail) },
    ];
    // The birdsmouth: a level seat on the plate and a plumb cut at the outside of the wall framing.
    const notched: Vec[] =
      seat > 0 && qTail < sh
        ? [plain[0], { x: sh, y: under(sh) }, { x: sh, y: rf.plate }, { x: rf.heelInset, y: rf.plate }, plain[1], plain[2], plain[3]]
        : plain;
    const length = (qRidge - qTail) / r.cos + r.d * rf.slope;
    const cut = `Plumb cut both ends, ${pitch}`;
    const seatCut = notched === plain ? cut : `${cut}; birdsmouth with a ${formatFrac(seat)} seat`;
    for (const [a, b] of lay.lines) {
      make('rafter', r.rafter, 'SYP', plane((a + b) / 2), notched, b - a, length, { cut: seatCut, note: 'Hung on the ridge beam; tied to the plate' });
    }
    for (const [a, b] of lay.fly) {
      make('fly-rafter', r.rafter, 'SYP', plane((a + b) / 2), plain, b - a, length, { cut, note: 'Carried by the lookouts and the ridge beam' });
    }

    // --- lookouts between the end rafter and the fly rafter
    const block = f.roof.rakeBlocking;
    const bd = DRESSED[block.size];
    const step = block.spacing * r.cos;
    for (const [fa, fb] of lay.fly) {
      const west = fb <= lay.a0 + 1e-6;
      const from = west ? lay.a0 : lay.a1;
      const len = west ? from - fb : fa - from;
      if (len < 1) continue;
      const along = rf.toPlan(0, west ? -1 : 1);
      const zero = rf.toPlan(0, 0);
      const inward = plane(0).u;
      for (let q = qTail + step; q < qRidge - 3; q += step) {
        const o = rf.toPlan(sl.s(q), from);
        make(
          'lookout',
          block.size,
          'SYP',
          {
            o: { x: o.x, y: o.y, z: top(q) },
            u: { x: along.x - zero.x, y: along.y - zero.y, z: 0 },
            // Square to the roof plane, so the block hangs below the sheathing.
            v: { x: -inward.x * rf.slope * r.cos, y: -inward.y * rf.slope * r.cos, z: r.cos },
          },
          rect(0, len, -bd.d, 0),
          bd.b,
          len,
          { note: 'Rake ladder block' },
        );
      }
    }

    // --- sub-fascia across the rafter tails
    if (sl.free) {
      const sub = DRESSED[f.roof.subFascia];
      const c = sl.s(-sl.overhang + sub.b / 2);
      const zTop = top(qTail);
      for (const [a, b] of pieces(rf.a0, rf.a1, splitRun(rf.a0, rf.a1, max, centers))) {
        make('sub-fascia', f.roof.subFascia, 'SYP', planeAlong(rf.axis, c), rect(a, b, zTop - sub.d, zTop), sub.b, b - a, {
          note: 'Nailed to the rafter tails',
        });
      }
    }

    // --- blocking between the rafters over the eave wall
    const room = Math.floor((top(sh) - rf.plate - 0.25) * 4) / 4;
    const h = Math.min(r.d, room);
    if (h > 2) {
      const c = sl.s(sh + B / 2);
      for (const [a, b] of baysBetween([...lay.lines, ...joists[sl.side]])) {
        if (b - a < MIN_BLOCK) continue;
        make('blocking', r.rafter, 'SYP', planeAlong(rf.axis, c), rect(a, b, rf.plate, rf.plate + h), B, b - a, {
          d: h,
          cut: h < r.d ? `Square; ripped to ${formatFrac(h)}` : 'Square',
          note: 'Between the rafters at the plate',
        });
      }
    }
  }

  // --- ridge beam
  const ridge = r.ridge;
  const start = rf.a0 < rf.aMin - 0.5 ? rf.a0 + B : lay.a0;
  const end = rf.a1 > rf.aMax + 0.5 ? rf.a1 - B : lay.a1;
  const posts = postWalls(design, zone).map((w) => rf.aOf(w.start)).filter((a) => a > start + 12 && a < end - 12);
  for (const [a, b] of pieces(start, end, splitRun(start, end, MAX_LVL, posts))) {
    for (let i = 0; i < ridge.plies; i++) {
      const c = rf.ridgeS + (i - (ridge.plies - 1) / 2) * ridge.thickness;
      make('ridge', lvlSize(ridge), 'LVL', planeAlong(rf.axis, c), rect(a, b, r.ridgeBottom, r.ridgeTop), ridge.thickness, b - a, {
        b: ridge.thickness,
        d: ridge.depth,
        note: `Ridge beam, ply ${i + 1} of ${ridge.plies}; size and bearing by engineer`,
      });
    }
  }
  return out;
}
