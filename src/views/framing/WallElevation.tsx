import type { ReactNode } from 'react';
import type { Design } from '../../model/schema';
import { outwardNormal, wallDir, type Vec } from '../../model/geometry';
import type { Member, Role, WallFrame } from '../../model/framing';
import { floorLevels, roofFraming } from '../../model/framing/levels';
import { headerLabel } from '../../model/framing/openings';
import { formatFrac, formatFtIn } from '../../model/units';
import { Dim, DimChain, INK, INK_LIGHT, LW, Line, Poly, Polys, Tag, Text, textWidth, TXT, useDraft } from '../draft/draft';

const GREY = '#c9c9c9';
const LIGHT = '#e9e9e9';
const LVL = '#9a9a9a';
const B = 1.5;

const SIDE_OF: Record<string, string> = { '0,-1': 'north', '0,1': 'south', '1,0': 'east', '-1,0': 'west' };

/**
 * How a wall is turned on the paper. Exterior walls are seen from outside; partitions
 * from the south or the east. `x` maps a distance along the wall to the drawing.
 */
export function wallView(design: Design, w: WallFrame) {
  const d = wallDir(w.wall);
  // The viewer stands on this side of the wall and looks back at it.
  const from: Vec = w.exterior ? outwardNormal(design, w.wall) : Math.abs(d.x) > Math.abs(d.y) ? { x: 0, y: 1 } : { x: 1, y: 0 };
  const right = { x: from.y, y: -from.x };
  const sign = d.x * right.x + d.y * right.y >= 0 ? 1 : -1;
  const side = SIDE_OF[`${Math.round(from.x)},${Math.round(from.y)}`] ?? 'outside';
  return {
    sign,
    x: (u: number) => sign * u,
    side,
    caption: w.exterior ? `Seen from outside, looking ${opposite(side)}` : `Seen from the ${side}`,
  };
}

const opposite = (side: string) => ({ north: 'south', south: 'north', east: 'west', west: 'east' })[side] ?? side;

/** Extent of a wall's framing elevation, in the drawing's own coordinates (y down). */
export function wallElevationBounds(design: Design, w: WallFrame) {
  const v = wallView(design, w);
  const xs = [v.x(w.f0), v.x(w.f1)];
  const r = w.gable !== 'none' ? roofFraming(design, w.zone) : null;
  const top = Math.max(w.plate, ...w.members.flatMap((m) => m.profile.map((p) => p.y)), r ? r.ridgeTop : 0);
  const bottom = w.zone ? w.base - 6 : w.base + floorLevels(design).joistBottom;
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: -top, y1: -bottom, top, bottom };
}

const PLUMB = new Set<Role>(['stud', 'end-stud', 'corner-nailer', 'king', 'jack', 'cripple', 'post']);

export function WallElevationDrawing({ design, wall: w }: { design: Design; wall: WallFrame }) {
  const { p } = useDraft();
  const v = wallView(design, w);
  const E = (u: number, z: number): Vec => ({ x: v.x(u), y: -z });
  const shape = (m: Member) => m.profile.map((q) => E(q.x, q.y));
  const b = wallElevationBounds(design, w);
  const lv = floorLevels(design);
  const r = w.gable !== 'none' ? roofFraming(design, w.zone) : null;
  const fill = (m: Member) =>
    m.material === 'LVL' ? LVL : m.role === 'header' || m.role === 'post' ? GREY : m.role === 'backing' || m.role === 'fireblock' ? LIGHT : '#fff';
  const groups = new Map<string, Vec[][]>();
  // Blocking sits behind the studs it spans between; everything else is in one plane.
  for (const m of [...w.members].sort((m1, m2) => Number(m2.role === 'backing') - Number(m1.role === 'backing'))) {
    const key = fill(m);
    groups.set(key, [...(groups.get(key) ?? []), shape(m)]);
  }

  // --- piece marks
  const marks: ReactNode[] = [];
  const spanOf = (m: Member) => {
    const us = m.profile.map((q) => q.x);
    const zs = m.profile.map((q) => q.y);
    return { u0: Math.min(...us), u1: Math.max(...us), z0: Math.min(...zs), z1: Math.max(...zs) };
  };
  const seenPosts = new Set<string>();
  // Marks on plumb pieces read up the page. Each is kept clear of the ones already placed:
  // a repeat of the same mark next door is dropped, and a different mark moves up.
  const placed: { x: number; y0: number; y1: number; text: string }[] = [];
  const room = (x: number, y: number, text: string): number | null => {
    const half = p(textWidth(text, TXT.mark)) / 2 + p(2);
    let at = y;
    for (let tries = 0; tries < 6; tries++) {
      const hit = placed.find((q) => Math.abs(q.x - x) < p(TXT.mark + 1) && at - half < q.y1 && at + half > q.y0);
      if (!hit) {
        placed.push({ x, y0: at - half, y1: at + half, text });
        return at;
      }
      if (hit.text === text) return null;
      at = hit.y0 - half - p(1);
    }
    return null;
  };
  w.members.forEach((m, i) => {
    const s = spanOf(m);
    const uc = (s.u0 + s.u1) / 2;
    if (PLUMB.has(m.role)) {
      if (m.role === 'post') {
        const key = `${s.z0}`;
        if (seenPosts.has(key)) return;
        seenPosts.add(key);
      }
      // Jacks are marked on the opening side and kings on the far side, so the marks do not collide.
      const o = w.openings.find((q) => uc > q.u0 - (q.jacks + 1) * B - 0.1 && uc < q.u1 + (q.jacks + 1) * B + 0.1);
      const towardOpening = o ? Math.sign((o.u0 + o.u1) / 2 - uc) : 0;
      let dir = 1;
      if (m.role === 'jack') dir = towardOpening * v.sign || 1;
      else if (m.role === 'king' || m.role === 'end-stud') dir = m.role === 'king' ? -(towardOpening * v.sign || 1) : uc < (w.f0 + w.f1) / 2 === v.sign > 0 ? 1 : -1;
      const drop = m.role === 'king' ? 50 : m.role === 'jack' ? 22 : m.role === 'corner-nailer' ? 64 : 34;
      const z = s.z1 - s.z0 < 30 ? (s.z0 + s.z1) / 2 : Math.min(s.z0 + drop, s.z1 - 8);
      const at = E(uc, z);
      const gap = (s.u1 - s.u0) / 2 + p(6.5);
      const text = m.role === 'post' ? `${m.mark} (${w.members.filter((q) => q.role === 'post' && spanOf(q).z0 === s.z0).length})` : m.mark;
      const y = room(at.x + dir * gap, at.y, text);
      if (y === null) return;
      marks.push(
        <Text key={i} at={{ x: at.x + dir * gap, y }} size={TXT.mark} rotate={-90} middle>
          {text}
        </Text>,
      );
    } else if (m.role === 'header') {
      if (w.members.find((q) => q.role === 'header' && q.note === m.note) !== m) return;
      marks.push(
        <Text key={i} at={E(uc, (s.z0 + s.z1) / 2)} size={TXT.tiny} middle weight="bold">
          {m.mark}
        </Text>,
      );
    } else if (m.role === 'sill') {
      marks.push(<Text key={i} at={E(uc, s.z0 - p(8.5))} size={TXT.mark} middle>{m.mark}</Text>);
    } else if (m.role === 'bottom-plate') {
      marks.push(<Text key={i} at={E(uc, s.z1 + p(8.5))} size={TXT.mark} middle>{m.mark}</Text>);
    } else if (m.role === 'top-plate') {
      marks.push(<Text key={i} at={E(uc, s.z0 - p(8.5))} size={TXT.mark} middle>{m.mark}</Text>);
    } else if (m.role === 'cap-plate') {
      marks.push(<Text key={i} at={E(uc, s.z1 + p(8.5))} size={TXT.mark} middle>{m.mark}</Text>);
    } else if (m.role === 'rake-plate') {
      // The upper plate is marked above the rake and the lower one below it.
      const upper = !w.members.some((q) => q.role === 'rake-plate' && q !== m && Math.abs(spanOf(q).u0 - s.u0) < 0.1 && spanOf(q).z1 > s.z1 + 0.1);
      const slope = (m.profile[1].y - m.profile[0].y) / (m.profile[1].x - m.profile[0].x);
      const zc = (m.profile[0].y + m.profile[1].y) / 2 + w.tvOf;
      const ang = (-Math.atan(slope) * v.sign * 180) / Math.PI;
      marks.push(
        <Text key={i} at={E(uc, upper ? zc + p(9.5) : zc - w.tvOf - p(8.5))} size={TXT.mark} rotate={ang} middle>
          {m.mark}
        </Text>,
      );
    }
  });

  // --- stud layout ticks
  const ticks: ReactNode[] = [];
  const tickZ = b.bottom - p(12);
  for (let k = 0; k < 400; k++) {
    const u = w.origin + w.layoutDir * w.spacing * k;
    if (u < w.f0 - 4 || u > w.f1 + 4) {
      if (k > 0 && (w.layoutDir === 1 ? u > w.f1 : u < w.f0)) break;
      continue;
    }
    ticks.push(<Line key={k} a={E(u, tickZ)} b={E(u, tickZ - p(k % 3 === 0 ? 7 : 4))} w={LW.hair} />);
  }
  const originAt = E(Math.min(Math.max(w.origin, w.f0 - 4), w.f1 + 4), tickZ);

  const chain = [...new Set([w.f0, ...w.openings.flatMap((o) => [o.u0, o.u1]), w.f1])].sort((m, n) => v.x(m) - v.x(n));
  const left = Math.min(v.x(w.f0), v.x(w.f1));
  const low = Math.min(...w.members.filter((m) => m.role === 'rake-plate').flatMap((m) => m.profile.map((q) => q.y)), Infinity);
  return (
    <g>
      {/* What the wall stands on. */}
      {w.zone ? (
        <g>
          <Poly points={[E(w.f0 - 6, w.base), E(w.f1 + 6, w.base), E(w.f1 + 6, w.base - 6), E(w.f0 - 6, w.base - 6)]} fill={LIGHT} w={LW.thin} />
          <Text at={E((w.f0 + w.f1) / 2, w.base - 3)} size={TXT.mark} middle color={INK_LIGHT}>GARAGE SLAB</Text>
        </g>
      ) : (
        <g>
          <Poly points={[E(w.f0 - 3, w.base), E(w.f1 + 3, w.base), E(w.f1 + 3, w.base + lv.joistBottom), E(w.f0 - 3, w.base + lv.joistBottom)]} w={LW.fine} stroke={INK_LIGHT} />
          <Line a={E(w.f0 - 3, w.base + lv.joistTop)} b={E(w.f1 + 3, w.base + lv.joistTop)} w={LW.hair} color={INK_LIGHT} />
          <Text at={E((w.f0 + w.f1) / 2, w.base + lv.joistBottom / 2 - 0.4)} size={TXT.mark} middle color={INK_LIGHT}>SUBFLOOR AND FLOOR FRAMING · SEE S-101</Text>
        </g>
      )}
      {[...groups].map(([color, polys]) => (
        <Polys key={color} polys={polys} fill={color} w={LW.fine} />
      ))}
      {r && w.ridgeU !== null && (
        <g>
          <Poly
            points={[E(w.ridgeU - r.half, r.ridgeBottom), E(w.ridgeU + r.half, r.ridgeBottom), E(w.ridgeU + r.half, r.ridgeTop), E(w.ridgeU - r.half, r.ridgeTop)]}
            fill={LVL}
            w={LW.thin}
          />
          <Text at={E(w.ridgeU, r.ridgeTop + p(8))} size={TXT.mark} middle>RIDGE BEAM</Text>
        </g>
      )}
      {r && (
        <Poly
          points={(w.ridgeU !== null ? [w.f0, w.ridgeU, w.f1] : [w.f0, w.f1]).map((u) => E(u, w.under(u) + r.tv))}
          closed={false}
          w={LW.hair}
          dash={[6, 3]}
          stroke={INK_LIGHT}
        />
      )}
      {w.openings.map((o) => {
        const c = E((o.u0 + o.u1) / 2, w.base + (o.sill + o.head) / 2);
        return (
          <g key={o.opening.id}>
            <Line a={E(o.u0, w.base + o.sill)} b={E(o.u1, w.base + o.head)} w={LW.hair} color="#b5b5b5" />
            <Line a={E(o.u0, w.base + o.head)} b={E(o.u1, w.base + o.sill)} w={LW.hair} color="#b5b5b5" />
            <Tag at={{ x: c.x, y: c.y - p(14) }} text={o.opening.tag} shape={o.opening.kind === 'window' ? 'hex' : 'circle'} />
            <Text at={{ x: c.x, y: c.y + p(12) }} size={TXT.tiny} middle>{`R.O. ${formatFrac(o.w)} x ${formatFrac(o.h)}`}</Text>
            <Text at={{ x: c.x, y: c.y + p(25) }} size={TXT.tiny} middle color={INK_LIGHT}>{`HDR. ${headerLabel(o.header)}`.toUpperCase()}</Text>
          </g>
        );
      })}
      {marks}
      {ticks}
      <Poly points={[originAt, { x: originAt.x - p(4), y: originAt.y + p(8) }, { x: originAt.x + p(4), y: originAt.y + p(8) }]} fill={INK} w={0} />
      <Text at={{ x: originAt.x + v.sign * w.layoutDir * p(9), y: originAt.y + p(10) }} size={TXT.mark} anchor={v.sign * w.layoutDir > 0 ? 'start' : 'end'}>
        {`STUD LAYOUT FROM HERE, ${formatFrac(w.spacing)} O.C.`}
      </Text>
      <DimChain points={chain.map((u) => E(u, b.bottom))} off={-p(54)} />
      <Dim a={E(v.sign > 0 ? w.f0 : w.f1, b.bottom)} b={E(v.sign > 0 ? w.f1 : w.f0, b.bottom)} off={-p(84)} />
      <Dim a={{ x: left, y: -w.base }} b={{ x: left, y: -(w.gable === 'none' ? w.plate : low) }} off={p(30)} text={w.gable === 'none' ? `${formatFtIn(w.plate - w.base)} PLATE` : undefined} />
      {w.gable !== 'none' && r && <Dim a={{ x: left, y: -w.base }} b={{ x: left, y: -r.ridgeBottom }} off={p(62)} text={`${formatFtIn(r.ridgeBottom - w.base)} TO RIDGE BEAM`} />}
      <line x1={v.x(w.f0) - 3} x2={v.x(w.f1) + 3} y1={-w.base} y2={-w.base} stroke={INK} strokeWidth={p(LW.med)} />
    </g>
  );
}
