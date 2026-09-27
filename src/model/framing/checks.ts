import type { Design } from '../schema';
import { exteriorLoop, pierLayout, platforms, polygonArea, footprint, footprintBounds, garageHouseSide, garageRoofFrame } from '../geometry';
import { formatFrac, formatFtIn } from '../units';
import type { Issue, IssueLevel, Ref } from '../validate';
import { ceilingZones } from './bearing';
import { frameModel } from './index';
import { DRESSED, isLvlSize } from './lumber';
import { floorLevels, roofFraming } from './levels';
import { headerLabel } from './openings';
import { specMismatches } from './phrases';
import { platformAxes } from './platforms';
import { slopes } from './roof';
import { spanLimit } from './spans';

const B = 1.5;
const ENGINEER = 'verify with engineer';

/**
 * Checks on the framing model. They are separate from `validateDesign` because a sound
 * design still raises framing questions for the engineer, and those are warnings to
 * carry on the drawings rather than mistakes in the design.
 */
export function validateFraming(design: Design): Issue[] {
  const issues: Issue[] = [];
  const push = (level: IssueLevel, code: string, message: string, ref?: Ref) => issues.push({ level, code, message, ref });
  const f = design.framing;
  const model = frameModel(design);
  const maxStock = Math.max(...f.lumber.stockLengths);

  // --- printed specs against the numbers
  for (const m of specMismatches(design)) {
    push('warning', 'spec-mismatch', `${m.path} reads "${m.actual}", but the framing numbers call for "${m.expected}"`);
  }

  // --- assembly depths against the levels
  const lv = floorLevels(design);
  if (Math.abs(-lv.joistBottom - design.levels.floorDepth) > 0.26) {
    push(
      'warning',
      'floor-depth',
      `Floor framing is ${formatFrac(-lv.joistBottom)} deep (${f.floor.joist} joists and ${formatFrac(f.floor.subfloor.thickness)} subfloor), but levels.floorDepth is ${formatFrac(design.levels.floorDepth)}`,
    );
  }
  const roofDepth = DRESSED[f.roof.rafter].d + f.roof.sheathing.thickness;
  for (const [name, t] of [['roof', design.roof.thickness], ['garage roof', design.garage?.roof.thickness]] as const) {
    if (t !== undefined && Math.abs(roofDepth - t) > 0.5) {
      push('warning', 'roof-depth', `The ${name} is drawn ${formatFrac(t)} thick, but ${f.roof.rafter} rafters and sheathing make ${formatFrac(roofDepth)}`);
    }
  }
  const loop = exteriorLoop(design);
  const b = footprintBounds(design);
  if (loop && Math.abs(polygonArea(footprint(design)) - (b.x1 - b.x0) * (b.y1 - b.y0)) > 1) {
    push('warning', 'framing-footprint', `Floor and roof framing assume a rectangular footprint; this one is not, so frame the offsets by hand; ${ENGINEER}`);
  }

  // --- walls
  for (const w of model.walls) {
    const ref: Ref = { kind: 'wall', id: w.wall.id };
    const ranges = w.openings.map((r) => ({ r, a: r.u0 - (r.jacks + 1) * B, b: r.u1 + (r.jacks + 1) * B }));
    for (const { r, a, b: end } of ranges) {
      const oref: Ref = { kind: 'opening', id: r.opening.id };
      const need = `${r.jacks} jack${r.jacks > 1 ? 's' : ''} and a king stud each side`;
      // The studs at the wall's ends and corners leave no room for the opening's own.
      const corner = w.members
        .filter((m) => m.role === 'end-stud' || m.role === 'corner-nailer')
        .map((m) => [Math.min(...m.profile.map((p) => p.x)), Math.max(...m.profile.map((p) => p.x))])
        .filter(([m0, m1]) => a < m1 - 0.01 && end > m0 + 0.01);
      if (corner.length) {
        const short = Math.max(...corner.map(([m0, m1]) => Math.min(m1 - a, end - m0)));
        push('warning', 'framing-opening-end', `${r.opening.tag} is ${formatFrac(short)} too close to the end of wall ${w.wall.id} for ${need}; ${ENGINEER}`, oref);
      }
      for (const t of w.tees) {
        const other = model.walls.find((q) => q.wall.id === t.wall.id);
        const half = (other?.depth ?? 3.5) / 2;
        if (a < t.u + half - 0.01 && end > t.u - half + 0.01) {
          push('warning', 'framing-opening-tee', `${r.opening.tag} leaves no room for ${need} where wall ${t.wall.id} meets wall ${w.wall.id}; ${ENGINEER}`, oref);
        }
      }
      if (r.header.byEngineer) {
        push(
          'warning',
          'header-span',
          `${r.opening.tag}: the ${formatFtIn(r.w)} rough opening is wider than the ${formatFtIn(f.openings.header.maxSpan)} limit for a (${f.openings.header.plies}) ${f.openings.header.size} header, so it is shown as ${headerLabel(r.header)}; ${ENGINEER}`,
          oref,
        );
      }
    }
    for (let i = 1; i < ranges.length; i++) {
      if (ranges[i].a < ranges[i - 1].b - B - 0.01) {
        push('warning', 'framing-opening-gap', `${ranges[i - 1].r.opening.tag} and ${ranges[i].r.opening.tag} are too close for separate jack and king studs; ${ENGINEER}`, {
          kind: 'opening',
          id: ranges[i].r.opening.id,
        });
      }
    }
    const studs = w.members.filter((m) => m.role === 'stud' || m.role === 'king' || m.role === 'end-stud');
    const tallest = Math.max(0, ...studs.map((m) => m.length));
    if (tallest > f.walls.fireblockAbove) {
      const slender = w.depth < 5;
      push(
        'warning',
        'tall-studs',
        `Wall ${w.wall.id} has ${w.stud} studs up to ${formatFtIn(tallest)} tall${slender ? ', which is slender for a wall this high' : ''}; stud size, bracing, and fire blocking need review; ${ENGINEER}`,
        ref,
      );
    }
    const post = w.members.find((m) => m.role === 'post');
    if (post) {
      const over = w.openings.find((r) => r.u0 - r.jacks * B < w.ridgeU! + B && r.u1 + r.jacks * B > w.ridgeU! - B);
      if (over) {
        push('warning', 'ridge-post-opening', `The ridge post in wall ${w.wall.id} lands on the header of ${over.opening.tag}; the header and its jacks carry the ridge load; ${ENGINEER}`, {
          kind: 'opening',
          id: over.opening.id,
        });
      }
      if (!w.zone) {
        const axis = design.roof.ridgeAxis === 'x' ? 'y' : 'x';
        const at = roofFraming(design, undefined)!.rf.ridgeS;
        const beams = pierLayout(design).beams.filter((q) => !q.deck).map((q) => q.a[axis]);
        if (!beams.some((y) => Math.abs(y - at) < 3)) {
          push('warning', 'ridge-post-bearing', `The ridge post in wall ${w.wall.id} does not land over a beam line; add a beam, piers, or blocking under it; ${ENGINEER}`, ref);
        }
      }
    }
  }

  // --- spans
  const span = (code: string, what: string, use: Parameters<typeof spanLimit>[0], size: string, spacing: number, length: number, ref?: Ref) => {
    const limit = spanLimit(use, size, spacing);
    if (limit !== null && length > limit + 0.01) {
      push('warning', code, `${what} span ${formatFtIn(length)}, more than the ${formatFtIn(limit)} table limit for ${size} at ${formatFrac(spacing)} o.c.; ${ENGINEER}`, ref);
    }
  };
  const beamYs = pierLayout(design).beams.filter((q) => !q.deck).map((q) => q.a.y).sort((p, q) => p - q);
  if (beamYs.length > 1) {
    const bw = DRESSED[f.floor.beam.size].b * f.floor.beam.plies;
    span('joist-span', 'Floor joists', 'floorJoist', f.floor.joist, f.floor.spacing, Math.max(...beamYs.slice(1).map((y, i) => y - beamYs[i])) - bw);
  }
  for (const zone of [undefined, 'garage'] as const) {
    const r = roofFraming(design, zone);
    if (!r) continue;
    const name = zone ? 'Garage rafters' : 'Rafters';
    const sl = slopes(design, r)[0];
    span('rafter-span', name, 'rafter', r.rafter, f.roof.spacing, sl.qRidge - r.rf.heelInset);
  }
  for (const z of ceilingZones(design)) {
    span('ceiling-span', `${z.title} joists`, 'ceilingJoist', z.joist, z.spacing, z.clearSpan);
    if (z.beamAt !== null) {
      push('info', 'ceiling-beam', `${z.title}: a flush beam under the ridge carries the joists at mid-span, because no wall does; its size and its bearing at each end are by the engineer`);
    }
  }
  for (const p of platforms(design)) {
    const ax = platformAxes(p);
    const pier = pierLayout(design).piers.find((q) => q.platform === p.kind);
    if (pier) span('deck-span', `${p.kind === 'deck' ? 'Deck' : 'Porch'} joists`, 'deckJoist', f.platforms.joist, f.platforms.spacing, ax.qOf(pier.p) - B);
  }

  // --- a roof that drains against a wall
  const g = garageRoofFrame(design);
  const against = garageHouseSide(design);
  if (g && against && (g.axis === 'x' ? ['north', 'south'] : ['west', 'east']).includes(against)) {
    push('warning', 'roof-low-edge', `The garage roof has an eave against the house wall, so it drains toward the wall; turn the ridge or add a cricket and gutter; ${ENGINEER}`);
  }

  // --- pieces longer than the yard stocks
  const long = new Map<string, number>();
  for (const m of model.members) {
    if (m.material === 'LVL' || isLvlSize(m.size) || m.length <= maxStock + 0.01) continue;
    long.set(`${m.group}: ${m.size} ${m.role}`, Math.max(long.get(`${m.group}: ${m.size} ${m.role}`) ?? 0, m.length));
  }
  for (const [what, len] of long) {
    push('warning', 'over-stock', `${what} is ${formatFtIn(len)} long, more than the longest stock (${formatFtIn(maxStock)}); splice it or order it specially; ${ENGINEER}`);
  }
  return issues;
}
