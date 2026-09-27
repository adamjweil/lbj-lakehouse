import * as THREE from 'three';

/** Canvas textures so the model has some surface character without image assets. */

function canvasTexture(size: [number, number], draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
  const c = document.createElement('canvas');
  c.width = size[0];
  c.height = size[1];
  const ctx = c.getContext('2d')!;
  draw(ctx, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

let cache: Record<string, THREE.Texture> | null = null;

export function textures() {
  if (cache) return cache;
  cache = {
    /** Board-and-batten: one board per foot with a raised batten. */
    siding: canvasTexture([64, 64], (ctx, w, h) => {
      ctx.fillStyle = '#e6e6e6';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = `rgba(0,0,0,${0.02 + Math.random() * 0.03})`;
        ctx.fillRect(Math.random() * w, 0, 1, h);
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 8, h);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(8, 0, 2, h);
    }),
    /** Deck boards: 5.5" boards with gaps, one repeat per foot. */
    deck: canvasTexture([64, 64], (ctx, w, h) => {
      ctx.fillStyle = '#e0e0e0';
      ctx.fillRect(0, 0, w, h);
      for (const y of [0, 32]) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(0, y + 29, w, 3);
      }
      for (let i = 0; i < 30; i++) {
        ctx.fillStyle = `rgba(0,0,0,${0.02 + Math.random() * 0.04})`;
        ctx.fillRect(0, Math.random() * h, w, 1);
      }
    }),
    /** Lattice skirt with transparent gaps. */
    lattice: canvasTexture([64, 64], (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 7;
      ctx.beginPath();
      for (let i = -w; i <= w * 2; i += 32) {
        ctx.moveTo(i, 0);
        ctx.lineTo(i + h, h);
        ctx.moveTo(i, h);
        ctx.lineTo(i + h, 0);
      }
      ctx.stroke();
    }),
    /** Tongue-and-groove / plank floors. */
    plank: canvasTexture([128, 128], (ctx, w, h) => {
      ctx.fillStyle = '#e8e8e8';
      ctx.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 16) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(0, y, w, 1);
        const off = (y * 37) % w;
        ctx.fillRect(off, y, 1, 16);
        for (let i = 0; i < 6; i++) {
          ctx.fillStyle = `rgba(0,0,0,${0.02 + Math.random() * 0.05})`;
          ctx.fillRect(0, y + 2 + Math.random() * 13, w, 1);
        }
      }
    }),
    tile: canvasTexture([64, 64], (ctx, w, h) => {
      ctx.fillStyle = '#eeeeee';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, 0, w, 2);
      ctx.fillRect(0, 0, 2, h);
    }),
  };
  return cache;
}

export function floorLook(finish: string): { color: string; map: 'plank' | 'tile' | null } {
  if (/concrete|slab/i.test(finish)) return { color: '#b8b5ae', map: null };
  if (/tile/i.test(finish)) return { color: '#cfcac1', map: 'tile' };
  if (/oak|wood|plank|pine/i.test(finish)) return { color: '#c9a57c', map: 'plank' };
  if (/lvp|vinyl/i.test(finish)) return { color: '#b9ab98', map: 'plank' };
  return { color: '#d7d1c7', map: null };
}
