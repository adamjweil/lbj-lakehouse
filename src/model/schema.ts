import { z } from 'zod';

/**
 * The house model. Everything is in INCHES.
 * Plan coordinates: +x = east, +y = south (screen-down), origin at the NW outer corner.
 * Heights are measured from finished floor (FF = 0); grade is at -levels.floorHeight.
 */

export const PointSchema = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof PointSchema>;

/** Walls and rooms without a zone belong to the house; 'garage' ones belong to the attached garage. */
export const ZoneSchema = z.enum(['garage']);
export type Zone = z.infer<typeof ZoneSchema>;

export const WallSchema = z.object({
  id: z.string().min(1),
  zone: ZoneSchema.optional(),
  type: z.enum(['exterior', 'interior']),
  /** Centerline endpoints. */
  start: PointSchema,
  end: PointSchema,
  thickness: z.number().positive(),
  /** Height above the zone's floor (defaults to the zone's plate height). */
  height: z.number().positive().optional(),
  /** Runs up to the roof underside (gable ends are automatic for exterior walls). */
  toRoof: z.boolean().optional(),
  /** Carries floor, ceiling, or roof load. Defaults to true for exterior walls and for interior walls under ceiling joists. */
  bearing: z.boolean().optional(),
  /** The end the stud layout is measured from (defaults to the wall's start). */
  layoutFrom: z.enum(['start', 'end']).optional(),
  note: z.string().optional(),
});
export type Wall = z.infer<typeof WallSchema>;

export const OPERATIONS = {
  door: ['swing', 'pocket', 'bifold', 'barn', 'cased', 'overhead'],
  slider: ['sliding'],
  window: ['casement', 'double-hung', 'awning', 'slider', 'fixed'],
} as const;

export const OpeningSchema = z.object({
  id: z.string().min(1),
  /** Schedule tag, e.g. D1 / W3. */
  tag: z.string().min(1),
  wallId: z.string(),
  kind: z.enum(['door', 'window', 'slider']),
  operation: z.enum([
    'swing', 'pocket', 'bifold', 'barn', 'cased', 'overhead', 'sliding',
    'casement', 'double-hung', 'awning', 'slider', 'fixed',
  ]),
  /** Distance from wall start to the opening CENTER, along the wall. */
  offset: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  /** Sill height above the floor of the wall's zone (0 for doors). */
  sill: z.number().min(0),
  /** Door hinge end (relative to wall direction). */
  hinge: z.enum(['start', 'end']).optional(),
  /** Which side of the wall the door swings to, facing from wall start to end. */
  swing: z.enum(['left', 'right']).optional(),
  note: z.string().optional(),
});
export type Opening = z.infer<typeof OpeningSchema>;

export const ROOM_TYPES = ['living', 'kitchen', 'dining', 'bedroom', 'bath', 'hall', 'closet', 'utility', 'entry', 'garage'] as const;

export const RoomSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  type: z.enum(ROOM_TYPES),
  zone: ZoneSchema.optional(),
  /** Polygon on wall centerlines. */
  polygon: z.array(PointSchema).min(3),
  ceiling: z.enum(['flat', 'vaulted']),
  /** Above the floor of the room's zone. */
  ceilingHeight: z.number().positive().optional(),
  finishes: z.object({ floor: z.string(), walls: z.string(), ceiling: z.string() }),
  /** Label position override (plan coords). */
  label: PointSchema.optional(),
});
export type Room = z.infer<typeof RoomSchema>;

export const FIXTURE_KINDS = [
  'counter', 'sink', 'range', 'fridge', 'dishwasher', 'island', 'table', 'chair', 'sofa',
  'coffee-table', 'bed', 'nightstand', 'dresser', 'toilet', 'vanity', 'shower', 'tub',
  'washer-dryer', 'water-heater', 'stove', 'closet-rod', 'car',
] as const;
export type FixtureKind = (typeof FIXTURE_KINDS)[number];

export const FixtureSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(FIXTURE_KINDS),
  /** Center point. */
  x: z.number(),
  y: z.number(),
  /** Size along local x (w) and local y (d). Local -y is the "back" (against the wall). */
  w: z.number().positive(),
  d: z.number().positive(),
  /** Clockwise degrees on the plan. */
  rotation: z.number(),
  label: z.string().optional(),
});
export type Fixture = z.infer<typeof FixtureSchema>;

export const SIDES = ['north', 'south', 'east', 'west'] as const;
export type Side = (typeof SIDES)[number];

export const RoofParamsSchema = z.object({
  pitch: z.number().min(0).max(24),
  ridgeAxis: z.enum(['x', 'y']),
  /** Eave overhang on the side away from the house. */
  overhang: z.number().min(0),
  gableOverhang: z.number().min(0),
  /** Overhang where the roof meets the house wall, at an eave or a rake (usually 0). */
  houseSideOverhang: z.number().min(0),
  thickness: z.number().positive(),
});

export const GarageSchema = z.object({
  /** Slab top relative to the house finished floor (negative = below). */
  floor: z.number(),
  /** Wall plate height above the slab. */
  plateHeight: z.number().positive(),
  roof: RoofParamsSchema,
  entry: z.object({
    /** The door between the house and the garage. */
    openingId: z.string(),
    landing: z.number().positive(),
    stairWidth: z.number().positive(),
    /** Direction the steps run from the landing, along the shared wall. */
    stairs: z.enum(SIDES),
  }),
  /** Section 2: a cut across the wall shared with the house, positioned along that wall. */
  section: z.object({ at: z.number(), look: z.enum(['-', '+']) }),
});
export type Garage = z.infer<typeof GarageSchema>;

/** A raised platform attached to one side of the house (deck or porch). */
export const DeckSchema = z.object({
  enabled: z.boolean(),
  side: z.enum(SIDES),
  /** Offset from the footprint's min corner along that side. */
  offset: z.number(),
  width: z.number().positive(),
  depth: z.number().positive(),
  railingHeight: z.number().positive(),
  stairs: z.object({
    enabled: z.boolean(),
    /** Stair center, measured along the deck's outer edge from its min corner. */
    offset: z.number(),
    width: z.number().positive(),
  }),
});

export const TREE_SPECIES = ['live-oak', 'cedar', 'cedar-elm'] as const;
export type TreeSpecies = (typeof TREE_SPECIES)[number];

/** The lot, landscape, and lake dock. Inches, plan coordinates (same as the house). */
export const FENCE_STYLES = ['metal', 'wood'] as const;
export type FenceStyle = (typeof FENCE_STYLES)[number];

export const SiteSchema = z.object({
  /** Property line polygon. The edge on the lake side is the shoreline. */
  lot: z.array(PointSchema).min(3),
  setbacks: z.object({ street: z.number().min(0), side: z.number().min(0), lake: z.number().min(0) }),
  /** Water surface below grade at the shore. */
  waterBelowGrade: z.number().min(0),
  /** Water depth at the dock. */
  waterDepth: z.number().positive(),
  /** Normal pool elevation in feet above sea level (for notes). */
  normalPool: z.number(),
  streetWidth: z.number().positive(),
  drivewayWidth: z.number().positive(),
  walkWidth: z.number().positive(),
  dock: z.object({
    /** Gangway centerline, measured along the shore (plan x for a south lake). */
    center: z.number(),
    gangwayLength: z.number().positive(),
    gangwayWidth: z.number().positive(),
    /** Dock body along the shore (width) and out into the lake (length). */
    width: z.number().positive(),
    length: z.number().positive(),
    /** Boat slip: offset from the dock's west edge, width, and length (open to the lake). */
    slipOffset: z.number().min(0),
    slipWidth: z.number().positive(),
    slipLength: z.number().positive(),
    /** Deck surface above the water. */
    deckAboveWater: z.number().positive(),
    lift: z.boolean(),
    boat: z.boolean(),
  }),
  /** Perimeter fence along the street and side lot lines (and the shore when `lakeSide`). */
  fence: z
    .object({
      style: z.enum(FENCE_STYLES),
      height: z.number().positive(),
      /** Post spacing along each run. */
      postSpacing: z.number().positive(),
      /** Clear opening across the driveway (gate posts at each side). */
      gateWidth: z.number().positive(),
      /** Inset from the property line toward the lot. */
      inset: z.number().min(0),
      lakeSide: z.boolean(),
    })
    .optional(),
  trees: z.array(
    z.object({
      x: z.number(),
      y: z.number(),
      species: z.enum(TREE_SPECIES),
      /** Overall tree height. */
      height: z.number().positive(),
      seed: z.number().int(),
    }),
  ),
});
export type Site = z.infer<typeof SiteSchema>;

/**
 * Construction materials for the structure and roof, shown in the drawing notes,
 * the plan callouts, the section assemblies, and the cover sheet. Sizes that the
 * geometry already knows (pier diameter, spacing, pitch) are added by the views.
 */
export const DEFAULT_SPECS = {
  foundation: {
    piers: 'Cast-in-place concrete piers on spread footings',
    beams: '(3) 2x10 P.T. built-up beams',
    joists: '2x10 P.T. floor joists @ 16" o.c.',
    subfloor: '3/4" T&G plywood subfloor, glued and screwed',
    floorInsulation: 'R-30 batts with a vapor retarder and rodent screen at the underside',
    skirt: 'P.T. lattice skirt with access panel',
    garageSlab: '4" concrete slab on grade over a vapor retarder and compacted base',
  },
  framing: {
    lumber: 'No. 2 southern yellow pine; P.T. where in contact with concrete or within 18" of grade',
    exteriorWalls: '2x6 studs @ 16" o.c.',
    interiorWalls: '2x4 studs @ 16" o.c.',
    sheathing: '7/16" OSB structural wall sheathing',
    wallInsulation: 'R-21 batts',
    headers: '(2) 2x10 headers, or LVL where noted by the engineer',
    rafters: '2x10 rafters @ 16" o.c.',
    ridge: 'LVL structural ridge beam',
    connectors: 'Galvanized hurricane ties, joist hangers, and post bases',
  },
  roof: {
    covering: '24 ga. standing seam metal panels with concealed clips',
    underlayment: 'High-temperature self-adhered underlayment',
    sheathing: '5/8" plywood roof sheathing',
    insulation: 'R-38 closed-cell spray foam at the vault',
    gutters: '5" K-style gutters with 3" x 4" downspouts',
  },
  dock: {
    piles: '10" dia. treated timber piles driven to refusal',
    framing: '2x10 P.T. framing with hot-dip galvanized hardware',
    decking: 'Composite decking',
    hardware: 'Galvanized cleats, corner bumpers, and a stainless swim ladder',
    lift: 'Four-post 5,000 lb boat lift with a remote control',
    electrical: 'GFCI-protected dock circuit with LED lighting',
  },
};

const text = z.string().min(1);
export const SpecsSchema = z.object({
  foundation: z.object({
    piers: text, beams: text, joists: text, subfloor: text, floorInsulation: text, skirt: text, garageSlab: text,
  }).default(DEFAULT_SPECS.foundation),
  framing: z.object({
    lumber: text, exteriorWalls: text, interiorWalls: text, sheathing: text, wallInsulation: text,
    headers: text, rafters: text, ridge: text, connectors: text,
  }).default(DEFAULT_SPECS.framing),
  roof: z.object({
    covering: text, underlayment: text, sheathing: text, insulation: text, gutters: text,
  }).default(DEFAULT_SPECS.roof),
  /** Boat dock materials; used only when `site.dock` is present. */
  dock: z.object({
    piles: text, framing: text, decking: text, hardware: text, lift: text, electrical: text,
  }).default(DEFAULT_SPECS.dock),
});
export type Specs = z.infer<typeof SpecsSchema>;

/**
 * Framing sizes and rules, as numbers. The framing model (every stud, joist, and rafter),
 * the takeoff, and the framing sheets are generated from these. They are preliminary
 * assumptions: member sizes and connections are to be verified by the engineer.
 * The `specs` phrases are the printed wording; validation warns when they disagree.
 */
export const LUMBER_SIZES = ['2x4', '2x6', '2x8', '2x10', '2x12', '4x4', '4x6', '6x6'] as const;
export type LumberSize = (typeof LUMBER_SIZES)[number];

const lumberSize = z.enum(LUMBER_SIZES);
/** A nominal board name, e.g. 1x12. */
const lumberName = () => z.string().regex(/^\d+(\/\d+)?x\d+$/);
const spacing = z.number().positive();
/** Sheet goods: thickness and the panel's face size. */
const panel = z.object({ thickness: z.number().positive(), width: z.number().positive(), length: z.number().positive() });
/** Engineered lumber, built up from plies. */
const lvl = z.object({ plies: z.number().int().positive(), thickness: z.number().positive(), depth: z.number().positive() });
const builtUp = z.object({ size: lumberSize, plies: z.number().int().positive() });
const studs = z.object({ stud: lumberSize, spacing });
/** Added to the unit size to get the rough opening. */
const allowance = z.object({ w: z.number().min(0), h: z.number().min(0) });

const FramingGroups = {
  lumber: z.object({
    /** Lengths the yard stocks, shortest first. */
    stockLengths: z.array(z.number().positive()).min(1),
    /** Precut stud lengths, used where a stud needs no cutting. */
    studLengths: z.array(z.number().positive()),
    /** Members this close to grade, or touching concrete, are pressure treated. */
    treatedWithin: z.number().min(0),
    /** Saw kerf lost between cuts from one stick. */
    kerf: z.number().min(0),
    /** Extra lumber and sheet goods to order, as fractions. */
    waste: z.number().min(0).max(1),
    sheetWaste: z.number().min(0).max(1),
  }),
  walls: z.object({
    exterior: studs,
    interior: studs,
    topPlates: z.number().int().min(1).max(2),
    sheathing: panel,
    /** Studs taller than this get a row of fire blocking. */
    fireblockAbove: z.number().positive(),
    /** Anchor bolts through the sill plates on the garage slab. */
    anchorBolts: z.object({ spacing, endDistance: z.number().positive() }),
    /** Flat blocks between studs where a partition meets the wall, and their vertical spacing. */
    backing: z.object({ size: lumberSize, spacing }).default({ size: '2x4', spacing: 24 }),
  }),
  openings: z.object({
    roughOpening: z.object({ door: allowance, cased: allowance, overhead: allowance, window: allowance }),
    /** Sawn-lumber header, used up to `maxSpan`; wider openings get the LVL header. */
    header: builtUp.extend({ maxSpan: z.number().positive() }),
    headerOver: lvl,
    /** Jack studs at each side, by rough-opening width. Wider openings get one more than the last rule. */
    jacks: z.array(z.object({ maxSpan: z.number().positive(), count: z.number().int().positive() })).min(1),
  }),
  floor: z.object({
    joist: lumberSize,
    spacing,
    rim: lumberSize,
    beam: builtUp,
    subfloor: panel,
    treated: z.boolean(),
  }),
  ceiling: z.object({ joist: lumberSize, spacing }),
  roof: z.object({
    rafter: lumberSize,
    spacing,
    /** Level cut where the rafter bears on the plate. */
    seat: z.number().min(0),
    ridge: lvl,
    /** Built-up post of wall studs under each ridge beam bearing. */
    ridgePostPlies: z.number().int().positive().default(3),
    subFascia: lumberSize,
    /** Blocks between the last rafter and the fly rafter at the rake overhang. */
    rakeBlocking: z.object({ size: lumberSize, spacing }),
    sheathing: panel,
  }),
  garage: z.object({ ridge: lvl, ceilingJoist: lumberSize }),
  platforms: z.object({
    joist: lumberSize,
    spacing,
    beam: builtUp,
    post: lumberSize,
    guardPost: lumberSize,
    guardSpacing: spacing,
    stringer: lumberSize,
    stringerSpacing: spacing,
    decking: z.object({ thickness: z.number().positive(), width: z.number().positive(), gap: z.number().min(0) }),
  }),
};

export type Framing = { [K in keyof typeof FramingGroups]: z.infer<(typeof FramingGroups)[K]> };

export const DEFAULT_FRAMING: Framing = {
  lumber: {
    stockLengths: [96, 120, 144, 168, 192],
    studLengths: [92.625, 104.625, 116.625],
    treatedWithin: 18,
    kerf: 0.125,
    waste: 0.1,
    sheetWaste: 0.08,
  },
  walls: {
    exterior: { stud: '2x6', spacing: 16 },
    interior: { stud: '2x4', spacing: 16 },
    topPlates: 2,
    sheathing: { thickness: 0.4375, width: 48, length: 96 },
    fireblockAbove: 120,
    anchorBolts: { spacing: 72, endDistance: 12 },
    backing: { size: '2x4', spacing: 24 },
  },
  openings: {
    roughOpening: {
      door: { w: 2, h: 2.5 },
      cased: { w: 1.5, h: 1 },
      overhead: { w: 0, h: 1 },
      window: { w: 0.5, h: 0.5 },
    },
    header: { size: '2x10', plies: 2, maxSpan: 72 },
    headerOver: { plies: 2, thickness: 1.75, depth: 11.875 },
    jacks: [
      { maxSpan: 50, count: 1 },
      { maxSpan: 110, count: 2 },
    ],
  },
  floor: {
    joist: '2x10',
    spacing: 16,
    rim: '2x10',
    beam: { size: '2x10', plies: 3 },
    subfloor: { thickness: 0.75, width: 48, length: 96 },
    treated: true,
  },
  ceiling: { joist: '2x6', spacing: 16 },
  roof: {
    rafter: '2x10',
    spacing: 16,
    seat: 3.5,
    ridge: { plies: 2, thickness: 1.75, depth: 14 },
    ridgePostPlies: 3,
    subFascia: '2x8',
    rakeBlocking: { size: '2x4', spacing: 24 },
    sheathing: { thickness: 0.625, width: 48, length: 96 },
  },
  garage: {
    ridge: { plies: 2, thickness: 1.75, depth: 11.875 },
    ceilingJoist: '2x8',
  },
  platforms: {
    joist: '2x8',
    spacing: 16,
    beam: { size: '2x10', plies: 3 },
    post: '6x6',
    guardPost: '4x4',
    guardSpacing: 72,
    stringer: '2x12',
    stringerSpacing: 16,
    decking: { thickness: 1, width: 5.5, gap: 0.125 },
  },
};

export const FramingSchema = z.object({
  lumber: FramingGroups.lumber.default(DEFAULT_FRAMING.lumber),
  walls: FramingGroups.walls.default(DEFAULT_FRAMING.walls),
  openings: FramingGroups.openings.default(DEFAULT_FRAMING.openings),
  floor: FramingGroups.floor.default(DEFAULT_FRAMING.floor),
  ceiling: FramingGroups.ceiling.default(DEFAULT_FRAMING.ceiling),
  roof: FramingGroups.roof.default(DEFAULT_FRAMING.roof),
  garage: FramingGroups.garage.default(DEFAULT_FRAMING.garage),
  platforms: FramingGroups.platforms.default(DEFAULT_FRAMING.platforms),
});

/**
 * The exterior envelope, as numbers: siding, weather barrier, insulation, and trim.
 * The envelope takeoff and its costs are measured from the walls and roofs with these.
 */
const EnvelopeGroups = {
  siding: z.object({
    /** Face width of one board and the spacing of the boards, which is also the batten spacing. */
    board: lumberName(),
    module: z.number().positive(),
    batten: lumberName(),
    /** Horizontal furring behind vertical boards, for the rain screen. */
    furring: z.object({ size: lumberName(), spacing }),
    /** Least distance from the bottom of the siding to the ground. */
    clearance: z.number().min(0),
    waste: z.number().min(0).max(1),
  }),
  wrap: z.object({
    /** One roll of weather barrier, and the lap between courses. */
    rollWidth: z.number().positive(),
    rollLength: z.number().positive(),
    lap: z.number().min(0),
    waste: z.number().min(0).max(1),
  }),
  insulation: z.object({
    walls: z.string().min(1),
    /** Over the flat ceilings. */
    attic: z.string().min(1),
    /** Under the roof deck of the vaulted rooms. */
    vault: z.string().min(1),
  }),
  trim: z.object({
    corner: lumberName(),
    casing: lumberName(),
    fascia: lumberName(),
    rake: lumberName(),
    frieze: lumberName(),
    soffit: z.string().min(1),
  }),
};

export type Envelope = { [K in keyof typeof EnvelopeGroups]: z.infer<(typeof EnvelopeGroups)[K]> };

export const DEFAULT_ENVELOPE: Envelope = {
  siding: {
    board: '1x12',
    module: 12,
    batten: '1x3',
    furring: { size: '1x3', spacing: 16 },
    clearance: 6,
    waste: 0.1,
  },
  wrap: { rollWidth: 108, rollLength: 1200, lap: 6, waste: 0.1 },
  insulation: {
    walls: 'R-21 batts',
    attic: 'R-38 blown insulation over the flat ceilings',
    vault: 'R-38 closed-cell spray foam at the vault',
  },
  trim: { corner: '1x6', casing: '1x4', fascia: '1x8', rake: '1x8', frieze: '1x6', soffit: 'Vented fiber-cement soffit' },
};

export const EnvelopeSchema = z.object({
  siding: EnvelopeGroups.siding.default(DEFAULT_ENVELOPE.siding),
  wrap: EnvelopeGroups.wrap.default(DEFAULT_ENVELOPE.wrap),
  insulation: EnvelopeGroups.insulation.default(DEFAULT_ENVELOPE.insulation),
  trim: EnvelopeGroups.trim.default(DEFAULT_ENVELOPE.trim),
});

export const DesignSchema = z.object({
  version: z.literal(1),
  meta: z.object({
    project: z.string(),
    subtitle: z.string(),
    address: z.string(),
    client: z.string(),
    designer: z.string(),
    lakeSide: z.enum(SIDES),
    section: z.object({
      /** Cut position along the ridge axis. */
      at: z.number(),
      /** Look toward decreasing (-) or increasing (+) ridge-axis coordinate. */
      look: z.enum(['-', '+']),
    }),
    revisions: z.array(z.object({ rev: z.number().int(), date: z.string(), note: z.string() })),
    notes: z.array(z.string()),
  }),
  levels: z.object({
    /** Finished floor above grade. */
    floorHeight: z.number().min(0),
    /** Plate height above FF. */
    wallHeight: z.number().positive(),
    /** Floor framing depth. */
    floorDepth: z.number().positive(),
  }),
  foundation: z.object({
    type: z.enum(['piers', 'crawlspace', 'slab']),
    beamSpacing: z.number().positive(),
    pierSpacing: z.number().positive(),
    pierSize: z.number().positive(),
  }),
  roof: z.object({
    style: z.literal('gable'),
    /** Rise per 12 of run. */
    pitch: z.number().min(0).max(24),
    ridgeAxis: z.enum(['x', 'y']),
    overhang: z.number().min(0),
    gableOverhang: z.number().min(0),
    thickness: z.number().positive(),
    seamSpacing: z.number().positive(),
  }),
  deck: DeckSchema,
  /** Street-side porch: a platform like the deck, with its own guard and skirt options. */
  porch: DeckSchema.extend({
    railing: z.boolean(),
    skirt: z.enum(['solid', 'lattice', 'none']),
  }).optional(),
  garage: GarageSchema.optional(),
  site: SiteSchema.optional(),
  materials: z.object({
    siding: z.string(),
    trim: z.string(),
    roof: z.string(),
    deck: z.string(),
    windowFrame: z.string(),
    door: z.string(),
    glass: z.string(),
    interior: z.string(),
  }),
  specs: SpecsSchema.default(DEFAULT_SPECS),
  framing: FramingSchema.default(DEFAULT_FRAMING),
  envelope: EnvelopeSchema.default(DEFAULT_ENVELOPE),
  walls: z.array(WallSchema),
  openings: z.array(OpeningSchema),
  rooms: z.array(RoomSchema),
  fixtures: z.array(FixtureSchema),
});
export type Design = z.infer<typeof DesignSchema>;

export type ParseResult = { ok: true; design: Design } | { ok: false; errors: string[] };

export function parseDesign(input: unknown): ParseResult {
  const r = DesignSchema.safeParse(input);
  if (r.success) return { ok: true, design: r.data };
  return {
    ok: false,
    errors: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}

export function parseDesignText(text: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`Invalid JSON: ${(e as Error).message}`] };
  }
  return parseDesign(json);
}
