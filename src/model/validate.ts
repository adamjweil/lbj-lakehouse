import type { Design } from './schema';
import {
  clearOpening, exteriorLoop, fixtureRect, openingCenter, openingRange, pointAlong, pointInPolygon,
  projectOnWall, rectsOverlap, roomOpenings, roomStats, wallById, wallDir, wallLength, leftNormal,
  add, mul, footprint, bbox, garageEntry, garageFootprint, garageRoofFrame, roomsForOpening,
  wallsOverlapRect, platforms, PLATFORM_TOP, type Rect,
} from './geometry';
import { formatFtIn, sqft } from './units';
import { siteGeom, treeConflicts } from './site';
import { buildingBounds, pointInPolygon as inPolygon } from './geometry';

export type IssueLevel = 'error' | 'warning' | 'info';
export type Ref = { kind: 'wall' | 'opening' | 'room' | 'fixture'; id: string };
export type Issue = { level: IssueLevel; code: string; message: string; ref?: Ref };

/**
 * Design sanity checks. These approximate common IRC requirements to catch mistakes early;
 * they are not a code review.
 */
export function validateDesign(design: Design): Issue[] {
  const issues: Issue[] = [];
  const push = (level: IssueLevel, code: string, message: string, ref?: Ref) =>
    issues.push({ level, code, message, ref });

  // --- ids and references
  const dupes = (ids: string[], label: string) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) push('error', 'duplicate-id', `Duplicate ${label} id "${id}"`);
      seen.add(id);
    }
  };
  dupes(design.walls.map((w) => w.id), 'wall');
  dupes(design.openings.map((o) => o.id), 'opening');
  dupes(design.rooms.map((r) => r.id), 'room');
  dupes(design.fixtures.map((f) => f.id), 'fixture');
  const tags = new Map<string, string>();
  for (const o of design.openings) {
    const prev = tags.get(o.tag);
    if (prev) push('warning', 'duplicate-tag', `Tag ${o.tag} is used by ${prev} and ${o.id}`, { kind: 'opening', id: o.id });
    tags.set(o.tag, o.id);
  }

  // --- walls
  for (const w of design.walls) {
    if (wallLength(w) < 1) push('error', 'wall-zero', `Wall ${w.id} has no length`, { kind: 'wall', id: w.id });
  }
  if (!exteriorLoop(design)) {
    push('error', 'open-shell', 'Exterior walls do not form a closed loop (check endpoints)');
  }

  // --- openings
  const byWall = new Map<string, typeof design.openings>();
  for (const o of design.openings) {
    const w = wallById(design, o.wallId);
    const ref: Ref = { kind: 'opening', id: o.id };
    if (!w) {
      push('error', 'opening-wall', `${o.tag} references missing wall "${o.wallId}"`, ref);
      continue;
    }
    const [a, b] = openingRange(o);
    if (a < -0.5 || b > wallLength(w) + 0.5) {
      push('error', 'opening-bounds', `${o.tag} extends past the end of wall ${w.id}`, ref);
    }
    const kindOk =
      (o.kind === 'door' && ['swing', 'pocket', 'bifold', 'barn', 'cased', 'overhead'].includes(o.operation)) ||
      (o.kind === 'slider' && o.operation === 'sliding') ||
      (o.kind === 'window' && ['casement', 'double-hung', 'awning', 'slider', 'fixed'].includes(o.operation));
    if (!kindOk) push('warning', 'opening-operation', `${o.tag}: "${o.operation}" is unusual for a ${o.kind}`, ref);
    if (o.kind !== 'window' && o.sill > 0) push('warning', 'door-sill', `${o.tag}: doors should have sill 0`, ref);
    const wallTop = w.height ?? design.levels.wallHeight;
    if (!w.toRoof && w.type === 'interior' && o.sill + o.height > wallTop) {
      push('error', 'opening-height', `${o.tag} is taller than wall ${w.id}`, ref);
    }
    if (o.kind === 'door' && o.operation !== 'cased' && o.height < 78) {
      push('warning', 'door-height', `${o.tag} is shorter than 6'-6"`, ref);
    }
    const list = byWall.get(w.id) ?? [];
    list.push(o);
    byWall.set(w.id, list);
  }
  for (const list of byWall.values()) {
    const sorted = [...list].sort((p, q) => p.offset - q.offset);
    for (let i = 1; i < sorted.length; i++) {
      const [, prevEnd] = openingRange(sorted[i - 1]);
      const [start] = openingRange(sorted[i]);
      if (start < prevEnd) {
        push('error', 'opening-overlap', `${sorted[i - 1].tag} and ${sorted[i].tag} overlap`, { kind: 'opening', id: sorted[i].id });
      } else if (start - prevEnd < 3) {
        push('warning', 'opening-tight', `Less than 3" of wall between ${sorted[i - 1].tag} and ${sorted[i].tag}`, { kind: 'opening', id: sorted[i].id });
      }
    }
  }

  // --- rooms
  for (const r of design.rooms) {
    const ref: Ref = { kind: 'room', id: r.id };
    const s = roomStats(design, r);
    for (const p of r.polygon) {
      if (!design.walls.some((w) => projectOnWall(w, p, 1) !== null)) {
        push('info', 'room-vertex', `${r.name}: corner (${p.x}, ${p.y}) is not on a wall`, ref);
        break;
      }
    }
    const openings = roomOpenings(design, r);
    const glazing = openings
      .filter((x) => x.opening.kind !== 'door')
      .reduce((sum, x) => sum + x.opening.width * x.opening.height, 0);
    if (r.type === 'bedroom') {
      if (sqft(s.area) < 70) push('error', 'bedroom-area', `${r.name} is ${sqft(s.area).toFixed(0)} SF (min 70 SF)`, ref);
      if (s.minDim < 84) push('error', 'bedroom-dim', `${r.name} is ${formatFtIn(s.minDim)} wide (min 7'-0")`, ref);
      const egress = openings.filter(({ opening: o }) => {
        if (o.kind !== 'window') return false;
        const c = clearOpening(o);
        return c.w >= 20 && c.h >= 24 && c.w * c.h >= 5.7 * 144 && o.sill <= 44;
      });
      if (egress.length === 0) {
        push('error', 'egress', `${r.name} has no emergency escape window (5.7 SF clear, 20" W, 24" H, sill <= 44")`, ref);
      }
    }
    if (['bedroom', 'living', 'kitchen', 'dining'].includes(r.type) && s.area > 0) {
      if (glazing < s.area * 0.08) {
        push('warning', 'glazing', `${r.name}: glazing is ${((glazing / s.area) * 100).toFixed(1)}% of floor area (min 8%)`, ref);
      }
    }
    if (r.type === 'hall' && s.minDim < 36) {
      push('error', 'hall-width', `${r.name} is ${formatFtIn(s.minDim)} wide (min 3'-0")`, ref);
    }
    if (r.type === 'bath' && glazing === 0) {
      push('info', 'bath-vent', `${r.name} has no window; provide an exhaust fan vented outside`, ref);
    }
    if (!['closet', 'utility', 'hall', 'garage'].includes(r.type) && s.ceilingHeight < 84) {
      push('error', 'ceiling', `${r.name} ceiling is below 7'-0"`, ref);
    }
  }

  // --- fixtures
  const fp = footprint(design);
  const gfp = garageFootprint(design);
  const doorSwings: { tag: string; id: string; rect: Rect }[] = [];
  for (const o of design.openings) {
    if (o.kind !== 'door' || o.operation !== 'swing') continue;
    const w = wallById(design, o.wallId);
    if (!w) continue;
    const c = openingCenter(w, o);
    const n = mul(leftNormal(wallDir(w)), o.swing === 'right' ? -1 : 1);
    const d = wallDir(w);
    const face = add(c, mul(n, w.thickness / 2));
    const pts = [
      add(face, mul(d, -o.width / 2)),
      add(face, mul(d, o.width / 2)),
      add(add(face, mul(d, -o.width / 2)), mul(n, o.width)),
      add(add(face, mul(d, o.width / 2)), mul(n, o.width)),
    ];
    doorSwings.push({ tag: o.tag, id: o.id, rect: bbox(pts) });
  }
  const onCounter = new Set(['sink', 'range', 'dishwasher']);
  for (const f of design.fixtures) {
    const ref: Ref = { kind: 'fixture', id: f.id };
    const r = fixtureRect(f);
    const inside = pointInPolygon({ x: f.x, y: f.y }, fp) || (gfp !== null && pointInPolygon({ x: f.x, y: f.y }, gfp));
    if (!inside) push('warning', 'fixture-outside', `${f.label ?? f.kind} (${f.id}) is outside the building`, ref);
    for (const s of doorSwings) {
      if (rectsOverlap(r, s.rect, 0.5)) push('warning', 'door-swing', `Door ${s.tag} swings into ${f.label ?? f.kind} (${f.id})`, ref);
    }
    if (onCounter.has(f.kind)) continue;
    for (const w of design.walls) {
      const mid = { x: f.x, y: f.y };
      const u = projectOnWall(w, mid, w.thickness / 2 + Math.min(f.w, f.d) / 2 - 1);
      if (u !== null && u > 0 && u < wallLength(w)) {
        push('warning', 'fixture-wall', `${f.label ?? f.kind} (${f.id}) overlaps wall ${w.id}`, ref);
        break;
      }
    }
  }

  // Tall fixtures colliding with each other (counters and appliances on them are fine).
  const solid = design.fixtures.filter((f) => !['counter', 'sink', 'range', 'dishwasher', 'closet-rod'].includes(f.kind));
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      if (rectsOverlap(fixtureRect(solid[i]), fixtureRect(solid[j]), 0.5)) {
        push('warning', 'fixture-overlap', `${solid[i].label ?? solid[i].kind} overlaps ${solid[j].label ?? solid[j].kind}`, { kind: 'fixture', id: solid[j].id });
      }
    }
  }

  // Openings too close to wall ends where walls meet.
  for (const o of design.openings) {
    const w = wallById(design, o.wallId);
    if (!w) continue;
    const [a, b] = openingRange(o);
    for (const other of design.walls) {
      if (other.id === w.id) continue;
      for (const p of [other.start, other.end]) {
        const u = projectOnWall(w, p);
        if (u === null) continue;
        const clearance = other.thickness / 2;
        if (u > a - clearance + 0.1 && u < b + clearance - 0.1) {
          push('error', 'opening-at-wall', `${o.tag} collides with wall ${other.id}`, { kind: 'opening', id: o.id });
        }
      }
    }
  }

  validateGarage(design, push);
  validatePlatforms(design, push);
  validateSite(design, push);
  return issues;
}

type Push = (level: IssueLevel, code: string, message: string, ref?: Ref) => void;

/** Attached garage: separation from the dwelling, the entry landing and steps, and roof clearances. */
function validateGarage(design: Design, push: Push) {
  const hasGarageWalls = design.walls.some((w) => w.zone === 'garage');
  const g = design.garage;
  if (!g) {
    if (hasGarageWalls) push('error', 'garage-missing', 'Walls are marked as garage, but the design has no "garage" settings');
    return;
  }
  if (!hasGarageWalls) {
    push('error', 'garage-walls', 'The "garage" settings exist, but no walls are marked as garage');
    return;
  }
  const entry = garageEntry(design);
  if (!entry) {
    push('error', 'garage-entry', `Garage entry door "${g.entry.openingId}" was not found`);
    return;
  }
  const ref: Ref = { kind: 'opening', id: entry.opening.id };
  const tag = entry.opening.tag;

  if (roomsForOpening(design, entry.opening).some((r) => r.type === 'bedroom')) {
    push('error', 'garage-bedroom', `${tag} opens from the garage into a bedroom, which IRC R302.5.1 prohibits`, ref);
  }
  push(
    'info',
    'garage-separation',
    `${tag}: use a solid-wood or steel door at least 1-3/8" thick or a 20-minute rated door, self-closing where required (R302.5.1), with 1/2" gypsum board on the garage side of the shared wall (R302.6)`,
    ref,
  );

  // Landing and steps must fit in the garage and stay clear of cars, fixtures, and doors.
  const garageRoom = design.rooms.find((r) => r.zone === 'garage');
  const interior = garageRoom ? bbox(roomStats(design, garageRoom).net) : bbox(garageFootprint(design) ?? []);
  const within = (r: Rect) => r.x0 >= interior.x0 - 0.5 && r.x1 <= interior.x1 + 0.5 && r.y0 >= interior.y0 - 0.5 && r.y1 <= interior.y1 + 0.5;
  if (!within(entry.landing) || !within(entry.run)) {
    push('error', 'garage-stairs-fit', `The landing or steps at ${tag} do not fit inside the garage`, ref);
  }
  for (const f of design.fixtures) {
    const fr = fixtureRect(f);
    if (rectsOverlap(fr, entry.landing, 0.5) || rectsOverlap(fr, entry.run, 0.5)) {
      push('error', 'garage-stairs-clear', `${f.label ?? f.kind} (${f.id}) blocks the landing or steps at ${tag}`, { kind: 'fixture', id: f.id });
    }
  }
  for (const o of design.openings) {
    if (o.id === entry.opening.id) continue;
    const w = wallById(design, o.wallId);
    if (!w || w.zone !== 'garage') continue;
    // The area just inside a garage door must stay clear.
    const inward = mul(leftNormal(wallDir(w)), 1);
    const c = openingCenter(w, o);
    const side = pointInPolygon(add(c, mul(inward, 12)), garageFootprint(design) ?? []) ? inward : mul(inward, -1);
    const [u0, u1] = openingRange(o);
    const zone = bbox([
      add(pointAlong(w, u0), mul(side, w.thickness / 2)),
      add(pointAlong(w, u1), mul(side, w.thickness / 2 + 36)),
    ]);
    if (rectsOverlap(zone, entry.landing, 0.5) || rectsOverlap(zone, entry.run, 0.5)) {
      push('error', 'garage-stairs-door', `The steps at ${tag} are in front of ${o.tag}`, ref);
    }
  }
  if (wallsOverlapRect(design, entry.run) || wallsOverlapRect(design, entry.landing)) {
    push('error', 'garage-stairs-wall', `The steps at ${tag} run into a wall`, ref);
  }

  // Roof clearances at the shared wall.
  const rf = garageRoofFrame(design);
  if (rf) {
    const face = add(openingCenter(entry.wall, entry.opening), mul(entry.into, entry.wall.thickness / 2));
    const headroom = rf.undersideAt(rf.sOf(face)) - entry.landingTop;
    if (headroom < 80) {
      push('error', 'garage-headroom', `Headroom over the landing at ${tag} is ${formatFtIn(headroom)} (min 6'-8")`, ref);
    }
    if (rf.undersideAt(rf.sOf(face)) < entry.opening.height) {
      push('error', 'garage-door-head', `${tag} is taller than the garage roof where it meets the house`, ref);
    }
    // A ridge parallel to the shared wall rises in front of its windows; a gable end against
    // the wall covers them only where the roof profile reaches their sill.
    const gableEnd = Math.abs(rf.sOf(wallDir(entry.wall))) > 0.5;
    for (const o of design.openings) {
      if (o.wallId !== entry.wall.id || o.kind !== 'window') continue;
      let top = rf.ridgeTop;
      if (gableEnd) {
        const [u0, u1] = openingRange(o);
        const s = [rf.sOf(pointAlong(entry.wall, u0)), rf.sOf(pointAlong(entry.wall, u1))].sort((p, q) => p - q);
        if (s[1] < rf.eave0 || s[0] > rf.eave1) continue;
        const under = s[0] <= rf.ridgeS && rf.ridgeS <= s[1] ? rf.ridgeUnder : Math.max(rf.undersideAt(s[0]), rf.undersideAt(s[1]));
        top = under + rf.tv;
      } else {
        const a = rf.aOf(openingCenter(entry.wall, o));
        if (a < rf.a0 || a > rf.a1) continue;
      }
      if (top >= o.sill) {
        push('error', 'garage-roof-window', `The garage roof (top ${formatFtIn(top)}) rises above the sill of ${o.tag} (${formatFtIn(o.sill)})`, { kind: 'opening', id: o.id });
      }
    }
  }
}

/** Decks and porches: guards, stair handrails, skirts, and clearances. */
function validatePlatforms(design: Design, push: Push) {
  const plats = platforms(design);
  const aboveGrade = design.levels.floorHeight + PLATFORM_TOP;
  for (const p of plats) {
    const name = p.kind === 'deck' ? 'Deck' : 'Porch';
    if (aboveGrade > 30 && !p.railing) {
      push('error', 'platform-guard', `${name} surface is ${formatFtIn(aboveGrade)} above grade; a 36" guard is required above 30" (IRC R312.1.1)`);
    }
    if (p.stairs && p.stairs.risers >= 4) {
      push('info', 'stair-handrail', `${name} steps have ${p.stairs.risers} risers; provide a graspable handrail (R311.7.8)`);
    }
    if (p.skirt === 'solid') {
      push('info', 'platform-skirt', `${name}: provide vents and an access panel in the solid skirt, and confirm the grade within 36" of the edge keeps the surface no more than 30" up`);
    }
    // Keep steps and platforms out of the approach to a garage door.
    for (const o of design.openings) {
      if (o.operation !== 'overhead') continue;
      const w = wallById(design, o.wallId);
      if (!w || w.type !== 'exterior') continue;
      const out = mul(leftNormal(wallDir(w)), 1);
      const gfp = garageFootprint(design) ?? footprint(design);
      const c = openingCenter(w, o);
      const side = pointInPolygon(add(c, mul(out, 12)), gfp) ? mul(out, -1) : out;
      const [u0, u1] = openingRange(o);
      const approach = bbox([
        add(pointAlong(w, u0), mul(side, w.thickness / 2)),
        add(pointAlong(w, u1), mul(side, w.thickness / 2 + 240)),
      ]);
      for (const r of [p.rect, p.stairs?.rect]) {
        if (r && rectsOverlap(r, approach, 0.5)) {
          push('error', 'platform-driveway', `${name} blocks the approach to ${o.tag}`, { kind: 'opening', id: o.id });
          break;
        }
      }
    }
  }
  for (let i = 0; i < plats.length; i++) {
    for (let j = i + 1; j < plats.length; j++) {
      const a = [plats[i].rect, plats[i].stairs?.rect].filter(Boolean) as Rect[];
      const b = [plats[j].rect, plats[j].stairs?.rect].filter(Boolean) as Rect[];
      if (a.some((x) => b.some((y) => rectsOverlap(x, y, 0.5)))) {
        push('error', 'platform-overlap', `The ${plats[i].kind} and the ${plats[j].kind} overlap`);
      }
    }
  }
}

/** Lot, setbacks, dock, and trees. */
function validateSite(design: Design, push: Push) {
  const g = siteGeom(design);
  if (!g) return;
  if (design.meta.lakeSide !== 'south') {
    push('warning', 'site-lake', 'The site layout assumes the lake is on the south side of the house');
  }
  if (g.fence && g.driveway && g.fence.gates[0]) {
    const gate = g.fence.gates[0];
    const w = Math.abs(gate.b.x - gate.a.x);
    if (w < g.driveway.x1 - g.driveway.x0) {
      push('warning', 'fence-gate', `The driveway gate opening (${formatFtIn(w)}) is narrower than the driveway (${formatFtIn(g.driveway.x1 - g.driveway.x0)})`);
    }
  }
  push('info', 'lot-area', `Lot is ${Math.round(sqft(g.area)).toLocaleString('en-US')} SF (${g.acres.toFixed(2)} acres)`);
  const within = (r: Rect, s: Rect) => r.x0 >= s.x0 - 0.5 && r.x1 <= s.x1 + 0.5 && r.y0 >= s.y0 - 0.5 && r.y1 <= s.y1 + 0.5;
  const checks: [string, Rect][] = [['The building', buildingBounds(design)], ...platforms(design).map((p) => [`The ${p.kind}`, p.rect] as [string, Rect])];
  for (const [name, r] of checks) {
    if (!within(r, g.lotRect)) push('error', 'lot-line', `${name} extends past the property line`);
    else if (!within(r, g.setback)) push('warning', 'setback', `${name} crosses a setback line (verify with the county and LCRA)`);
  }
  const d = g.dock;
  if (d) {
    if (Math.abs(d.gangway.y0 - g.shoreY) > 1 || Math.abs(d.gangway.y1 - d.body.y0) > 1) {
      push('error', 'dock-gangway', 'The dock gangway must run from the shoreline to the dock');
    }
    if (d.body.y0 <= g.shoreY) push('error', 'dock-shore', 'The dock must sit out in the lake, past the shoreline');
    if (d.gangway.x0 < d.lounge.x0 || d.gangway.x1 > d.lounge.x1) {
      push('error', 'dock-gangway', 'The gangway must land on the dock lounge deck, not the boat slip');
    }
    if (!within(d.slip, d.body)) push('error', 'dock-slip', 'The boat slip does not fit inside the dock');
    if (d.body.x0 < g.lotRect.x0 || d.body.x1 > g.lotRect.x1) {
      push('warning', 'dock-lot', 'The dock extends past the side lot lines extended into the lake');
    }
    push('info', 'dock-permit', 'Boat docks on Lake LBJ need an LCRA dock permit; verify setbacks and size limits');
  }
  for (const c of treeConflicts(design)) {
    const t = g.trees[c.index];
    push('warning', 'tree-conflict', `A ${t.species} at (${t.x}, ${t.y}) is too close to the house, a walk, the driveway, or the dock`);
  }
  g.trees.forEach((t) => {
    if (!inPolygon({ x: t.x, y: t.y }, g.lot)) push('warning', 'tree-lot', `A ${t.species} at (${t.x}, ${t.y}) is outside the lot`);
  });
}
