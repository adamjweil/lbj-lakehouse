import { useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { SiteGeom } from '../../../model/site';
import { toWorld, type Frame } from '../House3D';
import { siteTextures, tiled } from './textures';
import { flatRect, mulberry } from './util';

type G = NonNullable<SiteGeom>;

/** The lake: rippled water, the bottom near shore, and wooded hills on the far shore. */
export function Water({ fr, g }: { fr: Frame; g: G }) {
  const t = siteTextures();
  const { water, bottom, normal, hills } = useMemo(() => {
    const L = g.lotRect;
    const lake = { x0: L.x0 - 24000, x1: L.x1 + 24000, y0: g.shoreY, y1: g.shoreY + 30000 };
    const w = flatRect(fr, lake, g.water);
    const normal = tiled(t.waterNormal, w.w, w.d, 34);
    const waterMat = new THREE.MeshPhysicalMaterial({
      color: '#2f5f73',
      roughness: 0.06,
      metalness: 0.05,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.16, 0.16),
      transparent: true,
      opacity: 0.88,
      envMapIntensity: 1.2,
      clearcoat: 0.6,
    });
    const b = flatRect(fr, { ...lake, y1: g.shoreY + 3600 }, g.bottom);
    const bottomMat = new THREE.MeshStandardMaterial({ color: '#4d5a45', roughness: 1 });

    // Far shore: a long strip of low hills with forest texture, about 1,300 ft across the water.
    const width = 9000;
    const depth = 900;
    const geo = new THREE.PlaneGeometry(width, depth, 180, 30);
    geo.rotateX(-Math.PI / 2);
    const rnd = mulberry(9);
    const phases = Array.from({ length: 6 }, () => rnd() * Math.PI * 2);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const back = (depth / 2 - z) / depth; // 0 at the water, 1 at the back
      const hill =
        Math.sin(x / 260 + phases[0]) * 18 +
        Math.sin(x / 90 + phases[1]) * 6 +
        Math.sin(x / 37 + phases[2]) * 2.5 +
        Math.sin(z / 70 + phases[3]) * 5;
      const h = Math.min(1, back * 3) * (35 + hill) + back * 40;
      pos.setY(i, Math.max(-1, h));
    }
    geo.computeVertexNormals();
    const shore = toWorld(fr, { x: (L.x0 + L.x1) / 2, y: g.shoreY + 1300 * 12 }, g.water);
    geo.translate(shore.x, shore.y, shore.z + depth / 2);
    const hillMat = new THREE.MeshStandardMaterial({ map: tiled(t.forest, width, depth, 60), roughness: 1 });
    return {
      water: { geometry: w.geometry, material: waterMat },
      bottom: { geometry: b.geometry, material: bottomMat },
      normal,
      hills: { geometry: geo, material: hillMat },
    };
  }, [fr, g, t]);

  useFrame((_, dt) => {
    normal.offset.x += dt * 0.004;
    normal.offset.y += dt * 0.0025;
  });

  return (
    <group>
      <mesh geometry={bottom.geometry} material={bottom.material} />
      <mesh geometry={water.geometry} material={water.material} receiveShadow />
      <mesh geometry={hills.geometry} material={hills.material} receiveShadow />
    </group>
  );
}

