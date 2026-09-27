import type { Design, Zone } from './schema';
import { garageHouseSide, roofFrames, type RoofFrame } from './geometry';

/**
 * Roofing quantities, measured from the roof frames: metal panels and their clips,
 * underlayment, trim, flashing, gutters, and downspouts.
 */

export type RoofingItem = {
  key: string;
  item: string;
  qty: number;
  unit: 'SF' | 'LF' | 'ea.' | 'rolls';
  note: string;
};

export type RoofSurface = {
  zone?: Zone;
  title: string;
  frame: RoofFrame;
  /** Length along the ridge, with the rake overhangs. */
  length: number;
  /** Eave to ridge, measured up the slope, for the low and the high slope. */
  slopes: [number, number];
  /** Area of both slopes. */
  area: number;
  /** Eaves that overhang a wall (the others meet the house). */
  freeEaves: number;
  freeRakes: number;
};

/** Clip spacing along each standing seam. */
const CLIP_SPACING = 24;
/** Coverage of one roll of self-adhered underlayment, with its laps. */
const ROLL_SF = 185;
const DOWNSPOUTS_PER_EAVE = 2;

export function roofSurfaces(design: Design): RoofSurface[] {
  const against = garageHouseSide(design);
  return roofFrames(design).map(({ zone, frame: rf }) => {
    const k = Math.hypot(1, rf.slope);
    const slopes: [number, number] = [(rf.ridgeS - rf.eave0) * k, (rf.eave1 - rf.ridgeS) * k];
    const length = rf.a1 - rf.a0;
    const eaves = rf.axis === 'x' ? ['north', 'south'] : ['west', 'east'];
    const rakes = rf.axis === 'x' ? ['west', 'east'] : ['north', 'south'];
    const meets = (side: string) => zone === 'garage' && side === against;
    return {
      zone,
      title: zone === 'garage' ? 'Garage roof' : 'House roof',
      frame: rf,
      length,
      slopes,
      area: length * (slopes[0] + slopes[1]),
      freeEaves: eaves.filter((s) => !meets(s)).length,
      freeRakes: rakes.filter((s) => !meets(s)).length,
    };
  });
}

export function roofingTakeoff(design: Design): RoofingItem[] {
  const roofs = roofSurfaces(design);
  const seam = design.roof.seamSpacing;
  const sf = (sqIn: number) => sqIn / 144;
  const lf = (inches: number) => inches / 12;
  const area = roofs.reduce((s, r) => s + r.area, 0);
  let panels = 0;
  let panelLf = 0;
  let clips = 0;
  let eave = 0;
  let rake = 0;
  let wall = 0;
  let ridge = 0;
  let downspouts = 0;
  let downspoutLf = 0;
  for (const r of roofs) {
    const perSlope = Math.ceil(r.length / seam - 1e-9);
    for (const slope of r.slopes) {
      panels += perSlope;
      panelLf += perSlope * slope;
      // One more seam than panels on each slope, clipped from eave to ridge.
      clips += (perSlope + 1) * (Math.ceil(slope / CLIP_SPACING) + 1);
    }
    ridge += r.length;
    eave += r.freeEaves * r.length;
    const slopeSum = r.slopes[0] + r.slopes[1];
    rake += r.freeRakes * slopeSum;
    wall += (2 - r.freeRakes) * slopeSum + (2 - r.freeEaves) * r.length;
    downspouts += r.freeEaves * DOWNSPOUTS_PER_EAVE;
    downspoutLf += r.freeEaves * DOWNSPOUTS_PER_EAVE * (r.frame.eaveUnder + design.levels.floorHeight);
  }
  const stove = design.fixtures.some((f) => f.kind === 'stove');
  const items: RoofingItem[] = [
    { key: 'panels', item: 'Standing seam panels', qty: sf(area), unit: 'SF', note: `${panels} panels at ${seam}" coverage, ${Math.round(lf(panelLf))} LF in all, cut to the slope length` },
    { key: 'clips', item: 'Concealed panel clips', qty: clips, unit: 'ea.', note: `${CLIP_SPACING}" o.c. along every seam; spacing by the panel maker for the wind zone` },
    { key: 'underlayment', item: 'Self-adhered underlayment', qty: Math.ceil(sf(area) / ROLL_SF), unit: 'rolls', note: `${Math.round(sf(area))} SF of roof at ${ROLL_SF} SF to the roll` },
    { key: 'ridge', item: 'Ridge cap with closures', qty: lf(ridge), unit: 'LF', note: 'Both roofs' },
    { key: 'eave', item: 'Eave trim and drip edge', qty: lf(eave), unit: 'LF', note: 'Along every gutter' },
    { key: 'rake', item: 'Rake trim', qty: lf(rake), unit: 'LF', note: 'Up both slopes at each open gable end' },
    { key: 'wall', item: 'Sidewall flashing with counterflashing', qty: lf(wall), unit: 'LF', note: 'Where the garage roof meets the house wall' },
    { key: 'gutter', item: 'Gutters', qty: lf(eave), unit: 'LF', note: 'At the eaves' },
    { key: 'downspout', item: 'Downspouts', qty: lf(downspoutLf), unit: 'LF', note: `${downspouts} downspouts from the eave to grade` },
    { key: 'boot', item: 'Flue flashing boot', qty: stove ? 1 : 0, unit: 'ea.', note: 'At the wood stove flue' },
  ];
  return items.filter((i) => i.qty > 0);
}
