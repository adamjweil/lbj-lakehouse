import { useMemo } from 'react';
import * as THREE from 'three';
import type { Vec } from '../../../model/geometry';
import type { SiteGeom } from '../../../model/site';
import { formatFtIn } from '../../../model/units';
import { F, toWorld, type Frame } from '../House3D';

type G = NonNullable<SiteGeom>;

function label(lines: string[], opts: { width: number; bg: string; fg: string; big?: boolean }) {
  const c = document.createElement('canvas');
  const scale = 2;
  const lh = opts.big ? 64 : 44;
  c.width = opts.width * scale;
  c.height = (lines.length * lh + 36) * scale;
  const ctx = c.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.fillStyle = opts.bg;
  const r = 14;
  const w = opts.width;
  const h = c.height / scale;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, r);
  ctx.fill();
  ctx.fillStyle = opts.fg;
  ctx.textAlign = 'center';
  lines.forEach((l, i) => {
    ctx.font = `${i === 0 && opts.big ? 700 : 600} ${i === 0 && opts.big ? 46 : 30}px Helvetica, Arial, sans-serif`;
    ctx.fillText(l, w / 2, 18 + lh * (i + 0.75));
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return { texture: t, aspect: c.width / c.height };
}

/** Property lines: painted dashes, corner survey stakes with flagging, setbacks, and labels. */
export function LotLines({ fr, g }: { fr: Frame; g: G }) {
  const built = useMemo(() => {
    const L = g.lotRect;
    const lot = g.lot;
    const paint = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const setbackMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35 });
    const dashes = (pts: Vec[], closed: boolean, h: (p: Vec) => number, dash: number, gap: number, width: number) => {
      const out: THREE.Matrix4[] = [];
      const n = closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
        for (let t = 0; t < len; t += dash + gap) {
          const e = Math.min(len, t + dash);
          const p0 = { x: a.x + d.x * t, y: a.y + d.y * t };
          const p1 = { x: a.x + d.x * e, y: a.y + d.y * e };
          // A flat painted dash from p0 to p1.
          const w0 = toWorld(fr, p0, h(p0));
          const w1 = toWorld(fr, p1, h(p1));
          const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-(w1.z - w0.z), w1.x - w0.x));
          out.push(new THREE.Matrix4().compose(w0.clone().add(w1).multiplyScalar(0.5), q, new THREE.Vector3(w0.distanceTo(w1), 0.6 * F, width * F)));
        }
      }
      return out;
    };
    const onShore = (p: Vec) => Math.abs(p.y - g.shoreY) < 1;
    const lineH = (p: Vec) => (onShore(p) ? g.grade + 9 : g.grade + 1.5);
    const lines = dashes(lot, true, lineH, 48, 18, 10);
    const sb = g.setback;
    const setbacks = dashes(
      [
        { x: sb.x0, y: sb.y0 },
        { x: sb.x1, y: sb.y0 },
        { x: sb.x1, y: sb.y1 },
        { x: sb.x0, y: sb.y1 },
      ],
      true,
      () => g.grade + 1.2,
      18,
      24,
      2,
    );
    const mk = (mats: THREE.Matrix4[], mat: THREE.Material) => {
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, Math.max(1, mats.length));
      mats.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.count = mats.length;
      return mesh;
    };

    // Survey stakes with pink flagging at each corner.
    const stakes = lot.map((p) => toWorld(fr, p, onShore(p) ? g.grade + 8 : g.grade));

    const acres = g.acres.toFixed(2);
    const sf = Math.round(g.area / 144).toLocaleString('en-US');
    const width = formatFtIn(L.x1 - L.x0).replace(/-0"$/, '');
    const depth = formatFtIn(L.y1 - L.y0).replace(/-0"$/, '');
    const main = label([`${acres} ACRE LOT`, `${sf} SF · ${width} x ${depth}`], { width: 560, bg: 'rgba(20,24,28,0.78)', fg: '#ffffff', big: true });
    const front = label([`${width} FRONTAGE`], { width: 300, bg: 'rgba(255,255,255,0.85)', fg: '#1b1f23' });
    const side = label([`${depth} DEEP`], { width: 260, bg: 'rgba(255,255,255,0.85)', fg: '#1b1f23' });
    const cx = (L.x0 + L.x1) / 2;
    return {
      lines: mk(lines, paint),
      setbacks: mk(setbacks, setbackMat),
      stakes,
      labels: [
        { ...main, pos: toWorld(fr, { x: cx, y: L.y0 + 700 }, g.grade + 70 * 12), size: 56, onTop: true },
        { ...front, pos: toWorld(fr, { x: L.x0 + 170, y: g.shoreY - 30 }, g.grade + 4 * 12), size: 16, onTop: false },
        { ...side, pos: toWorld(fr, { x: L.x1 - 40, y: (L.y0 + g.shoreY) / 2 }, g.grade + 4 * 12), size: 16, onTop: false },
      ],
    };
  }, [fr, g]);

  return (
    <group>
      <primitive object={built.lines} />
      <primitive object={built.setbacks} />
      {built.stakes.map((p, i) => (
        <group key={i} position={p}>
          <mesh position={[0, 1.4, 0]} castShadow>
            <boxGeometry args={[0.16, 2.8, 0.16]} />
            <meshStandardMaterial color="#c9a26b" roughness={0.9} />
          </mesh>
          <mesh position={[0.22, 2.55, 0]}>
            <planeGeometry args={[0.45, 0.2]} />
            <meshStandardMaterial color="#ff4fa3" side={THREE.DoubleSide} emissive="#ff4fa3" emissiveIntensity={0.25} />
          </mesh>
        </group>
      ))}
      {built.labels.map((l, i) => (
        <sprite key={i} position={l.pos} scale={[l.size, l.size / l.aspect, 1]}>
          <spriteMaterial map={l.texture} depthTest={!l.onTop} transparent />
        </sprite>
      ))}
    </group>
  );
}
