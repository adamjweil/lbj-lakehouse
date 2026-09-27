import type { Design } from '../schema';
import { formatFrac, formatFtIn } from '../units';
import { boardFeet, MATERIAL_NAMES, orderLength, roundCut, stockFor, type Material } from './lumber';
import { sheetCount } from './sheathing';
import type { FrameModel, Member, Panel, PricedOn, Role, SheathingKind, System } from './types';

/** Where the lumber is used, which is also how it is ordered and priced. */
export type Trade = 'walls' | 'roof' | 'platforms' | 'floor';

export const TRADE_NAMES: Record<Trade, string> = {
  floor: 'Floor framing',
  walls: 'Wall framing',
  roof: 'Ceiling and roof framing',
  platforms: 'Deck and porch framing',
};

const TRADE: Record<System, Trade> = { wall: 'walls', floor: 'floor', ceiling: 'roof', roof: 'roof', platform: 'platforms' };
export const tradeOf = (m: Member): Trade => TRADE[m.system];

// ---------------------------------------------------------------- cut list

export type CutLine = {
  mark: string;
  roles: Role[];
  size: string;
  material: Material;
  length: number;
  cut: string;
  count: number;
  /** Assemblies that use the piece, with the count in each. */
  where: { group: string; count: number }[];
  pricedOn: PricedOn;
};

const bySize = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** Every distinct piece, with how many to cut and where they go. */
export function cutList(model: FrameModel): CutLine[] {
  const lines = new Map<string, CutLine>();
  for (const m of model.members) {
    let l = lines.get(m.mark);
    if (!l) {
      l = { mark: m.mark, roles: [], size: m.size, material: m.material, length: roundCut(m.length), cut: m.cut, count: 0, where: [], pricedOn: m.pricedOn };
      lines.set(m.mark, l);
    }
    l.count++;
    if (!l.roles.includes(m.role)) l.roles.push(m.role);
    const w = l.where.find((q) => q.group === m.group);
    if (w) w.count++;
    else l.where.push({ group: m.group, count: 1 });
  }
  return [...lines.values()].sort((a, b) => bySize(a.size, b.size) || a.material.localeCompare(b.material) || b.length - a.length || bySize(a.mark, b.mark));
}

// ---------------------------------------------------------------- stock

export type Stick = {
  trade: Trade;
  size: string;
  material: Material;
  pricedOn: PricedOn;
  /** Length bought. */
  stock: number;
  kind: 'stock' | 'precut' | 'order';
  cuts: { mark: string; length: number }[];
  /** Length used, with the saw kerfs. */
  used: number;
};

/** Studs cut from a precut stud: wall pieces this close under a precut length. */
const PRECUT_TRIM = 3;
const PRECUT_ROLES = new Set<Role>(['stud', 'end-stud', 'corner-nailer', 'king', 'post', 'jack', 'cripple']);

/**
 * Packs the pieces into the lengths the yard stocks. Each trade is packed on its own, the
 * way it is ordered. Pieces go longest first into the first stick with room; each stick is
 * then the shortest stock length that holds its cuts. LVL is ordered to length.
 */
export function packStock(design: Design, members: Member[]): Stick[] {
  const { stockLengths, studLengths, kerf } = design.framing.lumber;
  const max = Math.max(...stockLengths);
  const sticks: Stick[] = [];
  const groups = new Map<string, Member[]>();
  for (const m of members) {
    const key = [tradeOf(m), m.pricedOn, m.material, m.size].join('|');
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  for (const list of groups.values()) {
    const { size, material, pricedOn } = list[0];
    const base = { trade: tradeOf(list[0]), size, material, pricedOn };
    const open: Stick[] = [];
    for (const m of [...list].sort((a, b) => b.length - a.length)) {
      const length = roundCut(m.length);
      const cut = { mark: m.mark, length };
      if (material === 'LVL') {
        sticks.push({ ...base, stock: orderLength(length), kind: 'order', cuts: [cut], used: length });
        continue;
      }
      const precut = material === 'SYP' && PRECUT_ROLES.has(m.role) ? studLengths.find((s) => length <= s + 1e-6 && length > s - PRECUT_TRIM) : undefined;
      if (precut !== undefined) {
        sticks.push({ ...base, stock: precut, kind: 'precut', cuts: [cut], used: length });
        continue;
      }
      if (length > max + 1e-6) {
        // Longer than any stock: a special order, flagged by the framing checks.
        sticks.push({ ...base, stock: orderLength(length), kind: 'order', cuts: [cut], used: length });
        continue;
      }
      const stick = open.find((s) => s.used + kerf + length <= max + 1e-6);
      if (stick) {
        stick.cuts.push(cut);
        stick.used += kerf + length;
      } else {
        open.push({ ...base, stock: max, kind: 'stock', cuts: [cut], used: length });
      }
    }
    for (const s of open) s.stock = stockFor(stockLengths, s.used) ?? max;
    sticks.push(...open);
  }
  return sticks;
}

// ---------------------------------------------------------------- buy list

export type BuyLine = {
  trade: Trade;
  size: string;
  material: Material;
  pricedOn: PricedOn;
  stock: number;
  kind: Stick['kind'];
  /** Sticks the cuts need. */
  count: number;
  /** Extra sticks for waste, culls, and mistakes. */
  extra: number;
  /** Linear feet and board feet to buy, with the extra. */
  lf: number;
  bf: number;
  /** Share of the bought length that ends up in the building. */
  yield: number;
};

export function stockLabel(l: Pick<BuyLine, 'stock' | 'kind'>): string {
  if (l.kind === 'precut') return `${formatFrac(l.stock)} precut stud`;
  return `${Math.round(l.stock / 12)}'${l.kind === 'order' ? ' (order)' : ''}`;
}

/** What to buy: sticks by size and length for each trade, with the waste allowance added. */
export function buyList(design: Design, sticks: Stick[]): BuyLine[] {
  const lines = new Map<string, BuyLine & { used: number }>();
  for (const s of sticks) {
    const key = [s.trade, s.pricedOn, s.material, s.size, s.kind, s.stock].join('|');
    let l = lines.get(key);
    if (!l) {
      l = { trade: s.trade, size: s.size, material: s.material, pricedOn: s.pricedOn, stock: s.stock, kind: s.kind, count: 0, extra: 0, lf: 0, bf: 0, yield: 0, used: 0 };
      lines.set(key, l);
    }
    l.count++;
    l.used += s.cuts.reduce((sum, c) => sum + c.length, 0);
  }
  const out = [...lines.values()];
  // The waste allowance is added once for each size, to the length bought most.
  const sizes = new Map<string, typeof out>();
  for (const l of out) {
    if (l.kind === 'order') continue;
    const key = [l.trade, l.pricedOn, l.material, l.size].join('|');
    sizes.set(key, [...(sizes.get(key) ?? []), l]);
  }
  for (const list of sizes.values()) {
    const total = list.reduce((s, l) => s + l.count, 0);
    const most = [...list].sort((a, b) => b.count - a.count || b.stock - a.stock)[0];
    most.extra = Math.ceil(total * design.framing.lumber.waste - 1e-9);
  }
  const order: Trade[] = ['floor', 'walls', 'roof', 'platforms'];
  return out
    .map(({ used, ...l }) => {
      const n = l.count + l.extra;
      return { ...l, lf: (n * l.stock) / 12, bf: n * boardFeet(l.size, l.stock), yield: used / (n * l.stock) };
    })
    .sort((a, b) => order.indexOf(a.trade) - order.indexOf(b.trade) || a.material.localeCompare(b.material) || bySize(a.size, b.size) || a.stock - b.stock);
}

// ---------------------------------------------------------------- sheet goods

export type SheetLine = {
  kind: SheathingKind;
  item: string;
  /** Net area covered, in square feet. */
  area: number;
  /** Sheets the layout needs, and the extra for waste. */
  sheets: number;
  extra: number;
  pricedOn: PricedOn;
};

export function sheetGoods(design: Design, panels: Panel[]): SheetLine[] {
  const f = design.framing;
  const size = (p: { width: number; length: number }) => `${Math.round(p.width / 12)}' x ${Math.round(p.length / 12)}'`;
  const kinds: [SheathingKind, string][] = [
    ['subfloor', `${formatFrac(f.floor.subfloor.thickness)} T&G plywood subfloor, ${size(f.floor.subfloor)}`],
    ['wall', `${formatFrac(f.walls.sheathing.thickness)} OSB wall sheathing, ${size(f.walls.sheathing)}`],
    ['roof', `${formatFrac(f.roof.sheathing.thickness)} plywood roof sheathing, ${size(f.roof.sheathing)}`],
  ];
  return kinds
    .map(([kind, item]) => {
      const list = panels.filter((p) => p.kind === kind);
      const sheets = sheetCount(list);
      return {
        kind,
        item,
        area: list.reduce((s, p) => s + p.area, 0) / 144,
        sheets,
        extra: Math.ceil(sheets * f.lumber.sheetWaste - 1e-9),
        pricedOn: list[0]?.pricedOn ?? 'S-602',
      };
    })
    .filter((l) => l.sheets > 0);
}

// ---------------------------------------------------------------- summary

export type Takeoff = {
  cuts: CutLine[];
  sticks: Stick[];
  buy: BuyLine[];
  sheets: SheetLine[];
  /** Pieces by assembly. */
  counts: { group: string; title: string; pieces: number }[];
  totals: { pieces: number; lf: number; bf: number; sticks: number };
};

const cache = new WeakMap<FrameModel, Takeoff>();

export function takeoff(design: Design, model: FrameModel): Takeoff {
  const hit = cache.get(model);
  if (hit) return hit;
  const sticks = packStock(design, model.members);
  const buy = buyList(design, sticks);
  const t: Takeoff = {
    cuts: cutList(model),
    sticks,
    buy,
    sheets: sheetGoods(design, model.panels),
    counts: [
      ...model.walls.map((w) => ({ group: w.wall.id, title: `Wall ${w.wall.id}`, pieces: w.members.length })),
      ...model.assemblies.map((a) => ({ group: a.group, title: a.title, pieces: a.members.length })),
    ],
    totals: {
      pieces: model.members.length,
      lf: buy.reduce((s, l) => s + l.lf, 0),
      bf: buy.reduce((s, l) => s + l.bf, 0),
      sticks: buy.reduce((s, l) => s + l.count + l.extra, 0),
    },
  };
  cache.set(model, t);
  return t;
}

export const materialName = (m: Material) => MATERIAL_NAMES[m];
export const cutLength = (inches: number) => `${formatFrac(roundCut(inches))} (${formatFtIn(inches, 1 / 16)})`;
