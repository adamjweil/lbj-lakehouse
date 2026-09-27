import type { Design } from '../schema';
import { envelopeTakeoff } from '../envelope';
import { roofingTakeoff } from '../roofing';
import { formatFrac } from '../units';
import { frameModel } from './index';
import { MATERIAL_NAMES, roundCut } from './lumber';
import { headerLabel } from './openings';
import { solidBounds } from './solid';
import { stockLabel, takeoff, TRADE_NAMES } from './takeoff';

type Cell = string | number;

const quote = (c: Cell) => {
  const s = typeof c === 'number' ? String(Math.round(c * 1000) / 1000) : c;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (rows: Cell[][]) => rows.map((r) => r.map(quote).join(',')).join('\n') + '\n';

/** The takeoff as CSV files, keyed by file name. Lengths are in inches. */
export function takeoffCsv(design: Design): Record<string, string> {
  const model = frameModel(design);
  const t = takeoff(design, model);
  return {
    'cut-list.csv': toCsv([
      ['Mark', 'Piece', 'Size', 'Material', 'Length (in.)', 'Length', 'Count', 'Cut', 'Where', 'Priced on'],
      ...t.cuts.map((c) => [
        c.mark, c.roles.join(' / '), c.size, MATERIAL_NAMES[c.material], c.length, formatFrac(c.length), c.count, c.cut,
        c.where.map((w) => `${w.group} (${w.count})`).join('; '), c.pricedOn,
      ]),
    ]),
    'buy-list.csv': toCsv([
      ['Trade', 'Size', 'Material', 'Stock', 'Sticks for the cuts', 'Extra for waste', 'Buy', 'Linear feet', 'Board feet', 'Yield', 'Priced on'],
      ...t.buy.map((b) => [
        TRADE_NAMES[b.trade], b.size, MATERIAL_NAMES[b.material], stockLabel(b), b.count, b.extra, b.count + b.extra, b.lf, b.bf,
        `${Math.round(b.yield * 100)}%`, b.pricedOn,
      ]),
    ]),
    'pieces.csv': toCsv([
      ['Id', 'Mark', 'Assembly', 'Piece', 'Size', 'Material', 'Length (in.)', 'Cut', 'x0', 'y0', 'z0', 'x1', 'y1', 'z1', 'Note'],
      ...model.members.map((m) => {
        const b = solidBounds(m);
        return [m.id, m.mark, m.group, m.role, m.size, MATERIAL_NAMES[m.material], roundCut(m.length), m.cut, b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z, m.note ?? ''];
      }),
    ]),
    'rough-openings.csv': toCsv([
      ['Tag', 'Wall', 'Unit width', 'Unit height', 'Rough width', 'Rough height', 'Rough sill', 'Header underside', 'Header', 'Header length', 'Jacks each side', 'Kings each side', 'Bearing wall'],
      ...model.openings.map((r) => [
        r.opening.tag, r.wall.id, r.opening.width, r.opening.height, r.w, r.h, r.sill, r.head, headerLabel(r.header), r.header.length, r.jacks, 1, r.bearing ? 'yes' : 'no',
      ]),
    ]),
    'sheet-goods.csv': toCsv([
      ['Item', 'Net area (SF)', 'Sheets', 'Extra for waste', 'Buy', 'Priced on'],
      ...t.sheets.map((s) => [s.item, s.area, s.sheets, s.extra, s.sheets + s.extra, s.pricedOn]),
    ]),
    'hardware.csv': toCsv([['Item', 'Use', 'Count', 'Priced on'], ...model.hardware.map((h) => [h.item, h.use, h.count, h.pricedOn])]),
    'roofing.csv': toCsv([['Item', 'Quantity', 'Unit', 'Note'], ...roofingTakeoff(design).map((r) => [r.item, r.qty, r.unit, r.note])]),
    'envelope.csv': toCsv([
      ['Group', 'Item', 'Quantity', 'Unit', 'Note'],
      ...envelopeTakeoff(design).items.map((i) => [i.group, i.item, i.qty, i.unit, i.note]),
    ]),
  };
}

/** The whole takeoff as one JSON document. */
export function takeoffJson(design: Design) {
  const model = frameModel(design);
  const t = takeoff(design, model);
  return {
    project: design.meta.project,
    revision: design.meta.revisions.at(-1)?.rev ?? 0,
    units: 'inches',
    note: 'Preliminary takeoff for budgeting. Not for construction; sizes and connections by the engineer.',
    totals: t.totals,
    assemblies: t.counts,
    cutList: t.cuts,
    buyList: t.buy,
    sheetGoods: t.sheets,
    hardware: model.hardware,
    roughOpenings: model.openings.map((r) => ({
      tag: r.opening.tag, wall: r.wall.id, width: r.w, height: r.h, sill: r.sill, head: r.head, header: headerLabel(r.header), headerLength: r.header.length,
      jacks: r.jacks, bearing: r.bearing,
    })),
    roofing: roofingTakeoff(design),
    envelope: envelopeTakeoff(design).items,
    pieces: model.members.map((m) => ({ id: m.id, mark: m.mark, group: m.group, role: m.role, size: m.size, material: m.material, length: roundCut(m.length), cut: m.cut, note: m.note })),
  };
}
