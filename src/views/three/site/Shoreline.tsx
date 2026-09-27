import { useMemo } from 'react';
import * as THREE from 'three';
import type { SiteGeom } from '../../../model/site';
import { F, toWorld, type Frame } from '../House3D';
import { siteTextures } from './textures';
import { boxFor } from './util';

type G = NonNullable<SiteGeom>;

/** Limestone bulkhead along the lot frontage, with rock riprap banks on the neighboring lots. */
export function Shoreline({ fr, g }: { fr: Frame; g: G }) {
  const parts = useMemo(() => {
    const t = siteTextures();
    const L = g.lotRect;
    const wallTop = g.grade + 4;
    const wall = boxFor(fr, { x0: L.x0, x1: L.x1, y0: g.shoreY - 12, y1: g.shoreY }, g.bottom - 6, wallTop);
    const tex = t.limestone.clone();
    tex.needsUpdate = true;
    tex.repeat.set((L.x1 - L.x0) / 96, (wallTop - g.bottom) / 48);
    const wallMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
    const cap = boxFor(fr, { x0: L.x0, x1: L.x1, y0: g.shoreY - 16, y1: g.shoreY + 2 }, wallTop, wallTop + 4);
    const capMat = new THREE.MeshStandardMaterial({ color: '#d8d0bf', roughness: 0.8 });

    // Riprap slopes from grade at the shore down under the water, beyond each side lot line.
    const rip = new THREE.MeshStandardMaterial({ map: t.riprap.clone(), roughness: 1 });
    rip.map!.needsUpdate = true;
    rip.map!.repeat.set(800, 3);
    const slopes = [
      { x0: L.x0 - 24000, x1: L.x0 },
      { x0: L.x1, x1: L.x1 + 24000 },
    ].map(({ x0, x1 }) => {
      const run = 96;
      const drop = g.grade - (g.water - 24);
      const len = Math.hypot(run, drop) * F;
      const geo = new THREE.PlaneGeometry((x1 - x0) * F, len);
      geo.rotateX(-Math.PI / 2 + Math.atan2(drop, run));
      const c = toWorld(fr, { x: (x0 + x1) / 2, y: g.shoreY + run / 2 }, (g.grade + g.water - 24) / 2);
      geo.translate(c.x, c.y, c.z);
      return geo;
    });
    return { wall, wallMat, cap, capMat, rip, slopes };
  }, [fr, g]);
  return (
    <group>
      <mesh position={parts.wall.pos} material={parts.wallMat} castShadow receiveShadow>
        <boxGeometry args={parts.wall.size} />
      </mesh>
      <mesh position={parts.cap.pos} material={parts.capMat} castShadow receiveShadow>
        <boxGeometry args={parts.cap.size} />
      </mesh>
      {parts.slopes.map((geo, i) => (
        <mesh key={i} geometry={geo} material={parts.rip} receiveShadow />
      ))}
    </group>
  );
}
