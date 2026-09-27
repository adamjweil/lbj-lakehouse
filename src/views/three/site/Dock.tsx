import { useMemo, type ReactNode } from 'react';
import * as THREE from 'three';
import type { Design } from '../../../model/schema';
import type { Rect, Vec } from '../../../model/geometry';
import type { SiteGeom } from '../../../model/site';
import { F, toWorld, type Frame } from '../House3D';
import { textures } from '../materials';
import { barMatrix, boxFor } from './util';

type G = NonNullable<SiteGeom>;
type Dock = NonNullable<G['dock']>;

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, matrices: THREE.Matrix4[], shadow = true) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, matrices.length));
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.count = matrices.length;
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  return mesh;
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 14);

/** Box matrix spanning a plan rect between two heights. */
function rectMatrix(fr: Frame, r: Rect, bottom: number, top: number) {
  const b = boxFor(fr, r, bottom, top);
  return new THREE.Matrix4().compose(b.pos, new THREE.Quaternion(), new THREE.Vector3(...b.size));
}

export function DockMesh({ design, fr, g }: { design: Design; fr: Frame; g: G }) {
  const d = g.dock;
  const built = useMemo(() => (d ? buildDock(design, fr, g, d) : null), [design, fr, g, d]);
  if (!built) return null;
  return <group>{built}</group>;
}

function buildDock(design: Design, fr: Frame, g: G, d: Dock): ReactNode {
  const m = design.materials;
  const deckTex = textures().deck;
  const surface = (r: Rect) => {
    const t = deckTex.clone();
    t.needsUpdate = true;
    t.repeat.set(((r.x1 - r.x0) * F) / 1, ((r.y1 - r.y0) * F) / 1);
    return new THREE.MeshStandardMaterial({ color: m.deck, map: t, roughness: 0.85 });
  };
  const framing = new THREE.MeshStandardMaterial({ color: new THREE.Color(m.deck).multiplyScalar(0.6), roughness: 0.9 });
  const pileMat = new THREE.MeshStandardMaterial({ color: '#5a4634', roughness: 0.95 });
  const wetMat = new THREE.MeshStandardMaterial({ color: '#2b2722', roughness: 0.7 });
  const steel = new THREE.MeshStandardMaterial({ color: '#9aa0a6', roughness: 0.35, metalness: 0.8 });

  const parts: ReactNode[] = [];
  const deckBottom = d.deckTop - 1.5;

  // Walking surfaces and their framing.
  d.walkRects.forEach((r, i) => {
    const s = boxFor(fr, r, deckBottom, d.deckTop);
    parts.push(
      <mesh key={`deck${i}`} position={s.pos} material={surface(r)} castShadow receiveShadow>
        <boxGeometry args={s.size} />
      </mesh>,
    );
    const inset = { x0: r.x0 + 1, x1: r.x1 - 1, y0: r.y0 + 1, y1: r.y1 - 1 };
    parts.push(<primitive key={`frame${i}`} object={instanced(unitBox, framing, [rectMatrix(fr, inset, deckBottom - 9.25, deckBottom)])} />);
  });

  // Timber piles with a dark wet band at the waterline. On an open dock they stand above the deck for tie-up.
  const pileTop = d.deckTop + 18;
  const pileBottom = g.bottom - 24;
  parts.push(
    <primitive
      key="piles"
      object={instanced(
        unitCyl,
        pileMat,
        d.piles.map((p) =>
          new THREE.Matrix4().compose(toWorld(fr, p, (pileTop + pileBottom) / 2), new THREE.Quaternion(), new THREE.Vector3(10 * F, (pileTop - pileBottom) * F, 10 * F)),
        ),
      )}
    />,
    <primitive
      key="wet"
      object={instanced(
        unitCyl,
        wetMat,
        d.piles.map((p) =>
          new THREE.Matrix4().compose(toWorld(fr, p, g.water + 2), new THREE.Quaternion(), new THREE.Vector3(10.6 * F, 14 * F, 10.6 * F)),
        ),
        false,
      )}
    />,
  );

  // Boat lift: four steel posts, two beams, and bunks. Without one, the boat floats in the slip.
  const slipX = (d.slip.x0 + d.slip.x1) / 2;
  if (d.spec.boat && !d.lift.length) {
    parts.push(<Boat key="boat" fr={fr} center={{ x: slipX, y: (d.slip.y0 + d.slip.y1) / 2 + 12 }} keel={g.water - FLOATING_DRAFT} />);
  }
  if (d.lift.length) {
    const top = d.deckTop + 66;
    const lift: THREE.Matrix4[] = d.lift.map((p) =>
      new THREE.Matrix4().compose(toWorld(fr, p, (g.bottom + top) / 2), new THREE.Quaternion(), new THREE.Vector3(5 * F, (top - g.bottom) * F, 5 * F)),
    );
    const beams = [
      barMatrix(toWorld(fr, d.lift[0], top - 3), toWorld(fr, d.lift[1], top - 3), 6 * F, 4 * F),
      barMatrix(toWorld(fr, d.lift[2], top - 3), toWorld(fr, d.lift[3], top - 3), 6 * F, 4 * F),
    ];
    const cx = (d.slip.x0 + d.slip.x1) / 2;
    const bunkH = g.water + 14;
    const bunks = [-26, 26].map((dx) =>
      rectMatrix(fr, { x0: cx + dx - 2, x1: cx + dx + 2, y0: d.lift[0].y - 6, y1: d.lift[2].y + 6 }, bunkH - 4, bunkH),
    );
    const cross = [d.lift[0], d.lift[2]].map((p) =>
      rectMatrix(fr, { x0: d.slip.x0 + 8, x1: d.slip.x1 - 8, y0: p.y - 3, y1: p.y + 3 }, bunkH - 9, bunkH - 4),
    );
    parts.push(<primitive key="lift" object={instanced(unitBox, steel, [...lift, ...beams, ...cross])} />);
    parts.push(<primitive key="bunks" object={instanced(unitBox, framing, bunks)} />);
    if (d.spec.boat) parts.push(<Boat key="boat" fr={fr} center={{ x: cx, y: (d.slip.y0 + d.slip.y1) / 2 + 12 }} keel={bunkH} />);
  }

  // Swim ladder at the end of the lounge deck.
  const ladder: THREE.Matrix4[] = [];
  const lx = d.ladder.x;
  const ly = d.ladder.y + 3;
  for (const dx of [-9, 9]) {
    ladder.push(barMatrix(toWorld(fr, { x: lx + dx, y: ly }, g.water - 30), toWorld(fr, { x: lx + dx, y: ly }, d.deckTop + 30), 1.6 * F, 1.6 * F));
  }
  for (let h = g.water - 24; h < d.deckTop; h += 12) {
    ladder.push(barMatrix(toWorld(fr, { x: lx - 9, y: ly }, h), toWorld(fr, { x: lx + 9, y: ly }, h), 1.2 * F, 3 * F));
  }
  parts.push(<primitive key="ladder" object={instanced(unitBox, steel, ladder)} />);

  // A couple of loungers on the lounge deck, for scale.
  const chair = new THREE.MeshStandardMaterial({ color: '#e9e4d8', roughness: 0.7 });
  const lounge = d.lounge;
  const chairs: THREE.Matrix4[] = [];
  for (const dy of [0, 96]) {
    const base = { x: (lounge.x0 + lounge.x1) / 2, y: lounge.y0 + 72 + dy };
    chairs.push(rectMatrix(fr, { x0: base.x - 13, x1: base.x + 13, y0: base.y - 34, y1: base.y + 34 }, d.deckTop + 8, d.deckTop + 12));
    chairs.push(barMatrix(toWorld(fr, { x: base.x, y: base.y - 34 }, d.deckTop + 12), toWorld(fr, { x: base.x, y: base.y - 48 }, d.deckTop + 30), 26 * F, 2 * F));
  }
  parts.push(<primitive key="chairs" object={instanced(unitBox, chair, chairs)} />);

  return parts;
}

/** How far the keel of a floating boat sits below the water. */
const FLOATING_DRAFT = 12;

/** A simple runabout in the slip, on the lift or afloat, bow toward shore. */
function Boat({ fr, center, keel }: { fr: Frame; center: Vec; keel: number }) {
  const parts = useMemo(() => {
    const L = 264 * F;
    const Bm = 90 * F;
    const hullShape = (inset: number) => {
      const s = new THREE.Shape();
      const hw = Bm / 2 - inset;
      const hl = L / 2 - inset;
      s.moveTo(-hw * 0.9, -hl);
      s.lineTo(hw * 0.9, -hl);
      s.lineTo(hw, -hl * 0.2);
      s.quadraticCurveTo(hw * 0.95, hl * 0.6, 0, hl);
      s.quadraticCurveTo(-hw * 0.95, hl * 0.6, -hw, -hl * 0.2);
      s.closePath();
      return s;
    };
    const hull = new THREE.ExtrudeGeometry(hullShape(0), { depth: 30 * F, bevelEnabled: true, bevelThickness: 6 * F, bevelSize: 5 * F, bevelSegments: 4 });
    hull.rotateX(-Math.PI / 2);
    const stripe = new THREE.ExtrudeGeometry(hullShape(-0.15 * F), { depth: 5 * F, bevelEnabled: false });
    stripe.rotateX(-Math.PI / 2);
    stripe.translate(0, 18 * F, 0);
    const deck = new THREE.ExtrudeGeometry(hullShape(4 * F), { depth: 1 * F, bevelEnabled: false });
    deck.rotateX(-Math.PI / 2);
    deck.translate(0, 34 * F, 0);
    return { hull, stripe, deck, L, Bm };
  }, []);
  const p = toWorld(fr, center, keel + 6);
  const white = new THREE.MeshStandardMaterial({ color: '#f4f4f1', roughness: 0.25, metalness: 0.05 });
  const navy = new THREE.MeshStandardMaterial({ color: '#1f3a5a', roughness: 0.4 });
  const cream = new THREE.MeshStandardMaterial({ color: '#e6ddc8', roughness: 0.7 });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#9fb8c8', transparent: true, opacity: 0.35, roughness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: '#2a2d30', roughness: 0.5 });
  const { L, Bm } = parts;
  return (
    <group position={p}>
      <mesh geometry={parts.hull} material={white} castShadow receiveShadow />
      <mesh geometry={parts.stripe} material={navy} castShadow />
      <mesh geometry={parts.deck} material={cream} receiveShadow />
      {/* seats */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * Bm * 0.22, 40 * F, L * 0.05]} material={navy} castShadow>
          <boxGeometry args={[22 * F, 12 * F, 24 * F]} />
        </mesh>
      ))}
      <mesh position={[0, 40 * F, L * 0.36]} material={navy} castShadow>
        <boxGeometry args={[Bm * 0.8, 12 * F, 26 * F]} />
      </mesh>
      {/* windshield and console */}
      <mesh position={[0, 46 * F, -L * 0.08]} rotation={[-0.5, 0, 0]} material={glass}>
        <boxGeometry args={[Bm * 0.78, 14 * F, 0.6 * F]} />
      </mesh>
      <mesh position={[Bm * 0.22, 42 * F, -L * 0.02]} material={cream} castShadow>
        <boxGeometry args={[22 * F, 16 * F, 14 * F]} />
      </mesh>
      {/* outboard motor */}
      <mesh position={[0, 30 * F, L / 2 + 10 * F]} material={dark} castShadow>
        <boxGeometry args={[16 * F, 40 * F, 18 * F]} />
      </mesh>
    </group>
  );
}
