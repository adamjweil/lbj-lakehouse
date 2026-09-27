import { create } from 'zustand';
import { produce } from 'immer';
import type { Design, FixtureKind } from '../model/schema';
import { parseDesign, parseDesignText } from '../model/schema';
import { stringifyDesign } from '../model/format';
import type { Ref } from '../model/validate';
import type { SheetId } from '../views/sheets/sheetList';

export type Selection = Ref | null;
export type Tool = 'select' | 'wall' | 'door' | 'window' | 'slider' | 'fixture' | 'room' | 'measure';
export type ViewMode = 'sheets' | '3d' | 'split';
export type { SheetId } from '../views/sheets/sheetList';

const HISTORY_LIMIT = 200;

type State = {
  design: Design | null;
  savedText: string;
  loadErrors: string[];
  past: Design[];
  future: Design[];
  gesture: boolean;
  gestureBase: Design | null;

  selection: Selection;
  tool: Tool;
  fixtureKind: FixtureKind;
  wallType: 'interior' | 'exterior';
  snap: number;
  sheet: SheetId;
  mode: ViewMode;

  /** A newer house.json arrived from disk while there were unsaved edits. */
  diskDesign: Design | null;
  diskErrors: string[];
  saving: boolean;
  saveError: string | null;
  lastSaved: string | null;
  /** Read-only preview of a history snapshot. */
  preview: { name: string; design: Design } | null;
};

type Actions = {
  /** Load house.json text; `force` replaces unsaved edits. */
  loadFromDisk: (text: string, force?: boolean) => void;
  apply: (recipe: (d: Design) => void) => void;
  beginGesture: () => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;
  select: (s: Selection) => void;
  setTool: (t: Tool) => void;
  set: (p: Partial<State>) => void;
  save: () => Promise<void>;
  replaceDesign: (d: Design) => void;
};

export const useStore = create<State & Actions>((set, get) => ({
  design: null,
  savedText: '',
  loadErrors: [],
  past: [],
  future: [],
  gesture: false,
  gestureBase: null,
  selection: null,
  tool: 'select',
  fixtureKind: 'sofa',
  wallType: 'interior',
  snap: 1,
  sheet: 'A-101',
  mode: 'sheets',
  diskDesign: null,
  diskErrors: [],
  saving: false,
  saveError: null,
  lastSaved: null,
  preview: null,

  loadFromDisk: (text, force) => {
    const r = parseDesignText(text);
    const s = get();
    if (!r.ok) {
      if (s.design) set({ diskErrors: r.errors });
      else set({ loadErrors: r.errors });
      return;
    }
    const clean = s.design ? designText(s.design) === s.savedText : true;
    if (!s.design || clean || force) {
      set({
        design: r.design,
        savedText: stringifyDesign(r.design),
        loadErrors: [],
        diskErrors: [],
        diskDesign: null,
        past: s.design ? [...s.past, s.design].slice(-HISTORY_LIMIT) : [],
        future: [],
      });
    } else {
      set({ diskDesign: r.design, diskErrors: [] });
    }
  },

  apply: (recipe) => {
    const { design, gesture, past } = get();
    if (!design) return;
    const next = produce(design, recipe);
    if (next === design) return;
    if (gesture) set({ design: next });
    else set({ design: next, past: [...past, design].slice(-HISTORY_LIMIT), future: [] });
  },

  beginGesture: () => {
    const { design, gesture } = get();
    if (!design || gesture) return;
    set({ gesture: true, gestureBase: design });
  },

  endGesture: () => {
    const { gesture, gestureBase, design, past } = get();
    if (!gesture) return;
    if (gestureBase && design && gestureBase !== design) {
      set({ gesture: false, gestureBase: null, past: [...past, gestureBase].slice(-HISTORY_LIMIT), future: [] });
    } else {
      set({ gesture: false, gestureBase: null });
    }
  },

  undo: () => {
    const { past, design, future } = get();
    if (!past.length || !design) return;
    set({ design: past[past.length - 1], past: past.slice(0, -1), future: [design, ...future] });
  },

  redo: () => {
    const { past, design, future } = get();
    if (!future.length || !design) return;
    set({ design: future[0], future: future.slice(1), past: [...past, design] });
  },

  select: (selection) => set({ selection }),
  setTool: (tool) => set({ tool }),
  set: (p) => set(p),

  replaceDesign: (d) => {
    const { design, past } = get();
    set({ design: d, past: design ? [...past, design] : past, future: [], selection: null });
  },

  save: async () => {
    const { design } = get();
    if (!design) return;
    const text = designText(design);
    set({ saving: true, saveError: null });
    try {
      const res = await fetch('/api/design', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: text });
      const body = await res.json();
      if (!res.ok) throw new Error((body.errors ?? [body.error]).join('\n'));
      set({ savedText: text, lastSaved: body.savedAt, saving: false, diskDesign: null });
    } catch (e) {
      set({ saving: false, saveError: (e as Error).message });
    }
  },
}));

const textCache = new WeakMap<Design, string>();
const designText = (d: Design) => {
  let t = textCache.get(d);
  if (t === undefined) {
    // Canonical form (schema key order) so the dirty check matches what the server writes.
    const r = parseDesign(d);
    t = stringifyDesign(r.ok ? r.design : d);
    textCache.set(d, t);
  }
  return t;
};

export const selectDirty = (s: State) => !!s.design && designText(s.design) !== s.savedText;
