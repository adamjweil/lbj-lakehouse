import type { ReactNode } from 'react';
import type { Design, Wall } from '../../model/schema';
import {
  bbox, garageEntry, garageFootprint, garageHouseSide, garageRoofFrame, garageSharedAxis, openingRange, pierLayout, roofFrame, roomStats, wallDir,
  wallEndExtensions, wallLength, wallProfile, pointAlong, type RoofFrame, type Vec,
} from '../../model/geometry';
import { formatFtIn, formatPitch, lowerFirst } from '../../model/units';
import { DimChain, INK_LIGHT, LW, Line, LevelMark, PitchMark, POCHE, Poly, Text, TXT, useDraft } from '../draft/draft';
import { BEAM_DEPTH, OpeningElevation } from '../elevation/Elevation';

const E = (x: number, h: number): Vec => ({ x, y: -h });

/** How much of the house is shown past the shared wall before the break line. */
const HOUSE_SHOWN = 150;
const FOOTING = 12;

/**
 * Section 2 geometry: a cut across the wall shared with the house, at `garage.section.at`
 * along that wall. `s` is the plan coordinate across the shared wall and `a` the one along it.
 */
export function garageSectionFrame(design: Design) {
  const rf = garageRoofFrame(design);
  const g = design.garage;
  const side = garageHouseSide(design);
  const alongAxis = garageSharedAxis(design);
  const gfp = garageFootprint(design);
  if (!rf || !g || !side || !alongAxis || !gfp) return null;
  const { at, look } = g.section;
  const sOf = (q: Vec) => (alongAxis === 'y' ? q.x : q.y);
  const aOf = (q: Vec) => (alongAxis === 'y' ? q.y : q.x);
  const toPlan = (s: number, a: number): Vec => (alongAxis === 'y' ? { x: s, y: a } : { x: a, y: s });
  const sign = alongAxis === 'x' ? (look === '-' ? -1 : 1) : look === '-' ? 1 : -1;
  const lookDir = look === '-' ? -1 : 1;
  const houseDir = side === 'east' || side === 'south' ? 1 : -1;
  const gb = bbox(gfp);
  const [lo, hi] = alongAxis === 'y' ? [gb.x0, gb.x1] : [gb.y0, gb.y1];
  const faceS = houseDir > 0 ? hi : lo;
  const outerS = houseDir > 0 ? lo : hi;
  /** True when the garage ridge runs along the shared wall, so the cut shows the roof's gable profile. */
  const acrossRidge = rf.axis === alongAxis;
  /** The roof edge on the side away from the house: an eave, or a rake when the cut runs along the ridge. */
  const freeEdge = acrossRidge ? (houseDir > 0 ? rf.eave0 : rf.eave1) : houseDir > 0 ? rf.a0 : rf.a1;
  const breakS = faceS + houseDir * HOUSE_SHOWN;
  const hx = (s: number) => sign * s;
  return { rf, g, at, alongAxis, acrossRidge, lookDir, houseDir, faceS, outerS, freeEdge, breakS, hx, sOf, aOf, toPlan };
}

export function garageSectionBounds(design: Design) {
  const f = garageSectionFrame(design);
  if (!f) return null;
  const house = roofFrame(design);
  const top = Math.max(f.rf.ridgeTop, house.ridgeTop);
  const xs = [f.hx(f.freeEdge), f.hx(f.breakS)];
  return { x0: Math.min(...xs), x1: Math.max(...xs), h0: -design.levels.floorHeight - FOOTING, h1: top };
}

export const garageSectionNotes = (design: Design) => [
  `Garage slab: ${lowerFirst(design.specs.foundation.garageSlab)}, sloped to the overhead door. Thickened-edge footing by the engineer.`,
  'Shared wall: 1/2" gypsum board on the garage side, from the slab to the roof deck, including the framed crawl-space closure (IRC R302.6).',
  'Entry door D8: solid-core 1-3/8" or 20-minute rated, self-closing where required (R302.5.1). No openings to sleeping rooms.',
  'Landing: 36" minimum in the direction of travel, at most 1-1/2" below the threshold (R311.3).',
  'Steps: 4 risers at 6-1/2", 11" treads. Provide a graspable handrail 34"–38" above the nosings on the open side (R311.7).',
  `Garage roof: ${formatPitch(design.garage?.roof.pitch ?? 0)} ${lowerFirst(design.specs.roof.covering)} on ${design.framing.roof.rafter} rafters with ${design.framing.garage.ceilingJoist} ceiling joists at the plate line. ${
    garageSectionFrame(design)?.acrossRidge === false
      ? 'Step-flash the rake where it meets the house wall.'
      : 'Flash the low side where it meets the house wall.'
  }`,
];

/** Walls running across the cut plane, cut at `at`. */
function cutWalls(design: Design, walls: Wall[], f: NonNullable<ReturnType<typeof garageSectionFrame>>) {
  const { at, hx, sOf, aOf } = f;
  const out: ReactNode[] = [];
  for (const w of walls) {
    const d = wallDir(w);
    const da = aOf(d);
    if (Math.abs(da) < 1 - 1e-6) continue;
    const [e0, e1] = wallEndExtensions(design, w);
    const u = (at - aOf(w.start)) / da;
    if (u < -e0 || u > wallLength(w) + e1) continue;
    const s = sOf(w.start);
    const lo = Math.min(f.breakS, f.outerS);
    const hi = Math.max(f.breakS, f.outerS);
    if (s < lo || s > hi) continue;
    const prof = wallProfile(design, w);
    const base = prof.outline[0].y;
    const top = prof.topAt(u);
    const xa = hx(s - w.thickness / 2);
    const xb = hx(s + w.thickness / 2);
    const x0 = Math.min(xa, xb);
    const x1 = Math.max(xa, xb);
    const opening = design.openings.find((o) => {
      if (o.wallId !== w.id) return false;
      const [o0, o1] = openingRange(o);
      return u >= o0 && u <= o1;
    });
    const sill = opening ? base + opening.sill : 0;
    const head = opening ? sill + opening.height : 0;
    const segs: [number, number][] = opening ? [[base, sill], [head, top]] : [[base, top]];
    out.push(
      <g key={w.id}>
        {segs
          .filter(([v0, v1]) => v1 - v0 > 0.1)
          .map(([v0, v1]) => (
            <Poly key={v0} points={[E(x0, v0), E(x1, v0), E(x1, v1), E(x0, v1)]} fill={POCHE} stroke={POCHE} w={LW.thin} />
          ))}
        {opening && (
          <>
            <Line a={E(x0 - 1, sill)} b={E(x1 + 1, sill)} w={LW.med} />
            <Line a={E(x0, head)} b={E(x1, head)} w={LW.thin} />
            {opening.kind === 'window' && <Line a={E((x0 + x1) / 2, sill)} b={E((x0 + x1) / 2, head)} w={LW.fine} />}
          </>
        )}
      </g>,
    );
  }
  return out;
}

export function GarageSectionDrawing({ design }: { design: Design }) {
  const { p } = useDraft();
  const f = garageSectionFrame(design);
  const entry = garageEntry(design);
  if (!f) return null;
  const { rf, g, at, hx, houseDir, faceS, outerS, breakS, lookDir, sOf, aOf, toPlan, acrossRidge, alongAxis } = f;
  const grade = -design.levels.floorHeight;
  const house = roofFrame(design);
  const parts: ReactNode[] = [];
  const xBreak = hx(breakS);
  const garageSide = Math.sign(hx(outerS) - hx(faceS));
  const clipId = 'gsec-house';
  const houseLo = Math.min(hx(faceS), xBreak);
  const houseHi = Math.max(hx(faceS), xBreak);
  const garageRoom = design.rooms.find((r) => r.zone === 'garage');
  const ceiling = g.floor + (garageRoom ? roomStats(design, garageRoom).ceilingHeight : g.plateHeight);
  const beyondA = (a: number) => (a - at) * lookDir > 0;

  // --- Beyond: walls parallel to the cut, on the look side (far first).
  const beyond = design.walls
    .filter((w) => Math.abs(aOf(wallDir(w))) < 1e-6 && beyondA(aOf(w.start)))
    .sort((w1, w2) => Math.abs(aOf(w2.start) - at) - Math.abs(aOf(w1.start) - at));
  const nearest = new Map<string, Wall>();
  for (const w of beyond) nearest.set(w.zone ?? 'house', w);
  for (const w of nearest.values()) {
    const prof = wallProfile(design, w);
    const map = (q: Vec) => E(hx(sOf(pointAlong(w, q.x))), Math.min(q.y, w.zone ? ceiling : q.y));
    parts.push(
      <g key={`bw-${w.id}`} clipPath={w.zone ? undefined : `url(#${clipId})`}>
        <Poly points={prof.outline.map(map)} fill="#fff" w={LW.fine} />
        {[...prof.holes, ...prof.doors].map(({ opening, rect }) => {
          const a = hx(sOf(pointAlong(w, rect[0])));
          const b = hx(sOf(pointAlong(w, rect[2])));
          return <OpeningElevation key={opening.id} o={opening} x0={Math.min(a, b)} x1={Math.max(a, b)} v0={rect[1]} v1={rect[3]} noTrim />;
        })}
      </g>,
    );
  }

  // --- Steps beyond the landing, seen from the front.
  if (entry) {
    const run = entry.run;
    const s0 = sOf({ x: run.x0, y: run.y0 });
    const s1 = sOf({ x: run.x1, y: run.y1 });
    for (const st of entry.steps) {
      if (!beyondA(aOf({ x: (st.rect.x0 + st.rect.x1) / 2, y: (st.rect.y0 + st.rect.y1) / 2 }))) continue;
      parts.push(
        <Poly key={`step-${st.top}`} points={[E(hx(s0), g.floor), E(hx(s1), g.floor), E(hx(s1), st.top), E(hx(s0), st.top)]} fill="#fff" w={LW.thin} />,
      );
    }
    // Handrail post on the open side of the run.
    const openS = Math.abs(s0 - faceS) > Math.abs(s1 - faceS) ? s0 : s1;
    parts.push(
      <g key="rail">
        <Line a={E(hx(openS), g.floor)} b={E(hx(openS), entry.landingTop + 36)} w={LW.thin} />
        <Line a={E(hx(openS) - garageSide * 1.5, entry.landingTop + 36)} b={E(hx(faceS) + garageSide * 2, entry.landingTop + 36)} w={LW.thin} />
      </g>,
    );
  }

  // --- Garage slab and footing.
  const gx0 = hx(outerS);
  const gx1 = hx(faceS);
  const footIn = hx(outerS + houseDir * FOOTING);
  parts.push(
    <Poly
      key="slab"
      points={[E(gx0, grade - FOOTING), E(footIn, grade - FOOTING), E(footIn, grade), E(gx1, grade), E(gx1, g.floor), E(gx0, g.floor)]}
      fill="#cfcfcf"
      w={LW.med}
    />,
  );

  // --- House floor, crawl space, piers beyond (clipped at the break).
  const piers = pierLayout(design);
  const beamA = piers.beams.filter((b) => !b.deck).map((b) => aOf(b.a)).filter(beyondA).sort((a, b) => Math.abs(a - at) - Math.abs(b - at))[0];
  parts.push(
    <g key="house-base" clipPath={`url(#${clipId})`}>
      {beamA !== undefined && (
        <>
          <Poly points={[E(houseLo, -design.levels.floorDepth - BEAM_DEPTH), E(houseHi, -design.levels.floorDepth - BEAM_DEPTH), E(houseHi, -design.levels.floorDepth), E(houseLo, -design.levels.floorDepth)]} fill="#fff" w={LW.fine} />
          {piers.piers
            .filter((q) => !q.deck && Math.abs(aOf(q.p) - beamA) < 0.5)
            .map((q) => {
              const x = hx(sOf(q.p));
              return <Poly key={x} points={[E(x - 6, grade), E(x + 6, grade), E(x + 6, -design.levels.floorDepth - BEAM_DEPTH), E(x - 6, -design.levels.floorDepth - BEAM_DEPTH)]} fill="#fff" w={LW.fine} />;
            })}
        </>
      )}
      <Poly points={[E(houseLo, -design.levels.floorDepth), E(houseHi, -design.levels.floorDepth), E(houseHi, 0), E(houseLo, 0)]} fill="#fff" w={LW.med} />
      <Line a={E(houseLo, -0.75)} b={E(houseHi, -0.75)} w={LW.fine} />
      {/* Crawl-space closure at the garage (gypsum board on the garage side). */}
      <Poly points={[E(gx1, g.floor), E(gx1 + garageSide * 2, g.floor), E(gx1 + garageSide * 2, -design.levels.floorDepth), E(gx1, -design.levels.floorDepth)]} fill={POCHE} w={LW.thin} />
    </g>,
  );

  // --- Cut walls (garage and the shared house wall).
  parts.push(<g key="cut">{cutWalls(design, design.walls, f)}</g>);

  // --- Landing (cut).
  if (entry) {
    const L = entry.landing;
    const la = aOf({ x: L.x0, y: L.y0 });
    const lb = aOf({ x: L.x1, y: L.y1 });
    if (at >= Math.min(la, lb) && at <= Math.max(la, lb)) {
      const s0 = sOf({ x: L.x0, y: L.y0 });
      const s1 = sOf({ x: L.x1, y: L.y1 });
      const x0 = Math.min(hx(s0), hx(s1));
      const x1 = Math.max(hx(s0), hx(s1));
      parts.push(
        <g key="landing">
          <Poly points={[E(x0, g.floor), E(x1, g.floor), E(x1, entry.landingTop), E(x0, entry.landingTop)]} fill="#fff" w={LW.heavy} />
          <Line a={E(x0, g.floor)} b={E(x1, entry.landingTop - 1.5)} w={LW.hair} />
          <Line a={E(x0, entry.landingTop - 1.5)} b={E(x1, g.floor)} w={LW.hair} />
          <Line a={E(x0, entry.landingTop - 1.5)} b={E(x1, entry.landingTop - 1.5)} w={LW.fine} />
        </g>,
      );
    }
  }

  // A roof cut across its ridge shows both slopes; cut along its ridge it is a level band.
  const cutPoint = toPlan(faceS, at);
  const gable = (r: RoofFrame) => r.profiles.map((poly, i) => <Poly key={i} points={poly.map((q) => E(hx(q.x), q.y))} fill="#d9d9d9" w={LW.cut} />);
  const band = (r: RoofFrame, from: number, to: number) => {
    const under = r.undersideAt(r.sOf(cutPoint));
    return <Poly points={[E(from, under), E(to, under), E(to, under + r.tv), E(from, under + r.tv)]} fill="#d9d9d9" w={LW.cut} />;
  };

  // --- Garage ceiling and roof (cut).
  const ci = hx(outerS + houseDir * 3);
  const garageTop = rf.undersideAt(rf.sOf(cutPoint)) + rf.tv;
  parts.push(
    <g key="garage-roof">
      <Line a={E(ci, ceiling)} b={E(gx1, ceiling)} w={LW.med} />
      {/* Cut on the near side of the ridge, the roof beyond climbs to it. */}
      {!acrossRidge && (rf.ridgeS - at) * lookDir > 0 && (
        <Poly points={[E(hx(rf.a0), garageTop), E(hx(rf.a1), garageTop), E(hx(rf.a1), rf.ridgeTop), E(hx(rf.a0), rf.ridgeTop)]} fill="#fff" w={LW.fine} />
      )}
      {acrossRidge ? gable(rf) : band(rf, hx(rf.a0), hx(rf.a1))}
    </g>,
  );

  // --- House roof at the cut (clipped at the break, including the rake over the garage).
  const houseRoof: ReactNode = house.axis === alongAxis ? gable(house) : band(house, hx(houseDir > 0 ? house.a0 : house.a1), xBreak);
  parts.push(
    <g key="house-roof" clipPath={`url(#${clipId}-roof)`}>
      {houseRoof}
    </g>,
  );

  // --- Break line.
  const top = Math.max(house.ridgeTop, house.undersideAt(house.sOf(cutPoint)) + house.tv) + 12;
  const zig: Vec[] = [];
  const zy = [grade - FOOTING - 4, top];
  const mid = (zy[0] + zy[1]) / 2;
  zig.push(E(xBreak, zy[0]), E(xBreak, mid - 6), E(xBreak - 5, mid - 3), E(xBreak + 5, mid + 3), E(xBreak, mid + 6), E(xBreak, zy[1]));
  parts.push(<Poly key="break" points={zig} closed={false} w={LW.thin} />);

  // --- Labels.
  const gMid = hx((outerS + faceS) / 2);
  parts.push(
    <g key="labels">
      <Text at={E(gMid + garageSide * 20, 40)} size={TXT.label} weight="bold">GARAGE</Text>
      <Text at={E(gMid + garageSide * 20, 40 - p(17))} size={TXT.tiny} color={INK_LIGHT}>
        {`${formatFtIn(ceiling - g.floor)} CEILING`}
      </Text>
      <Text at={E(gMid, ceiling + 8)} size={TXT.tiny} color={INK_LIGHT}>ATTIC</Text>
      <Text at={E((hx(faceS) + xBreak) / 2, design.levels.wallHeight + 16)} size={TXT.label} weight="bold">GREAT ROOM</Text>
      <Text at={E((hx(faceS) + xBreak) / 2, -design.levels.floorDepth - 6)} size={TXT.tiny} color={INK_LIGHT}>CRAWL SPACE</Text>
      {entry && (
        <Text at={E(hx(faceS) + garageSide * 18, entry.landingTop + p(12))} size={TXT.tiny} weight="bold">
          {`${entry.opening.tag} / LANDING`}
        </Text>
      )}
    </g>,
  );

  // --- Grade, datums, dimensions, pitch.
  const outerX = hx(f.freeEdge) + garageSide * p(30);
  const breakX = xBreak - garageSide * p(30);
  const gradeLo = Math.min(outerX, breakX);
  const gradeHi = Math.max(outerX, breakX);
  parts.push(
    <g key="grade">
      <Line a={E(gradeLo, grade)} b={E(gradeHi, grade)} w={LW.heavy} />
      {Array.from({ length: Math.floor((gradeHi - gradeLo) / 10) }, (_, i) => (
        <Line key={i} a={E(gradeLo + i * 10 + 4, grade)} b={E(gradeLo + i * 10, grade - 4)} w={LW.hair} />
      ))}
    </g>,
  );
  const markX = hx(f.freeEdge) + garageSide * p(40);
  const left = garageSide < 0;
  parts.push(
    <g key="datums">
      <LevelMark x={markX} h={ceiling} label="GARAGE PLATE / CLG." left={left} />
      <LevelMark x={markX} h={0} label="FIN. FLOOR" left={left} lineFrom={hx(faceS)} />
      <LevelMark x={markX} h={g.floor} label="GARAGE SLAB" left={left} />
      <LevelMark x={xBreak - garageSide * p(40)} h={grade} label="AVG. GRADE" left={!left} />
    </g>,
  );
  if (entry) {
    const dimS = faceS - houseDir * (entry.width + 10);
    const x = hx(dimS);
    const pts = [g.floor, entry.landingTop, ceiling].map((h) => E(x, h));
    parts.push(<DimChain key="dims" points={pts} off={garageSide * p(1)} />);
  }
  if (acrossRidge) {
    const slopeS = f.freeEdge + (rf.ridgeS - f.freeEdge) * 0.5;
    const sx1 = hx(slopeS);
    const sx2 = hx(slopeS + Math.sign(rf.ridgeS - f.freeEdge));
    parts.push(
      <PitchMark key="pitch" at={E(sx1 + (sx2 > sx1 ? -p(10) : p(10)), rf.undersideAt(slopeS) + rf.tv + p(24))} pitch={rf.slope * 12} flip={sx2 < sx1} />,
    );
  }

  const clipTop = top + 40;
  const bottom = grade - FOOTING - 40;
  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <rect x={houseLo} y={-clipTop} width={houseHi - houseLo} height={clipTop - bottom} />
        </clipPath>
        <clipPath id={`${clipId}-roof`}>
          <rect
            x={Math.min(hx(f.freeEdge), xBreak)}
            y={-clipTop}
            width={Math.abs(hx(f.freeEdge) - xBreak)}
            height={clipTop - bottom}
          />
        </clipPath>
      </defs>
      {parts}
    </g>
  );
}

