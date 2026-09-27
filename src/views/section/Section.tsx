import type { ReactNode } from 'react';
import type { Design } from '../../model/schema';
import {
  deckGeom, openingRange, platforms, pierLayout, pointAlong, roofFrame, roomStats, wallDir,
  wallEndExtensions, wallLength, wallProfile, type Vec,
} from '../../model/geometry';
import { formatFtIn, formatIn, lowerFirst } from '../../model/units';
import {
  Dim, INK, INK_LIGHT, LW, Line, LevelMark, PitchMark, POCHE, Poly, Tag, Text, TXT, useDraft,
} from '../draft/draft';
import { BEAM_DEPTH, OpeningElevation } from '../elevation/Elevation';
import { platformPhrase } from '../../model/framing/phrases';
import { sidingPhrase } from '../../model/envelope';

const E = (x: number, h: number): Vec => ({ x, y: -h });

/** Section geometry helpers: s = plan coordinate across the ridge, a = along it. */
export function sectionFrame(design: Design) {
  const rf = roofFrame(design);
  const { at, look } = design.meta.section;
  const sign = rf.axis === 'x' ? (look === '-' ? -1 : 1) : look === '-' ? 1 : -1;
  const lookDir = look === '-' ? -1 : 1;
  return { rf, at, sign, lookDir, hx: (s: number) => sign * s };
}

export function sectionBounds(design: Design) {
  const { rf, hx } = sectionFrame(design);
  const xs = [hx(rf.eave0), hx(rf.eave1)];
  for (const dg of platforms(design)) {
    for (const r of [dg.rect, dg.stairs?.rect]) {
      if (!r) continue;
      if (rf.axis === 'x') xs.push(hx(r.y0), hx(r.y1));
      else xs.push(hx(r.x0), hx(r.x1));
    }
  }
  return { x0: Math.min(...xs), x1: Math.max(...xs), h0: -design.levels.floorHeight, h1: rf.ridgeTop };
}

/** Assembly notes keyed to the diamond tags in the section, built from `design.specs`. */
export function assemblies(design: Design): { tag: string; title: string; lines: string[] }[] {
  const { foundation: f, framing: fr, roof: r } = design.specs;
  return [
    {
      tag: 'R1',
      title: 'Roof',
      lines: [
        `${r.covering} on ${lowerFirst(r.underlayment)}`,
        r.sheathing,
        `${fr.rafters} with ${lowerFirst(fr.ridge)} (size by engineer)`,
        r.insulation,
        'T&G pine ceiling at great room; 1/2" GWB elsewhere',
      ],
    },
    {
      tag: 'W1',
      title: 'Exterior wall',
      lines: [
        sidingPhrase(design),
        'Weather-resistive barrier',
        fr.sheathing,
        `${fr.exteriorWalls}, ${lowerFirst(fr.wallInsulation)}`,
        '1/2" gypsum board or shiplap finish',
      ],
    },
    {
      tag: 'F1',
      title: 'Floor',
      lines: [
        'Finish flooring per the finish schedule',
        f.subfloor,
        `${f.joists}, ${lowerFirst(f.floorInsulation)}`,
        `${f.beams} on ${formatIn(design.foundation.pierSize)} dia. ${lowerFirst(f.piers)} (size by engineer)`,
      ],
    },
    {
      tag: 'D1',
      title: 'Deck',
      lines: [
        platformPhrase(design),
        'Ledger bolted to rim with flashing',
        '36" guard, balusters at less than 4" clear',
        'Stair: 7.5" max. riser, 11" min. tread, graspable handrail',
      ],
    },
  ];
}

export function SectionDrawing({ design }: { design: Design }) {
  const { p } = useDraft();
  const { rf, at, hx, lookDir } = sectionFrame(design);
  const { levels } = design;
  const grade = -levels.floorHeight;
  const sMin = rf.sMin;
  const sMax = rf.sMax;
  const aOf = rf.aOf;
  const sOf = rf.sOf;
  const b = sectionBounds(design);
  const parts: ReactNode[] = [];

  // --- Beyond: walls running across the ridge, on the look side of the cut (far first).
  const beyond = design.walls
    .filter((w) => {
      if (w.zone) return false;
      const d = wallDir(w);
      const across = rf.axis === 'x' ? Math.abs(d.x) < 1e-6 : Math.abs(d.y) < 1e-6;
      if (!across) return false;
      const a = aOf(w.start);
      return (a - at) * lookDir > 0;
    })
    .sort((w1, w2) => Math.abs(aOf(w2.start) - at) - Math.abs(aOf(w1.start) - at));
  for (const w of beyond) {
    const prof = wallProfile(design, w);
    const map = (q: Vec) => E(hx(sOf(pointAlong(w, q.x))), q.y);
    parts.push(
      <g key={`bw-${w.id}`}>
        <Poly points={prof.outline.map(map)} fill="#fff" w={LW.fine} />
        {[...prof.holes, ...prof.doors].map(({ opening, rect }) => {
          const x0 = hx(sOf(pointAlong(w, rect[0])));
          const x1 = hx(sOf(pointAlong(w, rect[2])));
          return <OpeningElevation key={opening.id} o={opening} x0={Math.min(x0, x1)} x1={Math.max(x0, x1)} v0={rect[1]} v1={rect[3]} noTrim />;
        })}
      </g>,
    );
  }

  // --- Floor structure (cut)
  const fx = [hx(sMin), hx(sMax)].sort((m, n) => m - n);
  parts.push(
    <g key="floor">
      <Poly points={[E(fx[0], -levels.floorDepth), E(fx[1], -levels.floorDepth), E(fx[1], 0), E(fx[0], 0)]} fill="#fff" w={LW.med} />
      <Line a={E(fx[0], -0.75)} b={E(fx[1], -0.75)} w={LW.fine} />
      <Poly
        points={[E(fx[0], -levels.floorDepth + 1.5), E(fx[1], -levels.floorDepth + 1.5)]}
        closed={false}
        w={LW.hair}
      />
    </g>,
  );
  const piers = pierLayout(design);
  for (const bm of piers.beams) {
    const s = sOf(bm.a);
    if (rf.axis === 'x' ? Math.abs(bm.a.y - bm.b.y) > 1e-6 : Math.abs(bm.a.x - bm.b.x) > 1e-6) continue;
    const top = bm.deck ? -1 - 7.25 : -levels.floorDepth;
    const x = hx(s);
    parts.push(
      <g key={`beam-${s}`}>
        <Poly points={[E(x - 2.25, top - BEAM_DEPTH), E(x + 2.25, top - BEAM_DEPTH), E(x + 2.25, top), E(x - 2.25, top)]} fill={POCHE} w={LW.thin} />
        <Line a={E(x - 2.25, top - BEAM_DEPTH)} b={E(x + 2.25, top)} w={LW.hair} color="#fff" />
        <Poly points={[E(x - 6, grade), E(x + 6, grade), E(x + 6, top - BEAM_DEPTH), E(x - 6, top - BEAM_DEPTH)]} fill="#fff" w={LW.thin} />
        <Poly points={[E(x - 12, grade - 10), E(x + 12, grade - 10), E(x + 12, grade), E(x - 12, grade)]} fill="#fff" w={LW.thin} dash={[5, 3]} />
      </g>,
    );
  }

  // --- Ceilings and room labels for rooms crossing the cut
  for (const r of design.rooms) {
    if (r.zone) continue;
    const net = roomStats(design, r).net;
    const hits: number[] = [];
    for (let i = 0; i < net.length; i++) {
      const q1 = net[i];
      const q2 = net[(i + 1) % net.length];
      const a1 = aOf(q1);
      const a2 = aOf(q2);
      if ((a1 - at) * (a2 - at) < 0) {
        const t = (at - a1) / (a2 - a1);
        hits.push(sOf(q1) + (sOf(q2) - sOf(q1)) * t);
      }
    }
    hits.sort((m, n) => m - n);
    for (let i = 0; i + 1 < hits.length; i += 2) {
      const s0 = hits[i];
      const s1 = hits[i + 1];
      const ch = r.ceilingHeight ?? levels.wallHeight;
      const mid = (s0 + s1) / 2;
      if (r.ceiling === 'flat') {
        const x0 = hx(s0);
        const x1 = hx(s1);
        parts.push(
          <g key={`ceil-${r.id}-${i}`}>
            <Poly points={[E(x0, ch), E(x1, ch), E(x1, ch + 7.25), E(x0, ch + 7.25)]} fill="#fff" w={LW.med} />
          </g>,
        );
      }
      parts.push(
        <g key={`lbl-${r.id}-${i}`}>
          <Text at={E(hx(mid), 66)} size={TXT.label} weight="bold">{r.name.toUpperCase()}</Text>
          <Text at={E(hx(mid), 66 - p(17))} size={TXT.tiny} color={INK_LIGHT}>
            {r.ceiling === 'vaulted' ? 'VAULTED CEILING' : `${formatFtIn(ch)} CEILING`}
          </Text>
        </g>,
      );
    }
  }

  // --- Cut walls (running along the ridge, crossing the cut)
  for (const w of design.walls) {
    if (w.zone) continue;
    const d = wallDir(w);
    const along = rf.axis === 'x' ? Math.abs(d.y) < 1e-6 : Math.abs(d.x) < 1e-6;
    if (!along) continue;
    const [e0, e1] = wallEndExtensions(design, w);
    const u = (at - aOf(w.start)) / (rf.axis === 'x' ? d.x : d.y);
    if (u < -e0 || u > wallLength(w) + e1) continue;
    const prof = wallProfile(design, w);
    const top = prof.topAt(u);
    const s = sOf(w.start);
    const xa = hx(s - w.thickness / 2);
    const xb = hx(s + w.thickness / 2);
    const x0 = Math.min(xa, xb);
    const x1 = Math.max(xa, xb);
    const opening = design.openings.find((o) => {
      if (o.wallId !== w.id) return false;
      const [o0, o1] = openingRange(o);
      return u >= o0 && u <= o1;
    });
    const segs: [number, number][] = opening
      ? [[0, opening.sill], [opening.sill + opening.height, top]]
      : [[0, top]];
    parts.push(
      <g key={`cut-${w.id}`}>
        {segs
          .filter(([v0, v1]) => v1 - v0 > 0.1)
          .map(([v0, v1]) => (
            <Poly key={v0} points={[E(x0, v0), E(x1, v0), E(x1, v1), E(x0, v1)]} fill={POCHE} stroke={POCHE} w={LW.thin} />
          ))}
        {opening && opening.kind !== 'door' && (
          <>
            <Line a={E(x0, opening.sill)} b={E(x1, opening.sill)} w={LW.thin} />
            <Line a={E((x0 + x1) / 2 - 0.5, opening.sill)} b={E((x0 + x1) / 2 - 0.5, opening.sill + opening.height)} w={LW.fine} />
            <Line a={E((x0 + x1) / 2 + 0.5, opening.sill)} b={E((x0 + x1) / 2 + 0.5, opening.sill + opening.height)} w={LW.fine} />
            <Poly points={[E(x0 - 1.5, opening.sill), E(x1 + 1.5, opening.sill), E(x1 + 1.5, opening.sill - 1.5), E(x0 - 1.5, opening.sill - 1.5)]} fill="#fff" w={LW.fine} />
          </>
        )}
      </g>,
    );
  }

  // --- Roof (cut)
  for (const [i, poly] of rf.profiles.entries()) {
    const pts = poly.map((q) => E(hx(q.x), q.y));
    parts.push(
      <g key={`roof-${i}`}>
        <Poly points={pts} fill="#d9d9d9" w={LW.cut} />
        <Poly points={[pts[0], pts[1]].map((q) => ({ x: q.x, y: q.y - 0.75 }))} closed={false} w={LW.hair} />
      </g>,
    );
  }
  // Fascia boards
  for (const s of [rf.eave0, rf.eave1]) {
    const x = hx(s);
    const dir = s === rf.eave0 ? -Math.sign(hx(1) - hx(0)) : Math.sign(hx(1) - hx(0));
    parts.push(
      <Poly key={`fascia-${s}`} points={[E(x, rf.undersideAt(s) - 1), E(x + dir * 1.5, rf.undersideAt(s) - 1), E(x + dir * 1.5, rf.undersideAt(s) + rf.tv), E(x, rf.undersideAt(s) + rf.tv)]} fill="#fff" w={LW.thin} />,
    );
  }

  // --- Decks, porches, and their stairs (cut)
  const dg = deckGeom(design);
  for (const pl of platforms(design)) {
    const r = pl.rect;
    const a0 = rf.axis === 'x' ? r.x0 : r.y0;
    const a1 = rf.axis === 'x' ? r.x1 : r.y1;
    const acrossRidge = rf.axis === 'x' ? pl.side === 'north' || pl.side === 'south' : pl.side === 'east' || pl.side === 'west';
    if (acrossRidge && at >= a0 && at <= a1) {
      const s0 = rf.axis === 'x' ? r.y0 : r.x0;
      const s1 = rf.axis === 'x' ? r.y1 : r.x1;
      const x = [hx(s0), hx(s1)].sort((m, n) => m - n);
      const outer = pl.side === 'south' || pl.side === 'east' ? s1 : s0;
      const ox = hx(outer);
      const rail = pl.spec.railingHeight;
      const outDir = Math.sign(hx(outer) - hx((s0 + s1) / 2));
      parts.push(
        <g key={pl.kind}>
          <Poly points={[E(x[0], -1 - 7.25), E(x[1], -1 - 7.25), E(x[1], -1), E(x[0], -1)]} fill="#fff" w={LW.med} />
          <Line a={E(x[0], -2)} b={E(x[1], -2)} w={LW.hair} />
          {pl.railing && (
            <>
              <Poly points={[E(ox - 1.75, -1), E(ox + 1.75, -1), E(ox + 1.75, rail), E(ox - 1.75, rail)]} fill="#fff" w={LW.thin} />
              <Line a={E(Math.min(ox, hx((s0 + s1) / 2)), rail)} b={E(Math.max(ox, hx((s0 + s1) / 2)), rail)} w={LW.hair} dash={[4, 3]} />
            </>
          )}
          {pl.skirt === 'solid' && (
            <Poly points={[E(ox, grade), E(ox + outDir * 1, grade), E(ox + outDir * 1, -1 - 7.25), E(ox, -1 - 7.25)]} fill={POCHE} w={LW.thin} />
          )}
        </g>,
      );
      const st = pl.stairs;
      const sa0 = st ? (rf.axis === 'x' ? st.rect.x0 : st.rect.y0) : 0;
      const sa1 = st ? (rf.axis === 'x' ? st.rect.x1 : st.rect.y1) : 0;
      if (st && at >= sa0 && at <= sa1) {
        const edgeX = hx(st.edge);
        const dir = Math.sign(hx(outer + (outer === s1 ? 1 : -1)) - edgeX);
        const tooth: Vec[] = [E(edgeX, -1)];
        for (let i = 1; i <= st.risers; i++) {
          const h = -1 - i * st.riserHeight;
          const xx = edgeX + dir * (i - 1) * st.tread;
          tooth.push(E(xx, h));
          if (i < st.risers) tooth.push(E(xx + dir * st.tread, h));
        }
        const far = edgeX + dir * st.treads * st.tread;
        tooth.push(E(far, grade), E(far - dir * 3, grade), E(edgeX, -1 - 9.25));
        parts.push(
          <g key={`${pl.kind}-stairs`}>
            <Poly points={tooth} fill={POCHE} w={LW.thin} />
            <Line a={E(edgeX, 34 - 1)} b={E(far, grade + 34)} w={LW.thin} />
          </g>,
        );
      }
    }
  }

  // --- Grade, levels, dimensions, pitch, assembly tags
  const leftX = b.x0 - p(30);
  const rightX = b.x1 + p(30);
  parts.push(
    <g key="grade">
      <Line a={E(leftX, grade)} b={E(rightX, grade)} w={LW.heavy} />
      {Array.from({ length: Math.floor((rightX - leftX) / 10) }, (_, i) => (
        <Line key={i} a={E(leftX + i * 10 + 4, grade)} b={E(leftX + i * 10, grade - 4)} w={LW.hair} />
      ))}
    </g>,
  );
  const houseRight = Math.max(hx(sMin), hx(sMax));
  const levelX = rightX + p(24);
  parts.push(
    <g key="levels">
      <LevelMark x={levelX} h={rf.ridgeTop} label="T.O. RIDGE" lineFrom={hx(rf.ridgeS)} />
      <LevelMark x={levelX} h={levels.wallHeight} label="T.O. PLATE" lineFrom={houseRight} />
      <LevelMark x={levelX} h={0} label="FIN. FLOOR" lineFrom={houseRight} />
      <LevelMark x={levelX} h={grade} label="AVG. GRADE" />
    </g>,
  );
  const dimX = Math.min(hx(sMin), hx(sMax)) + 18;
  parts.push(
    <g key="dims">
      <Dim a={E(dimX, 0)} b={E(dimX, levels.wallHeight)} off={-p(1)} />
      <Dim a={E(hx(rf.ridgeS) + 30, 0)} b={E(hx(rf.ridgeS) + 30, rf.ridgeUnder)} off={p(1)} />
    </g>,
  );
  const slopeS = rf.eave0 + (rf.ridgeS - rf.eave0) * 0.45;
  const sx1 = hx(slopeS);
  const sx2 = hx(slopeS + 1);
  parts.push(
    <PitchMark key="pitch" at={E(sx1 + (sx2 > sx1 ? -p(10) : p(10)), rf.undersideAt(slopeS) + rf.tv + p(24))} pitch={design.roof.pitch} flip={sx2 < sx1} />,
  );
  const tagAt = (s: number, h: number) => E(hx(s), h);
  const deckMid = dg ? (rf.axis === 'x' ? (dg.rect.y0 + dg.rect.y1) / 2 : (dg.rect.x0 + dg.rect.x1) / 2) : 0;
  parts.push(
    <g key="tags">
      <Tag at={tagAt(rf.eave0 + (rf.ridgeS - rf.eave0) * 0.7, rf.undersideAt(rf.eave0 + (rf.ridgeS - rf.eave0) * 0.7) - p(22))} text="R1" shape="diamond" />
      <Tag at={tagAt(sMin + 24, 40)} text="W1" shape="diamond" />
      <Tag at={tagAt((sMin + sMax) / 2 + 48, -levels.floorDepth - 12)} text="F1" shape="diamond" />
      {dg && <Tag at={tagAt(deckMid, 16)} text="D1" shape="diamond" />}
    </g>,
  );

  return <g>{parts}</g>;
}

export { INK };
