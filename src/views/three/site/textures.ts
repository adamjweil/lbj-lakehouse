import * as THREE from 'three';

/** Procedural site textures drawn on canvases (no downloads). Each repeats per `feet` of ground. */

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function make(size: number, draw: (ctx: CanvasRenderingContext2D, s: number, rnd: () => number) => void, seed: number, srgb = true) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  draw(ctx, size, mulberry(seed));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;

function speckle(ctx: CanvasRenderingContext2D, s: number, rnd: () => number, n: number, color: () => string, len: [number, number], width = 1) {
  ctx.lineWidth = width;
  for (let i = 0; i < n; i++) {
    const x = rnd() * s;
    const y = rnd() * s;
    const l = len[0] + rnd() * (len[1] - len[0]);
    const a = -Math.PI / 2 + (rnd() - 0.5) * 0.9;
    ctx.strokeStyle = color();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
}

let cache: ReturnType<typeof build> | null = null;

function build() {
  return {
    /** Mowed lawn with two mowing stripes and soft patchiness. One repeat covers 24 ft. */
    lawn: make(1024, (ctx, s, rnd) => {
      ctx.fillStyle = hsl(88, 34, 36);
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 90; i++) {
        const x = rnd() * s;
        const y = rnd() * s;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 60 + rnd() * 160);
        g.addColorStop(0, hsl(80 + rnd() * 20, 30 + rnd() * 15, 30 + rnd() * 14, 0.3));
        g.addColorStop(1, hsl(90, 30, 35, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
      }
      ctx.fillStyle = 'rgba(20,40,10,0.10)';
      ctx.fillRect(0, 0, s / 2, s);
      speckle(ctx, s, rnd, 60000, () => hsl(78 + rnd() * 30, 30 + rnd() * 25, 26 + rnd() * 22, 0.7), [2, 5]);
    }, 11),
    /** Native meadow: taller, drier, patchy grass. Repeat every 12 ft. */
    meadow: make(512, (ctx, s, rnd) => {
      ctx.fillStyle = hsl(62, 26, 38);
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 80; i++) {
        const x = rnd() * s;
        const y = rnd() * s;
        const r = 30 + rnd() * 110;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, rnd() < 0.5 ? hsl(45, 30, 52, 0.45) : hsl(95, 25, 28, 0.45));
        g.addColorStop(1, hsl(60, 25, 40, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
      }
      speckle(ctx, s, rnd, 14000, () => (rnd() < 0.4 ? hsl(45 + rnd() * 10, 30, 50 + rnd() * 15, 0.8) : hsl(70 + rnd() * 30, 25, 22 + rnd() * 20, 0.8)), [3, 10]);
    }, 23),
    /** Crushed limestone gravel. Repeat every 4 ft. */
    gravel: make(256, (ctx, s, rnd) => {
      ctx.fillStyle = '#b9b2a4';
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 5000; i++) {
        const r = 0.8 + rnd() * 2.4;
        ctx.fillStyle = hsl(35 + rnd() * 15, 8 + rnd() * 10, 50 + rnd() * 35);
        ctx.beginPath();
        ctx.arc(rnd() * s, rnd() * s, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }, 31),
    /** Asphalt with a dashed yellow centerline across the middle. Repeat every 20 ft along the road. */
    asphalt: make(512, (ctx, s, rnd) => {
      ctx.fillStyle = '#3b3d3f';
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 12000; i++) {
        ctx.fillStyle = hsl(0, 0, 18 + rnd() * 30, 0.6);
        ctx.fillRect(rnd() * s, rnd() * s, 1.2, 1.2);
      }
      ctx.fillStyle = '#d8b43a';
      ctx.fillRect(0, s / 2 - 3, s * 0.5, 6);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(0, 10, s, 5);
      ctx.fillRect(0, s - 15, s, 5);
    }, 41),
    /** Irregular flagstones with grassy joints. Repeat every 4 ft. */
    flagstone: make(256, (ctx, s, rnd) => {
      ctx.fillStyle = hsl(85, 25, 30);
      ctx.fillRect(0, 0, s, s);
      const cells = 4;
      const step = s / cells;
      for (let i = 0; i < cells; i++) {
        for (let j = 0; j < cells; j++) {
          const cx = (i + 0.5) * step + (rnd() - 0.5) * step * 0.3;
          const cy = (j + 0.5) * step + (rnd() - 0.5) * step * 0.3;
          const r = step * 0.42;
          ctx.fillStyle = hsl(30 + rnd() * 15, 15 + rnd() * 12, 58 + rnd() * 16);
          ctx.beginPath();
          for (let k = 0; k < 7; k++) {
            const a = (k / 7) * Math.PI * 2;
            const rr = r * (0.8 + rnd() * 0.25);
            const x = cx + Math.cos(a) * rr;
            const y = cy + Math.sin(a) * rr;
            if (k === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.fill();
        }
      }
      for (let i = 0; i < 2500; i++) {
        ctx.fillStyle = hsl(30, 10, 40 + rnd() * 40, 0.25);
        ctx.fillRect(rnd() * s, rnd() * s, 1.5, 1.5);
      }
    }, 53),
    /** Cut limestone blocks for the bulkhead. Repeat every 8 ft along, 4 ft up. */
    limestone: make(512, (ctx, s, rnd) => {
      ctx.fillStyle = '#8f877a';
      ctx.fillRect(0, 0, s, s);
      const rows = 6;
      const h = s / rows;
      for (let r = 0; r < rows; r++) {
        let x = -rnd() * 60;
        while (x < s) {
          const w = 60 + rnd() * 90;
          ctx.fillStyle = hsl(38 + rnd() * 10, 14 + rnd() * 10, 66 + rnd() * 14);
          ctx.fillRect(x + 2, r * h + 2, w - 4, h - 4);
          for (let i = 0; i < 40; i++) {
            ctx.fillStyle = hsl(35, 10, 45 + rnd() * 30, 0.3);
            ctx.fillRect(x + rnd() * w, r * h + rnd() * h, 2, 2);
          }
          x += w;
        }
      }
    }, 67),
    /** Loose rock riprap. Repeat every 6 ft. */
    riprap: make(256, (ctx, s, rnd) => {
      ctx.fillStyle = '#5f5a52';
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 180; i++) {
        const r = 6 + rnd() * 14;
        const x = rnd() * s;
        const y = rnd() * s;
        const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r);
        g.addColorStop(0, hsl(35, 10, 75 + rnd() * 10));
        g.addColorStop(1, hsl(30, 8, 40 + rnd() * 10));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * (0.6 + rnd() * 0.4), rnd() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
    }, 71),
    /** Alpha grass blades for tufts. */
    tuft: make(128, (ctx, s, rnd) => {
      ctx.clearRect(0, 0, s, s);
      for (let i = 0; i < 70; i++) {
        const x = s * 0.2 + rnd() * s * 0.6;
        const h = s * (0.45 + rnd() * 0.5);
        const lean = (rnd() - 0.5) * s * 0.35;
        ctx.strokeStyle = rnd() < 0.35 ? hsl(45, 35, 55 + rnd() * 15) : hsl(75 + rnd() * 25, 30, 25 + rnd() * 20);
        ctx.lineWidth = 1 + rnd() * 1.5;
        ctx.beginPath();
        ctx.moveTo(x, s);
        ctx.quadraticCurveTo(x + lean * 0.3, s - h * 0.6, x + lean, s - h);
        ctx.stroke();
      }
    }, 83),
    /** Tileable water ripple normal map (linear, not sRGB). */
    waterNormal: make(512, (ctx, s, rnd) => {
      // Sum of sine waves gives a smooth, tileable height field; take its gradient.
      const waves = Array.from({ length: 14 }, () => ({
        kx: Math.round((rnd() - 0.5) * 16),
        ky: Math.round((rnd() - 0.5) * 16),
        a: 0.3 + rnd(),
        p: rnd() * Math.PI * 2,
      })).filter((w) => w.kx || w.ky);
      const img = ctx.createImageData(s, s);
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          let dx = 0;
          let dy = 0;
          for (const w of waves) {
            const t = ((w.kx * x + w.ky * y) / s) * Math.PI * 2 + w.p;
            const c = Math.cos(t) * w.a;
            dx += c * w.kx;
            dy += c * w.ky;
          }
          const n = new THREE.Vector3(-dx * 0.02, -dy * 0.02, 1).normalize();
          const i = (y * s + x) * 4;
          img.data[i] = (n.x * 0.5 + 0.5) * 255;
          img.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
          img.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    }, 97, false),
    /** Forested far hills seen from across the lake. */
    forest: make(512, (ctx, s, rnd) => {
      ctx.fillStyle = hsl(95, 22, 24);
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 2500; i++) {
        const r = 3 + rnd() * 9;
        ctx.fillStyle = rnd() < 0.15 ? hsl(45, 20, 45 + rnd() * 10) : hsl(85 + rnd() * 40, 20 + rnd() * 15, 16 + rnd() * 18);
        ctx.beginPath();
        ctx.arc(rnd() * s, rnd() * s, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }, 101),
  };
}

export function siteTextures() {
  if (!cache) cache = build();
  return cache;
}

/** A texture clone tiled so one repeat covers `feet` × `feet` of a surface `w` × `h` feet. */
export function tiled(t: THREE.Texture, w: number, h: number, feet: number) {
  const c = t.clone();
  c.needsUpdate = true;
  c.repeat.set(w / feet, h / feet);
  return c;
}
