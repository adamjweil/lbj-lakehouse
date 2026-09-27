import type { ReactNode } from 'react';
import type { Design } from '../../model/schema';
import {
  bbox, footprint, platforms, footprintBounds, garageFootprint, garageRoofFrame, offsetPolygon, pierLayout, rectPoints,
  roofFrame, roofFrames, type Rect, type RoofFrame, type Vec,
} from '../../model/geometry';
import { formatFtIn, formatPitch } from '../../model/units';
import { Dim, DimChain, INK, INK_LIGHT, LW, Line, Poly, Text, textWidth, TXT, useDraft } from '../draft/draft';
import { arrowHead } from './PlanDrawing';

export function roofPlanBounds(design: Design, margin: number) {
  const all = [
    ...roofFrames(design).map((r) => r.frame.planRect),
    ...platforms(design).flatMap((q) => [q.rect, q.stairs?.rect]),
  ].filter(Boolean) as Rect[];
  return {
    x0: Math.min(...all.map((q) => q.x0)) - margin,
    y0: Math.min(...all.map((q) => q.y0)) - margin,
    x1: Math.max(...all.map((q) => q.x1)) + margin,
    y1: Math.max(...all.map((q) => q.y1)) + margin,
  };
}

function DeckOutline({ design, dashed }: { design: Design; dashed?: boolean }) {
  return (
    <g>
      {platforms(design).map((dg) => (
        <g key={dg.kind}>
          <Poly points={rectPoints(dg.rect)} w={dg.skirt === 'solid' ? LW.med : LW.thin} dash={dashed ? [6, 3] : undefined} />
          {dg.stairs && <Poly points={rectPoints(dg.stairs.rect)} w={LW.thin} dash={dashed ? [6, 3] : undefined} />}
        </g>
      ))}
    </g>
  );
}

/** One gable roof in plan: outline, seams, ridge, slope arrows, and gutters on the free eaves. */
function RoofOutline({ design, rf, label }: { design: Design; rf: RoofFrame; label: boolean }) {
  const { p } = useDraft();
  const r = rf.planRect;
  const seams: ReactNode[] = [];
  for (let a = rf.a0 + design.roof.seamSpacing; a < rf.a1 - 1; a += design.roof.seamSpacing) {
    seams.push(<Line key={a} a={rf.toPlan(rf.eave0, a)} b={rf.toPlan(rf.eave1, a)} w={LW.hair} color="#b5b5b5" />);
  }
  const ridgeA = rf.toPlan(rf.ridgeS, rf.a0);
  const ridgeB = rf.toPlan(rf.ridgeS, rf.a1);
  const pitch = rf.slope * 12;
  const aMid = rf.a0 + (rf.a1 - rf.a0) * 0.3;
  const eaves = [
    { s: rf.eave0, free: rf.eave0 < rf.sMin - 0.5 },
    { s: rf.eave1, free: rf.eave1 > rf.sMax + 0.5 },
  ];
  const across = (sign: number): Vec => (rf.axis === 'x' ? { x: 0, y: sign } : { x: sign, y: 0 });
  // A rake with no overhang ends against the house wall.
  const rakes = [
    { a: rf.a0, sign: 1, free: rf.a0 < rf.aMin - 0.5 },
    { a: rf.a1, sign: -1, free: rf.a1 > rf.aMax + 0.5 },
  ];
  return (
    <g>
      <Poly points={rectPoints(r)} fill="#fff" w={LW.heavy} />
      {seams}
      <Line a={ridgeA} b={ridgeB} w={LW.med} />
      {rakes
        .filter((q) => !q.free)
        .map((q) => (
          <Text key={q.a} at={rf.toPlan(rf.ridgeS + (rf.eave1 - rf.ridgeS) * 0.5, q.a + q.sign * (24 + p(10)))} size={TXT.tiny} rotate={rf.axis === 'x' ? -90 : undefined} middle>
            STEP FLASHING AT HOUSE WALL
          </Text>
        ))}
      {label && (
        <Text
          at={{ x: (ridgeA.x + ridgeB.x) / 2 + (rf.axis === 'x' ? 0 : p(8)), y: (ridgeA.y + ridgeB.y) / 2 - (rf.axis === 'x' ? p(5) : 0) }}
          size={TXT.tiny}
          weight="bold"
          anchor={rf.axis === 'x' ? 'middle' : 'start'}
        >
          RIDGE
        </Text>
      )}
      {eaves.map(({ s: eave, free }, i) => {
        const sign = Math.sign(eave - rf.ridgeS);
        const from = rf.toPlan(rf.ridgeS + (eave - rf.ridgeS) * 0.2, aMid);
        const to = rf.toPlan(rf.ridgeS + (eave - rf.ridgeS) * 0.75, aMid);
        const text = rf.toPlan(rf.ridgeS + (eave - rf.ridgeS) * 0.5, aMid + p(8));
        const gutterS = eave + sign * 4;
        return (
          <g key={i}>
            <Line a={from} b={to} w={LW.thin} />
            <Poly points={arrowHead(to, across(sign), p(10))} fill={INK} w={0} />
            <Text at={text} size={TXT.tiny} anchor="start" middle>{`${formatPitch(pitch)} DN`}</Text>
            {free ? (
              <g>
                <Line a={rf.toPlan(gutterS, rf.a0)} b={rf.toPlan(gutterS, rf.a1)} w={LW.thin} />
                {[rf.a0 + 6, rf.a1 - 6].map((a) => {
                  const c = rf.toPlan(gutterS, a);
                  return <circle key={a} cx={c.x} cy={c.y} r={2.5} fill="#fff" stroke={INK} strokeWidth={p(LW.thin)} />;
                })}
              </g>
            ) : (
              <Text at={rf.toPlan(eave - sign * (24 + p(10)), (rf.a0 + rf.a1) / 2)} size={TXT.tiny} rotate={rf.axis === 'y' ? -90 : undefined} middle>
                STEP FLASHING AT HOUSE WALL
              </Text>
            )}
          </g>
        );
      })}
    </g>
  );
}

export function RoofPlanDrawing({ design }: { design: Design }) {
  const { p } = useDraft();
  const house = roofFrame(design);
  const garage = garageRoofFrame(design);
  const r = house.planRect;
  const fp = footprint(design);
  const gfp = garageFootprint(design);
  return (
    <g>
      <DeckOutline design={design} />
      {garage && <RoofOutline design={design} rf={garage} label={false} />}
      {gfp && <Poly points={gfp} w={LW.thin} dash={[6, 3]} stroke={INK_LIGHT} />}
      <RoofOutline design={design} rf={house} label />
      <Poly points={fp} w={LW.thin} dash={[6, 3]} stroke={INK_LIGHT} />
      <Text at={{ x: (r.x0 + r.x1) / 2, y: r.y0 + (r.y1 - r.y0) * 0.72 }} size={TXT.tiny} color={INK_LIGHT}>
        {design.specs.roof.covering.toUpperCase()}
      </Text>
      <Text at={{ x: (r.x0 + r.x1) / 2, y: r.y0 + (r.y1 - r.y0) * 0.72 + p(12) }} size={TXT.tiny} color={INK_LIGHT}>
        {`${design.specs.framing.rafters} · ${design.specs.framing.ridge} (by eng.)`.toUpperCase()}
      </Text>
      <Dim a={{ x: r.x0, y: r.y0 }} b={{ x: r.x1, y: r.y0 }} off={p(45)} />
      <Dim a={{ x: r.x1, y: r.y0 }} b={{ x: r.x1, y: r.y1 }} off={p(45)} />
      {garage && (
        <>
          <Dim a={{ x: garage.planRect.x0, y: r.y0 }} b={{ x: garage.planRect.x1, y: r.y0 }} off={p(80)} extFrom={p(6) + (garage.planRect.y0 - r.y0)} />
          <Dim a={{ x: garage.planRect.x0, y: garage.planRect.y0 }} b={{ x: garage.planRect.x0, y: garage.planRect.y1 }} off={-p(45)} />
          <Text at={{ x: (garage.planRect.x0 + garage.planRect.x1) / 2, y: garage.planRect.y0 + (garage.planRect.y1 - garage.planRect.y0) * 0.72 }} size={TXT.tiny} color={INK_LIGHT}>
            GARAGE ROOF
          </Text>
        </>
      )}
      <Text at={{ x: r.x1 + p(10), y: r.y1 + p(22) }} size={TXT.tiny} anchor="end" color={INK_LIGHT}>
        GUTTERS AND DOWNSPOUTS AT EAVES
      </Text>
    </g>
  );
}

export function FoundationDrawing({ design }: { design: Design }) {
  const { p } = useDraft();
  const fb = footprintBounds(design);
  const fp = footprint(design);
  const { beams, piers } = pierLayout(design);
  const size = design.foundation.pierSize;
  const houseBeams = beams.filter((b) => !b.deck);
  const firstBeam = houseBeams[0];
  const xs = [...new Set(piers.filter((q) => !q.deck && Math.abs(q.p.y - firstBeam.a.y) < 0.5).map((q) => q.p.x))].sort((a, b) => a - b);
  const ys = houseBeams.map((b) => b.a.y).sort((a, b) => a - b);
  const midY = (ys[0] + (ys[1] ?? ys[0])) / 2;
  const labelY = ys.length > 2 ? (ys[1] + ys[2]) / 2 : fb.y1 - p(24);
  const jx = fb.x0 + (fb.x1 - fb.x0) * 0.62;
  const topY = Math.min(fb.y0, ...platforms(design).flatMap((q) => [q.rect.y0, q.stairs?.rect.y0 ?? q.rect.y0]));
  return (
    <g>
      <Poly points={fp} w={LW.med} />
      <Poly points={offsetPolygon(fp, fp.map(() => 6), false)} w={LW.hair} dash={[4, 3]} />
      <DeckOutline design={design} />
      {beams.map((b, i) => (
        <g key={i}>
          <Line a={b.a} b={b.b} w={LW.heavy} dash={[14, 5]} />
        </g>
      ))}
      {piers.map((q, i) => (
        <g key={i}>
          <circle cx={q.p.x} cy={q.p.y} r={size / 2} fill="#fff" stroke={INK} strokeWidth={p(LW.med)} />
          <rect x={q.p.x - size} y={q.p.y - size} width={size * 2} height={size * 2} fill="none" stroke={INK} strokeWidth={p(LW.hair)} strokeDasharray={`${p(4)} ${p(3)}`} />
        </g>
      ))}
      {/* joist span arrow */}
      <Line a={{ x: jx, y: ys[0] + 6 }} b={{ x: jx, y: (ys[1] ?? fb.y1) - 6 }} w={LW.thin} />
      <Poly points={arrowHead({ x: jx, y: ys[0] + 4 }, { x: 0, y: -1 }, p(9))} fill={INK} w={0} />
      <Poly points={arrowHead({ x: jx, y: (ys[1] ?? fb.y1) - 4 }, { x: 0, y: 1 }, p(9))} fill={INK} w={0} />
      <Text at={{ x: jx + p(8), y: midY }} size={TXT.tiny} anchor="start" middle>
        {design.specs.foundation.joists.toUpperCase()}
      </Text>
      <Text at={{ x: (fb.x0 + fb.x1) / 2, y: labelY }} size={TXT.tiny} color={INK_LIGHT} middle>
        {`${design.specs.foundation.beams} on ${formatFtIn(size)} dia. concrete piers (size by engineer)`.toUpperCase()}
      </Text>
      {/* The pier dimension string sits beyond anything built on the north side. */}
      <DimChain points={xs.map((x) => ({ x, y: topY }))} off={p(30)} />
      <DimChain points={ys.map((y) => ({ x: fb.x1, y }))} off={p(30)} />
      <GarageSlab design={design} />
      <Text at={{ x: fb.x1 - p(24), y: fb.y1 - p(20) }} size={TXT.tiny} anchor="end" color={INK_LIGHT}>
        {design.specs.foundation.skirt.toUpperCase()}
      </Text>
      {platforms(design)
        .filter((q) => q.skirt === 'solid')
        .map((q) => (
          <Text key={q.kind} at={{ x: (q.rect.x0 + q.rect.x1) / 2 + p(150), y: (q.rect.y0 + q.rect.y1) / 2 }} size={TXT.tiny} color={INK_LIGHT} middle>
            {`${q.kind.toUpperCase()}: SOLID SKIRT WITH FOUNDATION VENTS`}
          </Text>
        ))}
    </g>
  );
}

/** Garage slab on grade with thickened-edge footings on its free sides. */
function GarageSlab({ design }: { design: Design }) {
  const { p } = useDraft();
  const gfp = garageFootprint(design);
  if (!gfp || !design.garage) return null;
  const g = bbox(gfp);
  const fb = footprintBounds(design);
  const inset = 12;
  // Inset the footing line on every side except the one against the house.
  const inner = {
    x0: g.x0 + (Math.abs(g.x0 - fb.x1) < 1 ? 0 : inset),
    x1: g.x1 - (Math.abs(g.x1 - fb.x0) < 1 ? 0 : inset),
    y0: g.y0 + (Math.abs(g.y0 - fb.y1) < 1 ? 0 : inset),
    y1: g.y1 - (Math.abs(g.y1 - fb.y0) < 1 ? 0 : inset),
  };
  const c = { x: (g.x0 + g.x1) / 2, y: (g.y0 + g.y1) / 2 };
  const slabText = design.specs.foundation.garageSlab.toUpperCase();
  // Keep the stipple out from behind the label.
  const clear = { dx: p(textWidth(slabText, TXT.tiny)) / 2 + p(14), y0: c.y - p(22), y1: c.y + p(26) };
  const dots: ReactNode[] = [];
  for (let x = g.x0 + 9; x < g.x1 - 4; x += 18) {
    for (let y = g.y0 + 9; y < g.y1 - 4; y += 18) {
      const jx = ((x * 7 + y * 13) % 9) - 4;
      const jy = ((x * 11 + y * 5) % 9) - 4;
      if (Math.abs(x + jx - c.x) < clear.dx && y + jy > clear.y0 && y + jy < clear.y1) continue;
      dots.push(<circle key={`${x}-${y}`} cx={x + jx} cy={y + jy} r={0.7} fill={INK_LIGHT} />);
    }
  }
  return (
    <g>
      <g>{dots}</g>
      <Poly points={rectPoints(g)} w={LW.med} />
      <Poly points={rectPoints(inner)} w={LW.thin} dash={[8, 4]} />
      <Text at={{ x: c.x, y: c.y - p(8) }} size={TXT.label} weight="bold">GARAGE SLAB</Text>
      <Text at={{ x: c.x, y: c.y + p(8) }} size={TXT.tiny}>{slabText}</Text>
      <Text at={{ x: c.x, y: c.y + p(20) }} size={TXT.tiny}>SLOPE 1/8" PER FT TO DOOR</Text>
      <Text at={{ x: c.x, y: inner.y0 + p(14) }} size={TXT.tiny} color={INK_LIGHT}>THICKENED EDGE FTG. (BY ENG.)</Text>
      <Dim a={{ x: g.x0, y: g.y0 }} b={{ x: g.x1, y: g.y0 }} off={p(30)} />
      <Dim a={{ x: g.x0, y: g.y0 }} b={{ x: g.x0, y: g.y1 }} off={-p(30)} />
    </g>
  );
}
