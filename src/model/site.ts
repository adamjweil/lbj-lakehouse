import type { Design, Site } from './schema';
import {
  bbox, buildingBounds, footprint, garageFootprint, garageRoofFrame, openingCenter, platforms, polygonArea,
  rectsOverlap, roofFrame, wallById, type Rect, type Vec,
} from './geometry';

/**
 * Site geometry: the lot, landscape elements, and the lake dock.
 * Inches, plan coordinates. The site layout assumes the lake is on the south (+y) side.
 */

export const SQ_IN_PER_ACRE = 43560 * 144;

export type Path = { points: Vec[]; width: number };

export type SiteGeom = ReturnType<typeof siteGeom>;

/** Everything derived from `design.site`, or null when the design has no site. */
export function siteGeom(design: Design) {
  const site = design.site;
  if (!site) return null;
  const lot = site.lot;
  const lotRect = bbox(lot);
  const area = polygonArea(lot);
  const shoreY = lotRect.y1;
  const grade = -design.levels.floorHeight;
  const water = grade - site.waterBelowGrade;
  const setback: Rect = {
    x0: lotRect.x0 + site.setbacks.side,
    x1: lotRect.x1 - site.setbacks.side,
    y0: lotRect.y0 + site.setbacks.street,
    y1: lotRect.y1 - site.setbacks.lake,
  };
  const street: Rect = { x0: lotRect.x0 - 2400, x1: lotRect.x1 + 2400, y0: lotRect.y0 - site.streetWidth, y1: lotRect.y0 };
  return {
    site,
    lot,
    lotRect,
    area,
    acres: area / SQ_IN_PER_ACRE,
    shoreY,
    grade,
    water,
    bottom: water - site.waterDepth,
    setback,
    street,
    driveway: drivewayRect(design, site, lotRect),
    paths: sitePaths(design, site, lotRect, shoreY),
    dock: dockGeom(site, shoreY, water),
    fence: fenceGeom(design, site, lotRect, shoreY),
    trees: site.trees,
  };
}

/** Gravel driveway from the street to the garage's overhead door (or the house front door). */
function drivewayRect(design: Design, site: Site, lot: Rect): Rect | null {
  const door =
    design.openings.find((o) => o.operation === 'overhead') ??
    design.openings.find((o) => o.kind === 'door' && o.operation === 'swing');
  const w = door && wallById(design, door.wallId);
  if (!door || !w) return null;
  const c = openingCenter(w, door);
  const half = Math.max(site.drivewayWidth, door.width + 24) / 2;
  const face = Math.min(...(garageFootprint(design) ?? footprint(design)).map((p) => p.y));
  return { x0: c.x - half, x1: c.x + half, y0: lot.y0, y1: face };
}

/** Walks: driveway to the porch steps, and deck steps down to the dock. */
function sitePaths(design: Design, site: Site, lot: Rect, shoreY: number): Path[] {
  const out: Path[] = [];
  const width = site.walkWidth;
  const plats = platforms(design);
  const porch = plats.find((p) => p.kind === 'porch' && p.side === 'north');
  const drive = drivewayRect(design, site, lot);
  if (porch?.stairs && drive) {
    const sx = (porch.stairs.rect.x0 + porch.stairs.rect.x1) / 2;
    const sy = porch.stairs.rect.y0;
    const turnY = sy - 205;
    out.push({ points: [{ x: drive.x1, y: turnY }, { x: sx, y: turnY }, { x: sx, y: sy }], width });
  }
  const deck = plats.find((p) => p.kind === 'deck' && p.side === 'south');
  if (deck?.stairs && site.dock) {
    const sx = (deck.stairs.rect.x0 + deck.stairs.rect.x1) / 2;
    const cx = site.dock.center;
    const from = { x: sx, y: deck.stairs.rect.y1 };
    const pts = [from];
    if (Math.abs(cx - sx) > 1) pts.push({ x: sx, y: (from.y + shoreY) / 2 }, { x: cx, y: (from.y + shoreY) / 2 });
    pts.push({ x: cx, y: shoreY });
    out.push({ points: pts, width });
  }
  return out;
}

export type FenceRun = { a: Vec; b: Vec };
export type FenceGeom = NonNullable<ReturnType<typeof fenceGeom>>;

/**
 * Perimeter fence: runs along the lot edges (skipping the shoreline unless `lakeSide`),
 * inset from the property line, with a gate opening across the driveway.
 */
function fenceGeom(design: Design, site: Site, lot: Rect, shoreY: number) {
  const f = site.fence;
  if (!f) return null;
  const i = f.inset;
  const r: Rect = { x0: lot.x0 + i, x1: lot.x1 - i, y0: lot.y0 + i, y1: shoreY - (f.lakeSide ? i : 0) };
  const runs: FenceRun[] = [];
  const gates: FenceRun[] = [];
  // Street side, split at the driveway.
  const drive = drivewayRect(design, site, lot);
  if (drive) {
    const c = (drive.x0 + drive.x1) / 2;
    const g0 = Math.max(r.x0, c - f.gateWidth / 2);
    const g1 = Math.min(r.x1, c + f.gateWidth / 2);
    if (g0 > r.x0) runs.push({ a: { x: r.x0, y: r.y0 }, b: { x: g0, y: r.y0 } });
    if (g1 < r.x1) runs.push({ a: { x: g1, y: r.y0 }, b: { x: r.x1, y: r.y0 } });
    gates.push({ a: { x: g0, y: r.y0 }, b: { x: g1, y: r.y0 } });
  } else {
    runs.push({ a: { x: r.x0, y: r.y0 }, b: { x: r.x1, y: r.y0 } });
  }
  runs.push({ a: { x: r.x1, y: r.y0 }, b: { x: r.x1, y: r.y1 } });
  runs.push({ a: { x: r.x0, y: r.y1 }, b: { x: r.x0, y: r.y0 } });
  if (f.lakeSide) {
    // Leave the walk to the dock open.
    const walk = site.dock ? { x0: site.dock.center - site.walkWidth, x1: site.dock.center + site.walkWidth } : null;
    if (walk) {
      runs.push({ a: { x: r.x1, y: r.y1 }, b: { x: walk.x1, y: r.y1 } }, { a: { x: walk.x0, y: r.y1 }, b: { x: r.x0, y: r.y1 } });
      gates.push({ a: { x: walk.x1, y: r.y1 }, b: { x: walk.x0, y: r.y1 } });
    } else {
      runs.push({ a: { x: r.x1, y: r.y1 }, b: { x: r.x0, y: r.y1 } });
    }
  }
  const length = runs.reduce((s, q) => s + Math.hypot(q.b.x - q.a.x, q.b.y - q.a.y), 0);
  return { spec: f, runs, gates, length };
}

/** Rectangles covered by a path polyline. */
export function pathRects(p: Path): Rect[] {
  const h = p.width / 2;
  return p.points.slice(1).map((b, i) => {
    const a = p.points[i];
    return { x0: Math.min(a.x, b.x) - h, x1: Math.max(a.x, b.x) + h, y0: Math.min(a.y, b.y) - h, y1: Math.max(a.y, b.y) + h };
  });
}

export type DockGeom = NonNullable<ReturnType<typeof dockGeom>>;

/**
 * Open boat dock: one level, no cover.
 * The gangway runs from the shore to the middle of the lounge deck, which sits east of the slip.
 */
function dockGeom(site: Site, shoreY: number, water: number) {
  const d = site.dock;
  if (!d) return null;
  const gangway: Rect = { x0: d.center - d.gangwayWidth / 2, x1: d.center + d.gangwayWidth / 2, y0: shoreY, y1: shoreY + d.gangwayLength };
  const loungeWidth = d.width - d.slipOffset - d.slipWidth;
  const x0 = d.center - (d.slipOffset + d.slipWidth + loungeWidth / 2);
  const body: Rect = { x0, x1: x0 + d.width, y0: gangway.y1, y1: gangway.y1 + d.length };
  const slip: Rect = { x0: x0 + d.slipOffset, x1: x0 + d.slipOffset + d.slipWidth, y0: body.y1 - d.slipLength, y1: body.y1 };
  const finger: Rect = { x0, x1: slip.x0, y0: slip.y0, y1: body.y1 };
  const head: Rect = { x0, x1: slip.x1, y0: body.y0, y1: slip.y0 };
  const lounge: Rect = { x0: slip.x1, x1: body.x1, y0: body.y0, y1: body.y1 };
  const deckTop = water + d.deckAboveWater;
  const piles: Vec[] = [];
  const along = (a: number, b: number, step: number) => {
    const n = Math.max(1, Math.round((b - a) / step));
    return Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  };
  for (const y of along(gangway.y0 + 24, gangway.y1 - 12, 96)) piles.push({ x: gangway.x0 + 3, y }, { x: gangway.x1 - 3, y });
  for (const x of along(body.x0 + 5, body.x1 - 5, 120)) piles.push({ x, y: body.y0 + 5 }, { x, y: body.y1 - 5 });
  for (const y of along(body.y0 + 5, body.y1 - 5, 120)) {
    piles.push({ x: body.x0 + 5, y }, { x: body.x1 - 5, y });
    if (y > slip.y0) piles.push({ x: slip.x0 - 5, y }, { x: slip.x1 + 5, y });
  }
  // Corner piles belong to two rows; count each one once.
  const unique = piles.filter((q, i) => piles.findIndex((o) => Math.abs(o.x - q.x) < 1 && Math.abs(o.y - q.y) < 1) === i);
  const lift = d.lift
    ? [
        { x: slip.x0 + 8, y: slip.y0 + 48 },
        { x: slip.x1 - 8, y: slip.y0 + 48 },
        { x: slip.x0 + 8, y: slip.y1 - 60 },
        { x: slip.x1 - 8, y: slip.y1 - 60 },
      ]
    : [];
  const ladder = { x: (lounge.x0 + lounge.x1) / 2 - 24, y: body.y1 };
  return {
    spec: d, gangway, body, slip, finger, head, lounge, piles: unique, lift, ladder, deckTop,
    walkRects: [gangway, head, finger, lounge],
  };
}

/** Surfaces that shed water, for the site data table. */
export function imperviousCover(design: Design) {
  const g = siteGeom(design);
  const roofs = [roofFrame(design).planRect, garageRoofFrame(design)?.planRect].filter(Boolean) as Rect[];
  const roofArea = roofs.reduce((s, r) => s + (r.x1 - r.x0) * (r.y1 - r.y0), 0) - overlapArea(roofs);
  const driveway = g?.driveway ? (g.driveway.x1 - g.driveway.x0) * (g.driveway.y1 - g.driveway.y0) : 0;
  const walks = g ? g.paths.flatMap(pathRects).reduce((s, r) => s + (r.x1 - r.x0) * (r.y1 - r.y0), 0) : 0;
  const total = roofArea + driveway + walks;
  return { roofArea, driveway, walks, total, percent: g ? (total / g.area) * 100 : 0 };
}

function overlapArea(rects: Rect[]): number {
  if (rects.length < 2) return 0;
  const [a, b] = rects;
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Areas trees must stay out of: building, platforms, driveway, walks, and the dock. */
export function keepOutRects(design: Design, g: NonNullable<SiteGeom>): Rect[] {
  const grow = (r: Rect, m: number): Rect => ({ x0: r.x0 - m, x1: r.x1 + m, y0: r.y0 - m, y1: r.y1 + m });
  const out: Rect[] = [grow(buildingBounds(design), 72)];
  for (const p of platforms(design)) {
    out.push(grow(p.rect, 48));
    if (p.stairs) out.push(grow(p.stairs.rect, 48));
  }
  if (g.driveway) out.push(grow(g.driveway, 60));
  for (const p of g.paths) out.push(...pathRects(p).map((r) => grow(r, 36)));
  if (g.dock) out.push(grow(g.dock.gangway, 60), grow(g.dock.body, 60));
  return out;
}

export function treeConflicts(design: Design): { index: number; rect: Rect }[] {
  const g = siteGeom(design);
  if (!g) return [];
  const keep = keepOutRects(design, g);
  const out: { index: number; rect: Rect }[] = [];
  g.trees.forEach((t, index) => {
    const trunk: Rect = { x0: t.x - 12, x1: t.x + 12, y0: t.y - 12, y1: t.y + 12 };
    const hit = keep.find((r) => rectsOverlap(trunk, r));
    if (hit) out.push({ index, rect: hit });
  });
  return out;
}

