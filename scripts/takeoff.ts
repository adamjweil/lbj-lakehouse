import fs from 'node:fs';
import path from 'node:path';
import { parseDesignText } from '../src/model/schema';
import { envelopeCostRows, estimateSummary, formatUsd, framingCostRows, roofingCostRows } from '../src/model/costs';
import { envelopeTakeoff } from '../src/model/envelope';
import { frameModel } from '../src/model/framing';
import { validateFraming } from '../src/model/framing/checks';
import { takeoffCsv, takeoffJson } from '../src/model/framing/csv';
import { MATERIAL_NAMES } from '../src/model/framing/lumber';
import { headerLabel } from '../src/model/framing/openings';
import { stockLabel, takeoff, TRADE_NAMES } from '../src/model/framing/takeoff';
import { roofingTakeoff } from '../src/model/roofing';
import { formatFrac } from '../src/model/units';

/**
 * Prints the framing takeoff and, on request, writes it to files.
 *   npm run takeoff                       summary, buy list, sheet goods, hardware, roofing, envelope, costs
 *   npm run takeoff -- --cuts             also the cut list
 *   npm run takeoff -- --csv out/takeoff  write the CSV files to a folder
 *   npm run takeoff -- --json out/t.json  write everything as JSON
 *   npm run takeoff -- path/to/house.json use another design
 */
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? null : args[i + 1] ?? '';
};
const csvDir = flag('--csv');
const jsonFile = flag('--json');
const file = args.find((a, i) => !a.startsWith('--') && !['--csv', '--json'].includes(args[i - 1] ?? '')) ?? 'design/house.json';

const r = parseDesignText(fs.readFileSync(file, 'utf8'));
if (!r.ok) {
  console.error(`✗ ${file} does not match the schema:`);
  for (const e of r.errors) console.error(`  - ${e}`);
  process.exit(1);
}
const d = r.design;
const model = frameModel(d);
const t = takeoff(d, model);
const n = (v: number) => Math.round(v).toLocaleString('en-US');
const head = (s: string) => console.log(`\n${s}\n${'-'.repeat(s.length)}`);

console.log(`${d.meta.project} — rev ${d.meta.revisions.at(-1)?.rev ?? 0} — framing takeoff (preliminary, not for construction)`);
console.log(`${n(t.totals.pieces)} pieces · ${n(t.totals.sticks)} sticks to buy · ${n(t.totals.lf)} LF · ${n(t.totals.bf)} BF of sawn lumber`);

head('Pieces by assembly');
for (const c of t.counts) console.log(`  ${c.title.padEnd(18)} ${String(c.pieces).padStart(5)}`);

if (args.includes('--cuts')) {
  head('Cut list');
  for (const c of t.cuts) {
    console.log(`  ${c.mark.padEnd(6)} ${String(c.count).padStart(4)} x ${c.size.padEnd(22)} ${MATERIAL_NAMES[c.material].padEnd(11)} ${formatFrac(c.length).padStart(10)}  ${c.roles.join(' / ')}${c.cut === 'Square' ? '' : `  [${c.cut}]`}`);
  }
}

head('Buy list (with the waste allowance)');
let trade = '';
for (const b of t.buy) {
  if (TRADE_NAMES[b.trade] !== trade) {
    trade = TRADE_NAMES[b.trade];
    console.log(`  ${trade}`);
  }
  console.log(`    ${String(b.count + b.extra).padStart(4)} x ${b.size.padEnd(22)} ${MATERIAL_NAMES[b.material].padEnd(11)} ${stockLabel(b).padEnd(20)} ${n(b.lf).padStart(6)} LF  priced on ${b.pricedOn}`);
}

head('Sheet goods');
for (const s of t.sheets) console.log(`  ${String(s.sheets + s.extra).padStart(4)} sheets  ${s.item}  (${n(s.area)} SF net, ${s.sheets} + ${s.extra} for waste; priced on ${s.pricedOn})`);

head('Rough openings');
for (const o of model.openings) {
  console.log(`  ${o.opening.tag.padEnd(4)} wall ${o.wall.id.padEnd(3)} ${`${formatFrac(o.w)} x ${formatFrac(o.h)}`.padEnd(22)} header ${headerLabel(o.header).padEnd(28)} ${formatFrac(o.header.length).padStart(9)}  ${o.jacks} jack${o.jacks > 1 ? 's' : ''} + 1 king each side`);
}

head('Connectors and anchors');
for (const h of model.hardware) console.log(`  ${String(h.count).padStart(4)}  ${h.item.padEnd(38)} ${h.use}`);

head('Roofing');
for (const i of roofingTakeoff(d)) console.log(`  ${n(i.qty).padStart(6)} ${i.unit.padEnd(6)} ${i.item.padEnd(40)} ${i.note}`);

head('Exterior envelope');
for (const i of envelopeTakeoff(d).items) console.log(`  ${n(i.qty).padStart(6)} ${i.unit.padEnd(6)} ${i.item.padEnd(46)} ${i.note}`);

const costs = [
  ['Framing material cost (priced on S-602)', framingCostRows(d)],
  ['Roofing material cost (priced on S-602)', roofingCostRows(d)],
  ['Envelope material cost (priced on A-602)', envelopeCostRows(d)],
] as const;
for (const [title, rows] of costs) {
  head(title);
  for (const row of rows) console.log(`  ${row.item.padEnd(52)} ${row.qty.padStart(12)}  ${row.rate.padStart(16)}  ${formatUsd(row.cost).padStart(9)}`);
  console.log(`  ${'Subtotal'.padEnd(52)} ${''.padStart(12)}  ${''.padStart(16)}  ${formatUsd(rows.reduce((s, x) => s + x.cost, 0)).padStart(9)}`);
}

head('Material estimate summary (G-002)');
const summary = estimateSummary(d);
for (const row of summary.rows) console.log(`  ${row.sheet.padEnd(6)} ${row.item.padEnd(58)} ${formatUsd(row.cost).padStart(10)}`);
console.log(`  ${''.padEnd(6)} ${'Building'.padEnd(58)} ${formatUsd(summary.building).padStart(10)}  (${formatUsd(summary.perSf)} per conditioned SF)`);
console.log(`  ${''.padEnd(6)} ${'Total material cost'.padEnd(58)} ${formatUsd(summary.total).padStart(10)}`);

const issues = validateFraming(d).filter((i) => i.level === 'warning');
console.log(`\n${issues.length} framing item(s) for the engineer (npm run validate lists them).`);
console.log('Material costs only, with no labor. Rates are placeholders until replaced with supplier quotes.');

if (csvDir !== null) {
  const dir = path.resolve(csvDir || 'takeoff');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(takeoffCsv(d))) fs.writeFileSync(path.join(dir, name), text);
  console.log(`CSV files written to ${path.relative(process.cwd(), dir) || '.'}/`);
}
if (jsonFile !== null) {
  const out = path.resolve(jsonFile || 'takeoff.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(takeoffJson(d), null, 2));
  console.log(`JSON written to ${path.relative(process.cwd(), out)}`);
}
