import type { Design } from './schema';

/** Pretty JSON with points and number lists collapsed onto one line so house.json stays easy to read and edit. */
export function stringifyDesign(design: Design): string {
  return (
    JSON.stringify(design, null, 2)
      .replace(/\{\n\s+"x": (-?[\d.e+-]+),\n\s+"y": (-?[\d.e+-]+)\n\s+\}/g, '{ "x": $1, "y": $2 }')
      // Site trees: one per line.
      .replace(
        /\{\n\s+"x": (-?[\d.e+-]+),\n\s+"y": (-?[\d.e+-]+),\n\s+"species": ("[\w-]+"),\n\s+"height": (-?[\d.e+-]+),\n\s+"seed": (-?\d+)\n\s+\}/g,
        '{ "x": $1, "y": $2, "species": $3, "height": $4, "seed": $5 }',
      )
      // Lists of numbers (stock lengths): one line.
      .replace(/\[\n\s+(-?[\d.e+-]+(?:,\n\s+-?[\d.e+-]+)*)\n\s+\]/g, (_, list: string) => `[${list.split(/,\n\s+/).join(', ')}]`) + '\n'
  );
}
