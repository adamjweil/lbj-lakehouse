import type { Design } from '../schema';
import { formatFrac } from '../units';
import { roundCut } from './lumber';
import type { Assembly, FrameModel, Member, MemberDraft, Role, WallFrame } from './types';
import { frameCeilings } from './ceiling';
import { frameFloor } from './floor';
import { hardware } from './hardware';
import { framePlatforms } from './platforms';
import { frameRoof, roofGroup } from './roof';
import { sheathe } from './sheathing';
import { frameWalls, type WallInfo } from './walls';

export * from './types';

/** Piece-mark prefixes by role. */
const MARK: Record<Role, string> = {
  'bottom-plate': 'BP', 'top-plate': 'TP', 'cap-plate': 'CP', 'rake-plate': 'RP',
  stud: 'S', 'end-stud': 'S', 'corner-nailer': 'S', king: 'K', jack: 'J', cripple: 'C',
  header: 'H', sill: 'SL', backing: 'BK', fireblock: 'FB', post: 'P',
  beam: 'BM', joist: 'FJ', rim: 'RJ', blocking: 'BL',
  'ceiling-joist': 'CJ', ledger: 'LG',
  rafter: 'R', 'fly-rafter': 'FR', ridge: 'RB', lookout: 'LK', 'sub-fascia': 'SF',
  'deck-post': 'DP', decking: 'DK', 'guard-post': 'GP', rail: 'RL', baluster: 'BA', stringer: 'ST', tread: 'TR',
};

/** Identical pieces share a mark: same prefix, size, material, length, and cut. */
function assignMarks(members: Member[]) {
  const groups = new Map<string, Member[]>();
  for (const m of members) {
    const key = [MARK[m.role], m.size, m.material, roundCut(m.length), m.cut].join('|');
    const list = groups.get(key) ?? [];
    list.push(m);
    groups.set(key, list);
  }
  const byPrefix = new Map<string, Member[][]>();
  for (const list of groups.values()) {
    const prefix = MARK[list[0].role];
    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), list]);
  }
  for (const [prefix, lists] of byPrefix) {
    lists.sort((a, b) => a[0].size.localeCompare(b[0].size, undefined, { numeric: true }) || b[0].length - a[0].length || a[0].cut.localeCompare(b[0].cut));
    lists.forEach((list, i) => list.forEach((m) => (m.mark = `${prefix}${i + 1}`)));
  }
}

function withIds(group: string, drafts: MemberDraft[]): Member[] {
  const counts = new Map<string, number>();
  return drafts.map((d) => {
    const n = (counts.get(d.role) ?? 0) + 1;
    counts.set(d.role, n);
    return { ...d, id: `${group}/${d.role}-${n}`, mark: '' };
  });
}

function build(design: Design): FrameModel {
  const framed = frameWalls(design);
  const infos: WallInfo[] = framed.map(({ info, openings }) => ({ ...info, openings }));
  const walls: WallFrame[] = framed.map(({ info, openings, drafts }) => ({
    ...info,
    openings,
    members: withIds(info.wall.id, drafts),
  }));

  const floor = frameFloor(design);
  const ceilings = frameCeilings(design);
  const roofs = ([undefined, 'garage'] as const).map((zone) => ({
    zone,
    drafts: frameRoof(design, zone, ceilings.find((c) => c.zone.zone === zone)?.atEaves),
  }));
  const decks = framePlatforms(design);

  const list: Assembly[] = [
    { group: 'floor', system: 'floor' as const, title: 'Floor', members: withIds('floor', floor) },
    ...ceilings.map((c): Assembly => ({ group: c.zone.group, system: 'ceiling', zone: c.zone.zone, title: c.zone.title, members: withIds(c.zone.group, c.drafts) })),
    ...roofs
      .filter((r) => r.drafts.length)
      .map((r): Assembly => ({ group: roofGroup(r.zone), system: 'roof', zone: r.zone, title: r.zone ? 'Garage roof' : 'Roof', members: withIds(roofGroup(r.zone), r.drafts) })),
    ...decks.map((d): Assembly => ({ group: d.platform.kind, system: 'platform', title: d.platform.kind === 'deck' ? 'Deck' : 'Porch', members: withIds(d.platform.kind, d.drafts) })),
  ];
  const assemblies = list.filter((a) => a.members.length);

  const members = [...walls.flatMap((w) => w.members), ...assemblies.flatMap((a) => a.members)];
  assignMarks(members);
  return {
    walls,
    assemblies,
    members,
    panels: sheathe(design, infos),
    hardware: hardware(design, {
      walls: framed.flatMap((w) => w.drafts),
      floor,
      ceilings,
      roofs: roofs.flatMap((r) => r.drafts),
      platforms: decks.flatMap((d) => d.drafts),
    }),
    openings: walls.flatMap((w) => w.openings).sort((a, b) => a.opening.tag.localeCompare(b.opening.tag, undefined, { numeric: true })),
  };
}

const cache = new WeakMap<Design, FrameModel>();

/** Every piece of framing in the design. Cached per design object, which the editor replaces on each edit. */
export function frameModel(design: Design): FrameModel {
  let m = cache.get(design);
  if (!m) {
    m = build(design);
    cache.set(design, m);
  }
  return m;
}

/** Cut length as the shop writes it, e.g. 103-1/2". */
export const formatCut = (inches: number) => formatFrac(roundCut(inches));
