import type { ReactNode } from 'react';
import type { Design } from '../../model/schema';
import {
  buildingBounds, polygonCentroid, footprint, footprintBounds, garageFootprint, openingCenter, outwardNormal, pierLayout, platforms, pointAlong, rectPoints,
  wallDir, wallLength, leftNormal, add, mul, type Rect,
} from '../../model/geometry';
import { frameModel, type Member, type Role } from '../../model/framing';
import { ceilingZones } from '../../model/framing/bearing';
import { roofFraming } from '../../model/framing/levels';
import { lvlSize } from '../../model/framing/lumber';
import { framingPhrases } from '../../model/framing/phrases';
import { deckBoardSize } from '../../model/framing/platforms';
import { planOutline, solidBounds } from '../../model/framing/solid';
import { formatFrac } from '../../model/units';
import { Dim, DimChain, INK, INK_LIGHT, leading, LW, Leader, Line, Poly, Polys, Tag, Text, textWidth, TXT, useDraft } from '../draft/draft';

const GREY = '#c9c9c9';
const LIGHT = '#e9e9e9';
const DARK = '#3a3a3a';

const outlines = (list: Member[], ...roles: Role[]) => list.filter((m) => !roles.length || roles.includes(m.role)).map((m) => planOutline(m));
const up = (s: string) => s.toUpperCase();

/** Lines of text on a white plate, so they read over the framing. The first line is the heading. */
function Plate({ at, lines }: { at: { x: number; y: number }; lines: string[] }) {
  const { p } = useDraft();
  const w = Math.max(textWidth(lines[0], TXT.label), ...lines.slice(1).map((l) => textWidth(l, TXT.tiny))) * 0.95 + 16;
  const lh = leading(TXT.tiny);
  const h = 26 + (lines.length - 1) * lh;
  return (
    <g>
      <rect x={at.x - p(w / 2)} y={at.y - p(h / 2)} width={p(w)} height={p(h)} fill="#fff" stroke={INK} strokeWidth={p(LW.hair)} />
      {lines.map((l, i) => (
        <Text key={i} at={{ x: at.x, y: at.y - p(h / 2) + p(i === 0 ? 18 : 19 + i * lh) }} size={i === 0 ? TXT.label : TXT.tiny} weight={i === 0 ? 'bold' : 'normal'}>
          {l}
        </Text>
      ))}
    </g>
  );
}

export function framingPlanBounds(design: Design, margin: number): Rect {
  const b = buildingBounds(design);
  const all = [b, ...platforms(design).flatMap((q) => [q.rect, q.stairs?.rect])].filter(Boolean) as Rect[];
  return {
    x0: Math.min(...all.map((q) => q.x0)) - margin,
    y0: Math.min(...all.map((q) => q.y0)) - margin,
    x1: Math.max(...all.map((q) => q.x1)) + margin,
    y1: Math.max(...all.map((q) => q.y1)) + margin,
  };
}

/** The outline of the walls below, for reference under a framing plan. */
function WallsBelow({ design }: { design: Design }) {
  const gfp = garageFootprint(design);
  return (
    <g>
      <Poly points={footprint(design)} w={LW.thin} dash={[8, 4]} stroke={INK_LIGHT} />
      {gfp && <Poly points={gfp} w={LW.thin} dash={[8, 4]} stroke={INK_LIGHT} />}
    </g>
  );
}

// ---------------------------------------------------------------- S-101

export function FloorFramingDrawing({ design }: { design: Design }) {
  const { p } = useDraft();
  const model = frameModel(design);
  const f = design.framing;
  const floor = model.assemblies.find((a) => a.group === 'floor')?.members ?? [];
  const decks = model.assemblies.filter((a) => a.system === 'platform');
  const fb = footprintBounds(design);
  const { beams, piers } = pierLayout(design);
  const size = design.foundation.pierSize;
  const gfp = garageFootprint(design);
  const phrases = framingPhrases(design);
  const ys = beams.filter((b) => !b.deck).map((b) => b.a.y).sort((a, b) => a - b);
  const xs = [...new Set(piers.filter((q) => !q.deck).map((q) => q.p.x))].sort((a, b) => a - b);
  // Where a joist breaks over a beam.
  const joists = floor.filter((m) => m.role === 'joist');
  const splices = joists
    .map((m) => solidBounds(m))
    .filter((b) => b.max.y < fb.y1 - 12)
    .map((b) => ({ x: (b.min.x + b.max.x) / 2, y: b.max.y }));
  const under = joists.filter((m) => m.note?.startsWith('Under wall'));
  const underNotes = [...new Set(under.map((m) => m.note!))].map((note) => {
    const list = under.filter((m) => m.note === note).map((m) => solidBounds(m));
    return { note, count: new Set(list.map((b) => b.min.x)).size, x: list[0].min.x, y: (Math.min(...list.map((b) => b.min.y)) + Math.max(...list.map((b) => b.max.y))) / 2 };
  });
  const east = fb.x1 + p(150);
  const top = Math.min(fb.y0, ...platforms(design).flatMap((q) => [q.rect.y0, q.stairs?.rect.y0 ?? q.rect.y0]));
  const parts: ReactNode[] = [];

  for (const a of decks) {
    const kind = a.group;
    const plat = platforms(design).find((q) => q.kind === kind)!;
    const r = plat.rect;
    const mid = { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 };
    const name = kind === 'deck' ? 'DECK' : 'PORCH';
    const beam = a.members.find((m) => m.role === 'beam');
    const by = beam ? solidBounds(beam) : null;
    parts.push(
      <g key={kind}>
        <Polys polys={outlines(a.members, 'beam')} fill={GREY} w={LW.fine} />
        <Polys polys={outlines(a.members, 'joist', 'rim', 'ledger', 'stringer')} fill="#fff" w={LW.fine} />
        <Polys polys={outlines(a.members, 'deck-post')} fill={DARK} w={0} />
        <Plate
          at={{ x: mid.x + p(120), y: mid.y }}
          lines={[
            `${name} FRAMING`,
            up(`${f.platforms.joist} P.T. joists @ ${formatFrac(f.platforms.spacing)} o.c., hangers at the ledger`),
            up(`${deckBoardSize(design)} decking · guard posts @ ${formatFrac(f.platforms.guardSpacing)} max.`),
          ]}
        />
        {by && (
          <Leader
            to={{ x: r.x1 - 30, y: (by.min.y + by.max.y) / 2 }}
            at={{ x: east, y: (by.min.y + by.max.y) / 2 }}
            text={[up(`(${f.platforms.beam.plies}) ${f.platforms.beam.size} P.T. beam`), up(`on ${f.platforms.post} posts and piers`)]}
          />
        )}
        <Leader
          to={{ x: r.x1 - 60, y: kind === 'deck' ? r.y0 + 0.75 : r.y1 - 0.75 }}
          at={{ x: east, y: kind === 'deck' ? r.y0 + p(26) : r.y1 - p(26) }}
          text={[up(`${f.platforms.joist} P.T. ledger, bolted`), 'TO THE HOUSE RIM; FLASH OVER']}
        />
      </g>,
    );
  }

  return (
    <g>
      {gfp && (
        <g>
          <Poly points={gfp} w={LW.med} />
          <Text at={{ x: (gfp[0].x + gfp[1].x) / 2, y: (gfp[0].y + gfp[2].y) / 2 }} size={TXT.label} weight="bold">GARAGE SLAB</Text>
          <Text at={{ x: (gfp[0].x + gfp[1].x) / 2, y: (gfp[0].y + gfp[2].y) / 2 + p(14) }} size={TXT.tiny}>NO FLOOR FRAMING · SEE A-103</Text>
        </g>
      )}
      {piers.map((q, i) => (
        <circle key={i} cx={q.p.x} cy={q.p.y} r={size / 2} fill={LIGHT} stroke={INK} strokeWidth={p(LW.thin)} />
      ))}
      {parts}
      <Polys polys={outlines(floor, 'beam')} fill={GREY} w={LW.fine} />
      <Polys polys={outlines(floor, 'blocking')} fill={LIGHT} w={LW.fine} />
      <Polys polys={outlines(floor.filter((m) => !m.note?.startsWith('Under wall')), 'joist', 'rim')} fill="#fff" w={LW.fine} />
      <Polys polys={outlines(under)} fill={GREY} w={LW.thin} />
      {splices.map((s, i) => (
        <Line key={i} a={{ x: s.x - 3.5, y: s.y }} b={{ x: s.x + 3.5, y: s.y }} w={LW.med} />
      ))}
      <Poly points={footprint(design)} w={LW.thin} dash={[8, 4]} stroke={INK_LIGHT} />

      <Leader to={{ x: fb.x1 - 40, y: ys[0] + 46 }} at={{ x: east, y: ys[0] + 46 }} text={[up(phrases.foundation.joists), 'BUTT SPLICE OVER ALTERNATE BEAMS (—)']} />
      {ys.length > 1 && (
        <Leader to={{ x: fb.x1 - 24, y: ys[1] }} at={{ x: east, y: ys[1] + p(18) }} text={[up(phrases.foundation.beams), 'PLIES BREAK OVER THE PIERS']} />
      )}
      {ys.length > 2 && (
        <Leader to={{ x: fb.x1 - 10, y: ys[2] - 2 }} at={{ x: east, y: ys[2] - p(22) }} text={['SOLID BLOCKING OVER THE BEAM', 'BETWEEN THE JOIST SPLICES']} />
      )}
      <Leader to={{ x: fb.x1 - 70, y: fb.y1 - 1.25 }} at={{ x: east, y: fb.y1 - p(30) }} text={[up(`${f.floor.rim} P.T. rim`), up(phrases.foundation.subfloor.split(',')[0])]} />
      {underNotes.map((u, i) => (
        <Leader
          key={u.note}
          to={{ x: u.x + 1, y: fb.y0 + 60 + i * 30 }}
          at={{ x: east, y: fb.y0 + 14 + i * p(24) }}
          text={up(`${u.count > 1 ? 'Double joist' : 'Extra joist'} ${u.note.toLowerCase()}`)}
        />
      ))}
      <DimChain points={xs.map((x) => ({ x, y: top }))} off={p(34)} />
      <DimChain points={ys.map((y) => ({ x: fb.x1, y }))} off={p(34)} />
      <Dim a={{ x: fb.x0 + 16, y: fb.y0 + 40 }} b={{ x: fb.x0 + 32, y: fb.y0 + 40 }} off={p(0)} text={`${formatFrac(f.floor.spacing)} O.C.`} />
      <Text at={{ x: fb.x0 + 24, y: fb.y0 + 40 + p(14) }} size={TXT.tiny} color={INK_LIGHT}>TYP.</Text>
    </g>
  );
}

// ---------------------------------------------------------------- S-102

/** Height of the cut through the walls, above each wall's floor. */
const CUT = 48;

export function WallFramingPlanDrawing({ design }: { design: Design }) {
  const { p } = useDraft();
  const model = frameModel(design);
  const fb = footprintBounds(design);
  const gfp = garageFootprint(design);
  const plumb = new Set<Role>(['stud', 'end-stud', 'corner-nailer', 'king', 'jack', 'cripple', 'post']);
  const cut: Member[] = [];
  const posts: Member[] = [];
  const plates: Member[] = [];
  const headers: Member[] = [];
  const blocks: Member[] = [];
  for (const w of model.walls) {
    for (const m of w.members) {
      const b = solidBounds(m);
      const at = w.base + CUT;
      if (m.role === 'bottom-plate') plates.push(m);
      else if (m.role === 'header') headers.push(m);
      else if (m.role === 'backing' && Math.abs((b.min.z + b.max.z) / 2 - (w.base + 49.5)) < 2) blocks.push(m);
      else if (m.role === 'post' && b.max.z > at) posts.push(m);
      else if (plumb.has(m.role) && b.min.z < at && b.max.z > at) cut.push(m);
    }
  }
  const xs = [...new Set(design.walls.filter((w) => !w.zone && w.type === 'interior' && Math.abs(wallDir(w).y) > 0.99).map((w) => w.start.x))].sort((a, b) => a - b);
  const ys = [...new Set(design.walls.filter((w) => !w.zone && w.type === 'interior' && Math.abs(wallDir(w).x) > 0.99).map((w) => w.start.y))].sort((a, b) => a - b);
  const porch = platforms(design).find((q) => q.side === 'north');
  const top = fb.y0 - (porch ? 0 : 0);
  return (
    <g>
      {/* Sheathing on the outside of the exterior walls. */}
      <Poly points={footprint(design)} w={LW.med} />
      {gfp && <Poly points={gfp} w={LW.med} />}
      <Polys polys={outlines(plates)} fill="#fff" w={LW.fine} />
      <Polys polys={outlines(headers)} w={LW.fine} dash={[5, 3]} stroke={INK_LIGHT} />
      <Polys polys={outlines(blocks)} fill={GREY} w={LW.hair} />
      <Polys polys={outlines(cut)} fill={DARK} w={0} />
      <Polys polys={outlines(posts)} fill="#fff" w={LW.med} />
      {model.walls.map((w) => {
        const d = wallDir(w.wall);
        const n = leftNormal(d);
        const inward = w.exterior ? mul(outwardNormal(design, w.wall), -1) : n;
        const L = wallLength(w.wall);
        // Keep the tag off the openings.
        const free = [0.5, 0.35, 0.65, 0.2, 0.8].map((k) => k * L).find((u) => !w.openings.some((o) => u > o.u0 - 14 && u < o.u1 + 14)) ?? L / 2;
        const tag = add(pointAlong(w.wall, free), mul(inward, w.wall.thickness / 2 + p(22)));
        const from = pointAlong(w.wall, w.origin);
        const to = pointAlong(w.wall, w.origin + w.layoutDir * 16);
        const off = mul(inward, w.wall.thickness / 2 + p(7));
        return (
          <g key={w.wall.id}>
            <Tag at={tag} text={w.wall.id} shape="hex" />
            {/* Stud layout starts here and runs this way. */}
            <Line a={add(from, off)} b={add(to, off)} w={LW.thin} />
            <Poly points={[add(to, off), add(add(to, off), add(mul(d, -w.layoutDir * p(7)), mul(n, p(2.4)))), add(add(to, off), add(mul(d, -w.layoutDir * p(7)), mul(n, -p(2.4))))]} fill={INK} w={0} />
            <circle cx={from.x + off.x} cy={from.y + off.y} r={p(2)} fill={INK} />
          </g>
        );
      })}
      {design.openings.map((o) => {
        const w = design.walls.find((q) => q.id === o.wallId);
        if (!w) return null;
        const wf = model.walls.find((q) => q.wall.id === w.id);
        const out = wf?.exterior ? outwardNormal(design, w) : mul(leftNormal(wallDir(w)), -1);
        return <Tag key={o.id} at={add(openingCenter(w, o), mul(out, w.thickness / 2 + p(18)))} text={o.tag} shape={o.kind === 'window' ? 'hex' : 'circle'} />;
      })}
      <DimChain points={[fb.x0, ...xs, fb.x1].map((x) => ({ x, y: top }))} off={p(54)} />
      <Dim a={{ x: fb.x0, y: top }} b={{ x: fb.x1, y: top }} off={p(84)} />
      <DimChain points={[fb.y0, ...ys, fb.y1].map((y) => ({ x: fb.x1, y }))} off={p(54)} />
      <Dim a={{ x: fb.x1, y: fb.y0 }} b={{ x: fb.x1, y: fb.y1 }} off={p(84)} />
      {gfp && (
        <>
          <Dim a={{ x: gfp[0].x, y: top }} b={{ x: gfp[1].x, y: top }} off={p(54)} />
          <Dim a={{ x: gfp[0].x, y: gfp[0].y }} b={{ x: gfp[0].x, y: gfp[2].y }} off={-p(54)} />
        </>
      )}
    </g>
  );
}

// ---------------------------------------------------------------- S-103

export function RoofFramingDrawing({ design }: { design: Design }) {
  const { p } = useDraft();
  const model = frameModel(design);
  const f = design.framing;
  const phrases = framingPhrases(design);
  const roofs = model.assemblies.filter((a) => a.system === 'roof');
  const ceilings = model.assemblies.filter((a) => a.system === 'ceiling');
  const posts = model.walls.flatMap((w) => w.members.filter((m) => m.role === 'post'));
  const bearing = model.walls.filter((w) => !w.exterior && (w.bearing || w.gable !== 'none'));
  const fb = footprintBounds(design);
  const house = roofFraming(design, undefined)!;
  const garage = roofFraming(design, 'garage');
  const zones = ceilingZones(design);
  const east = house.rf.planRect.x1 + p(40);
  const r = house.rf.planRect;
  const room = design.rooms.find((q) => !q.zone && q.ceiling === 'vaulted');
  const vaulted = room ? polygonCentroid(room.polygon) : null;
  return (
    <g>
      {platforms(design).map((q) => (
        <Poly key={q.kind} points={rectPoints(q.rect)} w={LW.hair} dash={[3, 3]} stroke={INK_LIGHT} />
      ))}
      {ceilings.map((a) => (
        <g key={a.group}>
          <Polys polys={outlines(a.members, 'ceiling-joist', 'blocking')} fill={LIGHT} w={LW.hair} />
          <Polys polys={outlines(a.members, 'beam')} fill={GREY} w={LW.thin} />
        </g>
      ))}
      {roofs.map((a) => (
        <g key={a.group}>
          <Polys polys={outlines(a.members, 'blocking', 'lookout')} fill={LIGHT} w={LW.hair} />
          <Polys polys={outlines(a.members, 'rafter', 'fly-rafter', 'sub-fascia')} fill="#fff" w={LW.fine} />
          <Polys polys={outlines(a.members, 'ridge')} fill={GREY} w={LW.thin} />
        </g>
      ))}
      <WallsBelow design={design} />
      {bearing.map((w) => (
        <Line key={w.wall.id} a={w.wall.start} b={w.wall.end} w={LW.thin} dash={[10, 3, 2, 3]} color={INK_LIGHT} />
      ))}
      <Polys polys={outlines(posts)} fill={INK} w={0} />

      <Leader to={{ x: fb.x1 - 50, y: fb.y0 + 40 }} at={{ x: east, y: fb.y0 + 40 }} text={[up(phrases.framing.rafters), 'BIRDSMOUTH AT THE PLATE; HANGER AT THE RIDGE']} />
      <Leader
        to={{ x: fb.x1 - 30, y: house.rf.ridgeS }}
        at={{ x: east, y: house.rf.ridgeS - p(16) }}
        text={[up(`(${f.roof.ridge.plies}) ${lvlSize(f.roof.ridge)} ridge beam`), 'ON BUILT-UP POSTS (■) · BY ENGINEER']}
      />
      <Leader to={{ x: r.x1 - 0.75, y: fb.y0 + 90 }} at={{ x: east, y: fb.y0 + 90 }} text={[up(`${f.roof.rafter} fly rafter on ${f.roof.rakeBlocking.size} lookouts`), up(`@ ${formatFrac(f.roof.rakeBlocking.spacing)} o.c.`)]} />
      <Leader to={{ x: fb.x1 - 80, y: r.y1 - 0.75 }} at={{ x: east, y: r.y1 - p(4) }} text={up(`${f.roof.subFascia} sub-fascia`)} />
      <Leader to={{ x: fb.x1 - 20, y: fb.y1 - 1.25 }} at={{ x: east, y: fb.y1 - p(40) }} text={['BLOCKING BETWEEN THE RAFTERS', 'AT EACH EAVE WALL']} />
      {zones.map((z) => {
        const b = z.bounds;
        const c = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 + p(z.zone ? 60 : 80) };
        const bears = z.beamAt !== null ? 'HUNG FROM THE FLUSH BEAM' : z.supports.length ? up(`lapped over wall ${z.supports.map((w) => w.id).join(', ')}`) : 'BEARING ON THE EAVE WALLS';
        return <Plate key={z.group} at={c} lines={[up(`${z.title} joists`), up(`${z.joist} @ ${formatFrac(z.spacing)} o.c.`), bears]} />;
      })}
      {garage && (
        <Leader
          to={{ x: garage.rf.planRect.x0 + 40, y: garage.rf.ridgeS }}
          at={{ x: garage.rf.planRect.x0 - p(30), y: garage.rf.ridgeS - p(30) }}
          text={[up(`(${f.garage.ridge.plies}) ${lvlSize(f.garage.ridge)}`), 'RIDGE BEAM, AND A FLUSH', 'CEILING BEAM BELOW IT']}
        />
      )}
      {vaulted && <Plate at={{ x: vaulted.x, y: vaulted.y + p(80) }} lines={['VAULTED', 'NO CEILING JOISTS']} />}
      <Dim a={{ x: r.x0, y: r.y0 }} b={{ x: r.x1, y: r.y0 }} off={p(40)} />
      <Dim a={{ x: r.x1, y: r.y0 }} b={{ x: r.x1, y: r.y1 }} off={p(250)} />
      <Dim a={{ x: fb.x0 + 16, y: fb.y0 + 70 }} b={{ x: fb.x0 + 32, y: fb.y0 + 70 }} off={p(0)} text={`${formatFrac(f.roof.spacing)} O.C.`} />
    </g>
  );
}

export const FRAMING_LEGEND_FILL = { GREY, LIGHT, DARK, INK };
