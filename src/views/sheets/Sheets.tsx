import type { ReactNode } from 'react';
import type { Design, Side } from '../../model/schema';
import {
  designSummary, deckGeom, garageSharedAxis, openingHead, pierLayout, pointInPolygon, roomsForOpening, roomStats, clearOpening, wallById, wallFace,
} from '../../model/geometry';
import { formatFtIn, formatIn, formatPitch, formatSqft, lowerFirst } from '../../model/units';
import type { SheetId } from '../../editor/store';
import {
  FONT, INK, INK_LIGHT, leading, LW, NorthArrow, PText, POCHE, POCHE_INT, SCALES,
  ScaleBar, TXT, ViewTitle, wrapText, type ScaleKey,
} from '../draft/draft';
import { AREA, SHEET_LIST, SheetFrame } from './SheetFrame';
import { costBlock, noteBlock, PlanView, stack, table, type Block, type Col, type SheetProps } from './blocks';
import {
  BuyListSheet, CutListSheet, ExteriorWallElevationsSheet, FloorFramingSheet, FramingNotesSheet, FramingSchedulesSheet, GarageWallElevationsSheet, PartitionElevationsSheet,
  RoofFramingSheet, WallFramingPlanSheet,
} from './FramingSheets';
import { EnvelopeSheet, EstimateSummarySheet } from './EnvelopeSheets';
import { PlanDrawing, planBounds } from '../plan/PlanDrawing';
import { FoundationDrawing, RoofPlanDrawing, roofPlanBounds } from '../plan/RoofFoundation';
import { ElevationDrawing, elevationBounds, SIDE_TITLES } from '../elevation/Elevation';
import { assemblies, SectionDrawing, sectionBounds } from '../section/Section';
import { garageSectionNotes, GarageSectionDrawing, garageSectionBounds } from '../section/GarageSection';
import { AxonView } from '../axon/Axon';
import { DockPlanDrawing, SitePlanDrawing, dockPlanBounds, sitePlanBounds } from '../plan/SitePlan';
import { imperviousCover, siteGeom } from '../../model/site';
import { dockCostRows, fixtureCost, formatCost, formatUsd, foundationCostRows, openingCost, roomFinishCost, scheduleCosts, sumCosts } from '../../model/costs';
import { roughOpeningSize } from '../../model/framing/openings';
import { footprint as houseFootprint, footprintBounds, garageFootprint as garageOutline, polygonArea } from '../../model/geometry';

/** One-paragraph summaries of the structural and roofing materials in `design.specs`. */
function materialNotes(design: Design): string[] {
  const { foundation: f, framing: fr, roof: r } = design.specs;
  return [
    `Foundation: ${formatIn(design.foundation.pierSize)} dia. ${lowerFirst(f.piers)}; ${lowerFirst(f.beams)}; ${lowerFirst(f.joists)}. See A-103.`,
    `Framing: ${fr.lumber}. Exterior walls: ${lowerFirst(fr.exteriorWalls)} with ${lowerFirst(fr.sheathing)} and ${lowerFirst(fr.wallInsulation)}. Interior walls: ${lowerFirst(fr.interiorWalls)}. Headers: ${lowerFirst(fr.headers)}. See W1 on A-301.`,
    `Roof: ${formatPitch(design.roof.pitch)} gable; ${lowerFirst(r.covering)} over ${lowerFirst(r.underlayment)} and ${lowerFirst(r.sheathing)}; ${lowerFirst(fr.rafters)} with ${lowerFirst(fr.ridge)}. See A-102.`,
  ];
}

// ---------------------------------------------------------------- G-001

export function CoverSheet({ design, frame }: SheetProps) {
  const s = designSummary(design);
  const rf = { pitch: design.roof.pitch };
  const sp = design.specs;
  const colX = AREA.x + 1960;
  const colW = AREA.w - 1980;
  const data: [string, string][] = [
    ['Building type', `Single-family cabin, 1 bedroom / 1 bath${s.garageArea ? ', attached 1-car garage' : ''}`],
    ['Construction', 'Type V-B wood frame'],
    ['Code basis', 'IRC 2021 (verify local amendments)'],
    ['Conditioned area', formatSqft(s.gross)],
    ['Net room area', formatSqft(s.net)],
    ...(s.garageArea
      ? ([['Garage (unconditioned)', `${formatFtIn(s.garageWidth)} x ${formatFtIn(s.garageDepth)} · ${formatSqft(s.garageArea)}`]] as [string, string][])
      : []),
    ['Deck area', formatSqft(s.deckArea)],
    ...(s.porchArea ? ([['Porch area', formatSqft(s.porchArea)]] as [string, string][]) : []),
    ['Footprint', `${formatFtIn(s.width)} x ${formatFtIn(s.depth)}`],
    ['Plate height', formatFtIn(s.plate)],
    ['Ridge height (above grade)', formatFtIn(s.ridgeAboveGrade)],
    ['Foundation', `${formatIn(design.foundation.pierSize)} dia. ${lowerFirst(sp.foundation.piers)}`],
    ['Floor framing', `${sp.foundation.beams}; ${lowerFirst(sp.foundation.joists)}`],
    ['Wall framing', `Exterior ${lowerFirst(sp.framing.exteriorWalls)}; interior ${lowerFirst(sp.framing.interiorWalls)}`],
    ['Roof framing', `${sp.framing.rafters}; ${lowerFirst(sp.framing.ridge)}`],
    ['Roofing', `${formatPitch(rf.pitch)} gable, ${lowerFirst(sp.roof.covering)}`],
    ['Finished floor above grade', formatFtIn(design.levels.floorHeight)],
  ];
  return (
    <SheetFrame id="G-001" design={design} {...frame}>
      <PText x={AREA.x + 20} y={AREA.y + 90} size={96} weight="bold" spacing={4}>{design.meta.project.toUpperCase()}</PText>
      <PText x={AREA.x + 24} y={AREA.y + 150} size={32} color={INK_LIGHT}>{design.meta.subtitle}</PText>
      <PText x={AREA.x + 24} y={AREA.y + 190} size={20} color={INK_LIGHT}>{design.meta.address}</PText>
      <line x1={AREA.x + 20} x2={AREA.x + 1900} y1={AREA.y + 220} y2={AREA.y + 220} stroke={INK} strokeWidth={LW.heavy} />
      <AxonView design={design} box={{ x: AREA.x + 40, y: AREA.y + 280, w: 1840, h: 1640 }} />
      <PText x={AREA.x + 24} y={AREA.y + AREA.h - 20} size={TXT.note} color={INK_LIGHT}>
        {`AXONOMETRIC VIEW FROM THE ${design.meta.lakeSide.toUpperCase()} (LAKE SIDE) · GENERATED FROM design/house.json`}
      </PText>
      {stack(colX, AREA.y + 40, [
        (x, y) => table(x, y, 'Project data', [{ title: 'Item', w: colW * 0.48 }, { title: 'Value', w: colW * 0.52 }], data.map(([a, b]) => [a, b])),
        (x, y) =>
          table(
            x,
            y,
            'Sheet index',
            [{ title: 'Sheet', w: colW * 0.22 }, { title: 'Title', w: colW * 0.78 }],
            SHEET_LIST.map((sh) => [sh.id, sh.title]),
          ),
        (x, y) => noteBlock(x, y, colW, 'General notes', design.meta.notes),
      ])}
    </SheetFrame>
  );
}

// ---------------------------------------------------------------- A-100

export function SitePlanSheet({ design, frame }: SheetProps) {
  const g = siteGeom(design);
  if (!g) {
    return (
      <SheetFrame id="A-100" design={design} {...frame}>
        <PText x={AREA.x + 40} y={AREA.y + 80} size={TXT.sub}>No site information yet. Add a "site" block to design/house.json.</PText>
      </SheetFrame>
    );
  }
  const s = designSummary(design);
  const imp = imperviousCover(design);
  const footprintArea = polygonArea(houseFootprint(design)) + (garageOutline(design) ? polygonArea(garageOutline(design)!) : 0);
  const siteBox = { x: AREA.x, y: AREA.y, w: 1060, h: AREA.h - 110 };
  const dockBox = { x: AREA.x + 1100, y: AREA.y + 40, w: 820, h: 1380 };
  const colX = AREA.x + 1980;
  const colW = AREA.w - 1990;
  const dockB = dockPlanBounds(g, 60);
  const d = g.dock;
  const ft = (v: number) => formatFtIn(v).replace(/-0"$/, '');
  const sp = design.specs;
  const data: string[][] = [
    ['Lot area', `${Math.round(g.area / 144).toLocaleString('en-US')} SF (${g.acres.toFixed(2)} AC)`],
    ['Lot size', `${ft(g.lotRect.x1 - g.lotRect.x0)} x ${formatFtIn(g.lotRect.y1 - g.lotRect.y0)}`],
    ['Conditioned area', formatSqft(s.gross)],
    ['Garage', formatSqft(s.garageArea)],
    ['Deck / porch', `${formatSqft(s.deckArea)} / ${formatSqft(s.porchArea)}`],
    ['Building footprint', `${formatSqft(footprintArea)} (${((footprintArea / g.area) * 100).toFixed(1)}% of lot)`],
    ['Impervious cover', `${formatSqft(imp.total)} (${imp.percent.toFixed(1)}%)`],
    ['House to water', formatFtIn(g.shoreY - footprintBounds(design).y1)],
    ['Setbacks (verify)', `street ${ft(g.site.setbacks.street)}, side ${ft(g.site.setbacks.side)}, lake ${ft(g.site.setbacks.lake)}`],
    ...(d ? [['Boat dock (open)', `${ft(d.spec.width)} x ${ft(d.spec.length)} + ${ft(d.spec.gangwayWidth)} x ${ft(d.spec.gangwayLength)} gangway`]] : []),
    ...(g.fence
      ? [['Fence', `${ft(g.fence.spec.height)} ${g.fence.spec.style === 'metal' ? 'black metal picket' : 'cedar board'}, ${Math.round(g.fence.length / 12)} LF`]]
      : []),
    ['Trees shown', `${g.trees.length}`],
  ];
  const notes = [
    'Lot lines, dimensions, and area are for planning only. Obtain a boundary and topographic survey before final design.',
    'Verify setbacks, the flood elevation, and the Highland Lakes Watershed Ordinance requirements with the county and LCRA.',
    'The boat dock requires an LCRA dock permit. Size, height, and distance from the side lot lines are subject to LCRA rules.',
    'The on-site sewage facility (septic) must be designed and permitted separately. It is not shown.',
    'Protect existing trees during construction; keep equipment and fill out of the root zones.',
    'Gravel driveway over geotextile fabric. Confirm drainage and any culvert at the street.',
    ...(g.fence
      ? [
          `Perimeter fence along the street and side lot lines${g.fence.spec.lakeSide ? ' and the shoreline' : '; the shoreline is left open'}. Set posts in concrete, ${ft(g.fence.spec.postSpacing)} o.c. max. Confirm the property corners by survey and check HOA and county fence rules before installing.`,
        ]
      : []),
  ];
  return (
    <SheetFrame id="A-100" design={design} {...frame}>
      <PlanView design={design} scale="1in20ft" bounds={sitePlanBounds(g, 150)} box={siteBox}>
        <SitePlanDrawing design={design} g={g} />
      </PlanView>
      <ViewTitle x={AREA.x + 30} y={AREA.y + AREA.h - 60} num={1} title="Site Plan" scale="1in20ft" width={560} />
      <ScaleBar x={AREA.x + 620} y={AREA.y + AREA.h - 50} scale="1in20ft" />
      {dockB && (
        <>
          <PlanView design={design} scale="3/16" bounds={dockB} box={dockBox}>
            <DockPlanDrawing g={g} />
          </PlanView>
          <ViewTitle x={dockBox.x + 20} y={dockBox.y + dockBox.h + 50} num={2} title="Boat Dock Plan" scale="3/16" width={560} />
          {d &&
            stack(dockBox.x + 20, dockBox.y + dockBox.h + 130, [
              (x, y) =>
                noteBlock(x, y, dockBox.w - 40, 'Boat dock materials', [
                  `Open dock, one level, no cover. Walkways and lounge deck: ${lowerFirst(sp.dock.decking)} on ${lowerFirst(sp.dock.framing)}, ${ft(d.spec.deckAboveWater)} above normal pool.`,
                  `${sp.dock.piles}. Sizes and embedment by the engineer.`,
                  d.spec.lift
                    ? `Boat slip ${ft(d.spec.slipWidth)} x ${ft(d.spec.slipLength)} with ${lowerFirst(sp.dock.lift)}.`
                    : `Boat slip ${ft(d.spec.slipWidth)} x ${ft(d.spec.slipLength)}, open to the lake. No boat lift; tie the boat to the cleats with bumpers along the slip.`,
                  `${sp.dock.hardware}. No guard at the dock edges; the deck sits ${ft(d.spec.deckAboveWater)} above normal pool.`,
                  `${sp.dock.electrical}; bond the metal parts and provide a shore-side disconnect (NEC 682).`,
                ]),
              (x, y) =>
                costBlock(
                  x,
                  y,
                  dockBox.w - 40,
                  'Estimated boat dock material cost',
                  'Dock subtotal',
                  dockCostRows(design),
                  'MATERIAL COSTS ONLY (2026, CENTRAL TEXAS, ±25%). NO LABOR, PILE DRIVING, BARGE, OR EQUIPMENT. EXCLUDES THE LCRA DOCK PERMIT, SURVEY, AND ANY DREDGING OR SHORELINE WORK.',
                ),
            ])}
        </>
      )}
      <NorthArrow x={colX + colW - 60} y={AREA.y + AREA.h - 100} />
      {stack(colX, AREA.y + 40, [
        (x, y) => table(x, y, 'Site data', [{ title: 'Item', w: colW * 0.42 }, { title: 'Value', w: colW * 0.58 }], data),
        (x, y) => noteBlock(x, y, colW, 'Site notes', notes),
        (x, y) => ({
          height: g.fence ? 180 : 150,
          node: (
            <g>
              <PText x={x} y={y} size={TXT.label} weight="bold" spacing={0.6}>LEGEND</PText>
              <line x1={x} x2={x + colW} y1={y + 6} y2={y + 6} stroke={INK} strokeWidth={LW.thin} />
              <line x1={x} x2={x + 60} y1={y + 32} y2={y + 32} stroke={INK} strokeWidth={LW.heavy} strokeDasharray="12 3 2 3" />
              <PText x={x + 80} y={y + 36} size={TXT.note}>Property line</PText>
              <line x1={x} x2={x + 60} y1={y + 62} y2={y + 62} stroke={INK_LIGHT} strokeWidth={LW.thin} strokeDasharray="5 3" />
              <PText x={x + 80} y={y + 66} size={TXT.note}>Setback line (verify)</PText>
              <circle cx={x + 30} cy={y + 100} r={16} fill="#eef1ea" stroke={INK} strokeWidth={LW.fine} strokeDasharray="4 1.5" />
              <circle cx={x + 30} cy={y + 100} r={1.5} fill={INK} />
              <PText x={x + 80} y={y + 104} size={TXT.note}>Tree canopy (live oak, cedar, cedar elm)</PText>
              {g.fence && (
                <>
                  <line x1={x} x2={x + 60} y1={y + 136} y2={y + 136} stroke={INK} strokeWidth={LW.thin} />
                  {[12, 30, 48].map((t) => (
                    <line key={t} x1={x + t} x2={x + t} y1={y + 131} y2={y + 141} stroke={INK} strokeWidth={LW.fine} />
                  ))}
                  <PText x={x + 80} y={y + 140} size={TXT.note}>Fence (■ gate post)</PText>
                </>
              )}
            </g>
          ),
        }),
      ])}
    </SheetFrame>
  );
}

// ---------------------------------------------------------------- A-101

const PLAN_NOTES = [
  'Provide interconnected smoke alarms in the bedroom, the hall, and the great room. Provide a carbon monoxide alarm in the hall (fuel-burning appliance).',
  'Install the wood stove, hearth, and chimney per the manufacturer listing, with the required clearances to combustibles.',
  'Vent the dryer and the bath exhaust fan (50 CFM min.) to the exterior.',
  'Provide tempered glazing in hazardous locations per IRC R308, including glazing near doors and walking surfaces.',
  'Deck guards: 36" minimum height, with openings that will not pass a 4" sphere.',
  'Provide an attic access to the flat-ceiling areas and a crawl space access in the skirt.',
];

function Legend(design: Design, x: number, y: number, w: number): Block {
  const pitch = 54;
  const lh = leading(TXT.note);
  const sy = (i: number) => y + 30 + i * pitch;
  const row = (i: number, swatch: ReactNode, label: string) => {
    const lines = wrapText(label, w - 110, TXT.note);
    return (
      <g key={i}>
        {swatch}
        {lines.map((l, j) => (
          <PText key={j} x={x + 96} y={sy(i) + 12 - ((lines.length - 1) * lh) / 2 + j * lh} size={TXT.note}>{l}</PText>
        ))}
      </g>
    );
  };
  const hex = [0, 1, 2, 3, 4, 5].map((k) => `${x + 58 + 15 * Math.cos((k * Math.PI) / 3)},${sy(2) + 8 + 15 * Math.sin((k * Math.PI) / 3)}`).join(' ');
  return {
    height: 30 + 4 * pitch,
    node: (
      <g>
        <PText x={x} y={y} size={TXT.label} weight="bold" spacing={0.6}>LEGEND</PText>
        <line x1={x} x2={x + w} y1={y + 7} y2={y + 7} stroke={INK} strokeWidth={LW.thin} />
        {row(0, <rect x={x} y={sy(0)} width={72} height={16} fill={POCHE} />, `Exterior wall: ${lowerFirst(design.specs.framing.exteriorWalls)} (see wall type W1 on A-301)`)}
        {row(1, <rect x={x} y={sy(1) + 2} width={72} height={12} fill={POCHE_INT} />, `Interior partition: ${lowerFirst(design.specs.framing.interiorWalls)}, 1/2" GWB each side`)}
        {row(
          2,
          <g>
            <circle cx={x + 18} cy={sy(2) + 8} r={13} fill="#fff" stroke={INK} strokeWidth={LW.thin} />
            <PText x={x + 18} y={sy(2) + 12} size={TXT.tiny} anchor="middle" weight="bold">D1</PText>
            <polygon points={hex} fill="#fff" stroke={INK} strokeWidth={LW.thin} />
            <PText x={x + 58} y={sy(2) + 12} size={TXT.tiny} anchor="middle" weight="bold">W1</PText>
          </g>,
          'Door tag / window tag (see schedules on A-601)',
        )}
        {row(
          3,
          <g>
            <circle cx={x + 26} cy={sy(3) + 8} r={24} fill="#fff" stroke={INK} strokeWidth={LW.med} />
            <line x1={x + 2} x2={x + 50} y1={sy(3) + 8} y2={sy(3) + 8} stroke={INK} strokeWidth={LW.fine} />
            <PText x={x + 26} y={sy(3) + 3} size={TXT.tiny} anchor="middle" weight="bold">1</PText>
            <PText x={x + 26} y={sy(3) + 20} size={8} anchor="middle">A-301</PText>
          </g>,
          'Building section reference',
        )}
      </g>
    ),
  };
}

export function FloorPlanSheet({ design, overlay, planRef, frame }: SheetProps) {
  // With the front porch and the back deck the plan is too deep for 1/2" on this sheet.
  const scale: ScaleKey = '3/8';
  const colW = 1000;
  const box = { x: AREA.x, y: AREA.y, w: AREA.w - colW - 40, h: AREA.h - 110 };
  const s = designSummary(design);
  const colX = AREA.x + AREA.w - colW;
  return (
    <SheetFrame id="A-101" design={design} {...frame}>
      <PlanView design={design} scale={scale} bounds={planBounds(design, 30)} box={box} gRef={planRef}>
        <PlanDrawing design={design} />
        {overlay}
      </PlanView>
      <NorthArrow x={colX + colW - 50} y={AREA.y + AREA.h - 90} />
      <ViewTitle x={AREA.x + 30} y={AREA.y + AREA.h - 60} num={1} title="Floor Plan" scale={scale} width={620} />
      <ScaleBar x={AREA.x + 700} y={AREA.y + AREA.h - 50} scale={scale} />
      {stack(colX, AREA.y + 40, [
        (x, y) => Legend(design, x, y, colW),
        (x, y) =>
          table(
            x,
            y,
            'Area summary',
            [{ title: 'Room', w: colW * 0.46 }, { title: 'Size', w: colW * 0.34 }, { title: 'Area', w: colW * 0.2, align: 'end' }],
            [
              ...s.rooms.map((r) => [r.room.name, `${formatFtIn(r.width, 1)} x ${formatFtIn(r.depth, 1)}`, formatSqft(r.area)]),
              ['Net interior', '', formatSqft(s.net)],
              ['Gross conditioned', `${formatFtIn(s.width)} x ${formatFtIn(s.depth)}`, formatSqft(s.gross)],
              ...(s.garageArea
                ? [['Garage (unconditioned)', `${formatFtIn(s.garageWidth)} x ${formatFtIn(s.garageDepth)}`, formatSqft(s.garageArea)]]
                : []),
              ['Deck (unconditioned)', '', formatSqft(s.deckArea)],
              ...(s.porchArea ? [['Porch (unconditioned)', '', formatSqft(s.porchArea)]] : []),
            ],
          ),
        (x, y) => noteBlock(x, y, colW, 'Plan notes', PLAN_NOTES),
        (x, y) => noteBlock(x, y, colW, 'Construction materials', materialNotes(design)),
      ])}
    </SheetFrame>
  );
}

// ---------------------------------------------------------------- A-102

/** Width of the notes column on A-102 and A-103. */
const NOTES_COL_W = 820;

function PlanWithNotes(props: SheetProps & {
  id: SheetId;
  title: string;
  notes: string[];
  notesTitle: string;
  /** Extra blocks stacked under the notes, in the same column. */
  extra?: ((x: number, y: number) => Block)[];
  children: ReactNode;
}) {
  const scale: ScaleKey = '3/8';
  const colW = NOTES_COL_W;
  const box = { x: AREA.x, y: AREA.y + 20, w: AREA.w - colW - 60, h: AREA.h - 150 };
  const colX = AREA.x + AREA.w - colW;
  return (
    <SheetFrame id={props.id} design={props.design} {...props.frame}>
      <PlanView design={props.design} scale={scale} bounds={roofPlanBounds(props.design, 24)} box={box}>
        {props.children}
      </PlanView>
      <NorthArrow x={colX + colW - 60} y={AREA.y + AREA.h - 100} />
      <ViewTitle x={AREA.x + 30} y={AREA.y + AREA.h - 60} num={1} title={props.title} scale={scale} width={620} />
      <ScaleBar x={AREA.x + 700} y={AREA.y + AREA.h - 50} scale={scale} />
      {stack(colX, AREA.y + 60, [(x, y) => noteBlock(x, y, colW, props.notesTitle, props.notes), ...(props.extra ?? [])])}
    </SheetFrame>
  );
}

export function RoofPlanSheet(props: SheetProps) {
  const { design } = props;
  const g = design.garage;
  const sp = design.specs;
  return (
    <PlanWithNotes
      {...props}
      id="A-102"
      title="Roof Plan"
      notesTitle="Roof notes"
      notes={[
        `House roof: ${formatPitch(design.roof.pitch)} gable. Eave overhang ${formatFtIn(design.roof.overhang)}; rake overhang ${formatFtIn(design.roof.gableOverhang)}.`,
        ...(g
          ? [
              `Garage roof: ${formatPitch(g.roof.pitch)} gable with a ${formatFtIn(g.roof.overhang)} eave and ${formatFtIn(g.roof.gableOverhang)} rakes. Standing seam panels are rated for this low slope; confirm the minimum pitch with the manufacturer.`,
              'Where the garage roof meets the house wall, provide step flashing and counterflashing behind the siding. Keep the garage roof below the W5 clerestory sill.',
            ]
          : []),
        `Roofing: ${lowerFirst(sp.roof.covering)}, over ${lowerFirst(sp.roof.underlayment)} on ${lowerFirst(sp.roof.sheathing)}.`,
        `Roof framing: ${lowerFirst(sp.framing.rafters)} with ${lowerFirst(sp.framing.ridge)}. ${sp.framing.connectors} at every rafter-to-plate connection.`,
        `Insulation: ${lowerFirst(sp.roof.insulation)}.`,
        `Provide ${lowerFirst(sp.roof.gutters)} at the eaves. Discharge water away from the piers and toward the lake-side swale.`,
        'Flash the stovepipe with a manufactured boot. Place the chimney termination at least 3 ft above the roof and 2 ft above anything within 10 ft.',
        'Rafter, ridge beam, and connection sizes by the engineer. The vaulted ceiling requires a structural ridge or rafter ties per the engineer.',
      ]}
    >
      <RoofPlanDrawing design={design} />
    </PlanWithNotes>
  );
}

/**
 * Plain-language build order for the foundation, so the sheet reads as a plan of
 * attack and not just a set of notes. Counts come from the pier layout.
 */
function foundationSteps(design: Design): string[] {
  const { piers } = pierLayout(design);
  const house = piers.filter((q) => !q.deck).length;
  const platform = piers.length - house;
  const size = formatIn(design.foundation.pierSize);
  return [
    'Test the soil and get the engineering. A geotechnical report comes first; the engineer then sizes the piers, beams, and connections and seals the drawings.',
    'Pull the permits. County building and septic approvals, plus the LCRA review. Confirm the flood elevation before anything is set.',
    'Survey and stake. Mark the property corners, the setbacks, and then every pier center from this plan.',
    'Clear and grade. Strip the footprint only, stay out of the tree root zones, and slope the ground so water runs away from the building.',
    `Drill and pour the piers: ${house} under the house and ${platform} under the deck and porch. Drill ${size} holes to the depth the engineer calls for, set the cages and post bases, pour, and leave the tops level.`,
    'Set the beams. Bolt the P.T. beams into the post bases, then check level, square, and the diagonals before going further. Everything above depends on this step.',
    'Frame the floor. Hang the joists, run the rim, then glue and screw the subfloor down. Confirm the deck is flat and square before walls start.',
    'Insulate and close the crawl space. Batts, vapor retarder, and rodent screen underneath, then the skirt with its access panel.',
    ...(design.garage
      ? ['Pour the garage slab. Form the thickened edges, compact the base, lay the vapor retarder, then pour and slope to the overhead door with an isolation joint at the house.']
      : []),
    'Call for inspections as you go. Have each stage checked before it is covered up.',
  ];
}

export function FoundationPlanSheet(props: SheetProps) {
  const { design } = props;
  const dg = deckGeom(design);
  const sp = design.specs;
  return (
    <PlanWithNotes
      {...props}
      id="A-103"
      title="Foundation Plan"
      notesTitle="Foundation notes"
      notes={[
        `Piers: ${formatIn(design.foundation.pierSize)} dia. ${lowerFirst(sp.foundation.piers)}, spaced up to ${formatFtIn(design.foundation.pierSpacing)} o.c. Size and depth by the engineer, based on a geotechnical report.`,
        `Beams: ${lowerFirst(sp.foundation.beams)}, spaced up to ${formatFtIn(design.foundation.beamSpacing)} o.c. ${sp.framing.connectors}.`,
        `Floor framing: ${lowerFirst(sp.foundation.joists)}; ${lowerFirst(sp.foundation.subfloor)}; ${lowerFirst(sp.foundation.floorInsulation)}.`,
        `Lumber: ${sp.framing.lumber}.`,
        `Finished floor is ${formatFtIn(design.levels.floorHeight)} above average grade. Verify it against the flood elevation before construction.`,
        dg ? 'Deck: attach the ledger to the house rim with through-bolts and flashing. Place the outer beam on its own piers.' : 'No deck.',
        `Crawl space enclosure: ${lowerFirst(sp.foundation.skirt)}.`,
        ...(design.garage
          ? [
              `Garage: ${lowerFirst(sp.foundation.garageSlab)}, top of slab ${formatFtIn(-design.garage.floor)} below the house floor. Slope 1/8" per foot toward the overhead door.`,
              'Garage perimeter: thickened-edge footing, size and reinforcing by the engineer. Provide an isolation joint where the slab meets the house foundation.',
              'Close the house crawl space along the garage with P.T. framing and 1/2" gypsum board on the garage side (IRC R302.6), sealed at all penetrations.',
            ]
          : []),
      ]}
      extra={[
        (x, y) => noteBlock(x, y + 20, NOTES_COL_W, 'How the foundation gets built', foundationSteps(design)),
        (x, y) =>
          costBlock(
            x,
            y + 20,
            NOTES_COL_W,
            'Estimated foundation material cost',
            'Foundation subtotal',
            foundationCostRows(design),
            'MATERIAL COSTS ONLY (2026, CENTRAL TEXAS, ±25%) FOR THE WORK ON THIS SHEET. NO LABOR, DRILLING, OR EQUIPMENT. PIER DEPTH BY THE ENGINEER AND THE GEOTECHNICAL REPORT. SEE G-002 FOR THE WHOLE ESTIMATE.',
          ),
      ]}
    >
      <FoundationDrawing design={design} />
    </PlanWithNotes>
  );
}

// ---------------------------------------------------------------- A-201

/** Lake side and its opposite on A-201; the two remaining sides on A-202. */
function elevationOrder(design: Design): Side[] {
  const lake = design.meta.lakeSide;
  const order: Side[] = [lake, ({ north: 'south', south: 'north', east: 'west', west: 'east' } as const)[lake]];
  for (const s of ['east', 'west', 'north', 'south'] as Side[]) if (!order.includes(s)) order.push(s);
  return order;
}

export function ElevationsSheet(props: SheetProps) {
  return <ElevationPair {...props} id="A-201" sides={elevationOrder(props.design).slice(0, 2)} />;
}

export function SideElevationsSheet(props: SheetProps) {
  return <ElevationPair {...props} id="A-202" sides={elevationOrder(props.design).slice(2)} />;
}

function ElevationPair({ design, frame, id, sides }: SheetProps & { id: SheetId; sides: Side[] }) {
  const scale: ScaleKey = '1/2';
  const k = SCALES[scale].ratio * 100;
  const cellH = AREA.h / 2;
  const lake = design.meta.lakeSide;
  return (
    <SheetFrame id={id} design={design} {...frame}>
      {sides.map((side, i) => {
        const eb = elevationBounds(design, side);
        const bounds = { x0: eb.x0 - 230 / k, x1: eb.x1 + 450 / k, y0: -eb.h1 - 40 / k, y1: -eb.h0 + 20 / k };
        const box = { x: AREA.x, y: AREA.y + i * cellH, w: AREA.w, h: cellH - 110 };
        const hasFace = design.walls.some((w) => wallFace(design, w) === side);
        return (
          <g key={side}>
            {hasFace && (
              <PlanView design={design} scale={scale} bounds={bounds} box={box}>
                <ElevationDrawing design={design} side={side} />
              </PlanView>
            )}
            <ViewTitle
              x={box.x + 40}
              y={box.y + cellH - 70}
              num={i + 1}
              title={`${SIDE_TITLES[side]}${side === lake ? ' (Lake)' : ''}`}
              scale={scale}
              width={640}
            />
          </g>
        );
      })}
    </SheetFrame>
  );
}

// ---------------------------------------------------------------- A-301

const lookName = (axis: 'x' | 'y', look: '-' | '+') =>
  axis === 'x' ? (look === '-' ? 'WEST' : 'EAST') : look === '-' ? 'NORTH' : 'SOUTH';

export function SectionSheet({ design, frame }: SheetProps) {
  const scale: ScaleKey = '1/2';
  const k = SCALES[scale].ratio * 100;
  const sb = sectionBounds(design);
  const bounds = { x0: sb.x0 - 60 / k, x1: sb.x1 + 230 / k, y0: -sb.h1 - 50 / k, y1: -sb.h0 + 30 / k };
  // Section 1 spans the top of the sheet; Section 2 and the notes share the bottom.
  const box = { x: AREA.x, y: AREA.y + 20, w: AREA.w, h: 1010 };
  const bottomY = AREA.y + 1170;
  const notesX = AREA.x + 1960;
  const colW = (AREA.w - 1960 - 40) / 2;
  const gb = garageSectionBounds(design);
  const gAxis = garageSharedAxis(design);
  const box2 ={ x: AREA.x, y: bottomY, w: 1900, h: AREA.h - 1170 - 110 };
  const bounds2 = gb && { x0: gb.x0 - 330 / k, x1: gb.x1 + 330 / k, y0: -gb.h1 - 40 / k, y1: -gb.h0 + 20 / k };
  const cutNote = (axis: 'x' | 'y', at: number, look: '-' | '+', ref: string) =>
    `CUT AT ${axis === 'x' ? 'X' : 'Y'} = ${formatFtIn(at)}, LOOKING ${lookName(axis, look)} · SEE ${ref}/A-101`;
  const asm = assemblies(design);
  const assembly = (a: (typeof asm)[number]) => (x: number, y: number) => {
    const b = noteBlock(x + 40, y, colW - 40, `${a.title}`, a.lines, false);
    return {
      height: b.height,
      node: (
        <g>
          <polygon points={`${x + 14},${y - 18} ${x + 28},${y - 4} ${x + 14},${y + 10} ${x},${y - 4}`} fill="#fff" stroke={INK} strokeWidth={LW.thin} />
          <text x={x + 14} y={y - 1} fontSize={TXT.tiny} fontFamily={FONT} fontWeight="bold" textAnchor="middle">{a.tag}</text>
          {b.node}
        </g>
      ),
    };
  };
  const half = Math.ceil(asm.length / 2);
  return (
    <SheetFrame id="A-301" design={design} {...frame}>
      <PlanView design={design} scale={scale} bounds={bounds} box={box}>
        <SectionDrawing design={design} />
      </PlanView>
      <ViewTitle x={AREA.x + 40} y={box.y + box.h + 40} num={1} title="Building Section" scale={scale} width={640} />
      <PText x={AREA.x + 84} y={box.y + box.h + 80} size={TXT.note} color={INK_LIGHT}>
        {cutNote(design.roof.ridgeAxis, design.meta.section.at, design.meta.section.look, '1')}
      </PText>
      {bounds2 && gAxis && design.garage && (
        <>
          <PlanView design={design} scale={scale} bounds={bounds2} box={box2}>
            <GarageSectionDrawing design={design} />
          </PlanView>
          <ViewTitle x={AREA.x + 40} y={AREA.y + AREA.h - 60} num={2} title="Garage Section at Entry" scale={scale} width={640} />
          <PText x={AREA.x + 84} y={AREA.y + AREA.h - 20} size={TXT.note} color={INK_LIGHT}>
            {cutNote(gAxis, design.garage.section.at, design.garage.section.look, '2')}
          </PText>
        </>
      )}
      {stack(notesX, bottomY + 40, asm.slice(0, half).map(assembly))}
      {stack(notesX + colW + 40, bottomY + 40, [
        ...asm.slice(half).map(assembly),
        ...(gb ? [(x: number, y: number) => noteBlock(x, y + 20, colW, 'Garage section notes', garageSectionNotes(design))] : []),
      ])}
    </SheetFrame>
  );
}

// ---------------------------------------------------------------- A-601

export function SchedulesSheet({ design, frame }: SheetProps) {
  const doors = design.openings.filter((o) => o.kind !== 'window').sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true }));
  const windows = design.openings.filter((o) => o.kind === 'window').sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true }));
  const where = (o: (typeof design.openings)[number]) => {
    const rooms = roomsForOpening(design, o).map((r) => r.name);
    const w = wallById(design, o.wallId);
    const face = w ? wallFace(design, w) : null;
    return rooms.join(' / ') + (face ? ` (${face[0].toUpperCase()})` : '');
  };
  const opName: Record<string, string> = {
    swing: 'Hinged', pocket: 'Pocket', bifold: 'Bifold', barn: 'Barn', cased: 'Cased opening', overhead: 'Overhead sectional', sliding: 'Sliding glass',
    casement: 'Casement', 'double-hung': 'Double-hung', awning: 'Awning', slider: 'Horizontal slider', fixed: 'Fixed',
  };
  const W = AREA.w;
  const fixtureCols: Col[] = [
    { title: 'Item', w: 380 },
    { title: 'Description', w: 700 },
    { title: 'Size (W x D)', w: 380 },
    { title: 'Room', w: 500 },
    { title: 'Est. cost', w: 220, align: 'end' },
  ];
  const bedrooms = design.rooms.filter((r) => r.type === 'bedroom');
  const egressFor = (o: (typeof windows)[number]) => {
    if (!roomsForOpening(design, o).some((r) => bedrooms.includes(r))) return '';
    const c = clearOpening(o);
    const ok = c.w >= 20 && c.h >= 24 && c.w * c.h >= 5.7 * 144 && o.sill <= 44;
    return ok ? `Yes (${((c.w * c.h) / 144).toFixed(1)} SF)` : 'No';
  };
  const doorCols: Col[] = [
    { title: 'Tag', w: 90, align: 'middle' },
    { title: 'Location', w: 520 },
    { title: 'Type', w: 260 },
    { title: 'Size (W x H)', w: 300 },
    { title: 'Rough opening', w: 300 },
    { title: 'Notes', w: W - 1690 },
    { title: 'Est. cost', w: 220, align: 'end' },
  ];
  const winCols: Col[] = [
    { title: 'Tag', w: 90, align: 'middle' },
    { title: 'Location', w: 520 },
    { title: 'Operation', w: 260 },
    { title: 'Size (W x H)', w: 300 },
    { title: 'Sill / head', w: 300 },
    { title: 'Egress', w: 220 },
    { title: 'Notes', w: W - 1910 },
    { title: 'Est. cost', w: 220, align: 'end' },
  ];
  const roomCols: Col[] = [
    { title: 'Room', w: 380 },
    { title: 'Area', w: 160, align: 'end' },
    { title: 'Floor', w: 560 },
    { title: 'Walls', w: 700 },
    { title: 'Ceiling', w: 700 },
    { title: 'Clg. height', w: W - 2720 },
    { title: 'Est. cost', w: 220, align: 'end' },
  ];
  // Counters are listed for their cabinet cost; closet rods are too small to matter.
  const fixtureRows = design.fixtures
    .filter((f) => f.kind !== 'closet-rod')
    .map((f) => {
      const room = design.rooms.find((r) => {
        const s = roomStats(design, r);
        return s.net.length > 2 && pointInPolygon({ x: f.x, y: f.y }, s.net);
      });
      return { cost: fixtureCost(f), row: [f.kind.replace('-', ' '), f.label ?? '', `${formatIn(f.w)} x ${formatIn(f.d)}`, room?.name ?? ''] };
    });
  const roughSize = (o: (typeof design.openings)[number]) => {
    const ro = roughOpeningSize(design, o);
    return `${formatIn(ro.w)} x ${formatIn(ro.h)}`;
  };
  const doorCosts = doors.map((o) => openingCost(design, o));
  const windowCosts = windows.map((o) => openingCost(design, o));
  const roomCosts = design.rooms.map((r) => roomFinishCost(design, r).total);
  const fixtureCosts = fixtureRows.map((f) => f.cost);
  const subtotal = (cols: Col[], costs: typeof doorCosts) => cols.map((_, i) => (i === 0 ? 'Subtotal' : i === cols.length - 1 ? formatUsd(sumCosts(costs)) : ''));
  const total = scheduleCosts(design).total;
  return (
    <SheetFrame id="A-601" design={design} {...frame}>
      {stack(AREA.x + 20, AREA.y + 50, [
        (x, y) =>
          table(x, y, 'Door schedule', doorCols, doors.map((o, i) => [
            o.tag,
            where(o),
            opName[o.operation] ?? o.operation,
            `${formatFtIn(o.width)} x ${formatFtIn(o.height)}`,
            roughSize(o),
            o.note ?? '',
            formatCost(doorCosts[i]),
          ]), subtotal(doorCols, doorCosts)),
        (x, y) =>
          table(x, y, 'Window schedule', winCols, withRetiredTags(windows, 'W', (o) => [
            o.tag,
            where(o),
            opName[o.operation] ?? o.operation,
            `${formatFtIn(o.width)} x ${formatFtIn(o.height)}`,
            `${formatFtIn(o.sill)} / ${formatFtIn(openingHead(o))}`,
            egressFor(o),
            o.note ?? '',
            formatCost(windowCosts[windows.indexOf(o)]),
          ], design), subtotal(winCols, windowCosts)),
        (x, y) =>
          table(x, y, 'Room finish schedule', roomCols, design.rooms.map((r, i) => {
            const s = roomStats(design, r);
            return [
              r.name, formatSqft(s.area), r.finishes.floor, r.finishes.walls, r.finishes.ceiling,
              r.ceiling === 'vaulted' ? 'Vaulted' : formatFtIn(s.ceilingHeight), formatCost(roomCosts[i]),
            ];
          }), subtotal(roomCols, roomCosts)),
        (x, y) =>
          table(x, y, 'Fixtures and equipment', fixtureCols, fixtureRows.map((f) => [...f.row, formatCost(f.cost)]), subtotal(fixtureCols, fixtureCosts)),
      ])}
      <PText x={AREA.x + AREA.w - 20} y={AREA.y + AREA.h - 46} size={TXT.label} weight="bold" anchor="end">
        {`ESTIMATED MATERIAL TOTAL, SCHEDULED ITEMS: ${formatUsd(total)}`}
      </PText>
      <PText x={AREA.x + 20} y={AREA.y + AREA.h - 20} size={TXT.note} color={INK_LIGHT}>
        ROUGH OPENINGS ARE TYPICAL ALLOWANCES; VERIFY THEM WITH THE MANUFACTURER'S SPECIFICATIONS BEFORE FRAMING. WINDOW EGRESS IS ESTIMATED FROM THE OPERATION TYPE; CONFIRM THE NET CLEAR OPENING WITH THE SELECTED UNIT.
      </PText>
      <PText x={AREA.x + 20} y={AREA.y + AREA.h - 42} size={TXT.note} color={INK_LIGHT}>
        COSTS ARE MATERIAL COSTS ONLY (2026, CENTRAL TEXAS, ±25%) FOR THE SCHEDULED ITEMS: THE UNIT, FINISH, OR FIXTURE ITSELF, WITH NO LABOR. SEE G-002 FOR THE WHOLE ESTIMATE AND WHAT IT LEAVES OUT. OWNER = OWNER-FURNISHED; N.I.C. = NOT IN CONTRACT.
      </PText>
    </SheetFrame>
  );
}

/**
 * Schedule rows in tag order, with a placeholder row for any unused number
 * (for example a window removed in a revision), so existing tags keep their meaning.
 */
function withRetiredTags<T extends { tag: string }>(items: T[], prefix: string, row: (o: T) => string[], design: Design): string[][] {
  const nums = items.map((o) => Number(o.tag.slice(prefix.length))).filter(Number.isFinite);
  const max = Math.max(0, ...nums);
  const out: string[][] = [];
  for (let n = 1; n <= max; n++) {
    const found = items.find((o) => o.tag === `${prefix}${n}`);
    if (found) out.push(row(found));
    else {
      const replaced = design.openings.find((o) => o.note?.includes(`Replaces ${prefix}${n}`));
      out.push([`${prefix}${n}`, '—', 'Not used', '', '', '', replaced ? `Removed; see ${replaced.tag}` : 'Removed']);
    }
  }
  return out.concat(items.filter((o) => !/^\d+$/.test(o.tag.slice(prefix.length))).map(row));
}

export type { FrameProps, SheetProps } from './blocks';

export const SHEET_COMPONENTS: Record<SheetId, (p: SheetProps) => ReactNode> = {
  'G-001': CoverSheet,
  'G-002': EstimateSummarySheet,
  'A-100': SitePlanSheet,
  'A-101': FloorPlanSheet,
  'A-102': RoofPlanSheet,
  'A-103': FoundationPlanSheet,
  'A-201': ElevationsSheet,
  'A-202': SideElevationsSheet,
  'A-301': SectionSheet,
  'A-601': SchedulesSheet,
  'A-602': EnvelopeSheet,
  'S-001': FramingNotesSheet,
  'S-101': FloorFramingSheet,
  'S-102': WallFramingPlanSheet,
  'S-103': RoofFramingSheet,
  'S-201': ExteriorWallElevationsSheet,
  'S-202': PartitionElevationsSheet,
  'S-203': GarageWallElevationsSheet,
  'S-601': CutListSheet,
  'S-602': FramingSchedulesSheet,
  'S-603': BuyListSheet,
};

