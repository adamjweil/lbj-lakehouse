import type { ReactNode } from 'react';
import type { Design, Opening, Side, Wall } from '../../model/schema';
import {
  footprint, platformRailings, platforms, type Platform, footprintBounds, garageFootprint, garageRoofFrame, pierLayout, pointAlong,
  roofFrame, roofFrames, wallEndExtensions, wallFace, wallLength, wallProfile, SIDE_NORMAL, dot, type RoofFrame, type Vec,
} from '../../model/geometry';
import { INK, INK_LIGHT, LW, Line, LevelMark, PitchMark, Poly, Tag, Text, TXT, useDraft } from '../draft/draft';

export const BEAM_DEPTH = 9.25;

/** Horizontal drawing coordinate for a plan point seen from outside the given side. */
export function projector(side: Side) {
  switch (side) {
    case 'south':
      return (p: Vec) => p.x;
    case 'north':
      return (p: Vec) => -p.x;
    case 'east':
      return (p: Vec) => -p.y;
    case 'west':
      return (p: Vec) => p.y;
  }
}

const E = (x: number, h: number): Vec => ({ x, y: -h });

export function elevationBounds(design: Design, side: Side) {
  const hx = projector(side);
  const xs: number[] = [];
  let top = -Infinity;
  for (const { frame: rf } of roofFrames(design)) {
    for (const s of [rf.eave0, rf.eave1]) for (const a of [rf.a0, rf.a1]) xs.push(hx(rf.toPlan(s, a)));
    top = Math.max(top, rf.ridgeTop);
  }
  for (const r of platforms(design).flatMap((q) => [q.rect, q.stairs?.rect])) {
    if (!r) continue;
    xs.push(hx({ x: r.x0, y: r.y0 }), hx({ x: r.x1, y: r.y1 }));
  }
  return { x0: Math.min(...xs), x1: Math.max(...xs), h0: -design.levels.floorHeight, h1: top };
}

/** A roof seen from one side: a gable profile when looking along the ridge, otherwise the sloped surface. */
function RoofElevation({ design, rf, side, label }: { design: Design; rf: RoofFrame; side: Side; label: boolean }) {
  const { p } = useDraft();
  const hx = projector(side);
  const gableFace = rf.axis === 'x' ? side === 'east' || side === 'west' : side === 'north' || side === 'south';
  if (gableFace) {
    const polys = rf.profiles.map((poly) => poly.map((q) => E(hx(rf.toPlan(q.x, rf.a0)), q.y)));
    // Pitch mark over the slope that has an overhang (the free side).
    const freeEave = rf.eave0 < rf.sMin - 0.5 ? rf.eave0 : rf.eave1;
    const s1 = freeEave + (rf.ridgeS - freeEave) * 0.35;
    const x1 = hx(rf.toPlan(s1, 0));
    const x2 = hx(rf.toPlan(s1 + Math.sign(rf.ridgeS - freeEave), 0));
    const top = rf.undersideAt(s1) + rf.tv;
    return (
      <g>
        {polys.map((poly, i) => (
          <g key={i}>
            <Poly points={poly} fill="#fff" w={LW.heavy} />
            <Poly points={[poly[0], poly[1]].map((q) => ({ x: q.x, y: q.y - 5.5 }))} closed={false} w={LW.hair} />
          </g>
        ))}
        <PitchMark at={E(x1 + (x2 > x1 ? -p(10) : p(10)), top + p(26))} pitch={rf.slope * 12} flip={x2 < x1} />
      </g>
    );
  }
  // Seen from an eave side: only the slope facing the viewer shows above its eave.
  const n = SIDE_NORMAL[side];
  const facing = dot(rf.toPlan(1, 0), n) - dot(rf.toPlan(0, 0), n) > 0 ? rf.eave1 : rf.eave0;
  const eaveUnder = rf.undersideAt(facing);
  const eaveTop = eaveUnder + rf.tv;
  const xa = [hx(rf.toPlan(facing, rf.a0)), hx(rf.toPlan(facing, rf.a1))].sort((a, c) => a - c);
  const seams: ReactNode[] = [];
  for (let a = rf.a0 + design.roof.seamSpacing; a < rf.a1 - 1; a += design.roof.seamSpacing) {
    const x = hx(rf.toPlan(facing, a));
    seams.push(<Line key={a} a={E(x, eaveTop)} b={E(x, rf.ridgeTop - 3)} w={LW.hair} color={INK_LIGHT} />);
  }
  return (
    <g>
      <Poly points={[E(xa[0], eaveTop), E(xa[1], eaveTop), E(xa[1], rf.ridgeTop), E(xa[0], rf.ridgeTop)]} fill="#fff" w={LW.med} />
      {seams}
      <Line a={E(xa[0], rf.ridgeTop - 3)} b={E(xa[1], rf.ridgeTop - 3)} w={LW.thin} />
      <Poly points={[E(xa[0], eaveUnder), E(xa[1], eaveUnder), E(xa[1], eaveTop), E(xa[0], eaveTop)]} fill="#fff" w={LW.heavy} />
      <Line a={E(xa[0], eaveUnder + 5.5)} b={E(xa[1], eaveUnder + 5.5)} w={LW.hair} />
      {label && (
        <Text at={E((xa[0] + xa[1]) / 2 + p(120), eaveTop + (rf.ridgeTop - eaveTop) / 2)} size={TXT.tiny} middle color={INK_LIGHT}>
          STANDING SEAM METAL ROOF
        </Text>
      )}
    </g>
  );
}

export function ElevationDrawing({ design, side }: { design: Design; side: Side }) {
  const { p } = useDraft();
  const hx = projector(side);
  const rf = roofFrame(design);
  const garageRf = garageRoofFrame(design);
  const b = elevationBounds(design, side);
  const fb = footprintBounds(design);
  const grade = -design.levels.floorHeight;
  const faceWalls = design.walls.filter((w) => wallFace(design, w) === side);
  const houseX = [hx({ x: fb.x0, y: fb.y0 }), hx({ x: fb.x1, y: fb.y1 })].sort((a, c) => a - c);
  const right = b.x1 + p(30);
  const closeness = (q: Vec) => dot(q, SIDE_NORMAL[side]);
  const range = (pts: Vec[]) => {
    const c = pts.map(closeness);
    return [Math.min(...c), Math.max(...c)];
  };
  const houseNear = range(footprint(design))[1];

  // Base: rim band, lattice skirt
  const band = (
    <g>
      <clipPath id={`skirt-${side}`}>
        <rect x={houseX[0]} y={design.levels.floorDepth} width={houseX[1] - houseX[0]} height={design.levels.floorHeight - design.levels.floorDepth} />
      </clipPath>
      <rect x={houseX[0]} y={design.levels.floorDepth} width={houseX[1] - houseX[0]} height={design.levels.floorHeight - design.levels.floorDepth} fill="#fff" stroke={INK} strokeWidth={p(LW.thin)} />
      <g clipPath={`url(#skirt-${side})`} stroke={INK_LIGHT} strokeWidth={p(LW.hair)}>
        {Array.from({ length: Math.ceil((houseX[1] - houseX[0] + 40) / 6) }, (_, i) => {
          const x = houseX[0] - 30 + i * 6;
          return (
            <g key={i}>
              <line x1={x} y1={-grade} x2={x + 30} y2={design.levels.floorDepth} />
              <line x1={x + 30} y1={-grade} x2={x} y2={design.levels.floorDepth} />
            </g>
          );
        })}
      </g>
      <Poly points={[E(houseX[0], -design.levels.floorDepth), E(houseX[1], -design.levels.floorDepth), E(houseX[1], 0), E(houseX[0], 0)]} fill="#fff" w={LW.thin} />
    </g>
  );
  const house = (
    <g>
      {band}
      {faceWalls.filter((w) => !w.zone).map((w) => (
        <ElevationWall key={w.id} design={design} wall={w} side={side} />
      ))}
      <RoofElevation design={design} rf={rf} side={side} label />
    </g>
  );

  // Garage: slab edge, walls, and roof, drawn in front of or behind the house by depth.
  const gfp = garageFootprint(design);
  let garage: ReactNode = null;
  let garageInFront = false;
  if (gfp && garageRf && design.garage) {
    const [gFar, gNear] = range(gfp);
    garageInFront = gFar >= houseNear - 0.5 && gNear > houseNear + 0.5;
    const gx = [hx(gfp[0]), hx(gfp[2])].sort((a, c) => a - c);
    const slabTop = design.garage.floor;
    garage = (
      <g>
        <Poly points={[E(gx[0], grade), E(gx[1], grade), E(gx[1], slabTop), E(gx[0], slabTop)]} fill="#fff" w={LW.thin} />
        {faceWalls.filter((w) => w.zone === 'garage').map((w) => (
          <ElevationWall key={w.id} design={design} wall={w} side={side} />
        ))}
        <RoofElevation design={design} rf={garageRf} side={side} label={false} />
      </g>
    );
  }

  // Platforms behind the house are drawn first so the house hides them.
  const houseMin = Math.min(closeness({ x: fb.x0, y: fb.y0 }), closeness({ x: fb.x1, y: fb.y1 }));
  const plats = platforms(design).map((dg) => ({
    dg,
    behind: closeness({ x: (dg.rect.x0 + dg.rect.x1) / 2, y: (dg.rect.y0 + dg.rect.y1) / 2 }) < houseMin,
  }));
  const platformsDrawn = (behind: boolean) =>
    plats.filter((q) => q.behind === behind).map((q) => <PlatformElevation key={q.dg.kind} design={design} side={side} dg={q.dg} />);
  const left = b.x0 - p(30);
  const garageVisible = !!garage && faceWalls.some((w) => w.zone === 'garage');
  // Garage datums go on the garage's side; on the right they sit beyond the house datums.
  const gSide = gfp ? hx({ x: (gfp[0].x + gfp[2].x) / 2, y: (gfp[0].y + gfp[2].y) / 2 }) > (houseX[0] + houseX[1]) / 2 : false;
  const gMarkX = gSide ? right + p(24) + p(200) : left - p(24);
  return (
    <g>
      {platformsDrawn(true)}
      {!garageInFront && garage}
      {house}
      {garageInFront && garage}
      {platformsDrawn(false)}
      {/* Grade */}
      <Line a={E(left - p(10), grade)} b={E(right + p(10), grade)} w={LW.heavy} />
      {Array.from({ length: Math.floor((right - left + p(20)) / 10) }, (_, i) => {
        const x = left - p(10) + i * 10 + 4;
        return <Line key={i} a={E(x, grade)} b={E(x - 4, grade - 4)} w={LW.hair} />;
      })}
      <LevelMark x={right + p(24)} h={rf.ridgeTop} label="T.O. RIDGE" lineFrom={houseX[1]} />
      <LevelMark x={right + p(24)} h={design.levels.wallHeight} label="T.O. PLATE" lineFrom={houseX[1]} />
      <LevelMark x={right + p(24)} h={0} label="FIN. FLOOR" lineFrom={houseX[1]} />
      <LevelMark x={right + p(24)} h={grade} label="AVG. GRADE" />
      {garageVisible && design.garage && (
        <>
          <LevelMark x={gMarkX} h={design.garage.floor + design.garage.plateHeight} label="GARAGE PLATE" left={!gSide} />
          <LevelMark x={gMarkX} h={design.garage.floor} label="GARAGE SLAB" left={!gSide} />
        </>
      )}
    </g>
  );
}

function ElevationWall({ design, wall: w, side }: { design: Design; wall: Wall; side: Side }) {
  const { p } = useDraft();
  const hx = projector(side);
  const prof = wallProfile(design, w);
  // A wall that steps back at a corner is still seen out to the building's outer corner.
  const [e0, e1] = wallEndExtensions(design, w);
  const L = wallLength(w);
  const ua = e0 < 0 ? e0 : prof.u0;
  const ub = e1 < 0 ? L - e1 : prof.u1;
  const widen = (q: Vec): Vec =>
    Math.abs(q.x - prof.u0) < 1e-6 ? { x: ua, y: q.y > prof.outline[0].y + 1e-6 ? prof.topAt(ua) : q.y }
    : Math.abs(q.x - prof.u1) < 1e-6 ? { x: ub, y: q.y > prof.outline[0].y + 1e-6 ? prof.topAt(ub) : q.y }
    : q;
  const map = (q: Vec) => E(hx(pointAlong(w, q.x)), q.y);
  const outline = prof.outline.map(widen).map(map);
  const xs = outline.map((q) => q.x);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const top = Math.max(...prof.outline.map((q) => q.y));
  const id = `sid-${side}-${w.id}`;
  const base = prof.outline[0].y;
  const battens: ReactNode[] = [];
  for (let x = Math.ceil(x0 / 12) * 12; x < x1; x += 12) {
    battens.push(<line key={x} x1={x} x2={x} y1={-top} y2={-base} />);
  }
  const openings = [...prof.holes, ...prof.doors];
  return (
    <g>
      <clipPath id={id}>
        <polygon points={outline.map((q) => `${q.x},${q.y}`).join(' ')} />
      </clipPath>
      <Poly points={outline} fill="#fff" w={0} />
      <g clipPath={`url(#${id})`} stroke={INK_LIGHT} strokeWidth={p(LW.hair)}>
        {battens}
      </g>
      {/* corner boards */}
      <Poly points={[E(x0, base), E(x0 + 5.5, base), E(x0 + 5.5, prof.topAt(ua) - 1), E(x0, prof.topAt(ua) - 1)].map((q) => ({ ...q, y: Math.max(q.y, -top) }))} fill="#fff" w={LW.fine} />
      <Poly points={[E(x1 - 5.5, base), E(x1, base), E(x1, prof.topAt(ub) - 1), E(x1 - 5.5, prof.topAt(ub) - 1)].map((q) => ({ ...q, y: Math.max(q.y, -top) }))} fill="#fff" w={LW.fine} />
      <Poly points={outline} w={LW.med} />
      {openings.map(({ opening, rect }) => {
        const a = hx(pointAlong(w, rect[0]));
        const b = hx(pointAlong(w, rect[2]));
        return <OpeningElevation key={opening.id} o={opening} x0={Math.min(a, b)} x1={Math.max(a, b)} v0={rect[1]} v1={rect[3]} />;
      })}
    </g>
  );
}

export function OpeningElevation({ o, x0, x1, v0, v1, noTrim }: { o: Opening; x0: number; x1: number; v0: number; v1: number; noTrim?: boolean }) {
  const { p } = useDraft();
  const R = (a: number, b: number, c: number, d: number) => [E(a, b), E(c, b), E(c, d), E(a, d)];
  const trim = 3.5;
  const f = 2;
  const parts: ReactNode[] = [];
  const glass = (a: number, b: number, c: number, d: number, k: string) => (
    <Poly key={k} points={R(a, b, c, d)} fill="#eef3f6" w={LW.fine} />
  );
  const mid = (x0 + x1) / 2;
  if (o.kind === 'window') {
    parts.push(<Poly key="frame" points={R(x0, v0, x1, v1)} fill="#fff" w={LW.thin} />);
    if (o.operation === 'double-hung') {
      const vm = (v0 + v1) / 2;
      parts.push(glass(x0 + f, v0 + f, x1 - f, vm - 0.75, 'g1'), glass(x0 + f, vm + 0.75, x1 - f, v1 - f, 'g2'));
    } else if (o.operation === 'slider') {
      parts.push(glass(x0 + f, v0 + f, mid - 0.75, v1 - f, 'g1'), glass(mid + 0.75, v0 + f, x1 - f, v1 - f, 'g2'));
    } else {
      parts.push(glass(x0 + f, v0 + f, x1 - f, v1 - f, 'g'));
    }
    if (o.operation === 'casement') {
      parts.push(<Poly key="sw" points={[E(x0 + f, v0 + f), E(x1 - f, (v0 + v1) / 2), E(x0 + f, v1 - f)]} closed={false} w={LW.hair} dash={[4, 3]} />);
    } else if (o.operation === 'awning') {
      parts.push(<Poly key="sw" points={[E(x0 + f, v0 + f), E(mid, v1 - f), E(x1 - f, v0 + f)]} closed={false} w={LW.hair} dash={[4, 3]} />);
    }
    if (!noTrim) {
      parts.unshift(<Poly key="trim" points={R(x0 - trim, v0, x1 + trim, v1 + trim)} fill="#fff" w={LW.fine} />);
      parts.push(<Poly key="sill" points={R(x0 - trim - 1, v0 - 1.5, x1 + trim + 1, v0)} fill="#fff" w={LW.fine} />);
    }
  } else if (o.kind === 'slider') {
    parts.push(<Poly key="frame" points={R(x0, v0, x1, v1)} fill="#fff" w={LW.thin} />);
    parts.push(glass(x0 + 3, v0 + 4, mid - 1, v1 - 3, 'g1'), glass(mid + 1, v0 + 4, x1 - 3, v1 - 3, 'g2'));
    if (!noTrim) parts.unshift(<Poly key="trim" points={R(x0 - trim, v0, x1 + trim, v1 + trim)} fill="#fff" w={LW.fine} />);
  } else if (o.operation === 'overhead') {
    parts.push(<Poly key="frame" points={R(x0, v0, x1, v1)} fill="#fff" w={LW.thin} />);
    const panels = 4;
    for (let k = 1; k < panels; k++) {
      const v = v0 + ((v1 - v0) * k) / panels;
      parts.push(<Line key={`p${k}`} a={E(x0, v)} b={E(x1, v)} w={LW.fine} />);
    }
    // A row of lites in the top panel.
    const lites = 4;
    const top = v0 + ((v1 - v0) * (panels - 1)) / panels;
    for (let k = 0; k < lites; k++) {
      const a = x0 + 6 + ((x1 - x0 - 12) * k) / lites;
      const c = x0 + 6 + ((x1 - x0 - 12) * (k + 1)) / lites - 4;
      parts.push(glass(a, top + 5, c, v1 - 5, `l${k}`));
    }
    if (!noTrim) parts.unshift(<Poly key="trim" points={R(x0 - trim, v0, x1 + trim, v1 + trim)} fill="#fff" w={LW.fine} />);
  } else if (o.operation === 'cased') {
    parts.push(<Poly key="frame" points={R(x0, v0, x1, v1)} fill="#fff" w={LW.thin} />);
  } else {
    parts.push(<Poly key="frame" points={R(x0, v0, x1, v1)} fill="#fff" w={LW.thin} />);
    if (o.operation === 'bifold') {
      for (const x of [x0 + (x1 - x0) / 4, mid, x0 + (3 * (x1 - x0)) / 4]) parts.push(<Line key={x} a={E(x, v0)} b={E(x, v1)} w={LW.hair} />);
    } else {
      parts.push(<Poly key="p1" points={R(x0 + 4, v0 + 8, x1 - 4, v0 + 32)} w={LW.hair} />);
      if (o.note && /lite|glass/i.test(o.note)) parts.push(glass(x0 + 4, v0 + 40, x1 - 4, v1 - 6, 'lite'));
      else parts.push(<Poly key="p2" points={R(x0 + 4, v0 + 40, x1 - 4, v1 - 6)} w={LW.hair} />);
      const knobX = o.hinge === 'end' ? x0 + 3 : x1 - 3;
      parts.push(<circle key="knob" cx={knobX} cy={-(v0 + 36)} r={1.2} fill="none" stroke={INK} strokeWidth={p(LW.fine)} />);
    }
    if (!noTrim) parts.unshift(<Poly key="trim" points={R(x0 - trim, v0, x1 + trim, v1 + trim)} fill="#fff" w={LW.fine} />);
  }
  return (
    <g>
      {parts}
      {!noTrim && <Tag at={E(mid, (v0 + v1) / 2)} text={o.tag} shape={o.kind === 'window' ? 'hex' : 'circle'} />}
    </g>
  );
}

function PlatformElevation({ design, side, dg }: { design: Design; side: Side; dg: Platform }) {
  const { p } = useDraft();
  const hx = projector(side);
  const top = -1;
  const rimBot = top - 11.25;
  const grade = -design.levels.floorHeight;
  const rail = dg.spec.railingHeight;
  const r = dg.rect;
  const dx = [hx({ x: r.x0, y: r.y0 }), hx({ x: r.x1, y: r.y1 })].sort((a, b) => a - b);
  const parts: ReactNode[] = [];

  if (dg.skirt === 'solid') {
    // Board-and-batten skirt from grade to the rim hides the space underneath.
    const battens: ReactNode[] = [];
    for (let x = Math.ceil(dx[0] / 12) * 12; x < dx[1]; x += 12) {
      battens.push(<Line key={x} a={E(x, grade)} b={E(x, rimBot)} w={LW.hair} color={INK_LIGHT} />);
    }
    parts.push(
      <g key="skirt">
        <Poly points={[E(dx[0], grade), E(dx[1], grade), E(dx[1], rimBot), E(dx[0], rimBot)]} fill="#fff" w={LW.thin} />
        {battens}
      </g>,
    );
  } else {
    // Posts under the platform
    const posts = new Set<number>();
    for (const pr of pierLayout(design).piers) if (pr.platform === dg.kind) posts.add(Math.round(hx(pr.p)));
    for (const x of posts) {
      parts.push(<Poly key={`post${x}`} points={[E(x - 2.75, grade), E(x + 2.75, grade), E(x + 2.75, rimBot), E(x - 2.75, rimBot)]} fill="#fff" w={LW.thin} />);
    }
  }
  // Rim / fascia
  parts.push(<Poly key="rim" points={[E(dx[0], rimBot), E(dx[1], rimBot), E(dx[1], top), E(dx[0], top)]} fill="#fff" w={LW.med} />);

  // Railings
  const runs = platformRailings(design, dg);
  for (const [i, [a, b]] of runs.entries()) {
    const xa = hx(a);
    const xb = hx(b);
    const lo = Math.min(xa, xb);
    const hi = Math.max(xa, xb);
    if (hi - lo < 1) {
      // Seen end-on: a single post.
      parts.push(<Poly key={`rp${i}`} points={[E(lo - 1.75, top), E(lo + 1.75, top), E(lo + 1.75, rail), E(lo - 1.75, rail)]} fill="#fff" w={LW.thin} />);
      continue;
    }
    const bal: ReactNode[] = [];
    for (let x = lo + 5; x < hi - 2; x += 5) bal.push(<Line key={x} a={E(x, top + 3.5)} b={E(x, rail - 3.5)} w={LW.hair} />);
    const nPosts = Math.max(1, Math.ceil((hi - lo) / 72));
    const postXs = Array.from({ length: nPosts + 1 }, (_, k) => lo + ((hi - lo) * k) / nPosts);
    parts.push(
      <g key={`rail${i}`}>
        {bal}
        <Poly points={[E(lo, rail - 3.5), E(hi, rail - 3.5), E(hi, rail), E(lo, rail)]} fill="#fff" w={LW.thin} />
        <Poly points={[E(lo, top + 3.5), E(hi, top + 3.5), E(hi, top + 5), E(lo, top + 5)]} fill="#fff" w={LW.fine} />
        {postXs.map((x) => (
          <Poly key={x} points={[E(x - 1.75, top), E(x + 1.75, top), E(x + 1.75, rail + 1), E(x - 1.75, rail + 1)]} fill="#fff" w={LW.thin} />
        ))}
      </g>,
    );
  }

  // Stairs
  const s = dg.stairs;
  if (s) {
    const sx = [hx({ x: s.rect.x0, y: s.rect.y0 }), hx({ x: s.rect.x1, y: s.rect.y1 })].sort((a, b) => a - b);
    const frontOn = dg.side === side;
    if (frontOn || dg.side === oppositeOf(side)) {
      const steps: ReactNode[] = [];
      for (let i = 1; i < s.risers; i++) {
        const h = top - i * s.riserHeight;
        steps.push(<Line key={i} a={E(sx[0], h)} b={E(sx[1], h)} w={LW.thin} />);
      }
      parts.push(
        <g key="stairs">
          <Poly points={[E(sx[0], grade), E(sx[1], grade), E(sx[1], top), E(sx[0], top)]} fill="#fff" w={LW.thin} />
          {steps}
          {[sx[0], sx[1]].map((x) => (
            <Poly key={x} points={[E(x - 1.75, grade), E(x + 1.75, grade), E(x + 1.75, grade + 36 + 6), E(x - 1.75, grade + 36 + 6)]} fill="#fff" w={LW.thin} />
          ))}
        </g>,
      );
    } else {
      // Side view: sawtooth stringer
      const edgeX = hx(side === 'east' || side === 'west' ? { x: 0, y: s.edge } : { x: s.edge, y: 0 });
      const far = Math.abs(sx[0] - edgeX) > Math.abs(sx[1] - edgeX) ? sx[0] : sx[1];
      const dir = Math.sign(far - edgeX);
      const tooth: Vec[] = [E(edgeX, top)];
      for (let i = 1; i <= s.risers; i++) {
        const h = top - i * s.riserHeight;
        const x = edgeX + dir * (i - 1) * s.tread;
        tooth.push(E(x, h + s.riserHeight), E(x, h));
        if (i < s.risers) tooth.push(E(x + dir * s.tread, h));
      }
      tooth.push(E(far, grade), E(edgeX, top - 11.25));
      parts.push(
        <g key="stairs">
          <Poly points={tooth} fill="#fff" w={LW.thin} />
          <Line a={E(edgeX, top + 34)} b={E(far, grade + 34 + 4)} w={LW.thin} />
          <Line a={E(far, grade)} b={E(far, grade + 34 + 4)} w={LW.thin} />
        </g>,
      );
    }
  }

  return (
    <g>
      {parts}
      <Text at={E((dx[0] + dx[1]) / 2, rimBot - p(16))} size={TXT.tiny} color={INK_LIGHT}>
        {side === dg.side ? dg.kind.toUpperCase() : ''}
      </Text>
    </g>
  );
}

function oppositeOf(s: Side): Side {
  return ({ north: 'south', south: 'north', east: 'west', west: 'east' } as const)[s];
}

export const SIDE_TITLES: Record<Side, string> = {
  south: 'South Elevation',
  north: 'North Elevation',
  east: 'East Elevation',
  west: 'West Elevation',
};

export { INK };
