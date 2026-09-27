import type { Design } from '../schema';
import { formatFrac } from '../units';

/**
 * The `specs` phrases are the printed wording; the `framing` numbers drive the geometry.
 * These are the phrases the numbers call for, used to derive notes and to warn when
 * a printed phrase states a different size, count, spacing, or thickness.
 */

const oc = (spacing: number) => `@ ${formatFrac(spacing)} o.c.`;

export function framingPhrases(design: Design) {
  const f = design.framing;
  const pt = f.floor.treated ? ' P.T.' : '';
  return {
    foundation: {
      beams: `(${f.floor.beam.plies}) ${f.floor.beam.size}${pt} built-up beams`,
      joists: `${f.floor.joist}${pt} floor joists ${oc(f.floor.spacing)}`,
      subfloor: `${formatFrac(f.floor.subfloor.thickness)} T&G plywood subfloor, glued and screwed`,
    },
    framing: {
      exteriorWalls: `${f.walls.exterior.stud} studs ${oc(f.walls.exterior.spacing)}`,
      interiorWalls: `${f.walls.interior.stud} studs ${oc(f.walls.interior.spacing)}`,
      sheathing: `${formatFrac(f.walls.sheathing.thickness)} OSB structural wall sheathing`,
      headers: `(${f.openings.header.plies}) ${f.openings.header.size} headers, or LVL where noted by the engineer`,
      rafters: `${f.roof.rafter} rafters ${oc(f.roof.spacing)}`,
    },
    roof: {
      sheathing: `${formatFrac(f.roof.sheathing.thickness)} plywood roof sheathing`,
    },
  };
}

/** Deck and porch framing, for the section's assembly note. */
export const platformPhrase = (design: Design) =>
  `Composite decking on ${design.framing.platforms.joist} P.T. joists ${oc(design.framing.platforms.spacing)}`;

/** The numbers a phrase states: sizes, ply counts, spacings, and a leading thickness. */
function stated(phrase: string) {
  const thickness = phrase.match(/^\s*(\d+(?:-\d+\/\d+|\/\d+)?)"/);
  return {
    size: phrase.match(/\b(\d+x\d+)\b/)?.[1],
    plies: phrase.match(/\((\d+)\)/)?.[1],
    spacing: phrase.match(/@\s*(\d+(?:\.\d+)?)"/)?.[1],
    thickness: thickness?.[1],
  };
}

export type SpecMismatch = { path: string; actual: string; expected: string };

/** Printed phrases that state different numbers than the framing model uses. */
export function specMismatches(design: Design): SpecMismatch[] {
  const want = framingPhrases(design);
  const out: SpecMismatch[] = [];
  for (const [group, phrases] of Object.entries(want)) {
    for (const [key, expected] of Object.entries(phrases)) {
      const actual = (design.specs as Record<string, Record<string, string>>)[group]?.[key];
      if (actual === undefined) continue;
      const a = stated(actual);
      const e = stated(expected);
      const differs = (Object.keys(e) as (keyof typeof e)[]).some((k) => a[k] !== undefined && e[k] !== undefined && a[k] !== e[k]);
      if (differs) out.push({ path: `specs.${group}.${key}`, actual, expected });
    }
  }
  return out;
}
