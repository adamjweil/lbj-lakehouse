import type { ReactNode } from 'react';
import type { Design, Opening, Side, Wall } from '../../model/schema';
import {
  add, bbox, buildingBounds, footprintBounds, platformRailings, platforms, skirtEdges, stairHandrails, type Platform, garageEntry, garageSharedAxis, leftNormal, mul,
  norm, openingRange, outwardNormal, pointAlong, projectOnWall, roofFrame, roomStats, sub, wallDir, wallFace,
  wallPolygon, openingPolygon, dist, type Rect, type Vec,
} from '../../model/geometry';
import { formatFtIn, formatSqft } from '../../model/units';
import {
  DimChain, Dim, INK, INK_LIGHT, LW, Line, POCHE, POCHE_INT, Poly, Tag, Text, TXT, useDraft,
} from '../draft/draft';
import { FixtureSymbol } from './FixtureSymbol';

/** Model-space extents the floor plan needs, including dimension strings. */
export function planBounds(design: Design, margin: number) {
  const fb = buildingBounds(design);
  const r = { ...fb };
  for (const rect of platforms(design).flatMap((q) => [q.rect, q.stairs?.rect])) {
    if (!rect) continue;
    r.x0 = Math.min(r.x0, rect.x0);
    r.y0 = Math.min(r.y0, rect.y0);
    r.x1 = Math.max(r.x1, rect.x1);
    r.y1 = Math.max(r.y1, rect.y1);
  }
  return { x0: r.x0 - margin, y0: r.y0 - margin, x1: r.x1 + margin, y1: r.y1 + margin };
}

export function PlanDrawing({ design, showSection = true }: { design: Design; showSection?: boolean }) {
  const { p } = useDraft();
  return (
    <g>
      {platforms(design).map((q) => (
        <PlatformPlan key={q.kind} design={design} dg={q} />
      ))}
      <RoomFloors design={design} />
      {design.fixtures.map((f) => (
        <FixtureSymbol key={f.id} f={f} />
      ))}
      {design.walls.map((w) => (
        <Poly
          key={w.id}
          points={wallPolygon(design, w)}
          fill={w.type === 'exterior' ? POCHE : POCHE_INT}
          stroke={w.type === 'exterior' ? POCHE : POCHE_INT}
          w={0.4}
        />
      ))}
      {design.openings.map((o) => {
        const w = design.walls.find((x) => x.id === o.wallId);
        return w ? <OpeningSymbol key={o.id} design={design} wall={w} o={o} /> : null;
      })}
      {design.rooms.map((r) => {
        const s = roomStats(design, r);
        const small = s.area < 30 * 144;
        const c = s.center;
        const ceil = r.ceiling === 'vaulted' ? 'VAULTED CLG' : `${formatFtIn(s.ceilingHeight)} CLG`;
        return (
          <g key={r.id}>
            <Text at={{ x: c.x, y: c.y - p(small ? 2 : 8) }} size={small ? TXT.tiny : TXT.label} weight="bold">
              {r.name.toUpperCase()}
            </Text>
            <Text at={{ x: c.x, y: c.y + p(small ? 8 : 8) }} size={TXT.tiny}>
              {small ? formatSqft(s.area) : `${formatFtIn(s.width, 1)} x ${formatFtIn(s.depth, 1)}`}
            </Text>
            {!small && (
              <Text at={{ x: c.x, y: c.y + p(19) }} size={TXT.tiny} color={INK_LIGHT}>
                {`${formatSqft(s.area)} · ${ceil}`}
              </Text>
            )}
          </g>
        );
      })}
      <GarageEntryPlan design={design} />
      <OpeningTags design={design} />
      <ExteriorDimensions design={design} />
      {showSection && <SectionMarkers design={design} />}
    </g>
  );
}

function RoomFloors({ design }: { design: Design }) {
  const { p } = useDraft();
  return (
    <g>
      {design.rooms.map((r) => {
        if (!/tile/i.test(r.finishes.floor)) return null;
        const s = roomStats(design, r);
        const xs = s.net.map((q) => q.x);
        const ys = s.net.map((q) => q.y);
        const x0 = Math.min(...xs);
        const x1 = Math.max(...xs);
        const y0 = Math.min(...ys);
        const y1 = Math.max(...ys);
        const lines: ReactNode[] = [];
        for (let x = Math.ceil(x0 / 12) * 12; x < x1; x += 12) {
          lines.push(<line key={`x${x}`} x1={x} x2={x} y1={y0} y2={y1} />);
        }
        for (let y = Math.ceil(y0 / 12) * 12; y < y1; y += 12) {
          lines.push(<line key={`y${y}`} x1={x0} x2={x1} y1={y} y2={y} />);
        }
        return (
          <g key={r.id}>
            <clipPath id={`clip-${r.id}`}>
              <polygon points={s.net.map((q) => `${q.x},${q.y}`).join(' ')} />
            </clipPath>
            <g clipPath={`url(#clip-${r.id})`} stroke="#b9b9b9" strokeWidth={p(LW.hair)}>
              {lines}
            </g>
          </g>
        );
      })}
    </g>
  );
}

function PlatformPlan({ design, dg }: { design: Design; dg: Platform }) {
  const { p } = useDraft();
  const r = dg.rect;
  const boards: ReactNode[] = [];
  const horizontal = dg.side === 'north' || dg.side === 'south';
  if (horizontal) {
    for (let y = r.y0 + 5.75; y < r.y1; y += 5.75) boards.push(<line key={y} x1={r.x0} x2={r.x1} y1={y} y2={y} />);
  } else {
    for (let x = r.x0 + 5.75; x < r.x1; x += 5.75) boards.push(<line key={x} x1={x} x2={x} y1={r.y0} y2={r.y1} />);
  }
  const s = dg.stairs;
  const treads: ReactNode[] = [];
  if (s) {
    for (let i = 1; i <= s.treads; i++) {
      const t = i * s.tread;
      if (horizontal) {
        const y = dg.side === 'south' ? s.rect.y0 + t : s.rect.y1 - t;
        treads.push(<Line key={i} a={{ x: s.rect.x0, y }} b={{ x: s.rect.x1, y }} w={LW.thin} />);
      } else {
        const x = dg.side === 'east' ? s.rect.x0 + t : s.rect.x1 - t;
        treads.push(<Line key={i} a={{ x, y: s.rect.y0 }} b={{ x, y: s.rect.y1 }} w={LW.thin} />);
      }
    }
  }
  const sc = s ? { x: (s.rect.x0 + s.rect.x1) / 2, y: (s.rect.y0 + s.rect.y1) / 2 } : null;
  const inward = mul(dg.out, -1);
  return (
    <g>
      <g stroke="#c9c9c9" strokeWidth={p(LW.hair)}>{boards}</g>
      <Poly points={[{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }]} w={LW.med} />
      {dg.skirt === 'solid' &&
        skirtEdges(design, dg).map(([a, b], i) => (
          <Line key={`sk${i}`} a={a} b={b} w={LW.heavy} />
        ))}
      {platformRailings(design, dg).map(([a, b], i) => {
        const d = norm(sub(b, a));
        const n = leftNormal(d);
        const c = { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 };
        const inside = (n.x * (c.x - a.x) + n.y * (c.y - a.y)) > 0 ? n : mul(n, -1);
        const o = mul(inside, 3.5);
        return (
          <g key={i}>
            <Line a={add(a, o)} b={add(b, o)} w={LW.thin} />
          </g>
        );
      })}
      {s && (
        <>
          <Poly points={[{ x: s.rect.x0, y: s.rect.y0 }, { x: s.rect.x1, y: s.rect.y0 }, { x: s.rect.x1, y: s.rect.y1 }, { x: s.rect.x0, y: s.rect.y1 }]} w={LW.thin} fill="#fff" />
          {treads}
          {stairHandrails(dg).map((h, i) => (
            <Line key={`hr${i}`} a={h.a} b={h.b} w={LW.thin} dash={[6, 3]} />
          ))}
          {sc && (
            <>
              <Line a={add(sc, mul(inward, (horizontal ? s.rect.y1 - s.rect.y0 : s.rect.x1 - s.rect.x0) / 2 + 20))} b={add(sc, mul(dg.out, 8))} w={LW.fine} />
              <Poly points={arrowHead(add(sc, mul(dg.out, 12)), dg.out, p(10))} fill={INK} w={0} />
              <Text at={add(add(sc, mul(dg.out, 12)), mul(horizontal ? { x: 1, y: 0 } : { x: 0, y: 1 }, p(18)))} size={TXT.tiny} weight="bold" middle>
                DN
              </Text>
            </>
          )}
        </>
      )}
      <Text at={{ x: (r.x0 + r.x1) / 2 + (horizontal ? p(160) : 0), y: (r.y0 + r.y1) / 2 }} size={TXT.label} weight="bold" middle>
        {dg.kind.toUpperCase()}
      </Text>
      <Text at={{ x: (r.x0 + r.x1) / 2 + (horizontal ? p(160) : 0), y: (r.y0 + r.y1) / 2 + p(14) }} size={TXT.tiny} middle color={INK_LIGHT}>
        {`${formatFtIn(r.x1 - r.x0)} x ${formatFtIn(r.y1 - r.y0)} · COMPOSITE DECKING${dg.skirt === 'solid' ? ' · SOLID SKIRT' : ''}`}
      </Text>
    </g>
  );
}

export function arrowHead(tip: Vec, dir: Vec, size: number): Vec[] {
  const n = leftNormal(dir);
  const back = sub(tip, mul(dir, size));
  return [tip, add(back, mul(n, size * 0.35)), sub(back, mul(n, size * 0.35))];
}

function OpeningSymbol({ design, wall: w, o }: { design: Design; wall: Wall; o: Opening }) {
  const { p } = useDraft();
  const d = wallDir(w);
  const n = leftNormal(d);
  const t = w.thickness;
  const [u0, u1] = openingRange(o);
  const A = pointAlong(w, u0);
  const B = pointAlong(w, u1);
  const at = (u: number, v: number) => add(pointAlong(w, u), mul(n, v));
  const cut = <Poly points={openingPolygon(w, o)} fill="#fff" w={0} />;
  const jambs = (
    <>
      <Line a={at(u0, t / 2)} b={at(u0, -t / 2)} w={LW.thin} />
      <Line a={at(u1, t / 2)} b={at(u1, -t / 2)} w={LW.thin} />
    </>
  );
  const swingSign = o.swing === 'right' ? -1 : 1;

  if (o.kind === 'window') {
    const glass =
      o.operation === 'double-hung' || o.operation === 'slider' ? (
        <>
          <Line a={at(u0, 1)} b={at(o.operation === 'slider' ? (u0 + u1) / 2 + 1 : u1, 1)} w={LW.thin} />
          <Line a={at(o.operation === 'slider' ? (u0 + u1) / 2 - 1 : u0, -1)} b={at(u1, -1)} w={LW.thin} />
        </>
      ) : (
        <>
          <Line a={at(u0, 0.75)} b={at(u1, 0.75)} w={LW.thin} />
          <Line a={at(u0, -0.75)} b={at(u1, -0.75)} w={LW.thin} />
        </>
      );
    const outN = w.type === 'exterior' ? outwardNormal(design, w) : n;
    const sillOut = mul(outN, t / 2 + 1.5);
    const sillIn = mul(outN, t / 2);
    return (
      <g>
        {cut}
        {jambs}
        <Line a={at(u0, t / 2)} b={at(u1, t / 2)} w={LW.fine} />
        <Line a={at(u0, -t / 2)} b={at(u1, -t / 2)} w={LW.fine} />
        <Poly points={[add(A, sillIn), add(A, sillOut), add(B, sillOut), add(B, sillIn)]} closed={false} w={LW.fine} />
        {glass}
        {o.operation === 'casement' && (
          <Line
            a={add(pointAlong(w, (u0 + u1) / 2), mul(outN, t / 2))}
            b={add(pointAlong(w, (u0 + u1) / 2 + (u1 - u0) * 0.2), mul(outN, t / 2 + (u1 - u0) * 0.25))}
            w={LW.hair}
            dash={[3, 2]}
          />
        )}
      </g>
    );
  }

  if (o.kind === 'slider') {
    const mid = (u0 + u1) / 2;
    return (
      <g>
        {cut}
        {jambs}
        <Poly points={[at(u0, 1.5), at(mid + 1.5, 1.5), at(mid + 1.5, 0.25), at(u0, 0.25)]} w={LW.thin} fill="#fff" />
        <Poly points={[at(mid - 1.5, -0.25), at(u1, -0.25), at(u1, -1.5), at(mid - 1.5, -1.5)]} w={LW.thin} fill="#fff" />
        <Poly points={arrowHead(at(mid - (u1 - u0) * 0.2, 5 * swingSign), mul(d, -1), p(7))} fill={INK} w={0} />
        <Line a={at(mid - 2, 5 * swingSign)} b={at(mid - (u1 - u0) * 0.2, 5 * swingSign)} w={LW.hair} />
      </g>
    );
  }

  // doors
  const face = (u: number, extra = 0) => at(u, swingSign * (t / 2 + extra));
  const normal = mul(n, swingSign);
  switch (o.operation) {
    case 'overhead': {
      // Closed panel at the wall, with the open door overhead shown dashed inside the building.
      const inward = w.type === 'exterior' ? mul(outwardNormal(design, w), -1) : normal;
      const face0 = add(A, mul(inward, t / 2));
      const face1 = add(B, mul(inward, t / 2));
      const depth = o.height;
      return (
        <g>
          {cut}
          {jambs}
          <Poly points={[at(u0, 0.9), at(u1, 0.9), at(u1, -0.9), at(u0, -0.9)]} w={LW.thin} fill="#fff" />
          <Poly points={[face0, face1, add(face1, mul(inward, depth)), add(face0, mul(inward, depth))]} w={LW.fine} dash={[8, 4]} />
          <Line a={add(face0, mul(inward, depth / 2))} b={add(face1, mul(inward, depth / 2))} w={LW.hair} dash={[8, 4]} />
        </g>
      );
    }
    case 'cased':
      return (
        <g>
          {cut}
          {jambs}
          <Line a={at(u0, t / 2)} b={at(u1, t / 2)} w={LW.hair} dash={[4, 3]} />
        </g>
      );
    case 'pocket': {
      return (
        <g>
          {cut}
          <Line a={at(u0, t / 2)} b={at(u0, -t / 2)} w={LW.thin} />
          <Line a={at(u1, t / 2)} b={at(u1, -t / 2)} w={LW.thin} />
          <Poly points={[at(u0, 0.9), at(u0 - (u1 - u0) * 0.9, 0.9), at(u0 - (u1 - u0) * 0.9, -0.9), at(u0, -0.9)]} w={LW.fine} dash={[4, 2]} />
          <Poly points={[at(u0 - 2, 0.9), at(u0 + 6, 0.9), at(u0 + 6, -0.9), at(u0 - 2, -0.9)]} w={LW.thin} fill="#fff" />
        </g>
      );
    }
    case 'barn': {
      const off = t / 2 + 2;
      return (
        <g>
          {cut}
          {jambs}
          <Poly points={[at(u0 - 2, swingSign * off), at(u1 + 2, swingSign * off), at(u1 + 2, swingSign * (off + 1.5)), at(u0 - 2, swingSign * (off + 1.5))]} w={LW.thin} fill="#fff" />
          <Line a={at(u0 - 2 - (u1 - u0), swingSign * off)} b={at(u0 - 2, swingSign * off)} w={LW.hair} dash={[4, 2]} />
        </g>
      );
    }
    case 'bifold': {
      const W = u1 - u0;
      const a = W / 4 * 0.9;
      return (
        <g>
          {cut}
          {jambs}
          <Poly points={[face(u0), add(pointAlong(w, u0 + W / 4), mul(normal, t / 2 + a)), face(u0 + W / 2 - 0.5)]} closed={false} w={LW.thin} />
          <Poly points={[face(u1), add(pointAlong(w, u1 - W / 4), mul(normal, t / 2 + a)), face(u1 - W / 2 + 0.5)]} closed={false} w={LW.thin} />
        </g>
      );
    }
    default: {
      const hingeU = o.hinge === 'end' ? u1 : u0;
      const freeU = o.hinge === 'end' ? u0 : u1;
      const H = face(hingeU);
      const C = face(freeU);
      const R = dist(H, C);
      const O = add(H, mul(normal, R));
      const v1 = sub(O, H);
      const v2 = sub(C, H);
      const sweep = v1.x * v2.y - v1.y * v2.x > 0 ? 1 : 0;
      return (
        <g>
          {cut}
          {jambs}
          <Poly points={[H, O, add(O, mul(norm(sub(C, H)), 1.75)), add(H, mul(norm(sub(C, H)), 1.75))]} w={LW.thin} fill="#fff" />
          <path d={`M ${O.x} ${O.y} A ${R} ${R} 0 0 ${sweep} ${C.x} ${C.y}`} fill="none" stroke={INK} strokeWidth={p(LW.hair)} />
        </g>
      );
    }
  }
}

function OpeningTags({ design }: { design: Design }) {
  const { p } = useDraft();
  return (
    <g>
      {design.openings.map((o) => {
        const w = design.walls.find((x) => x.id === o.wallId);
        if (!w) return null;
        const c = pointAlong(w, o.offset);
        const dirN = leftNormal(wallDir(w));
        // Windows and sliders tag outside; doors tag on the side away from the swing.
        const n =
          o.kind !== 'door'
            ? w.type === 'exterior' ? outwardNormal(design, w) : dirN
            : mul(dirN, o.swing === 'right' ? 1 : -1);
        const at = add(c, mul(n, w.thickness / 2 + p(19)));
        const shape = o.kind === 'window' ? 'hex' : 'circle';
        return <Tag key={o.id} at={at} text={o.tag} shape={shape} />;
      })}
    </g>
  );
}

function ExteriorDimensions({ design }: { design: Design }) {
  const { p } = useDraft();
  const bb = buildingBounds(design);
  const fb = footprintBounds(design);
  const plats = platforms(design);
  const sides: Side[] = ['north', 'south', 'east', 'west'];
  const extreme = { north: bb.y0, south: bb.y1, west: bb.x0, east: bb.x1 };
  return (
    <g>
      {sides.map((side) => {
        const horizontal = side === 'north' || side === 'south';
        // Only walls on the building's outermost face get dimensioned from outside.
        const faceWalls = design.walls.filter((w) => {
          if (wallFace(design, w) !== side) return false;
          const outer = horizontal ? w.start.y + (side === 'north' ? -1 : 1) * (w.thickness / 2) : w.start.x + (side === 'west' ? -1 : 1) * (w.thickness / 2);
          return Math.abs(outer - extreme[side]) < 1;
        });
        if (!faceWalls.length) return null;
        const lo = horizontal ? bb.x0 : bb.y0;
        const hi = horizontal ? bb.x1 : bb.y1;
        const coords = new Set<number>([lo, hi]);
        // Where the house and garage meet along this face.
        for (const c of horizontal ? [fb.x0, fb.x1] : [fb.y0, fb.y1]) if (c > lo + 1 && c < hi - 1) coords.add(c);
        for (const w of faceWalls) {
          for (const o of design.openings) {
            if (o.wallId !== w.id) continue;
            const c = pointAlong(w, o.offset);
            coords.add(horizontal ? c.x : c.y);
          }
          for (const other of design.walls) {
            if (other.type !== 'interior') continue;
            for (const pt of [other.start, other.end]) {
              const u = projectOnWall(w, pt);
              if (u !== null && u > 1 && u < dist(w.start, w.end) - 1) coords.add(horizontal ? pt.x : pt.y);
            }
          }
        }
        const faceCoord = extreme[side];
        let extra = 0;
        for (const dg of plats) {
          const rects = [dg.rect, dg.stairs?.rect].filter(Boolean) as NonNullable<typeof dg.stairs>['rect'][];
          for (const r of rects) {
            const e = { north: bb.y0 - r.y0, south: r.y1 - bb.y1, west: bb.x0 - r.x0, east: r.x1 - bb.x1 }[side];
            extra = Math.max(extra, e);
          }
          if (dg.side !== side && (horizontal ? dg.side === 'east' || dg.side === 'west' : dg.side === 'north' || dg.side === 'south')) {
            coords.add(horizontal ? (dg.side === 'east' ? dg.rect.x1 : dg.rect.x0) : dg.side === 'south' ? dg.rect.y1 : dg.rect.y0);
          }
        }
        const sorted = [...coords].sort((a, b) => a - b);
        const pt = (c: number): Vec => (horizontal ? { x: c, y: faceCoord } : { x: faceCoord, y: c });
        // Left normal of a +x/+y run points north/east, so flip for south/west.
        const leftIsOut = side === 'north' || side === 'east';
        const off1 = (extra + p(55)) * (leftIsOut ? 1 : -1);
        const off2 = (extra + p(95)) * (leftIsOut ? 1 : -1);
        if (sorted.length <= 2) {
          return <Dim key={side} a={pt(lo)} b={pt(hi)} off={off1} />;
        }
        return (
          <g key={side}>
            <DimChain points={sorted.map(pt)} off={off1} />
            <Dim a={pt(lo)} b={pt(hi)} off={off2} extFrom={Math.abs(off1) + p(8)} />
          </g>
        );
      })}
    </g>
  );
}

/** Landing and steps inside the garage, with a dimension string along the shared wall. */
function GarageEntryPlan({ design }: { design: Design }) {
  const { p } = useDraft();
  const e = garageEntry(design);
  if (!e) return null;
  const rect = (r: Rect) => [
    { x: r.x0, y: r.y0 },
    { x: r.x1, y: r.y0 },
    { x: r.x1, y: r.y1 },
    { x: r.x0, y: r.y1 },
  ];
  const mid = (r: Rect): Vec => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });
  const vertical = Math.abs(e.along.y) > 0.5;
  const coord = (v: Vec) => (vertical ? v.y : v.x);
  const face = add(pointAlong(e.wall, e.opening.offset), mul(e.into, e.wall.thickness / 2));
  const arrowFrom = mid(e.landing);
  const arrowTo = add(mid(e.run), mul(e.along, (e.treads * e.tread) / 2 - 3));

  // Dimension string on the garage side of the shared wall: room faces, door, and the stair run.
  const garageRoom = design.rooms.find((r) => r.zone === 'garage');
  const net = garageRoom ? bbox(roomStats(design, garageRoom).net) : null;
  const coords = new Set<number>([coord(face), vertical ? e.run.y0 : e.run.x0, vertical ? e.run.y1 : e.run.x1]);
  if (net) {
    coords.add(vertical ? net.y0 : net.x0);
    coords.add(vertical ? net.y1 : net.x1);
  }
  const pts = [...coords].sort((a, b) => a - b).map((c) => (vertical ? { x: face.x, y: c } : { x: c, y: face.y }));
  // Dim offsets are measured along the left normal of a +x/+y run.
  const runDir = vertical ? { x: 0, y: 1 } : { x: 1, y: 0 };
  const intoSign = Math.sign(leftNormal(runDir).x * e.into.x + leftNormal(runDir).y * e.into.y);
  return (
    <g>
      <Poly points={rect(e.landing)} w={LW.thin} fill="#fff" />
      <Text at={add(mid(e.landing), mul(e.along, -p(8)))} size={TXT.tiny} middle>LANDING</Text>
      {e.steps.map((st, k) => (
        <Poly key={k} points={rect(st.rect)} w={LW.thin} fill="#fff" />
      ))}
      <Line a={arrowFrom} b={arrowTo} w={LW.fine} />
      <Poly points={arrowHead(arrowTo, e.along, p(9))} fill={INK} w={0} />
      <Text at={add(arrowTo, mul(e.along, p(14)))} size={TXT.tiny} weight="bold" middle>
        {`DN ${e.risers}R`}
      </Text>
      {pts.length > 2 && <DimChain points={pts} off={intoSign * (e.width + p(30))} extFrom={e.width + p(6)} />}
    </g>
  );
}

/** Cut lines for Section 1 (house) and Section 2 (garage). */
function SectionMarkers({ design }: { design: Design }) {
  const fb = footprintBounds(design);
  const bb = buildingBounds(design);
  const house = roofFrame(design);
  const extents = [fb, ...platforms(design).flatMap((q) => [q.rect, q.stairs?.rect])].filter(Boolean) as (typeof fb)[];
  const sLo = (r: typeof fb, axis: 'x' | 'y') => (axis === 'x' ? r.y0 : r.x0);
  const sHi = (r: typeof fb, axis: 'x' | 'y') => (axis === 'x' ? r.y1 : r.x1);
  // Section 2 is placed along the wall the garage shares with the house.
  const garageAxis = garageSharedAxis(design);
  return (
    <g>
      <SectionMarker
        axis={house.axis}
        at={design.meta.section.at}
        look={design.meta.section.look}
        num={1}
        lo={Math.min(...extents.map((r) => sLo(r, house.axis)))}
        hi={Math.max(...extents.map((r) => sHi(r, house.axis)))}
      />
      {garageAxis && design.garage && (
        <SectionMarker axis={garageAxis} at={design.garage.section.at} look={design.garage.section.look} num={2} lo={sLo(bb, garageAxis)} hi={sHi(bb, garageAxis)} />
      )}
    </g>
  );
}

/** A section cut line at `at` along `axis`, drawn across the other plan axis. */
function SectionMarker(props: { axis: 'x' | 'y'; at: number; look: '-' | '+'; num: number; lo: number; hi: number }) {
  const { p } = useDraft();
  const { axis, at, look, lo, hi } = props;
  const pt = (s: number): Vec => (axis === 'x' ? { x: at, y: s } : { x: s, y: at });
  const sign = look === '-' ? -1 : 1;
  const lookDir: Vec = axis === 'x' ? { x: sign, y: 0 } : { x: 0, y: sign };
  const ends = [
    { a: pt(lo - p(30)), b: pt(lo + p(10)), bubble: pt(lo - p(52)) },
    { a: pt(hi - p(10)), b: pt(hi + p(30)), bubble: pt(hi + p(52)) },
  ];
  const R = p(20);
  return (
    <g>
      <Line a={pt(lo - p(30))} b={pt(hi + p(30))} w={LW.hair} dash={[30, 6, 4, 6]} color={INK_LIGHT} />
      {ends.map((e, i) => (
        <g key={i}>
          <Line a={e.a} b={e.b} w={LW.heavy} />
          <Poly points={arrowHead(add(e.bubble, mul(lookDir, R * 1.9)), lookDir, R * 0.95)} fill={INK} w={0} />
          <circle cx={e.bubble.x} cy={e.bubble.y} r={R} fill="#fff" stroke={INK} strokeWidth={p(LW.med)} />
          <line x1={e.bubble.x - R} x2={e.bubble.x + R} y1={e.bubble.y} y2={e.bubble.y} stroke={INK} strokeWidth={p(LW.fine)} />
          <Text at={{ x: e.bubble.x, y: e.bubble.y - p(4) }} size={TXT.label} weight="bold">{props.num}</Text>
          <Text at={{ x: e.bubble.x, y: e.bubble.y + p(11) }} size={TXT.tiny}>A-301</Text>
        </g>
      ))}
    </g>
  );
}

export { INK };
