import { useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Tree, TreePreset } from '@dgreenheck/ez-tree';
import type { Design, TreeSpecies } from '../../../model/schema';
import { bbox, footprint, platforms, type Rect } from '../../../model/geometry';
import { keepOutRects, type SiteGeom } from '../../../model/site';
import { F, toWorld, type Frame } from '../House3D';
import { mulberry } from './util';

type G = NonNullable<SiteGeom>;
type Json = Record<string, any>;

/** Species tuned from EZ-Tree presets to read as Texas Hill Country trees. */
const SPECIES: Record<TreeSpecies | 'shrub', { preset: string; tweak: (o: Json) => void; spread: number }> = {
  // Live oak: short trunk, broad spreading crown, dark evergreen leaves.
  'live-oak': {
    preset: 'Oak Large',
    spread: 1.35,
    tweak: (o) => {
      o.bark.tint = 0x8a8078;
      o.branch.length['0'] = 30;
      o.branch.angle['1'] = 68;
      o.branch.angle['2'] = 50;
      o.branch.start['1'] = 0.3;
      o.branch.force.strength = -0.03;
      o.branch.children['0'] = 8;
      o.leaves.tint = 0x7f9a62;
      o.leaves.size = 3.6;
      o.leaves.count = 12;
    },
  },
  // Ashe juniper ("cedar"): dense, dark blue-green, conical.
  cedar: {
    preset: 'Pine Small',
    spread: 1.3,
    tweak: (o) => {
      o.bark.tint = 0x9a7f68;
      o.leaves.tint = 0x5f7d5c;
      o.leaves.count = Math.round(o.leaves.count * 1.5);
      o.leaves.size = o.leaves.size * 1.35;
    },
  },
  // Cedar elm: upright, airy crown.
  'cedar-elm': {
    preset: 'Ash Medium',
    spread: 1,
    tweak: (o) => {
      o.bark.tint = 0x9a948a;
      o.leaves.tint = 0x9fb885;
      o.leaves.count = Math.round(Math.max(o.leaves.count, 10) * 1.6);
      o.leaves.size = o.leaves.size * 1.4;
    },
  },
  shrub: {
    preset: 'Bush 1',
    spread: 1.3,
    tweak: (o) => {
      o.leaves.tint = 0x8fa877;
    },
  },
};

const VARIANT_SEEDS = [1203, 5417];
const TREE_OPACITY = 0.8;
/** Neighbors' trees on the lake side of the house are scaled down like the lot's own. */
const LAKESIDE_SCALE = 0.6;

type Template = { tree: Tree; height: number };

const cache = new Map<string, Template>();

function template(species: TreeSpecies | 'shrub', seed: number): Template {
  const variant = Math.abs(Math.floor(seed)) % VARIANT_SEEDS.length;
  const key = `${species}:${variant}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const spec = SPECIES[species];
  const json: Json = structuredClone((TreePreset as Record<string, Json>)[spec.preset]);
  json.seed = VARIANT_SEEDS[variant] + species.length * 31;
  spec.tweak(json);
  const tree = new Tree();
  tree.options.copy(json as never);
  tree.generate();
  // Slightly see-through trees so the house reads behind them (materials are shared by every clone).
  tree.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const m = o.material as THREE.Material;
    m.transparent = true;
    m.opacity = TREE_OPACITY;
    m.depthWrite = true;
  });
  const box = new THREE.Box3().setFromObject(tree);
  const t = { tree, height: box.max.y - box.min.y };
  cache.set(key, t);
  return t;
}

type Placement = { species: TreeSpecies | 'shrub'; x: number; y: number; height: number; seed: number };

/** The lot's trees, neighbors' trees beyond the lot lines, and shrubs along the front of the house. */
export function Trees({ design, fr, g, avoid }: { design: Design; fr: Frame; g: G; avoid: (p: THREE.Vector3) => boolean }) {
  const placements = useMemo(() => {
    const out: Placement[] = g.trees.map((t) => ({ ...t }));
    // Neighbors: a loose band of trees beyond each side lot line and across the street.
    const rnd = mulberry(77);
    const L = g.lotRect;
    const keep = keepOutRects(design, g);
    const lakeWall = bbox(footprint(design)).y1;
    let guard = 0;
    while (out.length < g.trees.length + 44 && guard++ < 4000) {
      const band = rnd();
      const x = band < 0.4 ? L.x0 - 120 - rnd() * 1200 : band < 0.8 ? L.x1 + 120 + rnd() * 1200 : L.x0 - 600 + rnd() * (L.x1 - L.x0 + 1200);
      const y = band < 0.8 ? L.y0 + rnd() * (g.shoreY - L.y0 - 240) : L.y0 - g.site.streetWidth - 200 - rnd() * 900;
      if (keep.some((r: Rect) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1)) continue;
      if (out.some((t) => Math.hypot(t.x - x, t.y - y) < 180)) continue;
      if (avoid(toWorld(fr, { x, y }, 0))) continue;
      const v = rnd();
      const species: TreeSpecies = v < 0.45 ? 'cedar' : v < 0.85 ? 'live-oak' : 'cedar-elm';
      const height = (species === 'cedar' ? 180 + rnd() * 140 : 330 + rnd() * 170) * (y > lakeWall ? LAKESIDE_SCALE : 1);
      out.push({ x, y, species, height, seed: Math.floor(rnd() * 1e5) });
    }
    // Foundation shrubs along the porch skirt, skipping the steps.
    const porch = platforms(design).find((p) => p.kind === 'porch');
    if (porch) {
      for (let x = porch.rect.x0 + 30; x < porch.rect.x1 - 20; x += 64) {
        if (porch.stairs && x > porch.stairs.rect.x0 - 30 && x < porch.stairs.rect.x1 + 30) continue;
        out.push({ species: 'shrub', x, y: porch.rect.y0 - 20, height: 40 + ((x * 7) % 12), seed: x });
      }
    }
    return out;
  }, [design, fr, g, avoid]);

  const group = useMemo(() => {
    const root = new THREE.Group();
    for (const p of placements) {
      const t = template(p.species, p.seed);
      const obj = t.tree.clone();
      const s = (p.height * F) / t.height;
      const spread = SPECIES[p.species].spread;
      obj.scale.set(s * spread, s, s * spread);
      obj.rotation.y = ((p.seed % 360) * Math.PI) / 180;
      obj.position.copy(toWorld(fr, p, g.grade));
      obj.traverse((o) => {
        o.castShadow = true;
        o.receiveShadow = true;
      });
      root.add(obj);
    }
    return root;
  }, [placements, fr, g]);

  // Leaves sway in the wind (the shader is shared by every clone of a template).
  useFrame(({ clock }) => {
    for (const t of cache.values()) t.tree.update(clock.elapsedTime);
  });

  return <primitive object={group} />;
}
