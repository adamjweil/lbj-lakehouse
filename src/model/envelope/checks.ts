import type { Design } from '../schema';
import { formatFrac } from '../units';
import type { Issue } from '../validate';
import { wallFaces } from './faces';

const rValue = (s: string) => s.match(/R-(\d+)/)?.[1];

/** Checks on the envelope: clearances, and the printed specs against the envelope numbers. */
export function validateEnvelope(design: Design): Issue[] {
  const issues: Issue[] = [];
  const e = design.envelope;
  const low = wallFaces(design).filter((f) => f.clearance < e.siding.clearance - 0.01);
  const zones = [...new Set(low.map((f) => (f.zone === 'garage' ? 'garage' : 'house')))];
  for (const zone of zones) {
    const list = low.filter((f) => (f.zone === 'garage' ? 'garage' : 'house') === zone);
    issues.push({
      level: 'warning',
      code: 'siding-clearance',
      message: `The ${zone} walls (${list.map((f) => f.wall.id).join(', ')}) start ${formatFrac(list[0].clearance)} above grade; hold the siding ${formatFrac(e.siding.clearance)} clear of the ground, on a concrete curb or with the grade cut down`,
    });
  }
  const pairs: [string, string, string][] = [
    ['specs.framing.wallInsulation', design.specs.framing.wallInsulation, e.insulation.walls],
    ['specs.roof.insulation', design.specs.roof.insulation, e.insulation.vault],
  ];
  for (const [path, printed, want] of pairs) {
    if (rValue(printed) && rValue(want) && rValue(printed) !== rValue(want)) {
      issues.push({ level: 'warning', code: 'spec-mismatch', message: `${path} reads "${printed}", but the envelope numbers call for "${want}"` });
    }
  }
  return issues;
}
