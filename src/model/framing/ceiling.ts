import type { Design, Wall } from '../schema';
import { wallDir } from '../geometry';
import { ceilingZones, type CeilingZone } from './bearing';
import { houseSheathing } from './floor';
import { DRESSED, lvlSize } from './lumber';
import { HUNG } from './hardware';
import { roofFraming } from './levels';
import { maker, pieces, planeAlong, splitRun } from './layout';
import { rafterLines } from './roof';
import { clipPolygon, rect } from './solid';
import type { MemberDraft } from './types';

const B = 1.5;
/** How far a joist runs past the far face of a wall it laps over. */
const LAP = 3;

const studDepth = (design: Design, w: Wall) => DRESSED[(w.type === 'exterior' ? design.framing.walls.exterior : design.framing.walls.interior).stud].d;

/** Face of the studs of the wall along one side of the ceiling, toward the ceiling; the side itself when no wall is there. */
function edgeFace(design: Design, z: CeilingZone, at: number, inward: 1 | -1): number {
  const cross = z.axis === 'x' ? 'y' : 'x';
  const w = design.walls.find(
    (q) => q.zone === z.zone && Math.abs(z.axis === 'x' ? wallDir(q).x : wallDir(q).y) > 1 - 1e-6 && Math.abs(q.start[cross] - at) < 1,
  );
  if (!w) return at;
  return at + inward * (w.type === 'exterior' ? w.thickness / 2 : studDepth(design, w) / 2);
}

export type CeilingFrame = {
  zone: CeilingZone;
  drafts: MemberDraft[];
  /** Joists at the low and high eaves, by their faces along the ridge, for the roof blocking. */
  atEaves: [number, number][][];
};

/** Ceiling joists for each flat-ceiling zone, and the flush beam that carries them where one is needed. */
export function frameCeilings(design: Design): CeilingFrame[] {
  const f = design.framing;
  const sh = houseSheathing(design);
  const max = Math.max(...f.lumber.stockLengths);
  const result: CeilingFrame[] = [];

  for (const z of ceilingZones(design)) {
    const out: MemberDraft[] = [];
    const r = roofFraming(design, z.zone);
    const lay = rafterLines(design, z.zone);
    if (!r || !lay) continue;
    const { rf } = r;
    const make = maker({ system: 'ceiling', group: z.group, zone: z.zone, pricedOn: 'S-602' }, out);
    const jd = DRESSED[z.joist];
    const h = z.height;
    const cross = z.axis === 'x' ? 'y' : 'x';
    const cA = edgeFace(design, z, cross === 'x' ? z.bounds.x0 : z.bounds.y0, 1);
    const cB = edgeFace(design, z, cross === 'x' ? z.bounds.x1 : z.bounds.y1, -1);
    const lo = z.axis === 'x' ? z.bounds.x0 : z.bounds.y0;
    const hi = z.axis === 'x' ? z.bounds.x1 : z.bounds.y1;
    // Joists run to the outside of the eave wall framing, beside the rafter seats.
    const endLo = lo - rf.sMin < 8 ? rf.sMin + sh : lo;
    const endHi = rf.sMax - hi < 8 ? rf.sMax - sh : hi;

    type Support = { at: number; lo: number; hi: number; wall: boolean };
    const supports: Support[] = z.supports.map((w) => {
      const d = studDepth(design, w);
      return { at: w.start[z.axis], lo: w.start[z.axis] - d / 2, hi: w.start[z.axis] + d / 2, wall: true };
    });
    let beamHalf = 0;
    if (z.beamAt !== null) {
      const lvl = z.zone === 'garage' ? f.garage.ridge : f.roof.ridge;
      beamHalf = (lvl.plies * lvl.thickness) / 2;
      supports.push({ at: z.beamAt, lo: z.beamAt - beamHalf, hi: z.beamAt + beamHalf, wall: false });
      for (let i = 0; i < lvl.plies; i++) {
        const c = z.beamAt + (i - (lvl.plies - 1) / 2) * lvl.thickness;
        make('beam', lvlSize(lvl), 'LVL', planeAlong(cross, c), rect(cA, cB, h, h + lvl.depth), lvl.thickness, cB - cA, {
          b: lvl.thickness,
          d: lvl.depth,
          note: `Flush ceiling beam under the ridge, ply ${i + 1} of ${lvl.plies}; joists hang from both sides; size and bearing by engineer`,
        });
      }
    }
    supports.sort((p, q) => p.at - q.at);

    /** A joist's elevation, with its top corners trimmed under the roof where it needs it. */
    const profile = (a: number, b: number) => {
      let poly = rect(a, b, h, h + jd.d);
      poly = clipPolygon(poly, -rf.slope, 1, rf.plate - rf.slope * (rf.sMin + rf.heelInset) + r.tv);
      poly = clipPolygon(poly, rf.slope, 1, rf.plate + rf.slope * (rf.sMax - rf.heelInset) + r.tv);
      return { poly, clipped: poly.length !== 4 };
    };
    const joist = (c0: number, c1: number, a: number, b: number, note: string) => {
      for (const [p, q] of pieces(a, b, splitRun(a, b, max, []))) {
        const { poly, clipped } = profile(p, q);
        make('ceiling-joist', z.joist, 'SYP', planeAlong(z.axis, (c0 + c1) / 2), poly, c1 - c0, q - p, {
          cut: clipped ? 'Square; top corner trimmed to the roof slope' : 'Square',
          note,
        });
      }
    };

    const atEaves: [number, number][][] = [[], []];
    const segments = supports.length + 1;
    const fits = (c0: number) => c0 >= cA - 1e-6 && c0 + B <= cB + 1e-6;
    // Each run sits against the other face of the rafters from the run before, so the runs lap past
    // each other over a wall. Beside a side wall only one face has room, and the two runs butt in line.
    const seats = lay.lines.map(([ra, rb]) => {
      const high = fits(rb) ? rb : fits(ra - B) ? ra - B : null;
      const low = fits(ra - B) ? ra - B : fits(rb) ? rb : null;
      return { ra, rb, high, low, inline: high === low };
    });
    for (let i = 0; i < segments; i++) {
      const left = supports[i - 1];
      const right = supports[i];
      const hung = [left, right].some((q) => q && !q.wall);
      const placed: number[] = [];
      const record = (c0: number) => {
        placed.push(c0);
        if (i === 0) atEaves[0].push([c0, c0 + B]);
        if (i === segments - 1) atEaves[1].push([c0, c0 + B]);
      };
      /** Ends of a run: lapped past a wall, butted over it, or stopped at the face of a beam. */
      const ends = (lapped: boolean): [number, number] => [
        !left ? endLo : !left.wall ? left.hi : lapped ? left.lo - LAP : left.at,
        !right ? endHi : !right.wall ? right.lo : lapped ? right.hi + LAP : right.at,
      ];
      for (const q of seats) {
        const c0 = i % 2 === 0 ? q.high : q.low;
        if (c0 === null) continue;
        const [a, b] = ends(!q.inline);
        joist(c0, c0 + B, a, b, hung ? `Beside the rafter; ${HUNG}` : 'Beside the rafter; nailed to it at the plate');
        record(c0);
        // A block fills the rafter's width where two runs pass each other over a wall.
        if (right?.wall && !q.inline && q.high !== null && q.low !== null) {
          make('blocking', z.joist, 'SYP', planeAlong(z.axis, (q.ra + q.rb) / 2), rect(right.lo - LAP, right.hi + LAP, h, h + jd.d), q.rb - q.ra, right.hi - right.lo + 2 * LAP, {
            note: 'Between the lapped joists over the bearing wall',
          });
        }
      }
      // Edge joists back the ceiling finish along the side walls, where no other joist is close.
      for (const c0 of [cA, cB - B]) {
        const clash = lay.lines.some(([ra, rb]) => c0 < rb - 0.01 && c0 + B > ra + 0.01);
        if (clash || placed.some((p) => Math.abs(p - c0) < B + 3) || cB - cA < 2 * B) continue;
        const [a, b] = ends(false);
        joist(c0, c0 + B, a, b, hung ? `Edge joist against the wall; ${HUNG}` : 'Edge joist against the wall');
        record(c0);
      }
    }
    result.push({ zone: z, drafts: out, atEaves });
  }
  return result;
}
