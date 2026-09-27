import { envelopeCostRows, estimateSummary, formatUsd } from '../../model/costs';
import { designSummary } from '../../model/geometry';
import { envelopeTakeoff, faceName, sidingPhrase, validateEnvelope } from '../../model/envelope';
import { frameModel } from '../../model/framing';
import { validateFraming } from '../../model/framing/checks';
import { takeoff } from '../../model/framing/takeoff';
import { roofSurfaces } from '../../model/roofing';
import { formatFrac, formatFtIn, formatSqft, lowerFirst } from '../../model/units';
import { INK, INK_LIGHT, leading, LW, PText, TXT, wrapText } from '../draft/draft';
import { AREA, SheetFrame } from './SheetFrame';
import { costBlock, noteBlock, stack, table, type SheetProps } from './blocks';

const n = (v: number) => Math.round(v).toLocaleString('en-US');

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

// ---------------------------------------------------------------- A-602

export function EnvelopeSheet({ design, frame }: SheetProps) {
  const t = envelopeTakeoff(design);
  const e = design.envelope;
  const leftW = 1500;
  const rightX = AREA.x + leftW + 60;
  const rightW = AREA.w - leftW - 80;
  const total = (pick: (f: (typeof t.faces)[number]) => number) => formatSqft(t.faces.reduce((s, f) => s + pick(f), 0));
  const rows = envelopeCostRows(design);
  const issues = validateEnvelope(design);
  let group = '';
  return (
    <SheetFrame id="A-602" design={design} {...frame}>
      {stack(AREA.x + 20, AREA.y + 50, [
        (x, y) =>
          table(
            x,
            y,
            'Exterior wall areas',
            [
              { title: 'Wall', w: 90, align: 'middle' },
              { title: 'Faces', w: 230 },
              { title: 'Gross', w: 150, align: 'end' },
              { title: 'Hidden', w: 150, align: 'end' },
              { title: 'Openings', w: 320 },
              { title: 'Siding', w: 150, align: 'end' },
              { title: 'Wall insulation', w: 190, align: 'end' },
              { title: 'Siding above grade', w: leftW - 1280, align: 'end' },
            ],
            t.faces.map((f) => [
              f.wall.id,
              faceName(design, f),
              formatSqft(f.gross),
              f.covered > 1 ? formatSqft(f.covered) : '',
              f.openings.map((o) => `${o.opening.tag}${o.exposed ? '' : ' (in garage)'}`).join(', '),
              formatSqft(f.net),
              f.insulated > 1 ? formatSqft(f.insulated) : 'Not heated',
              formatFtIn(f.clearance),
            ]),
            ['Total', '', total((f) => f.gross), total((f) => f.covered), '', total((f) => f.net), total((f) => f.insulated), ''],
          ),
        (x, y) =>
          table(
            x,
            y,
            'Envelope quantities',
            [
              { title: 'Group', w: 300 },
              { title: 'Item', w: 480 },
              { title: 'Quantity', w: 160, align: 'end' },
              { title: 'How it is measured', w: leftW - 940 },
            ],
            t.items.map((i) => {
              const g = i.group === group ? '' : i.group;
              group = i.group;
              return [g, i.item, `${n(i.qty)} ${i.unit}`, i.note];
            }),
          ),
      ])}
      {stack(rightX, AREA.y + 50, [
        (x, y) =>
          costBlock(
            x,
            y,
            rightW,
            'Estimated envelope material cost',
            'Envelope subtotal',
            rows,
            'MATERIAL COSTS ONLY, NO LABOR (2026, CENTRAL TEXAS, ±25%); PLACEHOLDERS UNTIL REPLACED WITH QUOTES. FLOOR INSULATION AND THE HOUSE SKIRT ARE PRICED ON A-103, WALL AND ROOF SHEATHING ON S-602, AND THE DOORS AND WINDOWS ON A-601.',
          ),
        (x, y) =>
          noteBlock(x, y + 10, rightW, 'Envelope notes', [
            `Siding: ${lowerFirst(sidingPhrase(design))}. Boards are ${e.siding.module}" on center, as drawn on the elevations. Hold the siding ${formatFrac(e.siding.clearance)} above the ground and 2" above roofs and decks.`,
            'Weather barrier: lap each course over the one below, and lap it over the head flashing at every opening. Tape the seams. Flash each rough opening with a sill pan and flashing tape before the unit goes in.',
            `Insulation: ${lowerFirst(e.insulation.walls)} in the house exterior walls; ${lowerFirst(e.insulation.attic)}; ${lowerFirst(e.insulation.vault)}. The garage is not heated. The house wall inside the garage is insulated, and finished with 1/2" gypsum board (IRC R302.6).`,
            'Wall areas run from the bottom of the floor framing (the slab, at the garage) to the top plate, or to the roof at a gable. "Hidden" is the house wall inside the garage, which gets no siding.',
            `Trim: ${e.trim.corner} corner boards, ${e.trim.casing} casing, ${e.trim.fascia} fascia, ${e.trim.rake} rake boards, ${e.trim.frieze} frieze, and ${lowerFirst(e.trim.soffit)}.`,
            ...issues.map((i) => `Open item: ${i.message}.`),
          ]),
      ])}
      <Footer lines={['PRELIMINARY QUANTITIES FOR BUDGETING. NOT FOR CONSTRUCTION. VERIFY PRODUCTS, CLEARANCES, AND FLASHING DETAILS WITH THE MANUFACTURERS AND THE BUILDER.']} />
    </SheetFrame>
  );
}

// ---------------------------------------------------------------- G-002

const EXCLUDED = [
  'All labor: every figure is the cost of material alone. Also equipment, pile driving, delivery, and waste hauling.',
  'Plumbing, electrical, and heating and cooling systems beyond the fixtures listed on A-601.',
  'Septic system, well or water service, and utility connections.',
  'Site work: clearing, grading, driveway, walks, fence, landscape, and drainage.',
  'Survey, soil report, engineering, permits, and LCRA fees.',
  'Interior paint and trim beyond the room finish allowances, and owner-furnished furniture and appliances marked "Owner".',
  'Builder overhead, profit, insurance, and sales tax.',
  'A contingency. Carry 10% to 15% until the drawings are engineered and bid.',
];

export function EstimateSummarySheet({ design, frame }: SheetProps) {
  const s = estimateSummary(design);
  const d = designSummary(design);
  const model = frameModel(design);
  const t = takeoff(design, model);
  const env = envelopeTakeoff(design);
  const roofs = roofSurfaces(design);
  const open = [...validateFraming(design), ...validateEnvelope(design)].filter((i) => i.level === 'warning');
  // This sheet is read more than it is measured from, so its type is a size larger.
  const BIG = { size: 15 };
  const NOTE = 14;
  const leftW = 1900;
  const rightX = AREA.x + leftW + 80;
  const rightW = AREA.w - leftW - 100;
  const share = (v: number) => `${Math.round((v / s.total) * 100)}%`;
  const barW = 260;
  const top = AREA.y + 210;
  const costTable = table(
    AREA.x + 20,
    top,
    'Estimated material cost by part of the work',
    [
      { title: 'Part of the work', w: 660 },
      { title: 'Itemized on', w: 170, align: 'middle' },
      { title: 'Measured from', w: leftW - 20 - 660 - 170 - 210 - 130 - barW },
      { title: 'Est. cost', w: 210, align: 'end' },
      { title: 'Share', w: 130, align: 'end' },
      { title: '', w: barW },
    ],
    s.rows.map((r) => [r.item, r.sheet, r.basis, formatUsd(r.cost), share(r.cost), '']),
    ['Total material cost', '', '', formatUsd(s.total), '100%', ''],
    BIG,
  );
  const quantities: string[][] = [
    ['Conditioned floor area', formatSqft(d.gross)],
    ['Garage', formatSqft(d.garageArea)],
    ['Deck and porch', formatSqft(d.deckArea + d.porchArea)],
    ['Framing pieces', n(t.totals.pieces)],
    ['Sawn lumber to buy', `${n(t.totals.bf)} board feet`],
    ['Sheathing to buy', `${t.sheets.reduce((a, q) => a + q.sheets + q.extra, 0)} sheets`],
    ['Roof area', formatSqft(roofs.reduce((a, r) => a + r.area, 0))],
    ['Siding area', formatSqft(env.faces.reduce((a, f) => a + f.net, 0))],
    ['Doors and windows', `${design.openings.length}`],
    ['Open items for the engineer', `${open.length}`],
  ];
  const half = Math.ceil(quantities.length / 2);
  return (
    <SheetFrame id="G-002" design={design} {...frame}>
      <PText x={AREA.x + 20} y={AREA.y + 70} size={TXT.big} weight="bold" spacing={1}>MATERIAL ESTIMATE SUMMARY</PText>
      <PText x={AREA.x + 20} y={AREA.y + 108} size={TXT.sub} color={INK_LIGHT}>
        {`Material costs for the work shown in this set, with no labor. Building ${formatUsd(s.building)} (${formatUsd(s.perSf)} per conditioned square foot)${s.site ? `; with the boat dock ${formatUsd(s.total)}` : ''}.`}
      </PText>
      <line x1={AREA.x + 20} x2={AREA.x + leftW} y1={AREA.y + 134} y2={AREA.y + 134} stroke={INK} strokeWidth={LW.heavy} />
      {stack(AREA.x + 20, top, [
        () => costTable,
        (x, y) =>
          table(
            x,
            y,
            'Totals',
            [
              { title: 'Item', w: 660 },
              { title: 'Amount', w: 330, align: 'end' },
              { title: 'Note', w: leftW - 20 - 990 },
            ],
            [
              ['Building: house, garage, deck, and porch', formatUsd(s.building), `${formatUsd(s.perSf)} per square foot of conditioned floor (${formatSqft(d.gross)})`],
              ...(s.site ? [['Boat dock', formatUsd(s.site), 'Material only, priced on A-100']] : []),
              ['Range at ±25%', `${formatUsd(s.total * 0.75)} to ${formatUsd(s.total * 1.25)}`, 'The prices are for early budgeting, before quotes'],
            ],
            ['Total material cost', formatUsd(s.total), 'Does not include labor or the other items listed at the right'],
            BIG,
          ),
        (x, y) =>
          table(
            x,
            y,
            'Key quantities',
            [
              { title: 'Item', w: 560 },
              { title: 'Quantity', w: (leftW - 20) / 2 - 560, align: 'end' },
              { title: 'Item', w: 560 },
              { title: 'Quantity', w: (leftW - 20) / 2 - 560, align: 'end' },
            ],
            quantities.slice(0, half).map((q, i) => [...q, ...(quantities[half + i] ?? ['', ''])]),
            undefined,
            BIG,
          ),
      ])}
      {/* A bar for each row's share of the total. */}
      {s.rows.map((r, i) => {
        const row = costTable.rows[i];
        const w = ((barW - 28) * r.cost) / Math.max(...s.rows.map((q) => q.cost));
        return <rect key={r.item} x={AREA.x + leftW - barW + 14} y={row.y + 12} width={w} height={row.h - 24} fill={r.part === 'site' ? '#a6a6a6' : '#4f4f4f'} />;
      })}
      {stack(rightX, AREA.y + 60, [
        (x, y) =>
          noteBlock(
            x,
            y,
            rightW,
            'How the numbers are made',
            [
              'Every quantity is measured from the design model: areas from the plan, pieces from the framing model, and counts from the schedules. Change the design and the estimate follows.',
              'Each material is priced on one sheet only. This summary adds the subtotals of those sheets; it prices nothing itself.',
              'Rates are material prices in 2026 dollars for Central Texas, with no labor. They are placeholders until replaced with supplier quotes. Edit the rates in src/model/costs.ts.',
              'Treat each figure as good to about ±25%. Supplier quotes replace the material prices; a builder\'s bid adds the labor.',
            ],
            true,
            NOTE,
          ),
        (x, y) => noteBlock(x, y + 10, rightW, 'Not in the estimate', EXCLUDED, true, NOTE),
        (x, y) =>
          noteBlock(
            x,
            y + 10,
            rightW,
            'Before relying on it',
            [
              'Have a licensed engineer design the structure and foundation for the site. Member sizes here are assumptions.',
              `${open.length} framing and envelope items are open. The checks panel in the app lists them, and so does "npm run validate".`,
              'Confirm the flood elevation, the setbacks, and the septic and LCRA requirements before pricing the site work.',
            ],
            true,
            NOTE,
          ),
      ])}
      <Footer lines={['PRELIMINARY MATERIAL ESTIMATE FOR BUDGETING. NO LABOR IS INCLUDED. NOT A BID, AND NOT FOR CONSTRUCTION.']} />
    </SheetFrame>
  );
}
