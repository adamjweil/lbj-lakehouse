import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Design } from '../model/schema';
import { SHEET_H, SHEET_W } from '../views/draft/draft';
import { SHEET_COMPONENTS } from '../views/sheets/Sheets';
import { PlanOverlay, emitCursor } from '../editor/PlanOverlay';
import { useStore, type SheetId } from '../editor/store';

type VB = { x: number; y: number; w: number; h: number };

const STORAGE_KEY = 'lbj:sheet-views';

/** Per-sheet zoom, remembered across reloads. */
const saved = new Map<SheetId, VB>(
  (() => {
    try {
      return Object.entries(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')) as [SheetId, VB][];
    } catch {
      return [];
    }
  })(),
);

function remember(sheet: SheetId, vb: VB) {
  saved.set(sheet, vb);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(saved)));
  } catch {
    // Storage unavailable; the zoom still persists for this session.
  }
}

function fitBox(el: HTMLElement): VB {
  const r = el.getBoundingClientRect();
  const aspect = r.width / Math.max(1, r.height);
  const pad = 40;
  let w = SHEET_W + pad * 2;
  let h = SHEET_H + pad * 2;
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  return { x: SHEET_W / 2 - w / 2, y: SHEET_H / 2 - h / 2, w, h };
}

export function SheetViewer({ design, sheet, editable }: { design: Design; sheet: SheetId; editable: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const plan = useRef<SVGGElement>(null);
  const [vb, setVb] = useState<VB | null>(saved.get(sheet) ?? null);
  const pan = useRef<{ x: number; y: number; vb: VB; moved: boolean } | null>(null);
  const select = useStore((s) => s.select);

  // Keep the aspect ratio in sync with the container.
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const apply = () => {
      setVb((cur) => {
        const r = el.getBoundingClientRect();
        if (!cur) return saved.get(sheet) ?? fitBox(el);
        const aspect = r.width / Math.max(1, r.height);
        const h = cur.w / aspect;
        return { ...cur, y: cur.y + (cur.h - h) / 2, h };
      });
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sheet]);

  useEffect(() => {
    setVb(saved.get(sheet) ?? (wrap.current ? fitBox(wrap.current) : null));
  }, [sheet]);

  useEffect(() => {
    if (vb) remember(sheet, vb);
  }, [vb, sheet]);

  const fit = useCallback(() => {
    if (wrap.current) setVb(fitBox(wrap.current));
  }, []);

  useEffect(() => {
    const onFit = () => fit();
    window.addEventListener('sheet:fit', onFit);
    return () => window.removeEventListener('sheet:fit', onFit);
  }, [fit]);

  // Wheel zoom (non-passive so we can prevent page scroll).
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setVb((cur) => {
        if (!cur) return cur;
        const r = el.getBoundingClientRect();
        if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
          const k = cur.w / r.width;
          return { ...cur, x: cur.x + e.deltaX * k, y: cur.y + e.deltaY * k };
        }
        const factor = Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
        const w = Math.min(Math.max(cur.w * factor, 120), SHEET_W * 3);
        const h = (w / cur.w) * cur.h;
        const fx = (e.clientX - r.left) / r.width;
        const fy = (e.clientY - r.top) / r.height;
        return { x: cur.x + (cur.w - w) * fx, y: cur.y + (cur.h - h) * fy, w, h };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [vb !== null]);

  const toModel = useCallback((cx: number, cy: number) => {
    const g = plan.current;
    const m = g?.getScreenCTM();
    if (!g || !m || !svg.current) return null;
    const pt = svg.current.createSVGPoint();
    pt.x = cx;
    pt.y = cy;
    const q = pt.matrixTransform(m.inverse());
    return { x: q.x, y: q.y };
  }, []);

  const Sheet = SHEET_COMPONENTS[sheet];
  const interactive = editable && sheet === 'A-101';

  return (
    <div className="sheet-wrap" ref={wrap}>
      {vb && (
        <Sheet
          design={design}
          planRef={plan}
          overlay={interactive ? <PlanOverlay design={design} toModel={toModel} /> : undefined}
          frame={{
            svgRef: svg,
            viewBox: `${vb.x} ${vb.y} ${vb.w} ${vb.h}`,
            className: 'sheet',
            onPointerDown: (e) => {
              if (e.button !== 0 && e.button !== 1) return;
              pan.current = { x: e.clientX, y: e.clientY, vb, moved: false };
              (e.currentTarget as Element).setPointerCapture(e.pointerId);
            },
            onPointerMove: (e) => {
              if (sheet === 'A-101') {
                const m = toModel(e.clientX, e.clientY);
                if (m) emitCursor(m);
              }
              const p = pan.current;
              if (!p || !svg.current) return;
              const r = svg.current.getBoundingClientRect();
              const k = p.vb.w / r.width;
              const dx = e.clientX - p.x;
              const dy = e.clientY - p.y;
              if (Math.abs(dx) + Math.abs(dy) > 3) p.moved = true;
              if (p.moved) setVb({ ...p.vb, x: p.vb.x - dx * k, y: p.vb.y - dy * k });
            },
            onPointerUp: () => {
              if (pan.current && !pan.current.moved) select(null);
              pan.current = null;
            },
            onDoubleClick: (e) => {
              if ((e.target as Element).getAttribute('data-paper') || e.target === svg.current) fit();
            },
            style: { cursor: pan.current?.moved ? 'grabbing' : 'default' },
          }}
        />
      )}
      <div className="sheet-zoom">
        <button onClick={() => setVb((c) => (c ? zoom(c, 1 / 1.3) : c))} title="Zoom in">+</button>
        <button onClick={() => setVb((c) => (c ? zoom(c, 1.3) : c))} title="Zoom out">−</button>
        <button onClick={fit} title="Fit sheet (double-click the paper)">Fit</button>
      </div>
    </div>
  );
}

function zoom(c: VB, f: number): VB {
  const w = c.w * f;
  const h = c.h * f;
  return { x: c.x + (c.w - w) / 2, y: c.y + (c.h - h) / 2, w, h };
}
