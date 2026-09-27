import { useEffect, useRef, useState } from 'react';
import type { Design } from '../model/schema';
import {
  bbox, dist, dot, fixtureCorners, openingPolygon, openingRange, pointAlong, roomStats, sub,
  wallDir, wallLength, wallPolygon, near, type Vec,
} from '../model/geometry';
import { formatFtIn } from '../model/units';
import { LW, SELECT, useDraft } from '../views/draft/draft';
import { planBounds } from '../views/plan/PlanDrawing';
import { useStore } from './store';
import {
  addFixture, addOpening, addRoom, addWall, moveWall, movePoint, nearestWall, projectDelta, snapPoint, snapTargets,
} from './ops';

type Drag =
  | { kind: 'wall'; id: string; p0: Vec; applied: Vec }
  | { kind: 'endpoint'; id: string; end: 'start' | 'end'; current: Vec; anchor: Vec }
  | { kind: 'opening'; id: string; grab: number }
  | { kind: 'fixture'; id: string; grab: Vec }
  | { kind: 'room-rect'; a: Vec; b: Vec };

const pts = (ps: Vec[]) => ps.map((p) => `${p.x},${p.y}`).join(' ');

/**
 * Editing layer for the floor plan: hit targets, selection outlines, drag handles and drawing tools.
 * Rendered inside the plan's model-space group.
 */
export function PlanOverlay({ design, toModel }: { design: Design; toModel: (x: number, y: number) => Vec | null }) {
  const { p } = useDraft();
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const snap = useStore((s) => s.snap);
  const select = useStore((s) => s.select);
  const apply = useStore((s) => s.apply);
  const setCursor = emitCursor;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [wallStart, setWallStart] = useState<Vec | null>(null);
  const [hover, setHover] = useState<Vec | null>(null);
  const [measure, setMeasure] = useState<{ a: Vec; b: Vec | null } | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  const snapOpts = (anchor?: Vec | null, exclude?: Vec) => ({
    grid: snap,
    points: snapTargets(useStore.getState().design ?? design, exclude),
    radius: p(10),
    anchor,
  });

  // Reset transient tool state when the tool changes.
  useEffect(() => {
    setWallStart(null);
    setMeasure(null);
    setHover(null);
  }, [tool]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setWallStart(null);
        setMeasure(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Window-level drag tracking.
  useEffect(() => {
    if (!drag) return;
    const st = useStore.getState();
    st.beginGesture();
    const move = (e: PointerEvent) => {
      const m = toModel(e.clientX, e.clientY);
      const d = dragRef.current;
      if (!m || !d) return;
      setCursor(m);
      const cur = useStore.getState().design;
      if (!cur) return;
      switch (d.kind) {
        case 'wall': {
          const w = cur.walls.find((x) => x.id === d.id);
          if (!w) return;
          const raw = projectDelta(sub(m, d.p0), w);
          const n = { x: wallDir(w).y, y: -wallDir(w).x };
          const mag = Math.round(dot(raw, n) / snap) * snap;
          const target = { x: n.x * mag, y: n.y * mag };
          const inc = sub(target, d.applied);
          if (Math.abs(inc.x) + Math.abs(inc.y) < 1e-6) return;
          apply((x) => moveWall(x, d.id, inc));
          dragRef.current = { ...d, applied: target };
          setDrag(dragRef.current);
          break;
        }
        case 'endpoint': {
          const next = snapPoint(m, { grid: snap, points: [], radius: 0, anchor: d.anchor });
          if (near(next, d.current, 0.01)) return;
          apply((x) => movePoint(x, d.current, next));
          dragRef.current = { ...d, current: next };
          setDrag(dragRef.current);
          break;
        }
        case 'opening': {
          const o = cur.openings.find((x) => x.id === d.id);
          const w = o && cur.walls.find((x) => x.id === o.wallId);
          if (!o || !w) return;
          const u = dot(sub(m, w.start), wallDir(w)) - d.grab;
          const L = wallLength(w);
          const clamped = Math.min(Math.max(Math.round(u / snap) * snap, o.width / 2), L - o.width / 2);
          if (clamped === o.offset) return;
          apply((x) => {
            const t = x.openings.find((q) => q.id === d.id);
            if (t) t.offset = clamped;
          });
          break;
        }
        case 'fixture': {
          const nx = Math.round((m.x - d.grab.x) / snap) * snap;
          const ny = Math.round((m.y - d.grab.y) / snap) * snap;
          apply((x) => {
            const f = x.fixtures.find((q) => q.id === d.id);
            if (f && (f.x !== nx || f.y !== ny)) {
              f.x = nx;
              f.y = ny;
            }
          });
          break;
        }
        case 'room-rect':
          dragRef.current = { ...d, b: snapPoint(m, snapOpts()) };
          setDrag(dragRef.current);
          break;
      }
    };
    const up = () => {
      const d = dragRef.current;
      if (d?.kind === 'endpoint') {
        // Join to a nearby wall endpoint when released close to one.
        const cur = useStore.getState().design;
        if (cur) {
          const target = snapTargets(cur, d.current).find((q) => dist(q, d.current) <= p(10) && dist(q, d.current) > 0.01);
          if (target) apply((x) => movePoint(x, d.current, target));
        }
      }
      if (d?.kind === 'room-rect' && dist(d.a, d.b) > 12) {
        let id = '';
        apply((x) => {
          id = addRoom(x, d.a, d.b);
        });
        if (id) select({ kind: 'room', id });
        useStore.getState().setTool('select');
      }
      useStore.getState().endGesture();
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    // The drag kind/id identify the gesture; later setDrag calls only update progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.kind, (drag as { id?: string } | null)?.id]);

  const start = (e: React.PointerEvent, fn: (m: Vec) => void) => {
    if (e.button !== 0 || tool !== 'select') return;
    e.stopPropagation();
    const m = toModel(e.clientX, e.clientY);
    if (m) fn(m);
  };

  // ---- tool layer (captures clicks anywhere on the drawing)
  const bounds = planBounds(design, 200);
  const toolLayer = tool !== 'select' && (
    <rect
      x={bounds.x0}
      y={bounds.y0}
      width={bounds.x1 - bounds.x0}
      height={bounds.y1 - bounds.y0}
      fill="transparent"
      style={{ cursor: 'crosshair' }}
      onPointerMove={(e) => {
        const m = toModel(e.clientX, e.clientY);
        if (!m) return;
        setCursor(m);
        if (tool === 'wall') setHover(snapPoint(m, snapOpts(wallStart)));
        else if (tool === 'room' || tool === 'fixture') setHover(snapPoint(m, snapOpts()));
        else if (tool === 'measure') {
          const s = snapPoint(m, snapOpts(measure && !measure.b ? measure.a : null));
          setHover(s);
        } else setHover(m);
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        const raw = toModel(e.clientX, e.clientY);
        if (!raw) return;
        const st = useStore.getState();
        switch (tool) {
          case 'wall': {
            const pt = snapPoint(raw, snapOpts(wallStart));
            if (!wallStart) setWallStart(pt);
            else if (dist(pt, wallStart) > 1) {
              apply((x) => {
                addWall(x, wallStart, pt, st.wallType);
              });
              setWallStart(pt);
            }
            break;
          }
          case 'door':
          case 'window':
          case 'slider': {
            const hit = nearestWall(design, raw, p(14));
            if (!hit) return;
            const u = Math.round(hit.u / snap) * snap;
            let id: string | null = null;
            apply((x) => {
              id = addOpening(x, hit.wall.id, u, tool);
            });
            if (id) {
              select({ kind: 'opening', id });
              st.setTool('select');
            }
            break;
          }
          case 'fixture': {
            const pt = snapPoint(raw, { ...snapOpts(), points: [] });
            let id = '';
            apply((x) => {
              id = addFixture(x, st.fixtureKind, pt);
            });
            select({ kind: 'fixture', id });
            st.setTool('select');
            break;
          }
          case 'room': {
            const a = snapPoint(raw, snapOpts());
            setDrag({ kind: 'room-rect', a, b: a });
            break;
          }
          case 'measure': {
            const pt = snapPoint(raw, snapOpts(measure && !measure.b ? measure.a : null));
            if (!measure || measure.b) setMeasure({ a: pt, b: null });
            else setMeasure({ a: measure.a, b: pt });
            break;
          }
        }
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (tool === 'wall') setWallStart(null);
      }}
    />
  );

  // ---- tool previews
  const preview: React.ReactNode[] = [];
  if (tool === 'wall' && hover) {
    preview.push(<circle key="wh" cx={hover.x} cy={hover.y} r={p(4)} fill={SELECT} />);
    if (wallStart) {
      preview.push(
        <g key="wl" pointerEvents="none">
          <line x1={wallStart.x} y1={wallStart.y} x2={hover.x} y2={hover.y} stroke={SELECT} strokeWidth={useStore.getState().wallType === 'exterior' ? 6 : 4.5} opacity={0.35} />
          <line x1={wallStart.x} y1={wallStart.y} x2={hover.x} y2={hover.y} stroke={SELECT} strokeWidth={p(LW.thin)} />
          <Label at={{ x: (wallStart.x + hover.x) / 2, y: (wallStart.y + hover.y) / 2 - p(10) }} text={formatFtIn(dist(wallStart, hover))} />
        </g>,
      );
    }
  }
  if ((tool === 'door' || tool === 'window' || tool === 'slider') && hover) {
    const hit = nearestWall(design, hover, p(14));
    if (hit) {
      const c = pointAlong(hit.wall, hit.u);
      preview.push(<circle key="op" cx={c.x} cy={c.y} r={p(6)} fill="none" stroke={SELECT} strokeWidth={p(LW.med)} pointerEvents="none" />);
    }
  }
  if (tool === 'fixture' && hover) {
    preview.push(<circle key="fx" cx={hover.x} cy={hover.y} r={p(5)} fill={SELECT} opacity={0.5} pointerEvents="none" />);
  }
  if (drag?.kind === 'room-rect') {
    const r = bbox([drag.a, drag.b]);
    preview.push(
      <g key="rr" pointerEvents="none">
        <rect x={r.x0} y={r.y0} width={r.x1 - r.x0} height={r.y1 - r.y0} fill={SELECT} fillOpacity={0.08} stroke={SELECT} strokeWidth={p(LW.thin)} strokeDasharray={`${p(6)} ${p(3)}`} />
        <Label at={{ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 }} text={`${formatFtIn(r.x1 - r.x0)} x ${formatFtIn(r.y1 - r.y0)}`} />
      </g>,
    );
  }
  if (tool === 'measure' && measure) {
    const b = measure.b ?? hover;
    if (b) {
      preview.push(
        <g key="ms" pointerEvents="none">
          <line x1={measure.a.x} y1={measure.a.y} x2={b.x} y2={b.y} stroke="#d1242f" strokeWidth={p(LW.med)} strokeDasharray={`${p(4)} ${p(2)}`} />
          <circle cx={measure.a.x} cy={measure.a.y} r={p(3)} fill="#d1242f" />
          <circle cx={b.x} cy={b.y} r={p(3)} fill="#d1242f" />
          <Label
            at={{ x: (measure.a.x + b.x) / 2, y: (measure.a.y + b.y) / 2 - p(10) }}
            text={`${formatFtIn(dist(measure.a, b))}  (Δx ${formatFtIn(Math.abs(b.x - measure.a.x))}, Δy ${formatFtIn(Math.abs(b.y - measure.a.y))})`}
            color="#d1242f"
          />
        </g>,
      );
    }
  }

  // ---- hit targets and selection
  const sel = selection;
  const selWall = sel?.kind === 'wall' ? design.walls.find((w) => w.id === sel.id) : undefined;
  const hitProps = (onDown: (e: React.PointerEvent) => void, cursor = 'pointer') => ({
    fill: 'transparent',
    style: { cursor: tool === 'select' ? cursor : undefined },
    pointerEvents: tool === 'select' ? ('all' as const) : ('none' as const),
    onPointerDown: onDown,
  });

  return (
    <g>
      {toolLayer}
      {/* rooms */}
      {design.rooms.map((r) => (
        <polygon
          key={r.id}
          data-hit={`room:${r.id}`}
          points={pts(roomStats(design, r).net)}
          {...hitProps((e) => start(e, () => select({ kind: 'room', id: r.id })), 'default')}
        />
      ))}
      {/* fixtures */}
      {design.fixtures.map((f) => (
        <polygon
          key={f.id}
          data-hit={`fixture:${f.id}`}
          points={pts(fixtureCorners(f))}
          {...hitProps((e) =>
            start(e, (m) => {
              select({ kind: 'fixture', id: f.id });
              setDrag({ kind: 'fixture', id: f.id, grab: { x: m.x - f.x, y: m.y - f.y } });
            }), 'move')}
        />
      ))}
      {/* walls */}
      {design.walls.map((w) => (
        <polygon
          key={w.id}
          data-hit={`wall:${w.id}`}
          points={pts(wallPolygon(design, w))}
          {...hitProps((e) =>
            start(e, (m) => {
              select({ kind: 'wall', id: w.id });
              setDrag({ kind: 'wall', id: w.id, p0: m, applied: { x: 0, y: 0 } });
            }), Math.abs(wallDir(w).x) > Math.abs(wallDir(w).y) ? 'ns-resize' : 'ew-resize')}
        />
      ))}
      {/* openings */}
      {design.openings.map((o) => {
        const w = design.walls.find((x) => x.id === o.wallId);
        if (!w) return null;
        return (
          <polygon
            key={o.id}
            data-hit={`opening:${o.id}`}
            points={pts(openingPolygon(w, o, 2))}
            {...hitProps((e) =>
              start(e, (m) => {
                select({ kind: 'opening', id: o.id });
                const u = dot(sub(m, w.start), wallDir(w));
                setDrag({ kind: 'opening', id: o.id, grab: u - o.offset });
              }), Math.abs(wallDir(w).x) > Math.abs(wallDir(w).y) ? 'ew-resize' : 'ns-resize')}
          />
        );
      })}

      {/* selection outlines */}
      <g pointerEvents="none">
        {sel?.kind === 'room' && (() => {
          const r = design.rooms.find((x) => x.id === sel.id);
          return r ? <polygon points={pts(roomStats(design, r).net)} fill={SELECT} fillOpacity={0.07} stroke={SELECT} strokeWidth={p(LW.med)} strokeDasharray={`${p(8)} ${p(4)}`} /> : null;
        })()}
        {sel?.kind === 'fixture' && (() => {
          const f = design.fixtures.find((x) => x.id === sel.id);
          return f ? <polygon points={pts(fixtureCorners(f))} fill={SELECT} fillOpacity={0.12} stroke={SELECT} strokeWidth={p(LW.med)} /> : null;
        })()}
        {selWall && (
          <polygon points={pts(wallPolygon(design, selWall))} fill={SELECT} fillOpacity={0.35} stroke={SELECT} strokeWidth={p(LW.med)} />
        )}
        {sel?.kind === 'opening' && (() => {
          const o = design.openings.find((x) => x.id === sel.id);
          const w = o && design.walls.find((x) => x.id === o.wallId);
          if (!o || !w) return null;
          const [u0, u1] = openingRange(o);
          const a = pointAlong(w, u0);
          const b = pointAlong(w, u1);
          return (
            <g>
              <polygon points={pts(openingPolygon(w, o, 2))} fill={SELECT} fillOpacity={0.25} stroke={SELECT} strokeWidth={p(LW.med)} />
              <Label at={{ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - p(18) }} text={`${o.tag} · ${formatFtIn(o.offset)} from ${w.id} start`} />
            </g>
          );
        })()}
      </g>

      {/* wall endpoint handles */}
      {selWall && tool === 'select' &&
        (['start', 'end'] as const).map((end) => {
          const pt = selWall[end];
          const other = end === 'start' ? selWall.end : selWall.start;
          return (
            <circle
              key={end}
              cx={pt.x}
              cy={pt.y}
              r={p(6)}
              fill="#fff"
              stroke={SELECT}
              strokeWidth={p(LW.heavy)}
              style={{ cursor: 'grab' }}
              onPointerDown={(e) => start(e, () => setDrag({ kind: 'endpoint', id: selWall.id, end, current: { ...pt }, anchor: other }))}
            />
          );
        })}
      {selWall && (
        <Label
          at={{ x: (selWall.start.x + selWall.end.x) / 2, y: (selWall.start.y + selWall.end.y) / 2 - p(20) }}
          text={`${selWall.id} · ${formatFtIn(wallLength(selWall))}`}
        />
      )}
      {preview}
    </g>
  );
}

function Label({ at, text, color = SELECT }: { at: Vec; text: string; color?: string }) {
  const { p } = useDraft();
  const size = p(9);
  const w = text.length * size * 0.56 + p(8);
  return (
    <g pointerEvents="none">
      <rect x={at.x - w / 2} y={at.y - size * 0.95} width={w} height={size * 1.45} rx={p(3)} fill={color} />
      <text x={at.x} y={at.y + size * 0.1} fontSize={size} fill="#fff" textAnchor="middle" fontFamily="Helvetica, Arial, sans-serif" fontWeight="bold">
        {text}
      </text>
    </g>
  );
}

const cursorListeners = new Set<(m: Vec) => void>();

/** Publishes the cursor's model position to the status bar. */
export function emitCursor(m: Vec) {
  cursorListeners.forEach((fn) => fn(m));
}

export function onCursor(fn: (m: Vec) => void) {
  cursorListeners.add(fn);
  return () => cursorListeners.delete(fn);
}
