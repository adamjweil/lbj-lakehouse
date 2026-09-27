import type { Design } from '../schema';
import { pierLayout } from '../geometry';
import { formatFrac } from '../units';
import type { CeilingFrame } from './ceiling';
import type { HardwareItem, MemberDraft } from './types';

/** Note on a ceiling joist that hangs from the flush beam. */
export const HUNG = 'hung from the ceiling beam';

type Parts = {
  walls: MemberDraft[];
  floor: MemberDraft[];
  ceilings: CeilingFrame[];
  roofs: MemberDraft[];
  platforms: MemberDraft[];
};

/** Connectors and anchors, counted from the pieces they fasten. Types and sizes are by the engineer. */
export function hardware(design: Design, p: Parts): HardwareItem[] {
  const f = design.framing;
  const out: HardwareItem[] = [];
  const add = (key: string, item: string, use: string, count: number, pricedOn: HardwareItem['pricedOn'] = 'S-602') => {
    if (count > 0) out.push({ key, item, use, count, pricedOn });
  };
  const count = (list: MemberDraft[], role: MemberDraft['role']) => list.filter((m) => m.role === role).length;

  // --- walls
  const bolts = f.walls.anchorBolts;
  const sills = p.walls.filter((m) => m.role === 'bottom-plate' && m.material === 'PT');
  add(
    'anchor-bolt',
    '1/2" x 10" anchor bolt with washer',
    `Garage sill plates, ${formatFrac(bolts.spacing)} o.c. max., ${formatFrac(bolts.endDistance)} from each plate end`,
    sills.reduce((s, m) => s + Math.max(2, Math.ceil((m.length - 2 * bolts.endDistance) / bolts.spacing - 1e-9) + 1), 0),
  );
  const lvlHeaders = new Set(p.walls.filter((m) => m.role === 'header' && m.material === 'LVL').map((m) => `${m.group}:${m.note}`));
  add('header-hanger', 'Header hanger or bearing plate', 'LVL headers, each end (by engineer)', lvlHeaders.size * 2);
  const posts = new Set(p.walls.filter((m) => m.role === 'post').map((m) => m.group));
  add('post-cap', 'Column cap', 'Ridge beam to each ridge post', posts.size);

  // --- house floor
  const piers = pierLayout(design).piers;
  add('beam-seat', 'Beam seat with anchor', 'Built-up beams to the house piers', piers.filter((q) => !q.deck).length, 'A-103');
  const joists = p.floor.filter((m) => m.role === 'joist');
  const lines = new Set(joists.map((m) => m.o.x.toFixed(2))).size;
  add('joist-splice', 'Strap tie', 'Floor joist splices over the beams', joists.length - lines, 'A-103');

  // --- ceilings
  for (const c of p.ceilings) {
    add(`${c.zone.group}-hanger`, 'Face-mount joist hanger', `${c.zone.title} joists at the flush beam`, c.drafts.filter((m) => m.note?.includes(HUNG)).length);
    if (c.zone.beamAt !== null) add(`${c.zone.group}-beam-hanger`, 'Beam hanger', `${c.zone.title} beam, each end (by engineer)`, 2);
  }

  // --- roofs
  const rafters = count(p.roofs, 'rafter');
  add('hurricane-tie', 'Hurricane tie', 'Every rafter to the wall plate', rafters);
  add('rafter-hanger', 'Sloped rafter hanger', 'Every rafter to the ridge beam', rafters + count(p.roofs, 'fly-rafter'));

  // --- decks and porches
  const deckJoists = count(p.platforms, 'joist');
  add('deck-hanger', 'Joist hanger, hot-dip galvanized', 'Deck and porch joists at the ledger', deckJoists);
  add('deck-tie', 'Hurricane tie, hot-dip galvanized', 'Deck and porch joists at the beam', deckJoists);
  const ledger = p.platforms.filter((m) => m.role === 'ledger').reduce((s, m) => s + m.length, 0);
  add('ledger-screw', '1/2" x 4" structural screw', 'Ledger to the house rim, two rows staggered at 16" o.c.', Math.ceil(ledger / 16) * 2);
  add('lateral-tie', 'Deck lateral load connector', 'Deck and porch to the house floor framing, four per platform', new Set(p.platforms.filter((m) => m.role === 'ledger').map((m) => m.group)).size * 4);
  const deckPosts = count(p.platforms, 'deck-post');
  add('post-base', 'Post base, hot-dip galvanized', 'Deck and porch posts to the footings', deckPosts || piers.filter((q) => q.deck).length);
  add('deck-post-cap', 'Post cap, hot-dip galvanized', 'Deck and porch beams to the posts', deckPosts);
  add('guard-bolt', '1/2" x 8" carriage bolt', 'Guard posts to the rim, two per post', count(p.platforms, 'guard-post') * 2);
  add('stringer-hanger', 'Stair stringer connector', 'Stringers to the drop header', count(p.platforms, 'stringer'));
  return out;
}
