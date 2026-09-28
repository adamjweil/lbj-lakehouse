import { lazy, Suspense, useEffect } from 'react';
import { useStore, type Tool, type ViewMode } from './editor/store';
import { deleteFixture, deleteOpening, deleteRoom, deleteWall, moveWall, projectDelta } from './editor/ops';
import { READONLY } from './env';
import { isSheetId } from './views/sheets/sheetList';
import { SheetViewer } from './ui/SheetViewer';
import { Inspector } from './ui/Inspector';
import { Banners, StatusBar, Toolbar, TopBar, ValidationPanel } from './ui/Chrome';
// Bundled at build time so the read-only build needs no server; harmless to import otherwise.
import bundledHouse from '../design/house.json';

const Scene3D = lazy(() => import('./views/three/Scene3D').then((m) => ({ default: m.Scene3D })));

const TOOL_KEYS: Record<string, Tool> = { v: 'select', w: 'wall', d: 'door', n: 'window', l: 'slider', o: 'room', f: 'fixture', m: 'measure' };

async function loadDesign() {
  if (READONLY) {
    useStore.getState().loadFromDisk(JSON.stringify(bundledHouse));
    return;
  }
  const res = await fetch('/api/design');
  useStore.getState().loadFromDisk(await res.text());
}

export function App() {
  const design = useStore((s) => s.design);
  const loadErrors = useStore((s) => s.loadErrors);
  const preview = useStore((s) => s.preview);
  const mode = useStore((s) => s.mode);
  const sheet = useStore((s) => s.sheet);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const s = params.get('sheet');
    const m = params.get('mode') as ViewMode | null;
    if (isSheetId(s)) useStore.getState().set({ sheet: s });
    if (m && ['sheets', '3d', 'split'].includes(m)) useStore.getState().set({ mode: m });
    loadDesign();
    if (import.meta.hot) {
      import.meta.hot.on('design:changed', (data: { text: string }) => useStore.getState().loadFromDisk(data.text));
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, select, textarea, [contenteditable]')) return;
      const st = useStore.getState();
      if (READONLY) {
        // No server to save to and nothing editable: keep fit-to-sheet and deselect, drop the rest.
        if (e.key === '0') window.dispatchEvent(new Event('sheet:fit'));
        if (e.key === 'Escape') st.select(null);
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        st.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        st.save();
        return;
      }
      if (mod) return;
      if (e.key === '0') {
        window.dispatchEvent(new Event('sheet:fit'));
        return;
      }
      if (st.preview) return;
      const editing = st.mode !== '3d' && st.sheet === 'A-101';
      const tool = TOOL_KEYS[e.key.toLowerCase()];
      if (tool && editing) {
        st.setTool(tool);
        return;
      }
      const sel = st.selection;
      if (e.key === 'Escape') {
        st.setTool('select');
        st.select(null);
        return;
      }
      if (!sel || !st.design) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        st.apply((d) => {
          if (sel.kind === 'wall') deleteWall(d, sel.id);
          if (sel.kind === 'opening') deleteOpening(d, sel.id);
          if (sel.kind === 'fixture') deleteFixture(d, sel.id);
          if (sel.kind === 'room') deleteRoom(d, sel.id);
        });
        st.select(null);
        return;
      }
      if (e.key.toLowerCase() === 'r' && sel.kind === 'fixture') {
        st.apply((d) => {
          const f = d.fixtures.find((x) => x.id === sel.id);
          if (f) f.rotation = (f.rotation + (e.shiftKey ? 270 : 90)) % 360;
        });
        return;
      }
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const dir = arrows[e.key];
      if (dir) {
        e.preventDefault();
        const step = e.shiftKey ? 12 : st.snap;
        const delta = { x: dir[0] * step, y: dir[1] * step };
        st.apply((d) => {
          if (sel.kind === 'fixture') {
            const f = d.fixtures.find((x) => x.id === sel.id);
            if (f) {
              f.x += delta.x;
              f.y += delta.y;
            }
          } else if (sel.kind === 'wall') {
            const w = d.walls.find((x) => x.id === sel.id);
            if (w) {
              const pd = projectDelta(delta, w);
              if (Math.abs(pd.x) + Math.abs(pd.y) > 1e-6) moveWall(d, sel.id, pd);
            }
          } else if (sel.kind === 'opening') {
            const o = d.openings.find((x) => x.id === sel.id);
            const w = o && d.walls.find((x) => x.id === o.wallId);
            if (o && w) {
              const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
              const along = (delta.x * (w.end.x - w.start.x) + delta.y * (w.end.y - w.start.y)) / len;
              o.offset = Math.min(Math.max(o.offset + along, o.width / 2), len - o.width / 2);
            }
          }
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!design) {
    return (
      <div className="loading">
        {loadErrors.length ? (
          <div className="load-error">
            <h1>design/house.json could not be loaded</h1>
            <ul>
              {loadErrors.map((e, i) => (
                <li key={i}>
                  <code>{e}</code>
                </li>
              ))}
            </ul>
            <p>Fix the file and save it. The app reloads automatically.</p>
          </div>
        ) : (
          <p>Loading the design…</p>
        )}
      </div>
    );
  }

  const shown = preview?.design ?? design;
  const editable = !preview && !READONLY;
  const showToolbar = editable && mode !== '3d' && sheet === 'A-101';

  return (
    <div className="app">
      <TopBar design={shown} />
      <Banners />
      <div className="main">
        {showToolbar && <Toolbar />}
        <div className={`stage mode-${mode}`}>
          {mode !== '3d' && <SheetViewer design={shown} sheet={sheet} editable={editable} />}
          {mode !== 'sheets' && (
            <Suspense fallback={<div className="scene loading">Loading 3D…</div>}>
              <Scene3D design={shown} />
            </Suspense>
          )}
        </div>
        <aside className="sidebar">
          <Inspector design={shown} readOnly={!editable} />
          <ValidationPanel design={shown} />
        </aside>
      </div>
      <StatusBar />
    </div>
  );
}
