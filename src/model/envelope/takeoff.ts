import type { Design } from '../schema';
import { platforms, roomStats, skirtEdges, wallFace } from '../geometry';
import { frameModel } from '../framing';
import { platformLevels } from '../framing/levels';
import { roofSurfaces } from '../roofing';
import { wallFaces, type WallFaceArea } from './faces';

export type EnvelopeItem = {
  key: string;
  group: 'Siding' | 'Weather barrier and flashing' | 'Insulation' | 'Trim';
  item: string;
  qty: number;
  unit: 'SF' | 'LF' | 'ea.' | 'rolls';
  note: string;
};

/** The printed wording for the siding, from the envelope numbers. */
export const sidingPhrase = (design: Design) => {
  const s = design.envelope.siding;
  return `${s.board} board-and-batten siding (${s.batten} battens) on rain-screen furring`;
};

const sf = (sqIn: number) => sqIn / 144;
const lf = (inches: number) => inches / 12;

export type EnvelopeTakeoff = { faces: WallFaceArea[]; items: EnvelopeItem[] };

const cache = new WeakMap<Design, EnvelopeTakeoff>();

/** Siding, weather barrier, flashing, insulation, and exterior trim, measured from the walls and roofs. */
export function envelopeTakeoff(design: Design): EnvelopeTakeoff {
  const hit = cache.get(design);
  if (hit) return hit;
  const e = design.envelope;
  const faces = wallFaces(design);
  const model = frameModel(design);
  const roofs = roofSurfaces(design);
  const items: EnvelopeItem[] = [];
  const add = (key: string, group: EnvelopeItem['group'], item: string, qty: number, unit: EnvelopeItem['unit'], note: string) => {
    if (qty > 0.01) items.push({ key, group, item, qty, unit, note });
  };

  // --- siding
  const net = faces.reduce((s, f) => s + f.net, 0);
  const extra = 1 + e.siding.waste;
  const pl = platformLevels(design);
  const skirt = platforms(design)
    .filter((p) => p.skirt === 'solid')
    .reduce((s, p) => s + skirtEdges(design, p).reduce((t, [a, b]) => t + Math.hypot(b.x - a.x, b.y - a.y), 0) * (pl.joistBottom - pl.grade), 0);
  const sided = net + skirt;
  add('siding', 'Siding', `${e.siding.board} siding boards`, lf((sided / e.siding.module) * extra), 'LF', `${Math.round(sf(net))} SF of wall${skirt ? ` and ${Math.round(sf(skirt))} SF of porch skirt` : ''}, one board each ${e.siding.module}"; ${Math.round(e.siding.waste * 100)}% waste`);
  add('battens', 'Siding', `${e.siding.batten} battens`, lf((sided / e.siding.module) * extra), 'LF', 'One over each joint between boards');
  add('furring', 'Siding', `${e.siding.furring.size} rain-screen furring`, lf((sided / e.siding.furring.spacing) * extra), 'LF', `Level, ${e.siding.furring.spacing}" o.c., with gaps to drain`);
  add('base', 'Siding', 'Insect screen and base flashing', lf(faces.reduce((s, f) => s + f.base, 0)), 'LF', 'Along the bottom of the rain screen');

  // --- weather barrier and flashing
  const exposed = faces.reduce((s, f) => s + f.exposed, 0);
  const roll = e.wrap.rollWidth * e.wrap.rollLength;
  const lapped = (e.wrap.rollWidth / (e.wrap.rollWidth - e.wrap.lap)) * (1 + e.wrap.waste);
  add('wrap', 'Weather barrier and flashing', 'Weather-resistive barrier', Math.ceil((exposed * lapped) / roll - 1e-9), 'rolls', `${Math.round(sf(exposed))} SF of wall; ${e.wrap.rollWidth / 12}' x ${e.wrap.rollLength / 12}' rolls lapped ${e.wrap.lap}"`);
  const open = faces.flatMap((f) => f.openings.filter((o) => o.exposed).map((o) => o.opening));
  const ro = (id: string) => model.openings.find((r) => r.opening.id === id)!;
  add('tape', 'Weather barrier and flashing', 'Flashing tape at openings', lf(open.reduce((s, o) => s + 2 * (ro(o.id).w + ro(o.id).h), 0)), 'LF', `Around ${open.length} rough openings`);
  add('pans', 'Weather barrier and flashing', 'Sill pans', open.filter((o) => o.operation !== 'overhead').length, 'ea.', 'Under every window and exterior door');
  add('head', 'Weather barrier and flashing', 'Head flashing (drip cap)', lf(open.reduce((s, o) => s + o.width + 4, 0)), 'LF', 'Over every opening, lapped by the weather barrier');
  const ledgers = model.members.filter((m) => m.role === 'ledger').reduce((s, m) => s + m.length, 0);
  add('ledger', 'Weather barrier and flashing', 'Ledger flashing', lf(ledgers), 'LF', 'Over the deck and porch ledgers');

  // --- insulation
  add('walls', 'Insulation', e.insulation.walls, sf(faces.reduce((s, f) => s + f.insulated, 0)), 'SF', 'House exterior walls, to the ceiling or the roof; the garage is not heated');
  const rooms = design.rooms.filter((r) => !r.zone);
  const slope = Math.hypot(1, design.roof.pitch / 12);
  const area = (kind: 'flat' | 'vaulted') => rooms.filter((r) => r.ceiling === kind).reduce((s, r) => s + roomStats(design, r).area, 0);
  add('attic', 'Insulation', e.insulation.attic, sf(area('flat')), 'SF', 'Bedroom, bath, hall, closet, and laundry');
  add('vault', 'Insulation', e.insulation.vault, sf(area('vaulted') * slope), 'SF', 'Measured on the slope, between the rafters');

  // --- trim
  let corners = 0;
  let count = 0;
  const garage = roofs.find((r) => r.zone === 'garage');
  for (const w of model.walls) {
    if (!w.exterior) continue;
    for (const end of w.ends) {
      if (end.kind !== 'corner' || !end.through || end.other.type !== 'exterior') continue;
      const face = faces.find((f) => f.wall.id === w.wall.id);
      const bottom = face ? Math.min(...face.outline.map((p) => p.y)) : w.base;
      // Where the garage covers the wall around the corner, only the part above its roof shows.
      const hidden = (faces.find((f) => f.wall.id === end.other.id)?.covered ?? 0) > 0;
      const from = hidden && garage ? garage.frame.eaveTop : bottom;
      if (w.plate - from < 1) continue;
      corners += 2 * (w.plate - from);
      count++;
    }
  }
  add('corner', 'Trim', `${e.trim.corner} corner boards`, lf(corners), 'LF', `Two boards at each of ${count} outside corners`);
  add('casing', 'Trim', `${e.trim.casing} casing`, lf(open.reduce((s, o) => s + 2 * o.height + o.width * (o.kind === 'window' ? 2 : 1), 0)), 'LF', 'Around the windows and exterior doors');
  const eaves = roofs.reduce((s, r) => s + r.freeEaves * r.length, 0);
  const rakes = roofs.reduce((s, r) => s + r.freeRakes * (r.slopes[0] + r.slopes[1]), 0);
  add('fascia', 'Trim', `${e.trim.fascia} fascia`, lf(eaves), 'LF', 'Over the sub-fascia at the eaves');
  add('rake', 'Trim', `${e.trim.rake} rake boards`, lf(rakes), 'LF', 'On the fly rafters');
  const frieze = roofs.reduce((s, r) => s + r.freeEaves * (r.frame.aMax - r.frame.aMin), 0);
  add('frieze', 'Trim', `${e.trim.frieze} frieze boards`, lf(frieze), 'LF', 'Under the soffit, along the eave walls');
  const soffit = roofs.reduce((s, r) => {
    const rf = r.frame;
    const over = [rf.sMin - rf.eave0, rf.eave1 - rf.sMax].filter((o) => o > 0.5).reduce((t, o) => t + o * r.length, 0);
    const gable = [rf.aMin - rf.a0, rf.a1 - rf.aMax].filter((o) => o > 0.5).reduce((t, o) => t + o * (r.slopes[0] + r.slopes[1]), 0);
    return s + over + gable;
  }, 0);
  add('soffit', 'Trim', e.trim.soffit, sf(soffit), 'SF', 'Under the eave and rake overhangs');

  const t = { faces, items };
  cache.set(design, t);
  return t;
}

/** Side of the house a face looks toward, for the schedule. */
export const faceName = (design: Design, f: WallFaceArea) => `${f.zone === 'garage' ? 'Garage' : 'House'} ${wallFace(design, f.wall) ?? ''}`.trim();
