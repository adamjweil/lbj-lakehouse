import type { ReactNode } from 'react';
import type { Design } from '../../model/schema';
import { footprintBounds, pierLayout, type Vec } from '../../model/geometry';
import { frameModel, type Member } from '../../model/framing';
import { ceilingZones } from '../../model/framing/bearing';
import { houseSheathing } from '../../model/framing/floor';
import { floorLevels, platformLevels, roofFraming } from '../../model/framing/levels';
import { lvlSize } from '../../model/framing/lumber';
import { headerLabel } from '../../model/framing/openings';
import { framingPhrases } from '../../model/framing/phrases';
import { deckBoardSize } from '../../model/framing/platforms';
import { cropTo, elevationView, inSlab, PLAN_VIEW, toSvg, type View } from '../../model/framing/project';
import { rafterLines } from '../../model/framing/roof';
import type { Solid } from '../../model/framing/solid';
import { formatFrac, formatPitch } from '../../model/units';
import { Dim, INK_LIGHT, LW, Leader, Line, Poly, Polys, Text, TXT, useDraft, type ScaleKey } from '../draft/draft';

const LIGHT = '#e4e4e4';
const LVL = '#9a9a9a';
const SHEET = '#d9d9d9';
const CONCRETE = '#d6d6d6';

type Window = { x0: number; y0: number; x1: number; y1: number };
type Note = { to: [number, number]; at: [number, number]; text: string | string[] };

export type Detail = {
  key: string;
  title: string;
  scale: ScaleKey;
  view: View;
  /** Depth range of the pieces shown, measured toward the viewer. */
  slab: [number, number];
  /** What the detail shows, in the view's own coordinates (y up). */
  window: Window;
  notes: Note[];
  /** Concrete, grade, and dimensions, drawn with `E` turning view coordinates into drawing ones. */
  extras?: (E: (x: number, y: number) => Vec, p: (n: number) => number) => ReactNode;
  /** Drawn under the framing. */
  under?: (E: (x: number, y: number) => Vec, p: (n: number) => number) => ReactNode;
};

const up = (s: string) => s.toUpperCase();

/** Typical details, each a window onto the framing model, so they change with the design. */
export function framingDetails(design: Design): Detail[] {
  const f = design.framing;
  const model = frameModel(design);
  const fb = footprintBounds(design);
  const r = roofFraming(design, undefined);
  const lay = rafterLines(design, undefined);
  if (!r || !lay) return [];
  const { rf } = r;
  const sh = houseSheathing(design);
  const lv = floorLevels(design);
  const pl = platformLevels(design);
  const ph = framingPhrases(design);
  const plate = design.levels.wallHeight;
  const grade = -design.levels.floorHeight;
  const zone = ceilingZones(design).find((z) => !z.zone);
  const out: Detail[] = [];
  // Sections look east, so the outside of the north wall is on the left.
  const east = elevationView({ x: 0, y: 1 });
  const depthOf = (x0: number, x1: number): [number, number] => [-x1, -x0];

  if (rf.axis === 'x') {
    // --- 1: eave
    const line = lay.lines.map(([a, b]) => (a + b) / 2).find((c) => (zone ? c > zone.bounds.x0 + 8 : c > fb.x0 + 40)) ?? lay.lines[2][0];
    const top = (y: number) => rf.undersideAt(y) + r.tv;
    const tail = rf.eave0;
    out.push({
      key: 'eave',
      title: 'Rafter at the Wall Plate',
      scale: '1',
      view: east,
      slab: depthOf(line - 2, line + 9),
      window: { x0: tail - 8, y0: plate - 30, x1: fb.y0 + 42, y1: top(fb.y0 + 42) + 6 },
      notes: [
        { to: [fb.y0 + 26, rf.undersideAt(fb.y0 + 26) + r.tv * 0.5], at: [fb.y0 + 12, top(fb.y0 + 42) + 2], text: [up(ph.framing.rafters), `PLUMB CUT BOTH ENDS, ${formatPitch(rf.slope * 12)}`] },
        { to: [fb.y0 + sh + f.roof.seat / 2, plate], at: [tail - 6, plate - 8], text: [up(`Birdsmouth: ${formatFrac(f.roof.seat)} seat`), 'ON THE PLATE; HURRICANE TIE'] },
        { to: [fb.y0 + sh + 3, plate - 1.5], at: [tail - 6, plate - 17], text: [up(`(${f.walls.topPlates}) ${f.walls.exterior.stud} top plates`), 'SPLICES OVER STUDS, 4 FT APART'] },
        { to: [fb.y0 + sh + 0.75, plate + 5], at: [tail - 6, top(tail) + 12], text: [up(`${f.roof.rafter} blocking, ripped`), 'BETWEEN THE RAFTERS'] },
        { to: [tail + 0.75, top(tail) - 4], at: [tail - 6, top(tail) + 3], text: up(`${f.roof.subFascia} sub-fascia`) },
        ...(zone ? [{ to: [fb.y0 + 34, plate + 3] as [number, number], at: [fb.y0 + 20, plate - 14] as [number, number], text: [up(`${zone.joist} ceiling joist`), 'BESIDE THE RAFTER'] }] : []),
        { to: [fb.y0 + sh + 3, plate - 22], at: [fb.y0 + 20, plate - 25], text: up(`${ph.framing.exteriorWalls}`) },
      ],
      extras: (E, p) => (
        <g>
          <Dim a={E(tail, plate - 28)} b={E(fb.y0, plate - 28)} off={p(0)} />
          <Line a={E(fb.y0 - 1, plate)} b={E(fb.y0 - 12, plate)} w={LW.hair} dash={[6, 3]} color={INK_LIGHT} />
          <Text at={E(fb.y0 - 12, plate + 1.2)} size={TXT.tiny} anchor="start" color={INK_LIGHT}>T.O. PLATE</Text>
        </g>
      ),
    });

    // --- 2: ridge
    const post = model.walls.find((w) => !w.zone && !w.exterior && w.ridgeU !== null);
    const at = post ? post.wall.start.x : line;
    const near = lay.lines.map(([a, b]) => (a + b) / 2).filter((c) => c > at + 2)[0] ?? line;
    out.push({
      key: 'ridge',
      title: 'Rafters at the Ridge Beam',
      scale: '1',
      view: east,
      slab: depthOf(at - 3, near + 2),
      window: { x0: rf.ridgeS - 34, y0: r.ridgeBottom - 26, x1: rf.ridgeS + 34, y1: r.ridgeTop + 8 },
      notes: [
        { to: [rf.ridgeS + 0.6, r.ridgeTop - 5], at: [rf.ridgeS + 12, r.ridgeTop + 5], text: [up(`(${f.roof.ridge.plies}) ${lvlSize(f.roof.ridge)} ridge beam`), 'SIZE AND BEARING BY ENGINEER'] },
        { to: [rf.ridgeS - r.half - 0.3, r.ridgeTop - 9], at: [rf.ridgeS - 32, r.ridgeTop + 5], text: ['SLOPED HANGER AT', 'EVERY RAFTER'] },
        { to: [rf.ridgeS + 1.4, r.ridgeBottom - 12], at: [rf.ridgeS + 12, r.ridgeBottom - 20], text: [up(`Post: (${f.roof.ridgePostPlies}) ${post?.stud ?? f.walls.interior.stud}, with a column cap`), 'BY ENGINEER'] },
        { to: [rf.ridgeS - 20, rf.undersideAt(rf.ridgeS - 20) - 1.6], at: [rf.ridgeS - 32, r.ridgeBottom - 20], text: [up(`(${f.walls.topPlates}) rake plates on`), 'BEVELED STUDS'] },
      ],
    });
  }

  // --- 3 and 4: floor
  const piers = pierLayout(design).piers.filter((q) => !q.deck);
  const xs = [...new Set(piers.map((q) => q.p.x))].sort((a, b) => a - b);
  const ys = [...new Set(piers.map((q) => q.p.y))].sort((a, b) => a - b);
  const px = xs[1] ?? xs[0];
  const size = design.foundation.pierSize;
  const pier = (y: number) => (E: (x: number, y: number) => Vec) => (
    <g>
      <Poly points={[E(y - size / 2, grade - 8), E(y + size / 2, grade - 8), E(y + size / 2, lv.beamBottom), E(y - size / 2, lv.beamBottom)]} fill={CONCRETE} w={LW.thin} />
      <Line a={E(y - 40, grade)} b={E(y + 40, grade)} w={LW.heavy} />
      <Text at={E(y, grade - 5)} size={TXT.tiny} middle>{up(`${formatFrac(size)} dia. pier`)}</Text>
      <Text at={E(y + 30, grade + 1.5)} size={TXT.tiny} color={INK_LIGHT}>GRADE</Text>
    </g>
  );
  if (ys.length > 2) {
    const y = ys[1];
    out.push({
      key: 'beam',
      title: 'Floor Joists over a Beam',
      scale: '1',
      view: east,
      slab: depthOf(px - 4, px + 5),
      window: { x0: y - 30, y0: grade - 10, x1: y + 30, y1: 10 },
      notes: [
        { to: [y - 14, (lv.joistTop + lv.joistBottom) / 2], at: [y - 28, 7], text: [up(ph.foundation.joists), 'BUTT OVER THE BEAM; STRAP TIE'] },
        { to: [y + 0.4, lv.joistBottom + 3], at: [y + 8, 7], text: ['SOLID BLOCKING', 'BETWEEN THE JOISTS'] },
        { to: [y + 1.6, (lv.beamTop + lv.beamBottom) / 2], at: [y + 10, lv.beamBottom - 3], text: [up(ph.foundation.beams), 'BEAM SEAT ANCHORED TO THE PIER'] },
        { to: [y - 20, -0.4], at: [y - 28, lv.beamBottom - 3], text: up(ph.foundation.subfloor.split(',')[0]) },
      ],
      under: pier(y),
    });
  }
  const deck = model.assemblies.find((a) => a.group === 'deck');
  if (deck && ys.length) {
    const y = fb.y1;
    const stud = model.walls.find((w) => w.wall.id === 'WS') ?? model.walls.find((w) => w.exterior && !w.zone);
    out.push({
      key: 'ledger',
      title: 'Exterior Wall, Rim, and Deck Ledger',
      scale: '1',
      view: east,
      slab: depthOf(px - 4, px + 5),
      window: { x0: y - 32, y0: grade - 10, x1: y + 32, y1: 26 },
      notes: [
        { to: [y - sh - 0.75, (lv.joistTop + lv.joistBottom) / 2], at: [y - 30, 22], text: [up(`${f.floor.rim} P.T. rim`), 'SHEATHING LAPS OVER IT'] },
        { to: [y - sh - 3, 0.75], at: [y - 30, 12], text: [up(`${stud?.stud ?? f.walls.exterior.stud} bottom plate`), 'ON THE SUBFLOOR'] },
        { to: [y + 0.75, (pl.joistTop + pl.joistBottom) / 2], at: [y + 8, 22], text: [up(`${f.platforms.joist} P.T. ledger`), 'STRUCTURAL SCREWS TO THE RIM;', 'FLASH OVER THE TOP'] },
        { to: [y + 16, (pl.joistTop + pl.joistBottom) / 2], at: [y + 10, lv.beamBottom - 6], text: [up(`${f.platforms.joist} P.T. deck joist`), 'IN A HANGER'] },
        { to: [y + 24, pl.top - 0.4], at: [y + 8, 9], text: up(`${deckBoardSize(design)} decking`) },
      ],
      under: pier(ys[ys.length - 1]),
    });
  }

  // --- 5 and 6: corners and partitions, in plan
  const wn = model.walls.find((w) => !w.zone && w.exterior && w.ends[1].kind === 'corner' && w.ends[1].through);
  if (wn) {
    const c = wn.wall.end;
    const cut = wn.base + 48;
    out.push({
      key: 'corner',
      title: 'Outside Corner, in Plan',
      scale: '1',
      view: PLAN_VIEW,
      slab: [cut - 1, cut + 1],
      window: { x0: c.x - 34, y0: -(c.y + 30), x1: c.x + 6, y1: -(c.y - 6) },
      notes: [
        { to: [c.x + wn.wall.thickness / 2 - sh - 0.75, -(c.y + 0.5)], at: [c.x - 32, -(c.y + 16)], text: ['END STUD OF THE WALL', 'THAT RUNS THROUGH'] },
        { to: [c.x - 4, -(c.y + wn.wall.thickness / 2 - 0.75)], at: [c.x - 32, -(c.y + 24)], text: ['STUD LAID FLAT: BACKS THE', 'WALLBOARD; CORNER STAYS OPEN'] },
        { to: [c.x, -(c.y + wn.wall.thickness / 2 + 0.75)], at: [c.x - 32, -(c.y + 8)], text: ['FIRST STUD OF THE', 'WALL THAT BUTTS'] },
      ],
    });
  }
  const host = model.walls.find((w) => !w.zone && w.exterior && w.tees.some((t) => !t.face && model.walls.find((q) => q.wall.id === t.wall.id)?.gable === 'none'));
  const tee = host?.tees.find((t) => model.walls.find((q) => q.wall.id === t.wall.id)?.gable === 'none');
  if (host && tee) {
    const at = tee.wall.start.x;
    const y = host.wall.start.y;
    const row = host.base + 1.5 + f.walls.backing.spacing * 2;
    out.push({
      key: 'tee',
      title: 'Partition at a Wall, in Plan',
      scale: '1',
      view: PLAN_VIEW,
      slab: [row - 0.5, row + 0.5],
      window: { x0: at - 22, y0: -(y + 30), x1: at + 22, y1: -(y - 6) },
      notes: [
        { to: [at - 5, -(y + host.wall.thickness / 2 - 0.75)], at: [at - 20, -(y + 14)], text: [up(`${f.walls.backing.size} ladder blocking`), up(`@ ${formatFrac(f.walls.backing.spacing)} o.c., flat`)] },
        { to: [at, -(y + host.wall.thickness / 2 + 0.75)], at: [at + 6, -(y + 24)], text: ['END STUD OF THE', 'PARTITION'] },
      ],
    });
  }

  // --- 7: a window opening
  const wall = model.walls.find((w) => w.gable === 'none' && w.exterior && w.openings.some((o) => o.sill > 0.5));
  const ro = wall?.openings.find((o) => o.sill > 0.5);
  if (wall && ro) {
    const d = { x: wall.wall.end.x - wall.wall.start.x, y: wall.wall.end.y - wall.wall.start.y };
    const len = Math.hypot(d.x, d.y);
    const view = elevationView({ x: d.x / len, y: d.y / len }, { x: wall.wall.start.x, y: wall.wall.start.y, z: 0 });
    const head = wall.base + ro.head;
    const sill = wall.base + ro.sill;
    const side = ro.jacks * 1.5;
    out.push({
      key: 'opening',
      title: `Window Opening ${ro.opening.tag}, from Inside`,
      scale: '1/2',
      view,
      slab: [-wall.wall.thickness, wall.wall.thickness],
      window: { x0: ro.u0 - 26, y0: wall.base - 2, x1: ro.u1 + 26, y1: wall.plate + 3 },
      notes: [
        { to: [ro.u0 - side - 0.75, sill + 10], at: [ro.u0 - 24, sill + 30], text: ['KING STUD', 'FULL HEIGHT'] },
        { to: [ro.u0 - 0.75, sill + 2], at: [ro.u0 - 24, sill - 14], text: [`JACK STUD${ro.jacks > 1 ? `S (${ro.jacks})` : ''}`, 'CARRIES THE HEADER'] },
        { to: [ro.u1 - 6, head + ro.header.d / 2], at: [ro.u1 + 6, head + ro.header.d + 10], text: [up(`Header: ${headerLabel(ro.header)}`), up(`${formatFrac(ro.header.length)} long`)] },
        { to: [(ro.u0 + ro.u1) / 2 + 4, head + ro.header.d + 5], at: [ro.u1 + 6, wall.plate - 4], text: 'CRIPPLES ON THE STUD LAYOUT' },
        { to: [ro.u1 - 8, sill - 0.75], at: [ro.u1 + 6, sill - 12], text: ['ROUGH SILL', 'ON CRIPPLES'] },
      ],
      extras: (E, p) => (
        <g>
          <Dim a={E(ro.u0, sill + 4)} b={E(ro.u1, sill + 4)} off={p(0)} text={`R.O. ${formatFrac(ro.w)}`} />
          <Dim a={E(ro.u0 + 5, sill)} b={E(ro.u0 + 5, head)} off={p(0)} text={`R.O. ${formatFrac(ro.h)}`} />
          <Line a={E(ro.u0, sill)} b={E(ro.u1, head)} w={LW.hair} color="#c4c4c4" />
          <Line a={E(ro.u0, head)} b={E(ro.u1, sill)} w={LW.hair} color="#c4c4c4" />
        </g>
      ),
    });
  }
  return out;
}

export function detailBounds(d: Detail) {
  return { x0: d.window.x0, y0: -d.window.y1, x1: d.window.x1, y1: -d.window.y0 };
}

export function DetailDrawing({ design, detail }: { design: Design; detail: Detail }) {
  const { p } = useDraft();
  const model = frameModel(design);
  const E = (x: number, y: number): Vec => ({ x, y: -y });
  const [lo, hi] = [Math.min(...detail.slab), Math.max(...detail.slab)];
  const w = detail.window;
  const inside = (poly: Vec[]) => toSvg(cropTo(poly, w));
  const panels: Solid[] = model.panels.flatMap((q) => q.pieces.map((piece) => ({ o: q.o, u: q.u, v: q.v, profile: piece, t: q.t })));
  const sheets = inSlab(detail.view, panels, lo, hi).map((q) => inside(q.poly)).filter((q) => q.length > 2);
  const pieces = inSlab<Member>(detail.view, model.members, lo, hi);
  const parts: ReactNode[] = [];
  pieces.forEach((q, i) => {
    const poly = inside(q.poly);
    if (poly.length < 3) return;
    // A piece that runs through the whole slab is cut by the section.
    const cut = q.far <= lo + 0.01 && q.near >= hi - 0.01;
    const lvl = q.item.material === 'LVL';
    parts.push(<Poly key={i} points={poly} fill={lvl ? LVL : cut ? LIGHT : '#fff'} w={cut ? LW.thin : LW.fine} />);
    if (cut && !lvl && q.poly.length === 4) {
      const c = toSvg(q.poly);
      const whole = cropTo(q.poly, w).length === 4 && q.poly.every((v) => v.x >= w.x0 && v.x <= w.x1 && v.y >= w.y0 && v.y <= w.y1);
      if (whole) {
        parts.push(<Line key={`a${i}`} a={c[0]} b={c[2]} w={LW.hair} />);
        parts.push(<Line key={`b${i}`} a={c[1]} b={c[3]} w={LW.hair} />);
      }
    }
  });
  return (
    <g>
      {detail.under?.(E, p)}
      <Polys polys={sheets} fill={SHEET} w={LW.hair} />
      {parts}
      {detail.extras?.(E, p)}
      {detail.notes.map((n, i) => (
        <Leader key={i} to={E(n.to[0], n.to[1])} at={E(n.at[0], n.at[1])} text={n.text} />
      ))}
      <Poly points={[E(w.x0, w.y0), E(w.x1, w.y0), E(w.x1, w.y1), E(w.x0, w.y1)]} w={LW.hair} dash={[10, 3, 2, 3]} stroke={INK_LIGHT} />
    </g>
  );
}

