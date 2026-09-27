import { formatUsd, framingCostRows, hardwareRate, roofingCostRows } from '../../model/costs';
import { frameModel } from '../../model/framing';
import { validateFraming } from '../../model/framing/checks';
import { MATERIAL_NAMES } from '../../model/framing/lumber';
import { headerLabel } from '../../model/framing/openings';
import { stockLabel, takeoff, TRADE_NAMES } from '../../model/framing/takeoff';
import { roofingTakeoff } from '../../model/roofing';
import { formatFrac, formatFtIn } from '../../model/units';
import type { ReactNode } from 'react';
import type { Design } from '../../model/schema';
import type { WallFrame } from '../../model/framing';
import { ceilingZones } from '../../model/framing/bearing';
import { lvlSize } from '../../model/framing/lumber';
import { framingPhrases } from '../../model/framing/phrases';
import { INK, INK_LIGHT, leading, LW, NorthArrow, PAPER, PText, SCALES, ScaleBar, textWidth, TXT, ViewTitle, wrapText, type ScaleKey } from '../draft/draft';
import { DetailDrawing, detailBounds, framingDetails } from '../framing/Details';
import { FloorFramingDrawing, framingPlanBounds, RoofFramingDrawing, WallFramingPlanDrawing } from '../framing/FramingPlans';
import { WallElevationDrawing, wallElevationBounds, wallView } from '../framing/WallElevation';
import { roofPlanBounds } from '../plan/RoofFoundation';
import { AREA, SheetFrame } from './SheetFrame';
import type { SheetId } from './sheetList';
import { costBlock, flowTable, FRAMING_DISCLAIMER, noteBlock, PlanView, stack, table, type Block, type Col, type SheetProps } from './blocks';

const n = (v: number) => Math.round(v).toLocaleString('en-US');

const ROLE_NAMES: Record<string, string> = {
  'bottom-plate': 'Bottom plate', 'top-plate': 'Top plate', 'cap-plate': 'Cap plate', 'rake-plate': 'Rake plate',
  stud: 'Stud', 'end-stud': 'End stud', 'corner-nailer': 'Corner nailer', king: 'King stud', jack: 'Jack stud', cripple: 'Cripple',
  header: 'Header', sill: 'Rough sill', backing: 'Ladder blocking', fireblock: 'Fire blocking', post: 'Ridge post',
  beam: 'Beam ply', joist: 'Joist', rim: 'Rim', blocking: 'Blocking', 'ceiling-joist': 'Ceiling joist', ledger: 'Ledger',
  rafter: 'Rafter', 'fly-rafter': 'Fly rafter', ridge: 'Ridge beam ply', lookout: 'Lookout', 'sub-fascia': 'Sub-fascia',
  'deck-post': 'Post', decking: 'Deck board', 'guard-post': 'Guard post', rail: 'Guard rail', baluster: 'Baluster', stringer: 'Stair stringer', tread: 'Stair tread',
};

export const roleName = (role: string) => ROLE_NAMES[role] ?? role;

function Footer({ lines }: { lines: string[] }) {
  const wrapped = lines.flatMap((l) => wrapText(l, AREA.w - 40, TXT.note));
  return (
    <g>
      {wrapped.map((l, i) => (
        <PText key={i} x={AREA.x + 20} y={AREA.y + AREA.h - 20 - (wrapped.length - 1 - i) * leading(TXT.note)} size={TXT.note} color={INK_LIGHT}>{l}</PText>
      ))}
    </g>
  );
}

// ---------------------------------------------------------------- S-601

const SHORT_MATERIAL: Record<string, string> = { SYP: 'SYP', PT: 'P.T.', LVL: 'LVL', COMP: 'Comp.' };

export function CutListSheet({ design, frame }: SheetProps) {
  const model = frameModel(design);
  const t = takeoff(design, model);
  const top = AREA.y + 50;
  const cutCols: Col[] = [
    { title: 'Mark', w: 64 },
    { title: 'Qty', w: 48, align: 'end' },
    { title: 'Size', w: 142 },
    { title: 'Matl.', w: 66 },
    { title: 'Cut length', w: 100, align: 'end' },
    { title: 'Piece', w: 200 },
    { title: 'End cuts', w: 354 },
  ];
  const cuts = flowTable(
    AREA.x + 20,
    top,
    `Cut list: ${n(t.totals.pieces)} pieces, ${t.cuts.length} marks`,
    cutCols,
    t.cuts.map((c) => [c.mark, `${c.count}`, c.size, SHORT_MATERIAL[c.material], formatFrac(c.length), c.roles.map(roleName).join(' / '), c.cut === 'Square' ? '' : c.cut]),
    { maxHeight: AREA.h - 470, gap: 28 },
  );
  return (
    <SheetFrame id="S-601" design={design} {...frame}>
      {cuts.node}
      {stack(AREA.x + 20, top + cuts.height + 30, [
        (x, y) =>
          noteBlock(x, y, AREA.w - 40, 'How to read the cut list', [
            'A mark names one piece: its size, material, cut length, and end cuts. Pieces with the same mark are interchangeable. The plans on S-101 to S-103 and the wall elevations on S-201 to S-203 show where each mark goes.',
            'Cut lengths are to the longest point. Rafters, rake plates, and gable studs are cut to the roof pitch; lay them out from the first piece and check it in place before cutting the rest.',
            'Materials: SYP is No. 2 southern yellow pine; P.T. is pressure-treated pine; LVL is laminated veneer lumber; Comp. is composite deck board. A blank under "End cuts" means square cuts at both ends.',
            'S-603 packs these cuts into the lengths to buy. The same lists download from the app as CSV or JSON, and "npm run takeoff" prints them.',
          ]),
      ])}
      <Footer lines={[FRAMING_DISCLAIMER]} />
    </SheetFrame>
  );
}

// ---------------------------------------------------------------- S-603

export function BuyListSheet({ design, frame }: SheetProps) {
  const model = frameModel(design);
  const t = takeoff(design, model);
  const f = design.framing.lumber;
  const leftW = 1640;
  const rightX = AREA.x + leftW + 80;
  const rightW = AREA.w - leftW - 100;
  let trade = '';
  const rows = t.buy.map((b) => {
    const name = TRADE_NAMES[b.trade] === trade ? '' : TRADE_NAMES[b.trade];
    trade = TRADE_NAMES[b.trade];
    return [name, b.size, MATERIAL_NAMES[b.material], stockLabel(b), `${b.count}`, b.extra ? `${b.extra}` : '', `${b.count + b.extra}`, n(b.lf), b.pricedOn];
  });
  const half = Math.ceil(t.counts.length / 2);
  return (
    <SheetFrame id="S-603" design={design} {...frame}>
      {stack(AREA.x + 20, AREA.y + 50, [
        (x, y) =>
          table(
            x,
            y,
            `Buy list: ${n(t.totals.sticks)} sticks, ${n(t.totals.bf)} board feet`,
            [
              { title: 'Used for', w: 330 },
              { title: 'Size', w: 250 },
              { title: 'Material', w: 160 },
              { title: 'Stock length', w: 250 },
              { title: 'For cuts', w: 120, align: 'end' },
              { title: 'Waste', w: 110, align: 'end' },
              { title: 'Buy', w: 110, align: 'end' },
              { title: 'Linear ft', w: 150, align: 'end' },
              { title: 'Priced on', w: leftW - 1480, align: 'middle' },
            ],
            rows,
            ['Total', '', '', '', `${t.buy.reduce((s, b) => s + b.count, 0)}`, `${t.buy.reduce((s, b) => s + b.extra, 0)}`, `${n(t.totals.sticks)}`, n(t.totals.lf), ''],
          ),
      ])}
      {stack(rightX, AREA.y + 50, [
        (x, y) =>
          table(
            x,
            y,
            'Pieces by assembly',
            [
              { title: 'Assembly', w: rightW / 2 - 130 },
              { title: 'Pieces', w: 130, align: 'end' },
              { title: 'Assembly', w: rightW / 2 - 130 },
              { title: 'Pieces', w: 130, align: 'end' },
            ],
            t.counts.slice(0, half).map((c, i) => [c.title, `${c.pieces}`, t.counts[half + i]?.title ?? '', t.counts[half + i] ? `${t.counts[half + i].pieces}` : '']),
            ['All assemblies', '', '', n(t.totals.pieces)],
          ),
        (x, y) =>
          noteBlock(x, y + 10, rightW, 'How to read the buy list', [
            `The buy list packs the cuts on S-601 into the lengths the yard stocks (${f.stockLengths.map((l) => `${l / 12}'`).join(', ')}), with a ${formatFrac(f.kerf)} saw kerf between cuts. Each part of the frame is packed on its own, the way it is ordered.`,
            'Wall pieces within 3" of a precut stud length are bought as precut studs. LVL is ordered to length, to the next even foot.',
            `"For cuts" is the number of sticks the cuts need. "Waste" adds ${Math.round(f.waste * 100)}% to each size for culls, mistakes, and blocking cut on site. "Buy" is the two together.`,
            '"Priced on" is the sheet that prices the material, so nothing is counted twice: A-103 prices the house floor framing and every beam on piers; S-602 prices the rest.',
            'Sheet goods, connectors, and roofing are counted on S-602.',
          ]),
      ])}
      <Footer lines={[FRAMING_DISCLAIMER]} />
    </SheetFrame>
  );
}

// ---------------------------------------------------------------- S-602

export function FramingSchedulesSheet({ design, frame }: SheetProps) {
  const model = frameModel(design);
  const t = takeoff(design, model);
  const leftW = 1500;
  const rightX = AREA.x + leftW + 60;
  const rightW = AREA.w - leftW - 80;
  const base = (zone: string | undefined) => (zone === 'garage' ? 'slab' : 'floor');
  const roCols: Col[] = [
    { title: 'Tag', w: 70, align: 'middle' },
    { title: 'Wall', w: 70, align: 'middle' },
    { title: 'Unit (W x H)', w: 200 },
    { title: 'Rough opening', w: 220 },
    { title: 'R.O. sill / head', w: 250 },
    { title: 'Header', w: 330 },
    { title: 'Hdr. length', w: 130, align: 'end' },
    { title: 'Jack / king', w: 120, align: 'middle' },
    { title: 'Wall', w: leftW - 1390 },
  ];
  const engineered = model.openings.filter((o) => o.header.byEngineer).map((o) => o.opening.tag);
  const issues = validateFraming(design).filter((i) => i.level === 'warning');
  const framing = framingCostRows(design);
  const roofing = roofingCostRows(design);
  const total = [...framing, ...roofing].reduce((s, r) => s + r.cost, 0);
  return (
    <SheetFrame id="S-602" design={design} {...frame}>
      {stack(AREA.x + 20, AREA.y + 50, [
        (x, y) =>
          table(x, y, 'Rough opening schedule', roCols, model.openings.map((o) => [
            o.opening.tag,
            o.wall.id,
            `${formatFtIn(o.opening.width)} x ${formatFtIn(o.opening.height)}`,
            `${formatFrac(o.w)} x ${formatFrac(o.h)}`,
            `${formatFrac(o.sill)} / ${formatFrac(o.head)} above ${base(o.wall.zone)}`,
            `${headerLabel(o.header)}${o.header.byEngineer ? ' (by eng.)' : ''}`,
            formatFrac(o.header.length),
            `${o.jacks} / 1`,
            o.bearing ? 'Bearing' : 'Partition',
          ])),
        (x, y) =>
          table(
            x,
            y,
            'Sheet goods',
            [
              { title: 'Item', w: 640 },
              { title: 'Net area', w: 170, align: 'end' },
              { title: 'Sheets laid', w: 170, align: 'end' },
              { title: 'Waste', w: 130, align: 'end' },
              { title: 'Buy', w: 130, align: 'end' },
              { title: 'Priced on', w: leftW - 1240, align: 'middle' },
            ],
            t.sheets.map((s) => [s.item, `${n(s.area)} SF`, `${s.sheets}`, `${s.extra}`, `${s.sheets + s.extra}`, s.pricedOn]),
          ),
        (x, y) =>
          table(
            x,
            y,
            'Roofing quantities',
            [
              { title: 'Item', w: 470 },
              { title: 'Quantity', w: 170, align: 'end' },
              { title: 'Notes', w: leftW - 640 },
            ],
            roofingTakeoff(design).map((r) => [r.item, `${n(r.qty)} ${r.unit}`, r.note]),
          ),
        (x, y) =>
          noteBlock(x, y, leftW, 'Framing notes', [
            'Rough openings are the unit size plus the allowance for its type. Verify them with the door and window maker before framing. Heights are above the floor the wall stands on.',
            `Headers in bearing walls are (${design.framing.openings.header.plies}) ${design.framing.openings.header.size} up to a ${formatFtIn(design.framing.openings.header.maxSpan)} rough opening. ${
              engineered.length ? `${engineered.join(' and ')} ${engineered.length > 1 ? 'are' : 'is'} wider and shown with LVL headers, sized by the engineer.` : ''
            } Partitions that carry no load get a flat header.`,
            'Sheet counts come from a panel layout: joints land on framing, and pieces up to half a sheet are cut two to a sheet.',
            `${issues.length} framing items are open for the engineer; the checks panel in the app and "npm run validate" list them.`,
          ]),
      ])}
      {stack(rightX, AREA.y + 50, [
        (x, y) =>
          table(
            x,
            y,
            'Connectors and anchors',
            [
              { title: 'Item', w: 420 },
              { title: 'Where', w: rightW - 770 },
              { title: 'Count', w: 100, align: 'end' },
              { title: 'Each', w: 110, align: 'end' },
              { title: 'Priced on', w: 140, align: 'middle' },
            ],
            model.hardware.map((h) => [h.item, h.use, `${h.count}`, `$${hardwareRate(h.key).toFixed(2)}`, h.pricedOn]),
          ),
        (x, y) =>
          costBlock(
            x,
            y,
            rightW,
            'Estimated framing material cost',
            'Framing subtotal',
            framing,
            'MATERIAL COSTS ONLY, NO LABOR. PRICES ARE PLACEHOLDERS UNTIL REPLACED WITH SUPPLIER QUOTES (2026, CENTRAL TEXAS, ±25%). THE HOUSE FLOOR FRAMING, SUBFLOOR, AND ALL BEAMS ON PIERS ARE PRICED ON A-103; DOOR AND WINDOW UNITS ON A-601.',
          ),
        (x, y) =>
          costBlock(
            x,
            y,
            rightW,
            'Estimated roofing material cost',
            'Roofing subtotal',
            roofing,
            'MATERIAL COSTS ONLY, NO LABOR (2026, CENTRAL TEXAS, ±25%). ROOF SHEATHING IS PRICED WITH THE FRAMING ABOVE.',
          ),
      ])}
      <PText x={AREA.x + AREA.w - 20} y={AREA.y + AREA.h - 60} size={TXT.label} weight="bold" anchor="end">
        {`ESTIMATED MATERIAL TOTAL, FRAMING AND ROOFING: ${formatUsd(total)}`}
      </PText>
      <Footer lines={[FRAMING_DISCLAIMER]} />
    </SheetFrame>
  );
}

// ---------------------------------------------------------------- framing plans

/** A swatch and what it stands for. */
function legend(x: number, y: number, w: number, rows: { swatch: (x: number, y: number) => ReactNode; label: string }[]): Block {
  const pitch = 30;
  return {
    height: 34 + rows.length * pitch,
    node: (
      <g>
        <PText x={x} y={y} size={TXT.label} weight="bold" spacing={0.6}>LEGEND</PText>
        <line x1={x} x2={x + w} y1={y + 7} y2={y + 7} stroke={INK} strokeWidth={LW.thin} />
        {rows.map((r, i) => (
          <g key={i}>
            {r.swatch(x, y + 26 + i * pitch)}
            <PText x={x + 80} y={y + 37 + i * pitch} size={TXT.note}>{r.label}</PText>
          </g>
        ))}
      </g>
    ),
  };
}

const box = (fill: string, stroke = INK) => (x: number, y: number) => <rect x={x} y={y} width={60} height={12} fill={fill} stroke={stroke} strokeWidth={LW.fine} />;
const dashes = (pattern: string) => (x: number, y: number) => <line x1={x} x2={x + 60} y1={y + 6} y2={y + 6} stroke={INK_LIGHT} strokeWidth={LW.thin} strokeDasharray={pattern} />;

function FramingPlanSheet(props: SheetProps & {
  id: SheetId;
  title: string;
  scale: ScaleKey;
  bounds: { x0: number; y0: number; x1: number; y1: number };
  blocks: ((x: number, y: number) => Block)[];
  children: ReactNode;
}) {
  const colW = 820;
  const area = { x: AREA.x, y: AREA.y + 20, w: AREA.w - colW - 60, h: AREA.h - 150 };
  const colX = AREA.x + AREA.w - colW;
  return (
    <SheetFrame id={props.id} design={props.design} {...props.frame}>
      <PlanView design={props.design} scale={props.scale} bounds={props.bounds} box={area}>
        {props.children}
      </PlanView>
      <NorthArrow x={colX + colW - 60} y={AREA.y + AREA.h - 130} />
      <ViewTitle x={AREA.x + 30} y={AREA.y + AREA.h - 80} num={1} title={props.title} scale={props.scale} width={620} />
      <ScaleBar x={AREA.x + 700} y={AREA.y + AREA.h - 70} scale={props.scale} />
      {stack(colX, AREA.y + 60, props.blocks)}
      <Footer lines={[FRAMING_DISCLAIMER]} />
    </SheetFrame>
  );
}

const count = (design: Design, group: string, role: string) =>
  frameModel(design).assemblies.filter((a) => a.group === group).flatMap((a) => a.members).filter((m) => m.role === role).length;

export function FloorFramingSheet(props: SheetProps) {
  const { design } = props;
  const f = design.framing;
  const ph = framingPhrases(design);
  const lines = new Set(frameModel(design).assemblies.find((a) => a.group === 'floor')?.members.filter((m) => m.role === 'joist').map((m) => m.o.x)).size;
  return (
    <FramingPlanSheet
      {...props}
      id="S-101"
      title="Floor Framing Plan"
      scale="3/8"
      bounds={roofPlanBounds(design, 24)}
      blocks={[
        (x, y) =>
          noteBlock(x, y, 820, 'Floor framing notes', [
            `Beams: ${ph.foundation.beams}, ${count(design, 'floor', 'beam')} plies in all. Each ply breaks only over a pier, and plies side by side break over different piers. Nail and bolt the plies together as the engineer directs.`,
            `Joists: ${ph.foundation.joists}, on ${lines} lines laid out from the northwest corner. Each line is two pieces, butted over a beam and tied with a strap; the splice moves to the next beam on the line alongside.`,
            'Solid blocking the depth of the joists runs over the two middle beams. Extra joists go under the partitions that run with the joists, doubled under the full-height wall.',
            `Rim: ${f.floor.rim} P.T. across the joist ends; end joists close the east and west sides. Wall sheathing laps down over the rim.`,
            `Subfloor: ${ph.foundation.subfloor}. Lay the sheets across the joists with the joints staggered; leave 1/8" at the edges.`,
            `Deck and porch: ${f.platforms.joist} P.T. joists at ${formatFrac(f.platforms.spacing)} o.c. hang from a ledger on the house rim and bear on a dropped (${f.platforms.beam.plies}) ${f.platforms.beam.size} beam on ${f.platforms.post} posts. Provide the lateral load connectors and the ledger flashing.`,
            'Stairs: notched 2x12 stringers hang from a header dropped below the rim and bear on a concrete pad.',
            'Pier, beam, and joist sizes and every connection are by the engineer. See A-103 for the piers and S-601 for the cut list.',
          ]),
        (x, y) =>
          legend(x, y + 10, 820, [
            { swatch: box('#c9c9c9'), label: 'Built-up beam, or a joist added under a wall' },
            { swatch: box('#fff'), label: 'Joist, rim, or ledger' },
            { swatch: box('#e9e9e9'), label: 'Solid blocking' },
            { swatch: (sx, sy) => <circle cx={sx + 30} cy={sy + 6} r={9} fill="#e9e9e9" stroke={INK} strokeWidth={LW.thin} />, label: 'Concrete pier (see A-103)' },
            { swatch: (sx, sy) => <line x1={sx + 20} x2={sx + 40} y1={sy + 6} y2={sy + 6} stroke={INK} strokeWidth={LW.heavy} />, label: 'Joist splice over a beam' },
            { swatch: dashes('8 4'), label: 'Outside face of the walls above' },
          ]),
      ]}
    >
      <FloorFramingDrawing design={design} />
    </FramingPlanSheet>
  );
}

export function RoofFramingSheet(props: SheetProps) {
  const { design } = props;
  const f = design.framing;
  const ph = framingPhrases(design);
  const zones = ceilingZones(design);
  const garage = zones.find((z) => z.zone === 'garage');
  return (
    <FramingPlanSheet
      {...props}
      id="S-103"
      title="Ceiling and Roof Framing Plan"
      scale="3/8"
      bounds={roofPlanBounds(design, 24)}
      blocks={[
        (x, y) =>
          noteBlock(x, y, 820, 'Roof framing notes', [
            `Rafters: ${ph.framing.rafters}, ${count(design, 'roof', 'rafter')} on the house and ${count(design, 'garage-roof', 'rafter')} on the garage, on the same layout as the studs below. Plumb cut both ends; birdsmouth with a ${formatFrac(f.roof.seat)} seat on the plate.`,
            `Ridge: (${f.roof.ridge.plies}) ${lvlSize(f.roof.ridge)} on the house and (${f.garage.ridge.plies}) ${lvlSize(f.garage.ridge)} on the garage. The rafters hang from the ridge beam in sloped hangers, so the beam carries half the roof. It bears on built-up posts in the gable walls and in the full-height partition.`,
            'The house ridge posts do not stand over a beam line, and the west post stands on the header of window W5. The engineer must design the load path to the foundation.',
            `Rakes: a ${f.roof.rafter} fly rafter on ${f.roof.rakeBlocking.size} lookouts at ${formatFrac(f.roof.rakeBlocking.spacing)} o.c. Eaves: ${f.roof.subFascia} sub-fascia across the rafter tails.`,
            'Block between the rafters over each eave wall; rip the blocks to clear the roof sheathing. Tie every rafter to the plate with a hurricane tie.',
            `Ceiling joists: ${f.ceiling.joist} at ${formatFrac(f.ceiling.spacing)} o.c. over the flat-ceiling rooms, beside the rafters and lapped over the bearing wall. The great room is vaulted and has none.`,
            ...(garage?.beamAt != null
              ? [`Garage ceiling: ${garage.joist} joists run with the rafters and hang from a flush (${f.garage.ridge.plies}) ${lvlSize(f.garage.ridge)} beam under the ridge. Joists turned the short way would hit the low rafters near the eaves.`]
              : []),
            `Sheathing: ${ph.roof.sheathing}, sheets across the rafters with the joints staggered. Where the garage roof meets the house wall, the last rafter fastens to the wall framing; flash the joint.`,
          ]),
        (x, y) =>
          legend(x, y + 10, 820, [
            { swatch: box('#fff'), label: 'Rafter, fly rafter, or sub-fascia' },
            { swatch: box('#c9c9c9'), label: 'LVL ridge beam or ceiling beam' },
            { swatch: box('#e9e9e9'), label: 'Ceiling joist, blocking, or lookout' },
            { swatch: (sx, sy) => <rect x={sx + 24} y={sy} width={12} height={12} fill={INK} />, label: 'Ridge post in the wall below' },
            { swatch: dashes('8 4'), label: 'Outside face of the walls below' },
            { swatch: dashes('10 3 2 3'), label: 'Bearing wall or full-height wall below' },
          ]),
      ]}
    >
      <RoofFramingDrawing design={design} />
    </FramingPlanSheet>
  );
}

export function WallFramingPlanSheet({ design, frame }: SheetProps) {
  const scale: ScaleKey = '1/2';
  const f = design.framing;
  const model = frameModel(design);
  const area = { x: AREA.x, y: AREA.y, w: AREA.w, h: 1680 };
  const bounds = framingPlanBounds(design, 0);
  const walls = { x0: Math.min(bounds.x0, -170) - 30, x1: bounds.x1 + 40, y0: -50, y1: 300 };
  const y = AREA.y + 1790;
  const colW = (AREA.w - 80) / 3;
  const sheetOf = (w: WallFrame) => (w.zone ? 'S-203' : w.exterior ? 'S-201' : 'S-202');
  return (
    <SheetFrame id="S-102" design={design} {...frame}>
      <PlanView design={design} scale={scale} bounds={walls} box={area}>
        <WallFramingPlanDrawing design={design} />
      </PlanView>
      <NorthArrow x={AREA.x + AREA.w - 70} y={AREA.y + 90} />
      <ViewTitle x={AREA.x + 30} y={AREA.y + 1720} num={1} title="Wall Framing Plan" scale={scale} width={620} />
      <ScaleBar x={AREA.x + 700} y={AREA.y + 1730} scale={scale} />
      {stack(AREA.x + 20, y, [
        (bx, by) =>
          noteBlock(bx, by, colW, 'Wall framing notes', [
            `Exterior walls: ${f.walls.exterior.stud} studs at ${formatFrac(f.walls.exterior.spacing)} o.c. Partitions: ${f.walls.interior.stud} studs at ${formatFrac(f.walls.interior.spacing)} o.c. One bottom plate and ${f.walls.topPlates} top plates.`,
            'The plan is cut 4 ft above the floor. Solid pieces are studs, kings, jacks, and cripples under the window sills. Headers are dashed.',
            'The dot and arrow on each wall show where its stud layout starts and the way it runs. Exterior layouts start at the building corner, so sheathing edges land on studs.',
          ]),
      ])}
      {stack(AREA.x + 40 + colW, y, [
        (bx, by) =>
          noteBlock(bx, by, colW, 'Corners and partitions', [
            'Corners: the wall that runs through ends in a stud, with a second stud laid flat against the inside face to back the wallboard. The wall that butts it starts with a stud. The corner stays open for insulation.',
            `Where a partition meets a wall, ${f.walls.backing.size} blocks at ${formatFrac(f.walls.backing.spacing)} o.c. span between the studs on each side (ladder blocking). Cap plates lap over the wall they meet.`,
            'Gable walls and the full-height partition P1 are framed to the rake, with fire blocking at the plate line. Garage walls stand on treated plates with anchor bolts.',
          ]),
      ])}
      {stack(AREA.x + 60 + colW * 2, y - 20, [
        (bx, by) =>
          flowTable(
            bx,
            by,
            'Wall key',
            [
              { title: 'Wall', w: 70, align: 'middle' },
              { title: 'Studs', w: 150 },
              { title: 'Framing length', w: 150, align: 'end' },
              { title: 'Pieces', w: 90, align: 'end' },
              { title: 'Elevation', w: 110, align: 'middle' },
            ],
            model.walls.map((w) => [w.wall.id, `${w.stud} @ ${formatFrac(w.spacing)}${w.gable === 'none' ? '' : ', to rake'}`, formatFtIn(w.f1 - w.f0), `${w.members.length}`, sheetOf(w)]),
            { maxHeight: 300, gap: 20 },
          ),
      ])}
      <Footer lines={[FRAMING_DISCLAIMER]} />
    </SheetFrame>
  );
}

// ---------------------------------------------------------------- wall elevations

function WallElevationsSheet({ design, frame, id, walls }: SheetProps & { id: SheetId; walls: WallFrame[] }) {
  const scale: ScaleKey = '1/2';
  const k = SCALES[scale].ratio * PAPER;
  const pad = { left: 140, right: 40, top: 40, bottom: 178 };
  const gap = 16;
  // Lay the elevations out in rows, in order, starting a new row when one is full.
  const cells = walls.map((w) => {
    const b = wallElevationBounds(design, w);
    return { w, b, width: Math.max((b.x1 - b.x0) * k + pad.left + pad.right, 520), height: (b.y1 - b.y0) * k + pad.top + pad.bottom };
  });
  const rows: (typeof cells)[] = [];
  for (const c of cells) {
    const row = rows[rows.length - 1];
    if (row && row.reduce((s, q) => s + q.width + gap, 0) + c.width <= AREA.w) row.push(c);
    else rows.push([c]);
  }
  const parts: ReactNode[] = [];
  let y = AREA.y;
  let num = 1;
  for (const row of rows) {
    const h = Math.max(...row.map((c) => c.height));
    let x = AREA.x + 10;
    for (const c of row) {
      const v = wallView(design, c.w);
      const origin = { x: x + pad.left - c.b.x0 * k, y: y + pad.top + (h - c.height) - c.b.y0 * k };
      parts.push(
        <g key={c.w.wall.id}>
          <PlanView design={design} scale={scale} bounds={{ x0: 0, y0: 0, x1: 0, y1: 0 }} box={{ x: origin.x, y: origin.y, w: 0, h: 0 }}>
            <WallElevationDrawing design={design} wall={c.w} />
          </PlanView>
          <ViewTitle x={x + 20} y={y + h - 50} num={num++} title={`Wall ${c.w.wall.id}`} scale={scale} width={Math.min(c.width - 80, 420)} />
          <PText x={x + 68} y={y + h - 17} size={TXT.tiny} color={INK_LIGHT}>
            {`${v.caption.toUpperCase()} · ${c.w.members.length} PIECES`}
          </PText>
        </g>,
      );
      x += c.width + gap;
    }
    y += h + gap;
  }
  return (
    <SheetFrame id={id} design={design} {...frame}>
      {parts}
      <Footer
        lines={[
          'EVERY PIECE CARRIES ITS MARK FROM THE CUT LIST ON S-601. X MARKS A ROUGH OPENING. DARK GREY IS LVL; GREY IS A SAWN HEADER OR A RIDGE POST; LIGHT GREY IS BLOCKING. THE DASHED LINE IS THE TOP OF THE RAFTERS.',
          FRAMING_DISCLAIMER,
        ]}
      />
    </SheetFrame>
  );
}

const wallsOf = (design: Design, pick: (w: WallFrame) => boolean, order: string[] = []) =>
  frameModel(design)
    .walls.filter(pick)
    .sort((a, b) => (order.indexOf(a.wall.id) + 1 || 99) - (order.indexOf(b.wall.id) + 1 || 99));

export function ExteriorWallElevationsSheet(props: SheetProps) {
  return <WallElevationsSheet {...props} id="S-201" walls={wallsOf(props.design, (w) => !w.zone && w.exterior, ['WN', 'WE', 'WS', 'WW'])} />;
}

export function PartitionElevationsSheet(props: SheetProps) {
  return <WallElevationsSheet {...props} id="S-202" walls={wallsOf(props.design, (w) => !w.zone && !w.exterior)} />;
}

export function GarageWallElevationsSheet(props: SheetProps) {
  return <WallElevationsSheet {...props} id="S-203" walls={wallsOf(props.design, (w) => w.zone === 'garage', ['G1', 'G2', 'G3'])} />;
}

// ---------------------------------------------------------------- S-001

function framingNotes(design: Design): { title: string; items: string[] }[] {
  const f = design.framing;
  const sp = design.specs;
  const ph = framingPhrases(design);
  const model = frameModel(design);
  const t = takeoff(design, model);
  return [
    {
      title: 'General',
      items: [
        'These sheets show one way to frame the building, generated from the design model. They are for budgeting, review, and discussion with the engineer and the framer. They are not for construction.',
        'A licensed engineer must design the structure for the wind, soil, and flood conditions of the site: member sizes, spans, connections, uplift and lateral bracing, hold-downs, and foundations. The engineer\'s drawings govern.',
        `Build to the 2021 International Residential Code and local amendments. Fasten framing to IRC Table R602.3(1) unless the engineer calls for more.`,
        `The model has ${model.members.length.toLocaleString('en-US')} pieces under ${t.cuts.length} marks. S-601 lists every mark; the plans and elevations show where each goes.`,
      ],
    },
    {
      title: 'Materials',
      items: [
        `Lumber: ${sp.framing.lumber}.`,
        'Engineered lumber: LVL, 2.0E, by one maker for the whole job. Keep it dry and store it flat. Do not notch or drill it without the maker\'s approval.',
        `Sheathing: ${ph.framing.sheathing}; ${ph.roof.sheathing}; ${ph.foundation.subfloor}.`,
        `Connectors: ${sp.framing.connectors}, installed with the fasteners the maker lists. Use hot-dip galvanized or stainless hardware and fasteners in treated lumber and outdoors.`,
      ],
    },
    {
      title: 'Layout',
      items: [
        `Studs, floor joists, and rafters share one layout: ${formatFrac(f.walls.exterior.spacing)} on center, measured from the northwest corner of the footprint, so they stack and sheathing edges land on framing.`,
        `Walls are ${formatFtIn(design.levels.wallHeight)} to the top of the plates: one bottom plate, ${f.walls.topPlates} top plates. Splices in the two top plates are at least 4 ft apart and land over a stud.`,
        'Gable walls and the full-height partition are framed to the rake: studs run from the floor to plates under the rafters, with fire blocking at the plate line.',
        'Crown joists and rafters up. Do not notch the bottom of a joist or rafter except for the birdsmouth shown.',
      ],
    },
    {
      title: 'Not in the model',
      items: [
        'Wall bracing, shear panels, hold-downs, and straps across the ridge: by the engineer.',
        'The framed closure of the crawl space at the garage, the landing and steps at the garage entry, and attic access framing.',
        'Blocking for cabinets, fixtures, grab bars, and trim; fire blocking at soffits and chases; stair handrails.',
      ],
    },
  ];
}

export function FramingNotesSheet({ design, frame }: SheetProps) {
  const details = framingDetails(design);
  const colW = 700;
  const colX = AREA.x + AREA.w - colW;
  const areaW = AREA.w - colW - 50;
  const gap = 30;
  const pad = { x: 30, top: 30, bottom: 100 };
  const cells = details.map((d) => {
    const k = SCALES[d.scale].ratio * PAPER;
    const b = detailBounds(d);
    // Notes sit beside the detail, so each side is as wide as its longest note.
    let left = 0;
    let right = 0;
    for (const n of d.notes) {
      const w = Math.max(...(Array.isArray(n.text) ? n.text : [n.text]).map((l) => textWidth(l, TXT.tiny))) * 0.95;
      if (n.at[0] >= n.to[0]) right = Math.max(right, (n.at[0] - d.window.x1) * k + w);
      else left = Math.max(left, (d.window.x0 - n.at[0]) * k + w);
    }
    const padLeft = pad.x + Math.max(0, left);
    return { d, k, b, padLeft, width: (b.x1 - b.x0) * k + padLeft + pad.x + Math.max(0, right), height: (b.y1 - b.y0) * k + pad.top + pad.bottom };
  });
  const rows: (typeof cells)[] = [];
  for (const c of cells) {
    const row = rows[rows.length - 1];
    if (row && row.reduce((s, q) => s + q.width + gap, 0) + c.width <= areaW) row.push(c);
    else rows.push([c]);
  }
  const parts: ReactNode[] = [];
  let y = AREA.y + 10;
  let num = 1;
  for (const row of rows) {
    const h = Math.max(...row.map((c) => c.height));
    let x = AREA.x + 10;
    for (const c of row) {
      const origin = { x: x + c.padLeft - c.b.x0 * c.k, y: y + pad.top - c.b.y0 * c.k };
      parts.push(
        <g key={c.d.key}>
          <PlanView design={design} scale={c.d.scale} bounds={{ x0: 0, y0: 0, x1: 0, y1: 0 }} box={{ x: origin.x, y: origin.y, w: 0, h: 0 }}>
            <DetailDrawing design={design} detail={c.d} />
          </PlanView>
          <ViewTitle x={x + 20} y={y + c.height - 50} num={num++} title={c.d.title} scale={c.d.scale} width={Math.max(c.width - 100, 340)} />
        </g>,
      );
      x += c.width + gap;
    }
    y += h + gap;
  }
  return (
    <SheetFrame id="S-001" design={design} {...frame}>
      {parts}
      {stack(colX, AREA.y + 50, framingNotes(design).map((n) => (x: number, by: number) => noteBlock(x, by, colW, `${n.title}`, n.items)))}
      <Footer lines={['DETAILS ARE CUT FROM THE FRAMING MODEL: LIGHT GREY WITH AN X IS LUMBER CUT BY THE SECTION, DARK GREY IS LVL OR SHEATHING, AND THE DASH-DOT LINE IS THE EDGE OF THE DETAIL.', FRAMING_DISCLAIMER]} />
    </SheetFrame>
  );
}
