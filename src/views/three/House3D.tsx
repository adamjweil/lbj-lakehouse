import { useMemo, type ReactNode } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import type { Design, Fixture, Opening, Wall } from '../../model/schema';
import {
  floorAt, platformRailings, platforms, skirtEdges, stairHandrails, PLATFORM_TOP, type Platform, footprint, footprintBounds, garageEntry, garageFootprint, garageRoofFrame,
  openingRange, outwardNormal, pierLayout, pointInPolygon, roofFrame, roofFrames, roomStats, wallDir, wallProfile,
  zoneFloor, add, mul, norm, bbox, type RoofFrame, type Vec,
} from '../../model/geometry';
import { floorLevels, PLATFORM_FOOTING } from '../../model/framing/levels';
import type { Selection } from '../../editor/store';
import { Framing3D } from './Framing3D';
import { floorLook, textures } from './materials';

/** 1 world unit = 1 foot. */
export const F = 1 / 12;
const SELECT = new THREE.Color('#2f81f7');
/** Height of the concrete footing under each deck post. */
const DECK_FOOTING = PLATFORM_FOOTING;

export type Frame = { cx: number; cy: number; base: number };

export function worldFrame(design: Design): Frame {
  const b = footprintBounds(design);
  return { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, base: design.levels.floorHeight };
}

/** Plan point + height above FF -> world position. */
export const toWorld = (fr: Frame, p: Vec, h: number) => new THREE.Vector3((p.x - fr.cx) * F, (h + fr.base) * F, (p.y - fr.cy) * F);

type Pick = (s: Selection) => void;

function clickable(ref: Selection, onPick?: Pick) {
  if (!onPick || !ref) return {};
  return {
    onClick: (e: ThreeEvent<MouseEvent>) => {
      if (e.delta > 4) return;
      e.stopPropagation();
      onPick(ref);
    },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      document.body.style.cursor = 'pointer';
    },
    onPointerOut: () => {
      document.body.style.cursor = '';
    },
  };
}

const highlighted = new WeakMap<THREE.Material, THREE.Material>();

function highlight<T extends THREE.MeshStandardMaterial>(m: T, on: boolean): T {
  if (!on) return m;
  let c = highlighted.get(m) as T | undefined;
  if (!c) {
    c = m.clone();
    c.emissive = SELECT;
    c.emissiveIntensity = 0.45;
    highlighted.set(m, c);
  }
  return c;
}

const fixtureMats = new Map<string, THREE.MeshStandardMaterial>();

/** Shared fixture materials, keyed by their parameters. */
function fixtureMat(color: string, extra: THREE.MeshStandardMaterialParameters, selected: boolean) {
  const key = JSON.stringify([color, extra]);
  let m = fixtureMats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra });
    fixtureMats.set(key, m);
  }
  return highlight(m, selected);
}

/** Matrix mapping a wall's (u along, v up, z right-normal) frame into the world. */
function wallMatrix(fr: Frame, w: Wall) {
  const d = wallDir(w);
  const m = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(d.x, 0, d.y),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(-d.y, 0, d.x),
  );
  const o = toWorld(fr, w.start, 0);
  m.setPosition(o);
  return m;
}

function extrude(outline: Vec[], holes: [number, number, number, number][], depth: number, z0: number) {
  const shape = new THREE.Shape(outline.map((q) => new THREE.Vector2(q.x * F, q.y * F)));
  for (const [a, b, c, d] of holes) {
    const path = new THREE.Path();
    path.moveTo(a * F, b * F);
    path.lineTo(c * F, b * F);
    path.lineTo(c * F, d * F);
    path.lineTo(a * F, d * F);
    path.closePath();
    shape.holes.push(path);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: depth * F, bevelEnabled: false });
  g.translate(0, 0, z0 * F);
  return g;
}

export type HouseOptions = {
  showRoof: boolean;
  showFurniture: boolean;
  /** `framing` swaps the finished house for its stick frame. */
  display: 'finished' | 'framing';
  /** Sheathing over the frame (framing display only). */
  showSheathing: boolean;
};

export function House3D({
  design,
  selection,
  onPick,
  options,
}: {
  design: Design;
  selection: Selection;
  onPick?: Pick;
  options: HouseOptions;
}) {
  const fr = useMemo(() => worldFrame(design), [design]);
  const mats = useMemo(() => makeMats(design), [design.materials]);

  if (options.display === 'framing') {
    // The frame stands on the same concrete: piers, footings, and the garage slab.
    return (
      <group>
        <Foundation design={design} fr={fr} mats={mats} concreteOnly />
        <Framing3D design={design} fr={fr} showSheathing={options.showSheathing} showRoof={options.showRoof} />
      </group>
    );
  }

  return (
    <group>
      <Foundation design={design} fr={fr} mats={mats} />
      {design.walls.map((w) => (
        <WallMesh
          key={w.id}
          design={design}
          fr={fr}
          wall={w}
          mats={mats}
          selected={selection?.kind === 'wall' && selection.id === w.id}
          selection={selection}
          onPick={onPick}
        />
      ))}
      <Floors design={design} fr={fr} selection={selection} onPick={onPick} />
      {options.showRoof && <Roofs design={design} fr={fr} mats={mats} />}
      <GarageEntryMesh design={design} fr={fr} mats={mats} />
      {options.showRoof && <Ceilings design={design} fr={fr} mats={mats} />}
      {platforms(design).map((dg) => (
        <Deck key={dg.kind} design={design} fr={fr} mats={mats} dg={dg} />
      ))}
      {options.showFurniture &&
        design.fixtures.map((f) => (
          <FixtureMesh
            key={f.id}
            design={design}
            fr={fr}
            f={f}
            selected={selection?.kind === 'fixture' && selection.id === f.id}
            onPick={onPick}
            mats={mats}
          />
        ))}
    </group>
  );
}

function makeMats(design: Design) {
  const t = textures();
  const siding = t.siding.clone();
  siding.needsUpdate = true;
  return {
    siding: new THREE.MeshStandardMaterial({ color: design.materials.siding, map: siding, roughness: 0.85 }),
    interior: new THREE.MeshStandardMaterial({ color: design.materials.interior, roughness: 0.95 }),
    trim: new THREE.MeshStandardMaterial({ color: design.materials.trim, roughness: 0.7 }),
    roof: new THREE.MeshStandardMaterial({ color: design.materials.roof, roughness: 0.45, metalness: 0.3 }),
    frame: new THREE.MeshStandardMaterial({ color: design.materials.windowFrame, roughness: 0.5 }),
    door: new THREE.MeshStandardMaterial({ color: design.materials.door, roughness: 0.6 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: design.materials.glass,
      roughness: 0.05,
      metalness: 0.1,
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    deck: new THREE.MeshStandardMaterial({ color: design.materials.deck, map: t.deck, roughness: 0.8 }),
    deckDark: new THREE.MeshStandardMaterial({ color: new THREE.Color(design.materials.deck).multiplyScalar(0.75), roughness: 0.85 }),
    lattice: new THREE.MeshStandardMaterial({ color: design.materials.trim, map: t.lattice, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 }),
    concrete: new THREE.MeshStandardMaterial({ color: '#a9a59c', roughness: 1 }),
    lumber: new THREE.MeshStandardMaterial({ color: '#8c7456', roughness: 0.9 }),
    pine: new THREE.MeshStandardMaterial({ color: '#d9b98c', map: t.plank, roughness: 0.8, side: THREE.DoubleSide }),
    ceiling: new THREE.MeshStandardMaterial({ color: '#f4f2ee', roughness: 1 }),
    metal: new THREE.MeshStandardMaterial({ color: '#2b2e31', roughness: 0.4, metalness: 0.7 }),
    skirt: new THREE.MeshStandardMaterial({ color: design.materials.siding, map: siding, roughness: 0.85, side: THREE.DoubleSide }),
  };
}

type Mats = ReturnType<typeof makeMats>;

// ---------------------------------------------------------------- walls & openings

function WallMesh(props: {
  design: Design;
  fr: Frame;
  wall: Wall;
  mats: Mats;
  selected: boolean;
  selection: Selection;
  onPick?: Pick;
}) {
  const { design, fr, wall: w, mats } = props;
  const { matrix, layers } = useMemo(() => {
    const prof = wallProfile(design, w);
    const holes = prof.holes.map((h) => h.rect);
    const t = w.thickness;
    const layers: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
    if (w.type === 'exterior') {
      const d = wallDir(w);
      const right = { x: -d.y, y: d.x };
      const on = outwardNormal(design, w);
      const outsideRight = right.x * on.x + right.y * on.y > 0;
      const sid = 1;
      if (outsideRight) {
        layers.push({ geo: extrude(prof.outline, holes, t - sid, -t / 2), mat: mats.interior });
        layers.push({ geo: extrude(prof.outline, holes, sid, t / 2 - sid), mat: mats.siding });
      } else {
        layers.push({ geo: extrude(prof.outline, holes, sid, -t / 2), mat: mats.siding });
        layers.push({ geo: extrude(prof.outline, holes, t - sid, -t / 2 + sid), mat: mats.interior });
      }
    } else {
      layers.push({ geo: extrude(prof.outline, holes, t, -t / 2), mat: mats.interior });
    }
    return { matrix: wallMatrix(fr, w), layers };
  }, [design, fr, w, mats]);
  const pick = clickable({ kind: 'wall', id: w.id }, props.onPick);
  const openings = design.openings.filter((o) => o.wallId === w.id);
  return (
    <group matrix={matrix} matrixAutoUpdate={false}>
      {layers.map((l, i) => (
        <mesh
          key={i}
          geometry={l.geo}
          material={props.selected ? highlight(l.mat as THREE.MeshStandardMaterial, true) : l.mat}
          castShadow
          receiveShadow
          {...pick}
        />
      ))}
      {openings.map((o) => (
        <OpeningMesh
          key={o.id}
          design={design}
          wall={w}
          o={o}
          mats={mats}
          selected={props.selection?.kind === 'opening' && props.selection.id === o.id}
          onPick={props.onPick}
        />
      ))}
    </group>
  );
}

function OpeningMesh(props: { design: Design; wall: Wall; o: Opening; mats: Mats; selected: boolean; onPick?: Pick }) {
  const { wall: w, o, mats } = props;
  const [u0, u1] = openingRange(o);
  // Local +z is the wall's right-hand side; put exterior details on the outside face.
  const d = wallDir(w);
  const out = w.type === 'exterior' ? outwardNormal(props.design, w) : { x: -d.y, y: d.x };
  const outZ = Math.sign(-d.y * out.x + d.x * out.y) || 1;
  const faceRot: [number, number, number] = [0, outZ > 0 ? 0 : Math.PI, 0];
  const width = u1 - u0;
  const cu = (u0 + u1) / 2;
  const cv = o.sill + o.height / 2;
  const t = w.thickness;
  const pick = clickable({ kind: 'opening', id: o.id }, props.onPick);
  const frameMat = highlight(o.kind === 'door' && o.operation !== 'cased' ? mats.trim : mats.frame, props.selected);
  const parts: ReactNode[] = [];
  const box = (key: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, mat: THREE.Material, extra = {}) => (
    <mesh key={key} position={[x * F, y * F, z * F]} material={mat} castShadow {...extra}>
      <boxGeometry args={[sx * F, sy * F, sz * F]} />
    </mesh>
  );
  const fw = 2;
  // Frame: jambs, head, sill (skipped at the floor for doors)
  parts.push(box('jl', u0 + fw / 2, cv, 0, fw, o.height, t + 0.5, frameMat));
  parts.push(box('jr', u1 - fw / 2, cv, 0, fw, o.height, t + 0.5, frameMat));
  parts.push(box('hd', cu, o.sill + o.height - fw / 2, 0, width, fw, t + 0.5, frameMat));
  if (o.sill > 0.5) parts.push(box('sl', cu, o.sill + fw / 2, 0, width + 3, fw, t + 2, frameMat));

  const innerW = width - fw * 2;
  const innerH = o.height - fw * (o.sill > 0.5 ? 2 : 1);
  const innerV = o.sill + (o.sill > 0.5 ? fw : 0) + innerH / 2;
  if (o.kind === 'window' || o.kind === 'slider') {
    parts.push(
      <mesh key="glass" position={[cu * F, innerV * F, 0]} material={mats.glass} {...pick}>
        <planeGeometry args={[innerW * F, innerH * F]} />
      </mesh>,
    );
    if (o.operation === 'double-hung') parts.push(box('rail', cu, innerV, 0, innerW, 1.5, 2.5, mats.frame));
    if (o.operation === 'slider' || o.kind === 'slider') parts.push(box('mull', cu, innerV, 0, 2, innerH, 2.5, mats.frame));
  } else if (o.operation !== 'cased') {
    const panelMat = highlight(mats.door, props.selected);
    if (o.operation === 'overhead') {
      const doorMat = highlight(mats.trim, props.selected);
      parts.push(box('panel', cu, innerV, 0, innerW, innerH, 1.75, doorMat, pick));
      const sections = 4;
      for (let k = 1; k < sections; k++) {
        parts.push(box(`groove${k}`, cu, o.sill + (innerH * k) / sections, outZ * 1.1, innerW, 1, 0.6, mats.frame));
      }
      const lites = 4;
      const liteV = o.sill + (innerH * (sections - 0.5)) / sections;
      for (let k = 0; k < lites; k++) {
        parts.push(
          <mesh key={`lite${k}`} position={[(u0 + fw + 6 + ((innerW - 12) * (k + 0.5)) / lites) * F, liteV * F, outZ * 1.2 * F]} rotation={faceRot} material={mats.frame}>
            <planeGeometry args={[((innerW - 12) / lites - 4) * F, (innerH / sections - 8) * F]} />
          </mesh>,
        );
      }
    } else if (o.operation === 'bifold') {
      for (let i = 0; i < 4; i++) {
        parts.push(box(`bf${i}`, u0 + fw + (innerW / 4) * (i + 0.5), innerV, 0, innerW / 4 - 0.3, innerH, 1.25, panelMat, pick));
      }
    } else {
      parts.push(box('panel', cu, innerV, 0, innerW, innerH, 1.75, panelMat, pick));
      if (o.note && /lite|glass/i.test(o.note)) {
        parts.push(
          <mesh key="lite" position={[cu * F, (o.sill + o.height * 0.7) * F, outZ * 1 * F]} rotation={faceRot} material={mats.glass}>
            <planeGeometry args={[innerW * 0.6 * F, o.height * 0.35 * F]} />
          </mesh>,
        );
      }
      const knobU = o.hinge === 'end' ? u0 + fw + 3 : u1 - fw - 3;
      parts.push(
        <mesh key="knob" position={[knobU * F, 36 * F, 0]} material={mats.metal}>
          <boxGeometry args={[1.2 * F, 1.2 * F, 4.5 * F]} />
        </mesh>,
      );
    }
  }
  // Opening heights are measured from the floor of the wall's zone.
  return <group position={[0, zoneFloor(props.design, w.zone) * F, 0]}>{parts}</group>;
}

// ---------------------------------------------------------------- floors, ceilings, foundation

function planShape(pts: Vec[], flip: boolean) {
  return new THREE.Shape(pts.map((q) => new THREE.Vector2(q.x * F, (flip ? -q.y : q.y) * F)));
}

function Floors({ design, fr, selection, onPick }: { design: Design; fr: Frame; selection: Selection; onPick?: Pick }) {
  const items = useMemo(() => {
    const t = textures();
    return design.rooms.map((r) => {
      const s = roomStats(design, r);
      const look = floorLook(r.finishes.floor);
      const pts = s.net.map((q) => ({ x: q.x - fr.cx, y: q.y - fr.cy }));
      const geo = new THREE.ShapeGeometry(planShape(pts, true));
      geo.rotateX(-Math.PI / 2);
      let map: THREE.Texture | null = null;
      if (look.map) {
        map = t[look.map].clone();
        map.needsUpdate = true;
        map.repeat.set(look.map === 'tile' ? 1 : 0.5, look.map === 'tile' ? 1 : 0.5);
      }
      const mat = new THREE.MeshStandardMaterial({ color: look.color, map, roughness: 0.8 });
      return { id: r.id, geo, mat, y: (fr.base + s.floor + 0.1) * F };
    });
  }, [design, fr]);
  return (
    <group>
      {items.map((it) => (
        <mesh
          key={it.id}
          position={[0, it.y, 0]}
          geometry={it.geo}
          material={highlight(it.mat, selection?.kind === 'room' && selection.id === it.id)}
          receiveShadow
          {...clickable({ kind: 'room', id: it.id }, onPick)}
        />
      ))}
    </group>
  );
}

function Ceilings({ design, fr, mats }: { design: Design; fr: Frame; mats: Mats }) {
  const items = useMemo(() => {
    const out: { key: string; geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
    for (const r of design.rooms) {
      const s = roomStats(design, r);
      const rf = (r.zone === 'garage' && garageRoofFrame(design)) || roofFrame(design);
      if (r.ceiling === 'flat') {
        const pts = s.net.map((q) => ({ x: q.x - fr.cx, y: q.y - fr.cy }));
        const geo = new THREE.ShapeGeometry(planShape(pts, false));
        geo.rotateX(Math.PI / 2);
        geo.translate(0, (fr.base + s.floor + s.ceilingHeight) * F, 0);
        out.push({ key: r.id, geo, mat: mats.ceiling });
      } else {
        // Vaulted: follow the roof underside across the room's bounding box.
        const b = bbox(s.net);
        const s0 = rf.sOf({ x: b.x0, y: b.y0 });
        const s1 = rf.sOf({ x: b.x1, y: b.y1 });
        const a0 = rf.aOf({ x: b.x0, y: b.y0 });
        const a1 = rf.aOf({ x: b.x1, y: b.y1 });
        const ss = [s0, Math.min(Math.max(rf.ridgeS, s0), s1), s1];
        const verts: number[] = [];
        const P = (s: number, a: number) => toWorld(fr, rf.toPlan(s, a), rf.undersideAt(s) - 0.5);
        for (let i = 0; i < 2; i++) {
          if (ss[i + 1] - ss[i] < 0.1) continue;
          const q = [P(ss[i], a0), P(ss[i + 1], a0), P(ss[i + 1], a1), P(ss[i], a1)];
          for (const idx of [0, 1, 2, 0, 2, 3]) verts.push(q[idx].x, q[idx].y, q[idx].z);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        const uv: number[] = [];
        for (let i = 0; i < verts.length; i += 3) uv.push(verts[i] * 0.5, verts[i + 2] * 0.5);
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.computeVertexNormals();
        out.push({ key: r.id, geo, mat: /pine|wood|t&g/i.test(r.finishes.ceiling) ? mats.pine : mats.ceiling });
      }
    }
    return out;
  }, [design, fr, mats]);
  return (
    <group>
      {items.map((it) => (
        <mesh key={it.key} geometry={it.geo} material={it.mat} receiveShadow />
      ))}
    </group>
  );
}

/** `concreteOnly` leaves out the floor band, skirt, and beams, which the framing view draws piece by piece. */
function Foundation({ design, fr, mats, concreteOnly = false }: { design: Design; fr: Frame; mats: Mats; concreteOnly?: boolean }) {
  const { band, skirt, piers, beams, slab } = useMemo(() => {
    const plan = footprint(design);
    const gfp = garageFootprint(design);
    const fp = plan.map((q) => ({ x: q.x - fr.cx, y: q.y - fr.cy }));
    const lv = design.levels;
    const band = new THREE.ExtrudeGeometry(planShape(fp, true), { depth: lv.floorDepth * F, bevelEnabled: false });
    band.rotateX(-Math.PI / 2);
    band.translate(0, (lv.floorHeight - lv.floorDepth) * F, 0);
    const skirtH = lv.floorHeight - lv.floorDepth;
    // One lattice panel per footprint edge, with UVs in feet so the pattern repeats per foot.
    const skirt = fp.map((a, i) => {
      const b = fp[(i + 1) % fp.length];
      // Edges inside the garage are closed with framing and gypsum board instead of lattice.
      const pa = plan[i];
      const pb = plan[(i + 1) % plan.length];
      const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
      const n = norm({ x: pb.y - pa.y, y: -(pb.x - pa.x) });
      const covered = !!gfp && (pointInPolygon(add(mid, mul(n, 6)), gfp) || pointInPolygon(add(mid, mul(n, -6)), gfp));
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const g = new THREE.PlaneGeometry(len * F, skirtH * F);
      const uv = g.getAttribute('uv');
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * len * F, uv.getY(k) * skirtH * F);
      g.rotateY(Math.atan2(-(b.y - a.y), b.x - a.x));
      g.translate(((a.x + b.x) / 2) * F, (skirtH / 2) * F, ((a.y + b.y) / 2) * F);
      return { g, covered };
    });
    const layout = pierLayout(design);
    // Under the frame, the piers stop at the underside of the framed beams.
    const beamBottom = concreteOnly ? lv.floorHeight + floorLevels(design).beamBottom : lv.floorHeight - lv.floorDepth - 9.25;
    const piers = layout.piers.map((p) => {
      const h = p.deck ? DECK_FOOTING : beamBottom;
      return { pos: toWorld(fr, p.p, 0).setY((h / 2) * F), h: h * F };
    });
    const beams = layout.beams.map((bm) => {
      const a = toWorld(fr, bm.a, 0);
      const b = toWorld(fr, bm.b, 0);
      const len = a.distanceTo(b);
      const top = bm.deck ? lv.floorHeight - 8.25 : lv.floorHeight - lv.floorDepth;
      return { pos: a.clone().add(b).multiplyScalar(0.5).setY((top - 4.625) * F), len, rotY: Math.atan2(-(b.z - a.z), b.x - a.x) };
    });
    let slab: { pos: THREE.Vector3; size: [number, number, number] } | null = null;
    if (gfp && design.garage) {
      const r = bbox(gfp);
      const top = design.levels.floorHeight + design.garage.floor;
      slab = {
        pos: toWorld(fr, { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 }, 0).setY(((top - 2) / 2) * F),
        size: [(r.x1 - r.x0) * F, (top + 2) * F, (r.y1 - r.y0) * F],
      };
    }
    return { band, skirt, piers, beams, slab };
  }, [design, fr, concreteOnly]);
  return (
    <group>
      {!concreteOnly && <mesh geometry={band} material={mats.trim} castShadow receiveShadow />}
      {!concreteOnly &&
        skirt.map(({ g, covered }, i) => (
          <mesh key={i} geometry={g} material={covered ? mats.interior : mats.lattice} castShadow />
        ))}
      {slab && (
        <mesh position={slab.pos} material={mats.concrete} receiveShadow castShadow>
          <boxGeometry args={slab.size} />
        </mesh>
      )}
      {piers.map((p, i) => (
        <mesh key={i} position={p.pos} material={mats.concrete} castShadow>
          <cylinderGeometry args={[(design.foundation.pierSize / 2) * F, (design.foundation.pierSize / 2) * F, p.h, 16]} />
        </mesh>
      ))}
      {!concreteOnly && beams.map((b, i) => (
        <mesh key={i} position={b.pos} rotation={[0, b.rotY, 0]} material={mats.lumber} castShadow>
          <boxGeometry args={[b.len, 9.25 * F, 4.5 * F]} />
        </mesh>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------- roof

function Roofs({ design, fr, mats }: { design: Design; fr: Frame; mats: Mats }) {
  const frames = useMemo(() => roofFrames(design), [design]);
  return (
    <group>
      {frames.map(({ zone, frame }) => (
        <Roof key={zone ?? 'house'} design={design} fr={fr} mats={mats} rf={frame} chimney={!zone} />
      ))}
    </group>
  );
}

function Roof({ design, fr, mats, rf, chimney }: { design: Design; fr: Frame; mats: Mats; rf: RoofFrame; chimney: boolean }) {
  const { slabs, seams, ridge, pipe } = useMemo(() => {
    const len = rf.a1 - rf.a0;
    const m = new THREE.Matrix4();
    if (rf.axis === 'x') {
      m.makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0));
      m.setPosition((rf.a1 - fr.cx) * F, fr.base * F, -fr.cy * F);
    } else {
      m.makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
      m.setPosition(-fr.cx * F, fr.base * F, (rf.a0 - fr.cy) * F);
    }
    const slabs = rf.profiles.map((poly) => {
      const g = new THREE.ExtrudeGeometry(new THREE.Shape(poly.map((q) => new THREE.Vector2(q.x * F, q.y * F))), {
        depth: len * F,
        bevelEnabled: false,
      });
      g.applyMatrix4(m);
      return g;
    });
    // Standing seams
    const seams: THREE.Matrix4[] = [];
    for (const poly of rf.profiles) {
      const eave = poly[0].x === rf.ridgeS ? poly[2] : poly[3];
      const top = poly[0].x === rf.ridgeS ? poly[3] : poly[2];
      for (let a = rf.a0 + design.roof.seamSpacing; a < rf.a1 - 1; a += design.roof.seamSpacing) {
        const p1 = toWorld(fr, rf.toPlan(eave.x, a), eave.y + 0.6);
        const p2 = toWorld(fr, rf.toPlan(top.x, a), top.y + 0.6);
        const dirY = p2.clone().sub(p1);
        const length = dirY.length();
        dirY.normalize();
        const dirX = rf.axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
        const dirZ = new THREE.Vector3().crossVectors(dirX, dirY);
        const mm = new THREE.Matrix4().makeBasis(dirX, dirY, dirZ);
        mm.scale(new THREE.Vector3(0.8 * F, length, 1.2 * F));
        mm.setPosition(p1.clone().add(p2).multiplyScalar(0.5));
        seams.push(mm);
      }
    }
    const r0 = toWorld(fr, rf.toPlan(rf.ridgeS, rf.a0), rf.ridgeTop + 0.5);
    const r1 = toWorld(fr, rf.toPlan(rf.ridgeS, rf.a1), rf.ridgeTop + 0.5);
    const ridge = { pos: r0.clone().add(r1).multiplyScalar(0.5), len: r0.distanceTo(r1), rotY: rf.axis === 'x' ? 0 : Math.PI / 2 };
    const stove = chimney ? design.fixtures.find((f) => f.kind === 'stove') : undefined;
    const pipe = stove
      ? { pos: toWorld(fr, stove, 0), bottom: 30, top: Math.max(rf.ridgeTop + 24, rf.undersideAt(rf.sOf(stove)) + rf.tv + 36) }
      : null;
    return { slabs, seams, ridge, pipe };
  }, [design, fr, rf, chimney]);
  const seamMesh = useMemo(() => {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mats.roof, Math.max(1, seams.length));
    seams.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.count = seams.length;
    mesh.castShadow = true;
    return mesh;
  }, [seams, mats.roof]);
  return (
    <group>
      {slabs.map((g, i) => (
        <mesh key={i} geometry={g} material={[mats.trim, mats.roof]} castShadow receiveShadow />
      ))}
      <primitive object={seamMesh} />
      <mesh position={ridge.pos} rotation={[0, ridge.rotY, 0]} material={mats.roof} castShadow>
        <boxGeometry args={[ridge.len, 2 * F, 8 * F]} />
      </mesh>
      {pipe && (
        <mesh position={[pipe.pos.x, ((pipe.bottom + pipe.top) / 2 + design.levels.floorHeight) * F, pipe.pos.z]} material={mats.metal} castShadow>
          <cylinderGeometry args={[4 * F, 4 * F, (pipe.top - pipe.bottom) * F, 16]} />
        </mesh>
      )}
    </group>
  );
}

// ---------------------------------------------------------------- deck

function Deck({ design, fr, mats, dg }: { design: Design; fr: Frame; mats: Mats; dg: Platform }) {
  const data = useMemo(() => {
    const r = dg.rect;
    const top = PLATFORM_TOP;
    const c = toWorld(fr, { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 }, top - 0.5);
    const horiz = dg.side === 'north' || dg.side === 'south';
    const deckTex = textures().deck.clone();
    deckTex.needsUpdate = true;
    deckTex.repeat.set(horiz ? (r.x1 - r.x0) / 12 : (r.y1 - r.y0) / 12, horiz ? (r.y1 - r.y0) / 12 : (r.x1 - r.x0) / 12);
    if (!horiz) deckTex.rotation = Math.PI / 2;
    const surface = new THREE.MeshStandardMaterial({ color: design.materials.deck, map: deckTex, roughness: 0.8 });
    const rail = dg.spec.railingHeight;
    const balusters: THREE.Matrix4[] = [];
    const posts: THREE.Vector3[] = [];
    const rails: { pos: THREE.Vector3; len: number; rotY: number }[] = [];
    for (const [a, b] of platformRailings(design, dg)) {
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const d = norm({ x: b.x - a.x, y: b.y - a.y });
      const n = Math.max(1, Math.ceil(len / 72));
      for (let k = 0; k <= n; k++) posts.push(toWorld(fr, add(a, mul(d, (len * k) / n)), top + (rail + 2) / 2));
      for (let t = 4.5; t < len - 2; t += 4.5) {
        const p = toWorld(fr, add(a, mul(d, t)), top + rail / 2);
        balusters.push(new THREE.Matrix4().makeTranslation(p.x, p.y, p.z));
      }
      const mid = toWorld(fr, add(a, mul(d, len / 2)), top + rail - 0.75);
      rails.push({ pos: mid, len: len * F, rotY: Math.atan2(-d.y, d.x) });
      rails.push({ pos: mid.clone().setY(mid.y - (rail - 5) * F), len: len * F, rotY: Math.atan2(-d.y, d.x) });
    }
    const steps: { pos: THREE.Vector3; size: [number, number, number] }[] = [];
    const s = dg.stairs;
    if (s) {
      const along = horiz;
      const width = along ? s.rect.x1 - s.rect.x0 : s.rect.y1 - s.rect.y0;
      const cAlong = along ? (s.rect.x0 + s.rect.x1) / 2 : (s.rect.y0 + s.rect.y1) / 2;
      for (let i = 1; i < s.risers; i++) {
        const h = top - i * s.riserHeight;
        const t0 = (i - 1) * s.tread;
        const mid = s.edge + (dg.side === 'south' || dg.side === 'east' ? 1 : -1) * (t0 + s.tread / 2);
        const p = along ? { x: cAlong, y: mid } : { x: mid, y: cAlong };
        const height = h + design.levels.floorHeight;
        const w = toWorld(fr, p, 0).setY((height / 2) * F);
        steps.push({ pos: w, size: along ? [width * F, height * F, s.tread * F] : [s.tread * F, height * F, width * F] });
      }
    }
    const balMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5 * F, (rail - 5) * F, 1.5 * F), mats.trim, Math.max(1, balusters.length));
    balusters.forEach((m, i) => balMesh.setMatrixAt(i, m));
    balMesh.count = balusters.length;
    balMesh.castShadow = true;
    const deckPosts = pierLayout(design).piers.filter((p) => p.platform === dg.kind).map((p) => toWorld(fr, p.p, 0));
    const postTop = design.levels.floorHeight - 17.5;
    const rimBottom = design.levels.floorHeight + top - 1.5 - 11.25;
    // Solid skirt panels on the exposed edges, from grade to the underside of the rim.
    const skirts =
      dg.skirt === 'solid'
        ? skirtEdges(design, dg).map(([a, b]) => {
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            const g = new THREE.PlaneGeometry(len * F, rimBottom * F);
            const uv = g.getAttribute('uv');
            for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * len * F, uv.getY(k) * rimBottom * F);
            const d = norm({ x: b.x - a.x, y: b.y - a.y });
            const outward = mul({ x: d.y, y: -d.x }, 0.75);
            const mid = toWorld(fr, add({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, outward), 0);
            g.rotateY(Math.atan2(-d.y, d.x));
            g.translate(mid.x, (rimBottom / 2) * F, mid.z);
            return g;
          })
        : [];
    const handrails = stairHandrails(dg).map((h) => ({
      a: toWorld(fr, h.a, h.ha),
      b: toWorld(fr, h.b, h.hb),
    }));
    return {
      skirts,
      handrails,
      c, size: [(r.x1 - r.x0) * F, 1.5 * F, (r.y1 - r.y0) * F] as [number, number, number],
      surface, posts, rails, balMesh, steps, rimY: (top - 1.5 - 5.625 + design.levels.floorHeight) * F, deckPosts,
      postH: Math.max(0, postTop - DECK_FOOTING) * F,
    };
  }, [design, fr, mats, dg]);
  return (
    <group>
      <mesh position={data.c} material={data.surface} castShadow receiveShadow>
        <boxGeometry args={data.size} />
      </mesh>
      <mesh position={[data.c.x, data.rimY, data.c.z]} material={mats.deckDark} castShadow>
        <boxGeometry args={[data.size[0] - 0.05, 11.25 * F, data.size[2] - 0.05]} />
      </mesh>
      {data.posts.map((p, i) => (
        <mesh key={i} position={p} material={mats.trim} castShadow>
          <boxGeometry args={[3.5 * F, (dg.spec.railingHeight + 2) * F, 3.5 * F]} />
        </mesh>
      ))}
      {data.rails.map((r, i) => (
        <mesh key={i} position={r.pos} rotation={[0, r.rotY, 0]} material={mats.trim} castShadow>
          <boxGeometry args={[r.len, 1.5 * F, 3.5 * F]} />
        </mesh>
      ))}
      <primitive object={data.balMesh} />
      {data.steps.map((s, i) => (
        <mesh key={i} position={s.pos} material={mats.deck} castShadow receiveShadow>
          <boxGeometry args={s.size} />
        </mesh>
      ))}
      {data.skirts.map((g, i) => (
        <mesh key={`skirt${i}`} geometry={g} material={mats.skirt} castShadow receiveShadow />
      ))}
      {data.handrails.map((h, i) => (
        <Rail key={`hr${i}`} a={h.a} b={h.b} mats={mats} />
      ))}
      {data.postH > 0.05 && data.deckPosts.map((p, i) => (
        <mesh key={i} position={[p.x, DECK_FOOTING * F + data.postH / 2, p.z]} material={mats.lumber} castShadow>
          <boxGeometry args={[5.5 * F, data.postH, 5.5 * F]} />
        </mesh>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------- fixtures

const FIX_COLORS: Record<string, string> = {
  cabinet: '#5d6b5f',
  counter: '#e9e5dc',
  steel: '#c9ccd0',
  dark: '#2f3133',
  fabric: '#8a8f86',
  wood: '#9c7550',
  white: '#f4f4f2',
  linen: '#e7e1d3',
};

function FixtureMesh(props: { design: Design; fr: Frame; f: Fixture; selected: boolean; onPick?: Pick; mats: Mats }) {
  const { fr, f } = props;
  const pos = toWorld(fr, f, floorAt(props.design, f));
  const pick = clickable({ kind: 'fixture', id: f.id }, props.onPick);
  const mat = (c: string, extra: THREE.MeshStandardMaterialParameters = {}) => fixtureMat(c, extra, props.selected);
  const B = (key: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, m: THREE.Material) => (
    <mesh key={key} position={[x * F, y * F, z * F]} material={m} castShadow receiveShadow {...pick}>
      <boxGeometry args={[sx * F, sy * F, sz * F]} />
    </mesh>
  );
  const { w, d } = f;
  const parts: ReactNode[] = [];
  switch (f.kind) {
    case 'counter':
    case 'island':
      parts.push(B('base', 0, 17.5, 0, w, 35, d - 1, mat(FIX_COLORS.cabinet)));
      parts.push(B('top', 0, 35.75, f.kind === 'island' ? 0 : 0.5, w, 1.5, d, mat(FIX_COLORS.counter, { roughness: 0.3 })));
      if (f.kind === 'counter' && /upper/i.test(f.label ?? '')) {
        parts.push(B('upper', 0, 72, -d / 2 + 6.5, w, 30, 12, mat(FIX_COLORS.cabinet)));
      }
      break;
    case 'sink':
      parts.push(B('basin', 0, 36.6, 0, w - 2, 0.4, d - 4, mat(FIX_COLORS.steel, { metalness: 0.8, roughness: 0.3 })));
      parts.push(B('faucet', 0, 44, -d / 2 + 2, 1.2, 14, 1.2, mat(FIX_COLORS.steel, { metalness: 0.8, roughness: 0.3 })));
      break;
    case 'range':
      parts.push(B('body', 0, 18, 0, w, 36, d, mat(FIX_COLORS.steel, { metalness: 0.6, roughness: 0.35 })));
      parts.push(B('top', 0, 36.3, 0, w, 0.6, d, mat(FIX_COLORS.dark)));
      parts.push(B('hood', 0, 66, -d / 2 + 8, w, 10, 18, mat(FIX_COLORS.steel, { metalness: 0.6, roughness: 0.35 })));
      break;
    case 'dishwasher':
      parts.push(B('front', 0, 17.5, d / 2 - 0.5, w - 0.5, 33, 1, mat(FIX_COLORS.steel, { metalness: 0.6, roughness: 0.35 })));
      break;
    case 'fridge':
      parts.push(B('body', 0, 35, 0, w, 70, d, mat(FIX_COLORS.steel, { metalness: 0.6, roughness: 0.35 })));
      break;
    case 'table':
      parts.push(B('top', 0, 29.25, 0, w, 1.5, d, mat(FIX_COLORS.wood)));
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(B(`leg${sx}${sz}`, sx * (w / 2 - 3), 14.25, sz * (d / 2 - 3), 2.5, 28.5, 2.5, mat(FIX_COLORS.wood)));
      break;
    case 'coffee-table':
      parts.push(B('top', 0, 15, 0, w, 2, d, mat(FIX_COLORS.wood)));
      parts.push(B('base', 0, 7, 0, w - 8, 14, d - 8, mat(FIX_COLORS.wood)));
      break;
    case 'chair':
      parts.push(B('seat', 0, 17, 0, w, 3, d, mat(FIX_COLORS.fabric)));
      parts.push(B('back', 0, 26, -d / 2 + 2, w, 18, 4, mat(FIX_COLORS.fabric)));
      break;
    case 'sofa':
      parts.push(B('base', 0, 9, 1.5, w - 4, 18, d - 3, mat(FIX_COLORS.fabric)));
      parts.push(B('back', 0, 18, -d / 2 + 4.5, w, 32, 9, mat(FIX_COLORS.fabric)));
      parts.push(B('armL', -w / 2 + 4, 12.5, 1, 8, 25, d - 2, mat(FIX_COLORS.fabric)));
      parts.push(B('armR', w / 2 - 4, 12.5, 1, 8, 25, d - 2, mat(FIX_COLORS.fabric)));
      break;
    case 'bed':
      parts.push(B('base', 0, 7, 0, w, 14, d, mat(FIX_COLORS.wood)));
      parts.push(B('mattress', 0, 18, 0.5, w - 1, 10, d - 3, mat(FIX_COLORS.white)));
      parts.push(B('blanket', 0, 23.5, d / 6, w, 1.5, (d * 2) / 3, mat(FIX_COLORS.linen)));
      parts.push(B('head', 0, 24, -d / 2 + 1, w + 2, 48, 2, mat(FIX_COLORS.wood)));
      parts.push(B('p1', -w / 4, 25, -d / 2 + 9, w / 2 - 4, 5, 12, mat(FIX_COLORS.white)));
      parts.push(B('p2', w / 4, 25, -d / 2 + 9, w / 2 - 4, 5, 12, mat(FIX_COLORS.white)));
      break;
    case 'nightstand':
    case 'dresser':
      parts.push(B('body', 0, f.kind === 'dresser' ? 17 : 12, 0, w, f.kind === 'dresser' ? 34 : 24, d, mat(FIX_COLORS.wood)));
      break;
    case 'toilet':
      parts.push(B('tank', 0, 24, -d / 2 + 4, w - 2, 14, 7, mat(FIX_COLORS.white, { roughness: 0.2 })));
      parts.push(
        <mesh key="bowl" position={[0, 8 * F, 4 * F]} material={mat(FIX_COLORS.white, { roughness: 0.2 })} scale={[1, 1, 1.35]} castShadow {...pick}>
          <cylinderGeometry args={[7.5 * F, 6 * F, 16 * F, 20]} />
        </mesh>,
      );
      break;
    case 'vanity':
      parts.push(B('base', 0, 16, 0, w, 32, d, mat(FIX_COLORS.cabinet)));
      parts.push(B('top', 0, 33, 0, w, 2, d, mat(FIX_COLORS.counter, { roughness: 0.3 })));
      parts.push(B('mirror', 0, 56, -d / 2 + 0.5, w - 6, 30, 0.5, mat('#b8c4cc', { metalness: 0.9, roughness: 0.05 })));
      break;
    case 'shower':
      parts.push(B('tray', 0, 1.5, 0, w, 3, d, mat(FIX_COLORS.white)));
      parts.push(
        <mesh key="glass" position={[0, 40 * F, (d / 2 - 0.5) * F]} material={props.mats.glass} {...pick}>
          <boxGeometry args={[w * F, 74 * F, 0.4 * F]} />
        </mesh>,
      );
      parts.push(B('head', 0, 76, -d / 2 + 4, 6, 1, 6, mat(FIX_COLORS.steel, { metalness: 0.8 })));
      break;
    case 'tub':
      parts.push(B('tub', 0, 10, 0, w, 20, d, mat(FIX_COLORS.white, { roughness: 0.2 })));
      break;
    case 'washer-dryer':
      parts.push(B('washer', 0, 19, 0, w, 38, d, mat(FIX_COLORS.white)));
      parts.push(B('dryer', 0, 57, 0, w, 38, d, mat('#ecebe8')));
      break;
    case 'water-heater':
      parts.push(B('unit', 0, 60, 0, w, 24, d, mat(FIX_COLORS.white)));
      break;
    case 'stove':
      parts.push(B('hearth', 0, 0.75, 0, w + 16, 1.5, d + 16, mat('#6f6a64')));
      parts.push(B('body', 0, 16, 0, w - 2, 26, d - 4, mat(FIX_COLORS.dark, { roughness: 0.5, metalness: 0.4 })));
      parts.push(B('window', 0, 16, d / 2 - 1.9, w - 10, 10, 0.3, mat('#f28c28', { emissive: '#f26b1d', emissiveIntensity: 0.9 })));
      break;
    case 'car': {
      const body = mat('#3d5a73', { roughness: 0.35, metalness: 0.5 });
      parts.push(B('body', 0, 20, 0, w, 22, d, body));
      parts.push(B('cabin', 0, 40, -d * 0.05, w - 6, 18, d * 0.48, mat('#2a3440', { roughness: 0.15, metalness: 0.3 })));
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        parts.push(
          <mesh key={`wheel${sx}${sz}`} position={[sx * (w / 2 - 3) * F, 12 * F, sz * (d / 2 - 30) * F]} rotation={[0, 0, Math.PI / 2]} material={mat('#1c1c1c')} castShadow>
            <cylinderGeometry args={[12 * F, 12 * F, 8 * F, 20]} />
          </mesh>,
        );
      }
      break;
    }
    case 'closet-rod':
      parts.push(B('shelf', 0, 66, -d / 2 + 6, w, 0.75, 12, mat(FIX_COLORS.white)));
      parts.push(B('rod', 0, 64, 0, w, 1.2, 1.2, mat(FIX_COLORS.steel, { metalness: 0.8 })));
      for (let i = 0; i < Math.floor(w / 6); i++) parts.push(B(`c${i}`, -w / 2 + 3 + i * 6, 48, 0, 1, 30, 18, mat(['#7b8a9a', '#b69f7b', '#6c7b6a', '#d8d2c4'][i % 4])));
      break;
  }
  return (
    <group position={pos} rotation={[0, (-f.rotation * Math.PI) / 180, 0]}>
      {parts}
    </group>
  );
}


/** Landing, steps, and handrail inside the garage at the house entry. */
function GarageEntryMesh({ design, fr, mats }: { design: Design; fr: Frame; mats: Mats }) {
  const data = useMemo(() => {
    const e = garageEntry(design);
    const g = design.garage;
    if (!e || !g) return null;
    const box = (r: { x0: number; y0: number; x1: number; y1: number }, bottom: number, top: number) => ({
      pos: toWorld(fr, { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 }, (bottom + top) / 2),
      size: [(r.x1 - r.x0) * F, (top - bottom) * F, (r.y1 - r.y0) * F] as [number, number, number],
    });
    const landing = box(e.landing, g.floor, e.landingTop);
    const steps = e.steps.map((st) => box(st.rect, g.floor, st.top));
    // Handrail along the open edge of the run, 36" above the nosings.
    const openEdge = add(
      { x: (e.run.x0 + e.run.x1) / 2, y: (e.run.y0 + e.run.y1) / 2 },
      mul(e.into, e.width / 2 - 1.5),
    );
    const half = mul(e.along, (e.treads * e.tread) / 2);
    const top0 = e.landingTop + 36;
    const top1 = g.floor + e.riserHeight + 36;
    const a = toWorld(fr, add(openEdge, mul(half, -1)), top0);
    const b = toWorld(fr, add(openEdge, half), top1);
    const rail = { a, b };
    return { landing, steps, rail };
  }, [design, fr]);
  if (!data) return null;
  const { rail } = data;
  const mid = rail.a.clone().add(rail.b).multiplyScalar(0.5);
  const dir = rail.b.clone().sub(rail.a);
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return (
    <group>
      <mesh position={data.landing.pos} material={mats.deck} castShadow receiveShadow>
        <boxGeometry args={data.landing.size} />
      </mesh>
      {data.steps.map((st, i) => (
        <mesh key={i} position={st.pos} material={mats.deck} castShadow receiveShadow>
          <boxGeometry args={st.size} />
        </mesh>
      ))}
      <mesh position={mid} quaternion={quat} material={mats.metal} castShadow>
        <cylinderGeometry args={[0.75 * F, 0.75 * F, dir.length(), 10]} />
      </mesh>
      {[rail.a, rail.b].map((p, i) => (
        <mesh key={i} position={[p.x, (p.y + (fr.base + (design.garage?.floor ?? 0)) * F) / 2, p.z]} material={mats.metal}>
          <cylinderGeometry args={[0.75 * F, 0.75 * F, p.y - (fr.base + (design.garage?.floor ?? 0)) * F, 10]} />
        </mesh>
      ))}
    </group>
  );
}

/** A sloped handrail between two world points, with posts down to grade. */
function Rail({ a, b, mats }: { a: THREE.Vector3; b: THREE.Vector3; mats: Mats }) {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const dir = b.clone().sub(a);
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return (
    <group>
      <mesh position={mid} quaternion={quat} material={mats.metal} castShadow>
        <cylinderGeometry args={[0.75 * F, 0.75 * F, dir.length(), 10]} />
      </mesh>
      {[a, b].map((p, i) => (
        <mesh key={i} position={[p.x, p.y / 2, p.z]} material={mats.metal}>
          <cylinderGeometry args={[0.75 * F, 0.75 * F, p.y, 10]} />
        </mesh>
      ))}
    </group>
  );
}
