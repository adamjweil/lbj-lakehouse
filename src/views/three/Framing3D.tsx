import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { Design } from '../../model/schema';
import type { Vec } from '../../model/geometry';
import { frameModel, type Member, type SheathingKind } from '../../model/framing';
import type { Material } from '../../model/framing/lumber';
import { solidFaces, solidTriangles, type Solid } from '../../model/framing/solid';
import type { P3 } from '../../model/framing/types';
import { F, type Frame } from './House3D';

/**
 * The stick frame in 3D: every piece of the framing model, merged into one mesh per material
 * so the whole frame takes a handful of draw calls, plus one set of lines for the arrises.
 */

const LUMBER: Record<Exclude<Material, 'COMP'>, { color: string; roughness: number }> = {
  SYP: { color: '#d9b377', roughness: 0.85 },
  PT: { color: '#7d7a46', roughness: 0.9 },
  LVL: { color: '#96612f', roughness: 0.75 },
};

const SHEATHING: Record<SheathingKind, string> = {
  wall: '#b98d4f',
  roof: '#c9a268',
  subfloor: '#c2a06a',
};

const EDGE_COLOR = '#4a3520';

const MATERIALS: Material[] = ['SYP', 'PT', 'LVL', 'COMP'];
const KINDS: SheathingKind[] = ['subfloor', 'wall', 'roof'];

/**
 * Appends a solid's triangles in world coordinates. Building (x, y, z) in inches maps to
 * world (x, z, y) in feet, the same as `toWorld`. Swapping two axes mirrors the solid, so
 * the last two corners of each triangle trade places to keep its winding.
 */
function pushSolid(out: number[], fr: Frame, solid: Solid) {
  const t = solidTriangles(solid);
  const put = (i: number) => out.push((t[i] - fr.cx) * F, (t[i + 2] + fr.base) * F, (t[i + 1] - fr.cy) * F);
  for (let i = 0; i + 8 < t.length; i += 9) {
    put(i);
    put(i + 6);
    put(i + 3);
  }
}

/** Appends the solid's arrises as line segments: the outline of each face and the corners between them. */
function pushEdges(out: number[], fr: Frame, solid: Solid, skip?: (i: number) => boolean) {
  const [back, front] = solidFaces(solid);
  const put = (p: P3) => out.push((p.x - fr.cx) * F, (p.z + fr.base) * F, (p.y - fr.cy) * F);
  const n = back.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (!skip?.(i)) {
      put(back[i]);
      put(back[j]);
      put(front[i]);
      put(front[j]);
    }
    if (!skip) {
      put(back[i]);
      put(front[i]);
    }
  }
}

/** Edges that two pieces of one sheet share are cuts in the model, not seams, so they are not drawn. */
function sharedEdges(pieces: Vec[][]) {
  const key = (a: Vec, b: Vec) => {
    const ka = `${a.x.toFixed(2)},${a.y.toFixed(2)}`;
    const kb = `${b.x.toFixed(2)},${b.y.toFixed(2)}`;
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  const count = new Map<string, number>();
  for (const piece of pieces) {
    piece.forEach((a, i) => {
      const k = key(a, piece[(i + 1) % piece.length]);
      count.set(k, (count.get(k) ?? 0) + 1);
    });
  }
  return (piece: Vec[], i: number) => (count.get(key(piece[i], piece[(i + 1) % piece.length])) ?? 0) > 1;
}

function merged(positions: number[], lines = false): THREE.BufferGeometry | null {
  if (!positions.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  // Not indexed, so every triangle gets its own flat normal.
  if (!lines) g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Disposes GPU resources when they are replaced and when the view unmounts. */
function useDisposal(items: ({ dispose: () => void } | null)[]) {
  useEffect(
    () => () => {
      for (const it of items) it?.dispose();
    },
    [items],
  );
}

export function Framing3D({
  design,
  fr,
  showSheathing,
  showRoof,
}: {
  design: Design;
  fr: Frame;
  /** Sheathing panels and the deck boards, which cover the frame. */
  showSheathing: boolean;
  showRoof: boolean;
}) {
  const mats = useMemo(() => {
    // Faces sit a little behind the edge lines drawn along their arrises.
    const solid = { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
    const lumber = (m: Exclude<Material, 'COMP'>) => new THREE.MeshStandardMaterial({ ...LUMBER[m], ...solid });
    const sheet = (k: SheathingKind) =>
      new THREE.MeshStandardMaterial({ color: SHEATHING[k], roughness: 0.95, ...solid, transparent: true, opacity: 0.85 });
    return {
      members: {
        SYP: lumber('SYP'),
        PT: lumber('PT'),
        LVL: lumber('LVL'),
        COMP: new THREE.MeshStandardMaterial({ color: design.materials.deck, roughness: 0.8, ...solid }),
      } satisfies Record<Material, THREE.Material>,
      panels: { wall: sheet('wall'), roof: sheet('roof'), subfloor: sheet('subfloor') } satisfies Record<SheathingKind, THREE.Material>,
      edges: new THREE.LineBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: 0.4 }),
    };
  }, [design.materials.deck]);

  const frame = useMemo(() => {
    const positions: Record<Material, number[]> = { SYP: [], PT: [], LVL: [], COMP: [] };
    const hidden = (m: Member) =>
      (!showRoof && (m.system === 'roof' || m.system === 'ceiling')) ||
      // Deck boards hide the joists under them, so they come and go with the sheathing.
      (!showSheathing && m.role === 'decking');
    const edges: number[] = [];
    for (const m of frameModel(design).members) {
      if (hidden(m)) continue;
      pushSolid(positions[m.material], fr, m);
      pushEdges(edges, fr, m);
    }
    return { meshes: MATERIALS.map((material) => ({ material, geo: merged(positions[material]) })), edges: merged(edges, true) };
  }, [design, fr, showRoof, showSheathing]);

  const sheathing = useMemo(() => {
    if (!showSheathing) return { meshes: [], edges: null };
    const positions: Record<SheathingKind, number[]> = { wall: [], roof: [], subfloor: [] };
    const edges: number[] = [];
    for (const p of frameModel(design).panels) {
      if (!showRoof && p.kind === 'roof') continue;
      const shared = sharedEdges(p.pieces);
      for (const piece of p.pieces) {
        if (piece.length < 3) continue;
        const solid = { o: p.o, u: p.u, v: p.v, profile: piece, t: p.t };
        pushSolid(positions[p.kind], fr, solid);
        // Sheet outlines only, so the seams between sheets show.
        pushEdges(edges, fr, solid, (i) => shared(piece, i));
      }
    }
    return { meshes: KINDS.map((kind) => ({ kind, geo: merged(positions[kind]) })), edges: merged(edges, true) };
  }, [design, fr, showRoof, showSheathing]);

  const frameGeos = useMemo(() => [...frame.meshes.map((f) => f.geo), frame.edges], [frame]);
  const sheathingGeos = useMemo(() => [...sheathing.meshes.map((s) => s.geo), sheathing.edges], [sheathing]);
  const allMats = useMemo(() => [...Object.values(mats.members), ...Object.values(mats.panels), mats.edges], [mats]);
  useDisposal(frameGeos);
  useDisposal(sheathingGeos);
  useDisposal(allMats);

  return (
    <group>
      {frame.meshes.map(
        ({ material, geo }) => geo && <mesh key={material} geometry={geo} material={mats.members[material]} castShadow receiveShadow />,
      )}
      {frame.edges && <lineSegments geometry={frame.edges} material={mats.edges} />}
      {sheathing.meshes.map(
        ({ kind, geo }) => geo && <mesh key={kind} geometry={geo} material={mats.panels[kind]} castShadow receiveShadow renderOrder={1} />,
      )}
      {sheathing.edges && <lineSegments geometry={sheathing.edges} material={mats.edges} renderOrder={2} />}
    </group>
  );
}
