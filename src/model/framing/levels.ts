import type { Design, Zone } from '../schema';
import { garageRoofFrame, PLATFORM_TOP, roofFrame, type RoofFrame } from '../geometry';
import { DRESSED, type Lvl } from './lumber';

/** Levels and sizes of a roof's framing. Heights are above the house finished floor. */
export type RoofFraming = {
  rf: RoofFrame;
  rafter: string;
  /** Rafter depth, square to the slope. */
  d: number;
  cos: number;
  /** Roof slope in degrees. */
  angle: number;
  /** Rafter depth measured plumb. */
  tv: number;
  ridge: Lvl;
  /** Half the width of the built-up ridge beam. */
  half: number;
  ridgeTop: number;
  ridgeBottom: number;
  /** Top of the rafters at a point across the ridge. */
  topAt: (s: number) => number;
};

export function roofFraming(design: Design, zone: Zone | undefined): RoofFraming | null {
  const rf = zone === 'garage' ? garageRoofFrame(design) : roofFrame(design);
  if (!rf) return null;
  const rafter = design.framing.roof.rafter;
  const d = DRESSED[rafter].d;
  const cos = 1 / Math.hypot(1, rf.slope);
  const tv = d / cos;
  const ridge = zone === 'garage' ? design.framing.garage.ridge : design.framing.roof.ridge;
  const half = (ridge.plies * ridge.thickness) / 2;
  // The ridge beam's top corners sit in the plane of the rafter tops.
  const ridgeTop = rf.undersideAt(rf.ridgeS - half) + tv;
  return {
    rf, rafter, d, cos, tv, ridge, half, ridgeTop,
    angle: (Math.atan(rf.slope) * 180) / Math.PI,
    ridgeBottom: ridgeTop - ridge.depth,
    topAt: (s: number) => rf.undersideAt(s) + tv,
  };
}

/** House floor framing levels, relative to the finished floor. */
export function floorLevels(design: Design) {
  const f = design.framing.floor;
  const joistTop = -f.subfloor.thickness;
  const joistBottom = joistTop - DRESSED[f.joist].d;
  return { joistTop, joistBottom, beamTop: joistBottom, beamBottom: joistBottom - DRESSED[f.beam.size].d };
}

/** Concrete footing under each deck and porch post, above grade. */
export const PLATFORM_FOOTING = 8;

/** Deck and porch framing levels, relative to the house finished floor. */
export function platformLevels(design: Design) {
  const f = design.framing.platforms;
  const joistTop = PLATFORM_TOP - f.decking.thickness;
  const joistBottom = joistTop - DRESSED[f.joist].d;
  const beamBottom = joistBottom - DRESSED[f.beam.size].d;
  return {
    top: PLATFORM_TOP,
    joistTop,
    joistBottom,
    beamTop: joistBottom,
    beamBottom,
    footingTop: -design.levels.floorHeight + PLATFORM_FOOTING,
    grade: -design.levels.floorHeight,
  };
}
