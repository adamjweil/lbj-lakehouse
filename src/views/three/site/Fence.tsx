import { useMemo } from 'react';
import * as THREE from 'three';
import type { Vec } from '../../../model/geometry';
import type { SiteGeom } from '../../../model/site';
import { F, toWorld, type Frame } from '../House3D';

type G = NonNullable<SiteGeom>;

type Part = { key: string; mats: THREE.Matrix4[]; material: THREE.Material };

/** Perimeter fence: black metal pickets or a cedar board fence, with gate posts at the driveway. */
export function Fence({ fr, g }: { fr: Frame; g: G }) {
  const parts = useMemo(() => {
    const fence = g.fence;
    if (!fence) return [];
    const f = fence.spec;
    const metal = f.style === 'metal';
    const postMat = metal
      ? new THREE.MeshStandardMaterial({ color: '#1d1f21', roughness: 0.45, metalness: 0.6 })
      : new THREE.MeshStandardMaterial({ color: '#8a6a4c', roughness: 0.9 });
    const infillMat = metal ? postMat : new THREE.MeshStandardMaterial({ color: '#a67c55', roughness: 0.85 });
    const posts: THREE.Matrix4[] = [];
    const rails: THREE.Matrix4[] = [];
    const infill: THREE.Matrix4[] = [];
    const caps: THREE.Matrix4[] = [];
    const base = g.grade;
    const up = (v: number) => base + v;

    // A box centered between plan points a and b, at height h (inches), sized along/up/across (inches).
    const box = (a: Vec, b: Vec, h: number, along: number, height: number, across: number) => {
      const wa = toWorld(fr, a, h);
      const wb = toWorld(fr, b, h);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-(wb.z - wa.z), wb.x - wa.x));
      return new THREE.Matrix4().compose(wa.add(wb).multiplyScalar(0.5), q, new THREE.Vector3(along * F, height * F, across * F));
    };
    const post = (p: Vec, size: number, height: number) => {
      posts.push(box(p, { x: p.x + 0.01, y: p.y }, up(height / 2), size, height, size));
      if (metal) caps.push(box(p, { x: p.x + 0.01, y: p.y }, up(height + 0.6), size + 0.8, 1.2, size + 0.8));
      else caps.push(box(p, { x: p.x + 0.01, y: p.y }, up(height + 0.5), size + 1.5, 1, size + 1.5));
    };

    const postSize = metal ? 2 : 3.5;
    for (const run of fence.runs) {
      const len = Math.hypot(run.b.x - run.a.x, run.b.y - run.a.y);
      if (len < 1) continue;
      const d = { x: (run.b.x - run.a.x) / len, y: (run.b.y - run.a.y) / len };
      const at = (t: number): Vec => ({ x: run.a.x + d.x * t, y: run.a.y + d.y * t });
      const bays = Math.max(1, Math.round(len / f.postSpacing));
      for (let i = 0; i <= bays; i++) post(at((len * i) / bays), postSize, f.height + (metal ? 2 : 0));
      // Rails run the full length (posts hide the joints).
      const railYs = metal ? [3.5, f.height - 1.5] : [8, f.height / 2, f.height - 6];
      for (const ry of railYs) {
        rails.push(box(run.a, run.b, up(ry), len, metal ? 1 : 3.5, metal ? 1 : 1.5));
      }
      if (metal) {
        // 5/8" pickets at 4" o.c. with a small finial above the top rail.
        for (let t = 2; t < len - 1; t += 4) {
          const p = at(t);
          infill.push(box(p, at(t + 0.01), up((2 + f.height) / 2), 0.625, f.height - 2, 0.625));
        }
      } else {
        // 1x6 cedar boards with 1/2" gaps on the street face, bottom 2" above grade.
        for (let t = 2.75; t < len - 2; t += 6) {
          const p = at(t);
          infill.push(box(p, at(t + 0.01), up(2 + (f.height - 2) / 2), 5.5, f.height - 2, 0.75));
        }
      }
    }
    // Heavier gate posts at the driveway (and the dock walk when fenced).
    for (const gate of fence.gates) {
      for (const p of [gate.a, gate.b]) post(p, metal ? 4 : 5.5, f.height + 12);
    }

    const out: Part[] = [
      { key: 'posts', mats: posts, material: postMat },
      { key: 'rails', mats: rails, material: infillMat },
      { key: 'infill', mats: infill, material: infillMat },
      { key: 'caps', mats: caps, material: postMat },
    ];
    return out;
  }, [fr, g]);

  const meshes = useMemo(
    () =>
      parts.map((p) => {
        const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), p.material, Math.max(1, p.mats.length));
        p.mats.forEach((m, i) => mesh.setMatrixAt(i, m));
        mesh.count = p.mats.length;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.name = `fence-${p.key}`;
        return mesh;
      }),
    [parts],
  );

  return (
    <group>
      {meshes.map((m) => (
        <primitive key={m.name} object={m} />
      ))}
    </group>
  );
}
