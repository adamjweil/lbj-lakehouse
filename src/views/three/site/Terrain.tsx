import { useMemo } from 'react';
import * as THREE from 'three';
import type { Rect } from '../../../model/geometry';
import { pathRects, type SiteGeom } from '../../../model/site';
import { toWorld, type Frame } from '../House3D';
import { siteTextures, tiled } from './textures';
import { flatRect, mulberry } from './util';

type G = NonNullable<SiteGeom>;

/** Ground: native meadow everywhere, mowed lawn in the middle of the lot, street, driveway, and walks. */
export function Terrain({ fr, g }: { fr: Frame; g: G }) {
  const parts = useMemo(() => {
    const t = siteTextures();
    const L = g.lotRect;
    const out: { key: string; geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];
    const add = (key: string, r: Rect, h: number, tex: THREE.Texture, feet: number, extra: THREE.MeshStandardMaterialParameters = {}, mottle = 0) => {
      const { geometry, w, d } = flatRect(fr, r, h, mottle);
      out.push({
        key,
        geometry,
        material: new THREE.MeshStandardMaterial({ map: tiled(tex, w, d, feet), roughness: 1, vertexColors: mottle > 0, ...extra }),
      });
    };
    const grade = g.grade;
    // Land extends well past the lot on every side except the lake.
    const land: Rect = { x0: L.x0 - 6000, x1: L.x1 + 6000, y0: L.y0 - 4800, y1: g.shoreY };
    add('meadow', land, grade - 0.25, t.meadow, 17, {}, 0.28);
    // Mowed lawn: the lot minus the native strips along the side lines.
    const lawn: Rect = { x0: L.x0 + 300, x1: L.x1 - 300, y0: L.y0 + 96, y1: g.shoreY - 14 };
    add('lawn', lawn, grade, t.lawn, 24, {}, 0.12);
    add('street', g.street, grade + 0.1, t.asphalt, 20, { roughness: 0.9 });
    if (g.driveway) add('driveway', g.driveway, grade + 0.3, t.gravel, 4);
    g.paths.forEach((p, i) =>
      pathRects(p).forEach((r, j) => add(`path${i}-${j}`, r, grade + 0.4 + j * 0.05, t.flagstone, 4)),
    );
    // Gravel apron around the dock landing.
    if (g.dock) {
      const gw = g.dock.gangway;
      add('landing', { x0: gw.x0 - 30, x1: gw.x1 + 30, y0: g.shoreY - 60, y1: g.shoreY - 14 }, grade + 0.45, t.gravel, 4);
    }
    return out;
  }, [fr, g]);

  // Grass tufts in the native areas: the side strips and the meadow just past the lot lines.
  const tufts = useMemo(() => {
    const t = siteTextures();
    const L = g.lotRect;
    const rnd = mulberry(5);
    const geo = new THREE.PlaneGeometry(1.6, 1.3);
    geo.translate(0, 0.65, 0);
    const cross = geo.clone();
    cross.rotateY(Math.PI / 2);
    const merged = mergeTwo(geo, cross);
    const mat = new THREE.MeshStandardMaterial({ map: t.tuft, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1 });
    const count = 1800;
    const mesh = new THREE.InstancedMesh(merged, mat, count);
    const m = new THREE.Matrix4();
    const keep = [g.driveway, ...g.paths.flatMap(pathRects)].filter(Boolean) as Rect[];
    let n = 0;
    let guard = 0;
    while (n < count && guard++ < count * 10) {
      const side = rnd();
      let x: number;
      let y: number;
      if (side < 0.55) {
        // Inside the lot's native side strips.
        x = rnd() < 0.5 ? L.x0 + rnd() * 300 : L.x1 - rnd() * 300;
        y = L.y0 + 96 + rnd() * (g.shoreY - L.y0 - 140);
      } else {
        // Just outside the lot.
        x = rnd() < 0.5 ? L.x0 - rnd() * 1200 : L.x1 + rnd() * 1200;
        y = L.y0 - 600 + rnd() * (g.shoreY - L.y0 + 520);
      }
      if (keep.some((r) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1)) continue;
      const s = 0.6 + rnd() * 0.9;
      const p = toWorld(fr, { x, y }, g.grade);
      m.compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * Math.PI, 0)), new THREE.Vector3(s, s * (0.8 + rnd() * 0.6), s));
      mesh.setMatrixAt(n++, m);
    }
    mesh.count = n;
    mesh.receiveShadow = true;
    return mesh;
  }, [fr, g]);

  return (
    <group>
      {parts.map((p) => (
        <mesh key={p.key} geometry={p.geometry} material={p.material} receiveShadow />
      ))}
      <primitive object={tufts} />
    </group>
  );
}

function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry) {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const x = a.getAttribute(name) as THREE.BufferAttribute;
    const y = b.getAttribute(name) as THREE.BufferAttribute;
    const arr = new Float32Array(x.array.length + y.array.length);
    arr.set(x.array as Float32Array, 0);
    arr.set(y.array as Float32Array, x.array.length);
    out.setAttribute(name, new THREE.BufferAttribute(arr, x.itemSize));
  }
  const ia = a.getIndex()!.array;
  const ib = b.getIndex()!.array;
  const idx = new Uint16Array(ia.length + ib.length);
  idx.set(ia, 0);
  const offset = a.getAttribute('position').count;
  for (let i = 0; i < ib.length; i++) idx[ia.length + i] = ib[i] + offset;
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

