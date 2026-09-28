import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { Design } from '../model/schema';
import { FIXTURE_KINDS, parseDesignText } from '../model/schema';
import { validateDesign, type Issue } from '../model/validate';
import { validateFraming } from '../model/framing/checks';
import { validateEnvelope } from '../model/envelope';
import { takeoffCsv, takeoffJson } from '../model/framing/csv';
import { designSummary } from '../model/geometry';
import { formatFtIn, formatSqft } from '../model/units';
import { stringifyDesign } from '../model/format';
import { selectDirty, useStore, type Tool } from '../editor/store';
import { onCursor } from '../editor/PlanOverlay';
import { READONLY } from '../env';
import { DISCIPLINES, disciplineOf, SHEETS, type SheetId } from '../views/sheets/sheetList';
import { exportPdf } from '../export/pdf';

export function TopBar({ design }: { design: Design }) {
  const sheet = useStore((s) => s.sheet);
  const mode = useStore((s) => s.mode);
  const set = useStore((s) => s.set);
  const dirty = useStore(selectDirty);
  const saving = useStore((s) => s.saving);
  const save = useStore((s) => s.save);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const preview = useStore((s) => s.preview);
  const [exporting, setExporting] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [takeoffOpen, setTakeoffOpen] = useState(false);
  const rev = design.meta.revisions.at(-1);
  const discipline = disciplineOf(sheet);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo" aria-hidden>⌂</span>
        <div>
          <div className="title">{design.meta.project}</div>
          <div className="subtitle">Rev {rev?.rev ?? '—'} · {formatSqft(designSummary(design).gross)}</div>
        </div>
      </div>
      <div className="seg disciplines" role="group" aria-label="Discipline">
        {DISCIPLINES.filter((g) => SHEETS.some((q) => disciplineOf(q.id) === g.key)).map((g) => (
          <button
            key={g.key}
            className={discipline === g.key ? 'on' : ''}
            title={`${g.title} sheets`}
            onClick={() => {
              const first = SHEETS.find((q) => disciplineOf(q.id) === g.key);
              if (first) set({ sheet: first.id, mode: mode === '3d' ? 'sheets' : mode });
            }}
          >
            {g.key}
          </button>
        ))}
      </div>
      <nav className="tabs" aria-label="Sheets">
        {SHEETS.filter((s) => disciplineOf(s.id) === discipline).map((s) => (
          <button
            key={s.id}
            className={sheet === s.id && mode !== '3d' ? 'on' : ''}
            onClick={() => set({ sheet: s.id, mode: mode === '3d' ? 'sheets' : mode })}
            title={s.title}
          >
            <b>{s.id}</b> <span>{s.title}</span>
          </button>
        ))}
      </nav>
      <div className="seg" role="group" aria-label="View">
        {(['sheets', 'split', '3d'] as const).map((m) => (
          <button key={m} className={mode === m ? 'on' : ''} onClick={() => set({ mode: m })}>
            {m === 'sheets' ? 'Sheets' : m === 'split' ? 'Split' : '3D'}
          </button>
        ))}
      </div>
      <div className="actions">
        {!READONLY && (
          <>
            <button onClick={undo} disabled={!canUndo || !!preview} title="Undo (⌘Z)">↶</button>
            <button onClick={redo} disabled={!canRedo || !!preview} title="Redo (⇧⌘Z)">↷</button>
            <button onClick={() => setHistoryOpen(true)} title="Saved versions">History</button>
          </>
        )}
        <button
          disabled={!!exporting}
          onClick={async () => {
            setExporting('Preparing…');
            try {
              await exportPdf(design, (msg) => setExporting(msg));
            } finally {
              setExporting(null);
            }
          }}
        >
          {exporting ?? 'Export PDF'}
        </button>
        <button onClick={() => setTakeoffOpen(true)} title="Download the framing takeoff">Takeoff</button>
        <button onClick={() => downloadJson(design)} title="Download house.json">JSON</button>
        {READONLY ? (
          <span className="badge" title="Published from design/house.json at build time. Nothing here can be edited or saved.">
            Read-only
          </span>
        ) : (
          <button className={`primary ${dirty ? 'dirty' : ''}`} onClick={save} disabled={!dirty || saving || !!preview} title="Save to design/house.json (⌘S)">
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        )}
      </div>
      {!READONLY && historyOpen && <HistoryDialog onClose={() => setHistoryOpen(false)} />}
      {takeoffOpen && <TakeoffDialog design={design} onClose={() => setTakeoffOpen(false)} />}
    </header>
  );
}

function download(name: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

const downloadJson = (design: Design) => download('house.json', stringifyDesign(design), 'application/json');

const TAKEOFF_FILES: Record<string, string> = {
  'cut-list.csv': 'Every distinct piece: mark, size, length, end cuts, and where it goes',
  'buy-list.csv': 'Sticks to buy by size and stock length, with the waste allowance',
  'pieces.csv': 'Every piece on its own row, with its position in the building',
  'rough-openings.csv': 'Rough opening, header, and jack studs for each door and window',
  'sheet-goods.csv': 'Subfloor, wall, and roof sheathing by the sheet',
  'hardware.csv': 'Connectors and anchors',
  'roofing.csv': 'Roofing, trim, flashing, gutters, and downspouts',
  'envelope.csv': 'Siding, weather barrier, insulation, and exterior trim',
};

function TakeoffDialog({ design, onClose }: { design: Design; onClose: () => void }) {
  const files = useMemo(() => takeoffCsv(design), [design]);
  const rev = design.meta.revisions.at(-1)?.rev ?? 0;
  const stem = `${design.meta.project.replace(/\W+/g, '-')}-rev${rev}`;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Framing takeoff" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Framing takeoff</h2>
          <button onClick={onClose} aria-label="Close">✕</button>
        </header>
        <p className="muted">Preliminary quantities for budgeting, from the design as it is on screen. Lengths are in inches. Sheets S-601 and S-602 show the same lists.</p>
        <ul className="history">
          {Object.entries(files).map(([name, text]) => (
            <li key={name}>
              <button onClick={() => download(`${stem}-${name}`, text, 'text/csv')} title={TAKEOFF_FILES[name]}>
                <b>{name}</b> · {TAKEOFF_FILES[name] ?? ''}
              </button>
            </li>
          ))}
          <li>
            <button onClick={() => download(`${stem}-takeoff.json`, JSON.stringify(takeoffJson(design), null, 2), 'application/json')}>
              <b>takeoff.json</b> · Everything above in one file
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
}

const TOOLS: { id: Tool; label: string; key: string; icon: string }[] = [
  { id: 'select', label: 'Select / move', key: 'V', icon: '↖' },
  { id: 'wall', label: 'Draw wall', key: 'W', icon: '▭' },
  { id: 'door', label: 'Add door', key: 'D', icon: '◠' },
  { id: 'window', label: 'Add window', key: 'N', icon: '▥' },
  { id: 'slider', label: 'Add sliding door', key: 'L', icon: '⇆' },
  { id: 'room', label: 'Draw room', key: 'O', icon: '⬚' },
  { id: 'fixture', label: 'Place fixture', key: 'F', icon: '▣' },
  { id: 'measure', label: 'Measure', key: 'M', icon: '↔' },
];

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const snap = useStore((s) => s.snap);
  const set = useStore((s) => s.set);
  const fixtureKind = useStore((s) => s.fixtureKind);
  const wallType = useStore((s) => s.wallType);
  return (
    <aside className="toolbar" aria-label="Tools">
      {TOOLS.map((t) => (
        <button key={t.id} className={tool === t.id ? 'on' : ''} onClick={() => setTool(t.id)} title={`${t.label} (${t.key})`}>
          <span className="icon">{t.icon}</span>
          <span className="key">{t.key}</span>
        </button>
      ))}
      <div className="tool-opts">
        {tool === 'wall' && (
          <select value={wallType} onChange={(e) => set({ wallType: e.target.value as 'interior' | 'exterior' })} aria-label="Wall type">
            <option value="interior">Interior</option>
            <option value="exterior">Exterior</option>
          </select>
        )}
        {tool === 'fixture' && (
          <select value={fixtureKind} onChange={(e) => set({ fixtureKind: e.target.value as typeof fixtureKind })} aria-label="Fixture">
            {FIXTURE_KINDS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        )}
        <label title="Snap increment">
          <span>Snap</span>
          <select value={snap} onChange={(e) => set({ snap: +e.target.value })}>
            <option value={0.5}>½"</option>
            <option value={1}>1"</option>
            <option value={3}>3"</option>
            <option value={6}>6"</option>
            <option value={12}>1'</option>
          </select>
        </label>
      </div>
    </aside>
  );
}

export const TOOL_HINTS: Record<Tool, string> = {
  select: 'Click to select · drag walls, openings, and fixtures · drag empty space to pan · scroll to zoom',
  wall: 'Click to start a wall, click again to finish · keeps chaining · double-click or Esc to stop',
  door: 'Click a wall to add a door',
  window: 'Click a wall to add a window',
  slider: 'Click a wall to add a sliding door',
  room: 'Drag a rectangle along the wall centerlines to define a room',
  fixture: 'Click to place the fixture chosen in the toolbar',
  measure: 'Click two points to measure · Esc to clear',
};

export function ValidationPanel({ design }: { design: Design }) {
  const issues = useMemo(() => validateDesign(design), [design]);
  // Framing and envelope questions go to the engineer; they are listed apart from the design checks.
  // They lag a drag by a moment, so re-framing the house never holds up the pointer.
  const settled = useDeferredValue(design);
  const framing = useMemo(() => [...validateFraming(settled), ...validateEnvelope(settled)], [settled]);
  const select = useStore((s) => s.select);
  const set = useStore((s) => s.set);
  const mode = useStore((s) => s.mode);
  const [open, setOpen] = useState(true);
  const [framingOpen, setFramingOpen] = useState(false);
  const counts = { error: 0, warning: 0, info: 0 };
  for (const i of issues) counts[i.level]++;
  const go = (i: Issue, sheet: SheetId) => {
    if (!i.ref) return;
    select(i.ref);
    if (mode !== '3d') set({ sheet });
  };
  const list = (items: Issue[], sheet: SheetId) =>
    items.map((i, k) => (
      <li key={k} className={`lvl-${i.level} ${i.ref ? 'clickable' : ''}`} onClick={() => go(i, sheet)}>
        <span className="dot" aria-hidden />
        <span>{i.message}</span>
      </li>
    ));
  return (
    <section className={`validation ${open ? 'open' : ''}`}>
      <button className="validation-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>Checks</span>
        <span className="counts">
          <span className="c-error">{counts.error} errors</span>
          <span className="c-warning">{counts.warning} warnings</span>
          <span className="c-info">{counts.info} notes</span>
        </span>
      </button>
      {open && (
        <ul>
          {issues.length === 0 && <li className="ok">All checks pass.</li>}
          {list(issues, 'A-101')}
        </ul>
      )}
      <button className="validation-head" onClick={() => setFramingOpen((v) => !v)} aria-expanded={framingOpen}>
        <span>Framing</span>
        <span className="counts">
          <span className="c-warning">{framing.filter((i) => i.level === 'warning').length} for the engineer</span>
        </span>
      </button>
      {framingOpen && (
        <ul>
          {framing.length === 0 && <li className="ok">No open framing items.</li>}
          {list(framing, 'A-101')}
        </ul>
      )}
      <p className="disclaimer">These checks approximate common IRC requirements. They are not a code review. Framing sizes are assumptions for the engineer to design.</p>
    </section>
  );
}

export function StatusBar() {
  const tool = useStore((s) => s.tool);
  const mode = useStore((s) => s.mode);
  const sheet = useStore((s) => s.sheet);
  const lastSaved = useStore((s) => s.lastSaved);
  const saveError = useStore((s) => s.saveError);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const off = onCursor(setCursor);
    return () => {
      off();
    };
  }, []);
  const editing = mode !== '3d' && sheet === 'A-101';
  return (
    <footer className="statusbar">
      <span>{editing ? TOOL_HINTS[tool] : mode === '3d' ? 'Drag to orbit · right-drag to pan · scroll to zoom · click an element to select it' : 'Switch to A-101 to edit the plan · scroll to zoom · drag to pan'}</span>
      <span className="spacer" />
      {saveError && <span className="err">Save failed: {saveError}</span>}
      {editing && cursor && <span className="mono">x {formatFtIn(cursor.x)} · y {formatFtIn(cursor.y)}</span>}
      {lastSaved && <span className="muted">Saved {new Date(lastSaved).toLocaleTimeString()}</span>}
    </footer>
  );
}

export function Banners() {
  const diskDesign = useStore((s) => s.diskDesign);
  const diskErrors = useStore((s) => s.diskErrors);
  const preview = useStore((s) => s.preview);
  const set = useStore((s) => s.set);
  const replaceDesign = useStore((s) => s.replaceDesign);
  const loadFromDisk = useStore((s) => s.loadFromDisk);
  return (
    <div className="banners">
      {preview && (
        <div className="banner info">
          Previewing <code>{preview.name}</code> (read-only).
          <button onClick={() => { replaceDesign(preview.design); set({ preview: null }); }}>Restore this version</button>
          <button onClick={() => set({ preview: null })}>Close preview</button>
        </div>
      )}
      {diskDesign && (
        <div className="banner warn">
          <code>house.json</code> changed on disk while you have unsaved edits.
          <button
            onClick={() => loadFromDisk(stringifyDesign(diskDesign), true)}
          >
            Load the disk version
          </button>
          <button onClick={() => set({ diskDesign: null })}>Keep my edits</button>
        </div>
      )}
      {diskErrors.length > 0 && (
        <div className="banner error">
          <code>house.json</code> on disk is invalid, so the app is still showing the last valid version: {diskErrors.slice(0, 3).join('; ')}
          <button onClick={() => set({ diskErrors: [] })}>Dismiss</button>
        </div>
      )}
    </div>
  );
}

function HistoryDialog({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<{ name: string; size: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = useStore((s) => s.set);
  useEffect(() => {
    fetch('/api/history')
      .then((r) => r.json())
      .then(setItems)
      .catch((e) => setError(String(e)));
  }, []);
  const open = async (name: string) => {
    const text = await (await fetch(`/api/history/${name}`)).text();
    const r = parseDesignText(text);
    if (!r.ok) {
      setError(`${name} is not a valid design: ${r.errors[0]}`);
      return;
    }
    set({ preview: { name, design: r.design }, selection: null });
    onClose();
  };
  const label = (name: string) => {
    const m = name.match(/house-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\w+)\.json/);
    if (!m) return name;
    const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return `${d.toLocaleString()} · ${m[7] === 'app' ? 'saved in app' : 'edited on disk'}`;
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Saved versions" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Saved versions</h2>
          <button onClick={onClose} aria-label="Close">✕</button>
        </header>
        <p className="muted">Every save and every on-disk edit of <code>design/house.json</code> is kept in <code>design/history/</code>.</p>
        {error && <p className="err">{error}</p>}
        {!items && !error && <p>Loading…</p>}
        <ul className="history">
          {items?.map((it) => (
            <li key={it.name}>
              <button onClick={() => open(it.name)}>{label(it.name)}</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
