import type { Design, Fixture, Opening, Room } from './schema';
import { footprint, footprintBounds, garageFootprint, pierLayout, polygonArea, roomStats, wallById } from './geometry';
import { siteGeom } from './site';
import { designSummary } from './geometry';
import { frameModel } from './framing';
import { lvlDepth } from './framing/lumber';
import { takeoff, TRADE_NAMES, type BuyLine, type Trade } from './framing/takeoff';
import { roofingTakeoff } from './roofing';
import { envelopeTakeoff } from './envelope';

/**
 * Material cost estimates for the whole set, in 2026 dollars for the Lake LBJ / Central
 * Texas area. Every rate is the price of the material alone: no labor, equipment,
 * delivery, tax, or markup. These are budgeting numbers only (about ±25%); replace
 * them with supplier quotes.
 */

/** A cost in dollars, or a reason the item isn't priced. */
export type CostEstimate = { cost: number } | { cost: null; reason: string };

const priced = (cost: number): CostEstimate => ({ cost: Math.round(cost / 10) * 10 });

// ---------------------------------------------------------------- openings

/** Price of the door unit with its frame and hardware, by operation. The overhead door includes its opener. */
const DOOR_COST: Record<string, number> = {
  swing: 320,
  pocket: 550,
  bifold: 220,
  barn: 500,
  cased: 120,
  sliding: 2800,
  overhead: 2200,
};
/** Exterior hinged doors (insulated, weatherstripped, keyed hardware). */
const EXTERIOR_DOOR_COST = 1100;

/** Price of the window unit per square foot, by operation. */
const WINDOW_COST_PER_SF: Record<string, number> = {
  casement: 70,
  'double-hung': 52,
  awning: 70,
  slider: 45,
  fixed: 40,
};
const WINDOW_MIN_COST = 280;
/** Tempered or obscure glass upcharge. */
const SPECIAL_GLASS_FACTOR = 1.15;

export function openingCost(design: Design, o: Opening): CostEstimate {
  if (o.kind === 'window') {
    const sf = (o.width * o.height) / 144;
    let cost = Math.max(WINDOW_MIN_COST, sf * (WINDOW_COST_PER_SF[o.operation] ?? 90));
    if (/tempered|obscure/i.test(o.note ?? '')) cost *= SPECIAL_GLASS_FACTOR;
    return priced(cost);
  }
  const wall = wallById(design, o.wallId);
  if (o.operation === 'swing' && wall?.type === 'exterior') return priced(EXTERIOR_DOOR_COST);
  // Base prices are for a 3'-0" leaf; wide sliders and overheads scale with width.
  const base = DOOR_COST[o.operation] ?? 650;
  const scale = o.operation === 'sliding' || o.operation === 'overhead' ? Math.max(1, o.width / (o.operation === 'sliding' ? 96 : 108)) : 1;
  return priced(base * scale);
}

// ---------------------------------------------------------------- room finishes

type Rate = [RegExp, number];

/** Material $/SF, with its setting materials, finish, and paint; first match wins. */
const FLOOR_RATES: Rate[] = [
  [/oak|hardwood|walnut|maple/i, 7.5],
  [/tile|stone|marble/i, 6],
  [/lvp|vinyl|laminate/i, 3.2],
  [/carpet/i, 2.8],
  [/concrete|slab/i, 0.6],
];
const WALL_RATES: Rate[] = [
  [/shiplap|board|plank|paneling/i, 4.2],
  [/gypsum|drywall|paint/i, 1.1],
];
const CEILING_RATES: Rate[] = [
  [/tongue|t&g|pine|cedar|wood/i, 4.5],
  [/gypsum|drywall|paint/i, 1.2],
];
const DEFAULT_RATE = { floor: 4, walls: 1.1, ceiling: 1.2 };

function rate(rates: Rate[], finish: string, fallback: number): number {
  // "Painted shiplap" should price as shiplap, so check the specific rates first.
  return rates.find(([re]) => re.test(finish))?.[1] ?? fallback;
}

/** Floor, wall, and ceiling finish areas (SF) and the material cost of each. */
export function roomFinishCost(design: Design, room: Room) {
  const s = roomStats(design, room);
  const floorSf = s.area / 144;
  let perimeter = 0;
  for (let i = 0; i < s.net.length; i++) {
    const a = s.net[i];
    const b = s.net[(i + 1) % s.net.length];
    perimeter += Math.hypot(b.x - a.x, b.y - a.y);
  }
  // Wall area at the plate height, less about 15% for openings.
  const wallSf = ((perimeter * s.ceilingHeight) / 144) * 0.85;
  const slope = room.ceiling === 'vaulted' ? Math.hypot(1, design.roof.pitch / 12) : 1;
  const ceilingSf = floorSf * slope;
  const floor = floorSf * rate(FLOOR_RATES, room.finishes.floor, DEFAULT_RATE.floor);
  const walls = wallSf * rate(WALL_RATES, room.finishes.walls, DEFAULT_RATE.walls);
  const ceiling = ceilingSf * rate(CEILING_RATES, room.finishes.ceiling, DEFAULT_RATE.ceiling);
  return { floor, walls, ceiling, total: priced(floor + walls + ceiling) };
}

// ---------------------------------------------------------------- fixtures

const OWNER_FURNISHED = new Set(['table', 'chair', 'sofa', 'coffee-table', 'bed', 'nightstand', 'dresser']);

/** Price of each item, with its faucet, valve, or trim kit where it has one. */
const FIXTURE_COST: Partial<Record<Fixture['kind'], number>> = {
  sink: 450,
  range: 1400,
  fridge: 2000,
  dishwasher: 750,
  toilet: 300,
  vanity: 800,
  shower: 2200, // valve, pan, tile for the surround, and glass
  tub: 1200,
  'washer-dryer': 1800,
  'water-heater': 1400,
  stove: 3400, // wood stove with its flue pipe and hearth pad
  'closet-rod': 60,
};
/** Cabinets with countertop, per linear foot. */
const BASE_CABINET_PER_LF = 380;
const UPPER_CABINET_PER_LF = 200;
const ISLAND_PER_LF = 480;

export function fixtureCost(f: Fixture): CostEstimate {
  if (f.kind === 'car') return { cost: null, reason: 'N.I.C.' };
  if (OWNER_FURNISHED.has(f.kind)) return { cost: null, reason: 'Owner' };
  const lf = f.w / 12;
  if (f.kind === 'counter') return priced(lf * (BASE_CABINET_PER_LF + (/upper/i.test(f.label ?? '') ? UPPER_CABINET_PER_LF : 0)));
  if (f.kind === 'island') return priced(lf * ISLAND_PER_LF);
  return priced(FIXTURE_COST[f.kind] ?? 0);
}

// ---------------------------------------------------------------- formatting

export function formatUsd(dollars: number): string {
  return `$${Math.round(dollars).toLocaleString('en-US')}`;
}

export function formatCost(c: CostEstimate): string {
  return c.cost === null ? c.reason : formatUsd(c.cost);
}

export function sumCosts(costs: CostEstimate[]): number {
  return costs.reduce((s, c) => s + (c.cost ?? 0), 0);
}

// ---------------------------------------------------------------- foundation and floor framing

/**
 * Material costs for the work shown on the foundation plan. Piers are priced each
 * (concrete, form tube, reinforcing, and beam seat); framing by the floor area it
 * covers; the skirt and footings by the foot.
 */
const PIER_EACH = 140;
const BEAM_PER_LF = 7.3;
const JOISTS_PER_SF = 2.75;
const SUBFLOOR_PER_SF = 1.75;
const FLOOR_INSULATION_PER_SF = 1.6;
const SKIRT_PER_LF = 9;
const SLAB_PER_SF = 3.2;
const THICKENED_EDGE_PER_LF = 11;

export type CostRow = { item: string; qty: string; rate: string; cost: number };

const sf = (sqIn: number) => sqIn / 144;
const lf = (inches: number) => inches / 12;
const perimeter = (pts: { x: number; y: number }[]) =>
  pts.reduce((s, a, i) => s + Math.hypot(pts[(i + 1) % pts.length].x - a.x, pts[(i + 1) % pts.length].y - a.y), 0);
const qtyEa = (n: number) => `${n} ea.`;
const qtySf = (sqIn: number) => `${Math.round(sf(sqIn)).toLocaleString('en-US')} SF`;
const qtyLf = (inches: number) => `${Math.round(lf(inches)).toLocaleString('en-US')} LF`;

/** Priced rows for the foundation plan, in the order they are built. */
export function foundationCostRows(design: Design): CostRow[] {
  const { beams, piers } = pierLayout(design);
  const fp = footprint(design);
  const floor = polygonArea(fp);
  const beamLen = (deck: boolean) => beams.filter((b) => b.deck === deck).reduce((s, b) => s + Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y), 0);
  const count = (deck: boolean) => piers.filter((q) => q.deck === deck).length;
  const rows: CostRow[] = [
    { item: 'Concrete piers with spread footings', qty: qtyEa(count(false)), rate: `${formatUsd(PIER_EACH)} ea.`, cost: count(false) * PIER_EACH },
    { item: 'P.T. built-up beams', qty: qtyLf(beamLen(false)), rate: `${money(BEAM_PER_LF)}/LF`, cost: lf(beamLen(false)) * BEAM_PER_LF },
    { item: 'Floor joists, blocking, straps, and rim', qty: qtySf(floor), rate: `${money(JOISTS_PER_SF)}/SF`, cost: sf(floor) * JOISTS_PER_SF },
    { item: 'Subfloor, with adhesive and screws', qty: qtySf(floor), rate: `${money(SUBFLOOR_PER_SF)}/SF`, cost: sf(floor) * SUBFLOOR_PER_SF },
    { item: 'Floor insulation, vapor retarder, rodent screen', qty: qtySf(floor), rate: `${money(FLOOR_INSULATION_PER_SF)}/SF`, cost: sf(floor) * FLOOR_INSULATION_PER_SF },
    { item: 'Crawl-space skirt with access panel', qty: qtyLf(perimeter(fp)), rate: `${formatUsd(SKIRT_PER_LF)}/LF`, cost: lf(perimeter(fp)) * SKIRT_PER_LF },
  ];
  if (count(true)) {
    rows.push(
      { item: 'Deck and porch piers', qty: qtyEa(count(true)), rate: `${formatUsd(PIER_EACH)} ea.`, cost: count(true) * PIER_EACH },
      { item: 'Deck and porch beams', qty: qtyLf(beamLen(true)), rate: `${money(BEAM_PER_LF)}/LF`, cost: lf(beamLen(true)) * BEAM_PER_LF },
    );
  }
  const gfp = garageFootprint(design);
  if (gfp) {
    const area = polygonArea(gfp);
    // The side against the house needs no footing of its own.
    const free = garageFreeEdgeLength(design, gfp);
    rows.push(
      { item: 'Garage slab on grade over compacted base', qty: qtySf(area), rate: `${money(SLAB_PER_SF)}/SF`, cost: sf(area) * SLAB_PER_SF },
      { item: 'Garage thickened-edge footing', qty: qtyLf(free), rate: `${formatUsd(THICKENED_EDGE_PER_LF)}/LF`, cost: lf(free) * THICKENED_EDGE_PER_LF },
    );
  }
  return rows.map((r) => ({ ...r, cost: Math.round(r.cost / 10) * 10 }));
}

/** Garage perimeter minus the edges butting the house, which sit on the house foundation. */
function garageFreeEdgeLength(design: Design, gfp: { x: number; y: number }[]): number {
  const h = footprintBounds(design);
  let total = 0;
  for (let i = 0; i < gfp.length; i++) {
    const a = gfp[i];
    const b = gfp[(i + 1) % gfp.length];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const onHouse =
      (Math.abs(mid.x - h.x0) < 1 || Math.abs(mid.x - h.x1) < 1) ? mid.y > h.y0 - 1 && mid.y < h.y1 + 1
        : (Math.abs(mid.y - h.y0) < 1 || Math.abs(mid.y - h.y1) < 1) ? mid.x > h.x0 - 1 && mid.x < h.x1 + 1
          : false;
    if (!onHouse) total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

// ---------------------------------------------------------------- boat dock

/**
 * Material costs for the dock. A pile is the treated timber alone; driving it is labor
 * and equipment. The deck rate covers the treated framing, the deck boards, and the
 * galvanized hardware under a square foot of walkway.
 */
const PILE_EACH = 325;
const DOCK_DECK_PER_SF = 11;
const BOAT_LIFT = 6500;
const SWIM_LADDER = 350;
const DOCK_HARDWARE = 700;
const DOCK_ELECTRICAL = 900;

/** Priced rows for the boat dock plan, or an empty list when there is no dock. */
export function dockCostRows(design: Design): CostRow[] {
  const d = siteGeom(design)?.dock;
  if (!d) return [];
  const area = (r: { x0: number; y0: number; x1: number; y1: number }) => (r.x1 - r.x0) * (r.y1 - r.y0);
  const deckArea = d.walkRects.reduce((s, r) => s + area(r), 0);
  const rows: CostRow[] = [
    { item: 'Treated timber piles', qty: qtyEa(d.piles.length), rate: `${formatUsd(PILE_EACH)} ea.`, cost: d.piles.length * PILE_EACH },
    { item: 'Framing and decking: gangway, walkways, lounge', qty: qtySf(deckArea), rate: `${formatUsd(DOCK_DECK_PER_SF)}/SF`, cost: sf(deckArea) * DOCK_DECK_PER_SF },
    ...(d.lift.length ? [{ item: 'Boat lift', qty: qtyEa(1), rate: formatUsd(BOAT_LIFT), cost: BOAT_LIFT }] : []),
    { item: 'Swim ladder', qty: qtyEa(1), rate: formatUsd(SWIM_LADDER), cost: SWIM_LADDER },
    { item: 'Cleats, bumpers, and trim hardware', qty: 'Allowance', rate: formatUsd(DOCK_HARDWARE), cost: DOCK_HARDWARE },
    { item: 'Dock wiring, GFCI devices, and lights', qty: 'Allowance', rate: formatUsd(DOCK_ELECTRICAL), cost: DOCK_ELECTRICAL },
  ];
  return rows.map((r) => ({ ...r, cost: Math.round(r.cost / 10) * 10 }));
}

// ---------------------------------------------------------------- framing (S-602)

/**
 * Material prices for framing lumber, per linear foot of No. 2 southern yellow pine.
 * Placeholders for budgeting: replace them with the supplier's quote.
 */
const LUMBER_PER_LF: Record<string, number> = {
  '2x2': 0.45,
  '2x4': 0.65,
  '2x6': 0.95,
  '2x8': 1.3,
  '2x10': 1.8,
  '2x12': 2.4,
  '4x4': 1.9,
  '4x6': 3.2,
  '6x6': 5,
};
const TREATED_FACTOR = 1.35;
/** One 1-3/4" LVL ply, per linear foot, for each inch of depth. */
const LVL_PER_LF_PER_INCH = 0.75;
const DECK_BOARD_PER_LF = 3.25;
const SHEET_EACH = { wall: 16, roof: 38, subfloor: 48 };
const HARDWARE_EACH: Record<string, number> = {
  'anchor-bolt': 4,
  'header-hanger': 30,
  'post-cap': 35,
  'beam-seat': 28,
  'joist-splice': 3,
  'ceiling-hanger': 3.5,
  'garage-ceiling-hanger': 3.5,
  'ceiling-beam-hanger': 45,
  'garage-ceiling-beam-hanger': 45,
  'hurricane-tie': 1.5,
  'rafter-hanger': 9,
  'deck-hanger': 4.5,
  'deck-tie': 2,
  'ledger-screw': 1.2,
  'lateral-tie': 30,
  'post-base': 28,
  'deck-post-cap': 22,
  'guard-bolt': 3,
  'stringer-hanger': 8,
};
const HARDWARE_DEFAULT = 5;
/** Nails, screws, and adhesive, as a share of the lumber and sheathing. */
const FASTENER_SHARE = 0.04;

/** Price per linear foot of a framing size in a material. */
export function lumberRate(size: string, material: string): number {
  if (material === 'LVL') return lvlDepth(size) * LVL_PER_LF_PER_INCH;
  if (material === 'COMP') return DECK_BOARD_PER_LF;
  return (LUMBER_PER_LF[size] ?? 1) * (material === 'PT' ? TREATED_FACTOR : 1);
}

export const hardwareRate = (key: string) => HARDWARE_EACH[key] ?? HARDWARE_DEFAULT;
export const sheetRate = (kind: keyof typeof SHEET_EACH) => SHEET_EACH[kind];
export const buyLineCost = (l: BuyLine) => l.lf * lumberRate(l.size, l.material);

const roundRows = (rows: CostRow[]) => rows.filter((r) => r.cost > 0).map((r) => ({ ...r, cost: Math.round(r.cost / 10) * 10 }));
const usd2 = (v: number) => `$${v.toFixed(2)}`;
/** Whole dollars where the rate is whole, cents where it is not. */
const money = (v: number) => (Number.isInteger(v) ? formatUsd(v) : usd2(v));
const perUnit = (unit: string) => (unit === 'ea.' ? ' ea.' : unit === 'rolls' ? '/roll' : `/${unit}`);
const qtyN = (n: number, unit: string) => `${Math.round(n).toLocaleString('en-US')} ${unit}`;

/**
 * Priced rows for the framing sheet: the material for walls, ceilings, roofs, and decks,
 * with their sheathing and connectors. The house floor, its beams, the deck and porch
 * beams, and the subfloor are priced on A-103 and left out here.
 */
export function framingCostRows(design: Design): CostRow[] {
  const model = frameModel(design);
  const t = takeoff(design, model);
  const mine = t.buy.filter((l) => l.pricedOn === 'S-602');
  const rows: CostRow[] = [];
  const lumber = (item: string, lines: BuyLine[]) => {
    const feet = lines.reduce((s, l) => s + l.lf, 0);
    const cost = lines.reduce((s, l) => s + buyLineCost(l), 0);
    if (feet > 0) rows.push({ item, qty: qtyN(feet, 'LF'), rate: `${usd2(cost / feet)}/LF avg.`, cost });
  };
  const sawn = (l: BuyLine) => l.material === 'SYP' || l.material === 'PT';
  for (const trade of ['walls', 'roof', 'platforms'] as Trade[]) {
    lumber(`${TRADE_NAMES[trade]} lumber`, mine.filter((l) => l.trade === trade && sawn(l)));
  }
  lumber('LVL headers, ridge beams, and ceiling beam', mine.filter((l) => l.material === 'LVL'));
  lumber('Composite deck boards and stair treads', mine.filter((l) => l.material === 'COMP'));
  for (const sh of t.sheets.filter((q) => q.pricedOn === 'S-602')) {
    const n = sh.sheets + sh.extra;
    rows.push({ item: sh.item, qty: qtyN(n, 'sheets'), rate: `${formatUsd(sheetRate(sh.kind))} ea.`, cost: n * sheetRate(sh.kind) });
  }
  const hw = model.hardware.filter((h) => h.pricedOn === 'S-602');
  const hwCost = hw.reduce((s, h) => s + h.count * hardwareRate(h.key), 0);
  rows.push({ item: 'Connectors, hangers, and anchors', qty: qtyN(hw.reduce((s, h) => s + h.count, 0), 'ea.'), rate: 'See hardware', cost: hwCost });
  const materials = rows.reduce((s, r) => s + r.cost, 0) - hwCost;
  rows.push({ item: 'Nails, screws, and adhesive', qty: 'Allowance', rate: `${Math.round(FASTENER_SHARE * 100)}% of material`, cost: materials * FASTENER_SHARE });
  return roundRows(rows);
}

// ---------------------------------------------------------------- roofing (S-602)

/** Material costs for the roofing, by the unit each item is measured in. Panel clips are priced with the panels. */
const ROOFING_RATES: Record<string, number> = {
  panels: 4.75,
  clips: 0,
  underlayment: 130,
  ridge: 6.5,
  eave: 3.5,
  rake: 3.5,
  wall: 5,
  gutter: 4.5,
  downspout: 3.5,
  boot: 90,
};

export function roofingCostRows(design: Design): CostRow[] {
  return roundRows(
    roofingTakeoff(design)
      .filter((i) => (ROOFING_RATES[i.key] ?? 0) > 0)
      .map((i) => ({
        item: i.key === 'panels' ? 'Standing seam panels with clips' : i.item,
        qty: qtyN(i.qty, i.unit),
        rate: `${money(ROOFING_RATES[i.key])}${perUnit(i.unit)}`,
        cost: i.qty * ROOFING_RATES[i.key],
      })),
  );
}

// ---------------------------------------------------------------- envelope (A-602)

/** Material costs for the exterior envelope, by the unit each item is measured in. */
const ENVELOPE_RATES: Record<string, number> = {
  siding: 3.2,
  battens: 0.85,
  furring: 0.55,
  base: 2,
  wrap: 170,
  tape: 0.9,
  pans: 22,
  head: 2.5,
  ledger: 2.5,
  walls: 1.15,
  attic: 1.1,
  vault: 4.2,
  corner: 2.2,
  casing: 1.6,
  fascia: 3,
  rake: 3,
  frieze: 2.2,
  soffit: 3.5,
};

export function envelopeCostRows(design: Design): CostRow[] {
  return roundRows(
    envelopeTakeoff(design)
      .items.filter((i) => (ENVELOPE_RATES[i.key] ?? 0) > 0)
      .map((i) => ({ item: i.item, qty: qtyN(i.qty, i.unit), rate: `${money(ENVELOPE_RATES[i.key])}${perUnit(i.unit)}`, cost: i.qty * ENVELOPE_RATES[i.key] })),
  );
}

// ---------------------------------------------------------------- schedules and the summary

/** Costs of the items scheduled on A-601, as that sheet lists them. */
export function scheduleCosts(design: Design) {
  const doors = design.openings.filter((o) => o.kind !== 'window').map((o) => openingCost(design, o));
  const windows = design.openings.filter((o) => o.kind === 'window').map((o) => openingCost(design, o));
  const finishes = design.rooms.map((r) => roomFinishCost(design, r).total);
  // Closet rods are too small to schedule.
  const fixtures = design.fixtures.filter((f) => f.kind !== 'closet-rod').map(fixtureCost);
  return {
    doors: sumCosts(doors),
    windows: sumCosts(windows),
    finishes: sumCosts(finishes),
    fixtures: sumCosts(fixtures),
    total: sumCosts([...doors, ...windows, ...finishes, ...fixtures]),
  };
}

export type SummaryRow = { item: string; sheet: string; basis: string; cost: number; part: 'building' | 'site' };

/** Every estimate in the set, once each, with the sheet that itemizes it. */
export function estimateSummary(design: Design): { rows: SummaryRow[]; building: number; site: number; total: number; perSf: number } {
  const sum = (rows: CostRow[]) => rows.reduce((s, r) => s + r.cost, 0);
  const sc = scheduleCosts(design);
  const s = designSummary(design);
  const t = takeoff(design, frameModel(design));
  const env = envelopeTakeoff(design);
  const sided = env.faces.reduce((a, f) => a + f.net, 0);
  const roof = roofingTakeoff(design).find((i) => i.key === 'panels')?.qty ?? 0;
  const b = 'building' as const;
  const all: SummaryRow[] = [
    { part: b, item: 'Foundation, floor framing, and garage slab', sheet: 'A-103', basis: `${qtySf(s.gross)} of floor on piers; ${qtySf(s.garageArea)} slab`, cost: sum(foundationCostRows(design)) },
    { part: b, item: 'Framing: walls, ceilings, roofs, deck, and porch', sheet: 'S-602', basis: `${t.totals.pieces.toLocaleString('en-US')} pieces, with sheathing and connectors`, cost: sum(framingCostRows(design)) },
    { part: b, item: 'Roofing, gutters, and downspouts', sheet: 'S-602', basis: `${qtyN(roof, 'SF')} of standing seam roof`, cost: sum(roofingCostRows(design)) },
    { part: b, item: 'Exterior envelope: siding, barrier, insulation, and trim', sheet: 'A-602', basis: `${qtySf(sided)} of siding`, cost: sum(envelopeCostRows(design)) },
    { part: b, item: 'Doors and windows', sheet: 'A-601', basis: `${design.openings.length} units`, cost: sc.doors + sc.windows },
    { part: b, item: 'Interior finishes', sheet: 'A-601', basis: `${design.rooms.length} rooms`, cost: sc.finishes },
    { part: b, item: 'Fixtures, cabinets, and equipment', sheet: 'A-601', basis: 'Built-in items; furniture is by the owner', cost: sc.fixtures },
    { part: 'site', item: 'Boat dock', sheet: 'A-100', basis: 'Open dock with a slip and gangway', cost: sum(dockCostRows(design)) },
  ];
  const rows = all.filter((r) => r.cost > 0);
  const part = (p: SummaryRow['part']) => rows.filter((r) => r.part === p).reduce((a, r) => a + r.cost, 0);
  const building = part('building');
  const total = building + part('site');
  // The cost per square foot leaves the dock out, so it compares with other houses.
  return { rows, building, site: part('site'), total, perSf: s.gross ? building / sf(s.gross) : 0 };
}
