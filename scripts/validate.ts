import fs from 'node:fs';
import { parseDesignText } from '../src/model/schema';
import { validateDesign } from '../src/model/validate';
import { designSummary } from '../src/model/geometry';
import { formatFtIn, formatSqft } from '../src/model/units';
import { frameModel } from '../src/model/framing';
import { validateFraming } from '../src/model/framing/checks';
import { validateEnvelope } from '../src/model/envelope';

/** Usage: npm run validate [path]  (defaults to design/house.json) */
const file = process.argv[2] ?? 'design/house.json';
const r = parseDesignText(fs.readFileSync(file, 'utf8'));
if (!r.ok) {
  console.error(`✗ ${file} does not match the schema:`);
  for (const e of r.errors) console.error(`  - ${e}`);
  process.exit(1);
}
const d = r.design;
const s = designSummary(d);
console.log(`${d.meta.project} — rev ${d.meta.revisions.at(-1)?.rev ?? 0}`);
console.log(`  footprint ${formatFtIn(s.width)} x ${formatFtIn(s.depth)} · ${formatSqft(s.gross)} gross · ${formatSqft(s.net)} net · deck ${formatSqft(s.deckArea)}${s.porchArea ? ` · porch ${formatSqft(s.porchArea)}` : ''}${s.garageArea ? ` · garage ${formatSqft(s.garageArea)}` : ''}`);
for (const room of s.rooms) {
  console.log(`  ${room.room.name.padEnd(18)} ${`${formatFtIn(room.width, 1)} x ${formatFtIn(room.depth, 1)}`.padEnd(20)} ${formatSqft(room.area)}`);
}
console.log(`  ridge ${formatFtIn(s.ridgeAboveGrade)} above grade`);
const issues = validateDesign(d);
const icon = { error: '✗', warning: '!', info: '·' } as const;
for (const i of issues) console.log(`${icon[i.level]} [${i.level}] ${i.message}${i.ref ? `  (${i.ref.kind} ${i.ref.id})` : ''}`);
const errors = issues.filter((i) => i.level === 'error').length;
const warnings = issues.filter((i) => i.level === 'warning').length;
console.log(errors ? `✗ ${errors} error(s), ${warnings} warning(s)` : `✓ no errors, ${warnings} warning(s)`);

// Framing questions are for the engineer; they never fail the check.
const framing = [...validateFraming(d), ...validateEnvelope(d)];
const model = frameModel(d);
console.log(`\nFraming: ${model.members.length.toLocaleString('en-US')} pieces, ${model.panels.length} sheathing panels`);
for (const i of framing) console.log(`${icon[i.level]} [${i.level}] ${i.message}${i.ref ? `  (${i.ref.kind} ${i.ref.id})` : ''}`);
console.log(`${framing.filter((i) => i.level === 'warning').length} framing and envelope item(s) to resolve with the engineer`);
process.exit(errors ? 1 : 0);
