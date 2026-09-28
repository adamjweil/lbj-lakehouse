# LBJ Lake House

A local design app for a one-bedroom lake cabin on Lake LBJ, Texas. There is one source of
truth, [`design/house.json`](design/house.json), and everything else — the drawing set, the
schedules, the framing takeoff, the 3D model, and the PDF export — is generated from it.

Edit the JSON (by hand, in the app, or by asking an AI assistant to), and every drawing,
schedule, and cost estimate updates to match. Nothing is drawn or counted by hand twice.

**Live read-only viewer:** [lbj-lakehouse.web.app](https://lbj-lakehouse.web.app) — the current
design, browsable (sheets, schedules, 3D), no editing. See [Deploying](#deploying).

> **Status:** preliminary design drawings, not construction documents. Every structural size
> is an assumption for a licensed engineer to review and size. See [Disclaimer](#disclaimer).

## What's in the design

- A 720 SF one-bedroom, one-bath cabin with an attached one-car garage, a lake-side deck, and a
  street-side porch, on a 0.85-acre lot with an open boat dock.
- A **member-by-member framing model**: every stud, joist, rafter, header, and beam, generated
  from the plan, with a piece mark, size, cut length, and end cuts — about 1,300 pieces.
- A **cut list and buy list**, packed into stock lumber lengths, plus sheet goods, hardware,
  rough openings, roofing, and the exterior envelope (siding, wrap, insulation, trim).
- **21 drawing sheets**: a cover sheet and estimate summary, the architectural set (site, floor,
  roof, and foundation plans, elevations, a building section, schedules), and a structural
  framing set (notes and details, framing plans, wall framing elevations, cut and buy lists,
  and a cost schedule).
- A **3D model** with a finished view and a framing view (toggle stick framing and sheathing on
  and off), camera presets, a walk mode, and a site/landscape scene.
- **Material cost estimates** throughout, with no labor included — every rate is a material
  price only, so the numbers are meant to be compared against supplier quotes.
- A **PDF export** of the full sheet set, and CSV/JSON export of the takeoff.

All of this is *derived*, not hand-drawn: move a wall in the plan and the roof, the framing, the
3D model, the schedules, and every cost that depends on it follow.

## Quick start

Requires [Node.js](https://nodejs.org) 20 or later.

```bash
npm install
npm run dev
```

Open the URL Vite prints (typically `http://localhost:5173`). The app loads
`design/house.json`, shows the drawing sheets and the 3D model side by side, and lets you edit
the plan directly (draw walls, add doors and windows, move fixtures, drag things around) or by
editing the JSON file in an editor — whichever changes, the other reflects it live.

## How it works

- **The design file.** `design/house.json` describes the house: levels, foundation, roof, walls,
  openings, rooms, fixtures, the deck and porch, an optional site/lot/dock, material specs, and
  the numeric framing and envelope rules. Units are inches; see [Editing the design](#editing-the-design-housejson)
  below for the coordinate system and field conventions, or [`CLAUDE.md`](CLAUDE.md) for the
  full reference.
- **The model layer** (`src/model/`) turns that JSON into geometry: wall polygons and joins,
  room net areas, roof frames, the deck and stairs, the pier layout, and — in `src/model/framing/`
  — the entire stick-framing model (every wall, floor, ceiling, roof, and deck member), the
  takeoff, and the cost estimates. This is the only place geometry is computed, so the 2D
  drawings and the 3D model can't disagree with each other.
- **The views** (`src/views/`) are pure render functions over that model: the drafting
  primitives and sheet layouts (`views/sheets`, `views/draft`), the plan/elevation/section/axon
  drawings, the framing plans and wall elevations, and the Three.js 3D scene. Because they're
  pure, the same components render on screen and inside the headless PDF export.
- **The editor** (`src/editor/`) is a small Zustand store with undo/redo, plus `ops.ts`, a set
  of pure editing operations (move a wall, add an opening, delete a room, ...) that keep
  everything downstream (openings, room polygons, other walls) consistent.
- **The dev server plugin** (`vite-plugin-design.ts`) is what makes the JSON file a live source
  of truth: it serves `design/house.json` to the app, saves the app's edits back to disk,
  copies every version into `design/history/`, and watches the file so edits made outside the
  app (in an editor, or by a script) push into the running app over HMR.

Because the model, the drawings, and the 3D view are all derived from one file, this project is
also a good fit for an AI coding assistant to work on directly: point it at `design/house.json`
and `CLAUDE.md`, and it can move a wall, resize a room, add a dock, or rework the framing rules,
and everything downstream (the drawings, the takeoff, the costs) follows without anyone
re-drawing anything by hand.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the app at `http://localhost:5173`. |
| `npm run validate` | Check `design/house.json` against the schema and the design rules, print a room summary, and list framing/envelope items for the engineer. Run after every edit. |
| `npm run takeoff` | Print the framing takeoff: pieces, buy list, sheet goods, rough openings, hardware, roofing, envelope, and material costs. `-- --cuts` adds the cut list; `-- --csv <folder>` or `-- --json <file>` export it. |
| `npm test` | Run the Vitest unit tests (geometry, validation, editing, framing, takeoff, envelope). |
| `npm run snapshot [A-101 3d 3d-framing ...]` | Render the sheets and 3D views to `snapshots/*.png`, headlessly. Omit the arguments to render everything. |
| `npm run textcheck [A-101 ...]` | Render the sheets headlessly and flag hard-to-read text (too small, overlapping, crossing a table rule, off the sheet). |
| `npm run smoke` | End-to-end test: drag walls, undo, save, pick up a disk edit, add a window, export the PDF — against a scratch copy of the design. |
| `npm run typecheck` | Run the TypeScript checks. |
| `npm run build` | Type-check and build the production bundle with Vite. On its own this isn't deployable — see [Deploying](#deploying). |
| `npm run build:readonly` | Build the read-only static bundle: `design/house.json` is baked in at build time, and every editing/saving feature is disabled. This is what's deployed to Firebase Hosting. |
| `npm run deploy:firebase` | `build:readonly`, then `firebase deploy --only hosting`. |

## Editing the design (house.json)

Save `design/house.json` and the running app reloads it live (via the `design:changed` HMR
event). If the app has unsaved edits of its own, it shows a banner instead of overwriting them.
Every version — from the app or from disk — is copied into `design/history/`, so nothing is
ever lost, and the app has an in-app "saved versions" browser to preview and restore any of
them.

**Units are inches.** Plan coordinates: +x is east, +y is **south** (the screen's down
direction), origin at the northwest outer corner. Heights are measured from the finished floor
(FF = 0); grade is at `-levels.floorHeight`.

The file has these top-level sections:

- `meta` — project name, address, the building section cut, and a revision log (add an entry
  each time you issue a change set; the newest one appears in every title block).
- `levels`, `foundation`, `roof` — the house's floor height, plate height, floor framing depth,
  pier layout, and roof pitch/overhangs.
- `walls[]`, `openings[]`, `rooms[]`, `fixtures[]` — the floor plan itself. Walls are centerline
  segments; openings (doors, sliders, windows) sit on a wall by offset; rooms are polygons on
  wall centerlines; fixtures are furniture and equipment.
- `garage` (optional) — an attached garage: its own floor level, plate height, roof, entry door,
  and section cut.
- `deck` / `porch` — platforms attached to one side of the house (deck on the lake side, porch
  on the street side), with their stairs, railing, and skirt.
- `site` (optional) — the lot, setbacks, a boat dock, a perimeter fence, and trees.
- `specs` — the foundation/framing/roof/dock materials as printed phrases (what the sheets say).
- `framing` — the same information as numbers (stud spacing, header rules, rafter size, ...) —
  this is what actually generates the framing model and the takeoff. If a `specs` phrase and a
  `framing` number disagree, validation flags it.
- `envelope` — siding, weather barrier, insulation, and trim, as numbers.

`CLAUDE.md` has the full field-by-field reference (coordinate conventions, how zones/garages
work, how framing spans and headers are chosen, how nothing gets priced twice, and the code map
of `src/`). Whether you're editing by hand or pointing an assistant at this repo, that's the
document to read first.

After editing, keep the JSON in the app's canonical style (two-space indent, points on one
line): the app rewrites the file this way whenever it saves, and `npm run validate` will
otherwise still accept a differently-formatted file.

## Project structure

```
design/house.json       The one source of truth. Every version is archived in design/history/.
src/model/               Schema (zod), units, geometry, validation, cost estimates, roofing.
src/model/framing/        The stick-framing model, its takeoff, and its checks.
src/model/envelope/       Exterior wall faces, envelope takeoff, and its checks.
src/model/site.ts         Lot, dock, fence, and tree geometry.
src/editor/               Zustand store (undo/redo), pure editing operations, the plan overlay.
src/views/draft/          Drafting primitives and sheet units (100 SVG units per paper inch).
src/views/{plan,elevation,section,axon,framing}/   The drawings, generated from the model.
src/views/sheets/          Title block, sheet layouts, schedules, and the sheet registry.
src/views/three/           The 3D model (finished and framing views) and the site/landscape scene.
src/export/pdf.ts          Renders every sheet off-screen and assembles the PDF.
scripts/                   validate, takeoff, snapshot, textcheck, and smoke CLIs.
vite-plugin-design.ts      Dev-server API that reads/writes house.json and its history.
```

See [`CLAUDE.md`](CLAUDE.md) for the detailed version of this map, including every module's
responsibilities and the conventions the code follows.

## Deploying

This is fundamentally a **local design tool**: editing works because a Node dev server
(`vite-plugin-design.ts`) reads and writes `design/house.json` and `design/history/` directly on
disk, and watches the file for outside edits. A plain production build (`npm run build`) drops
that server plugin entirely — Vite's dev-only `configureServer` hook doesn't run in a built app —
so a static host would serve the page but every save (and the initial load, which fetches
`/api/design`) would fail.

There are two real ways to get this in front of people, depending on whether they need to edit
it or just see it.

### Editable, for yourself

Run it where you're going to use it: `npm run dev` on your own machine, or on a machine you
control (a home server, a small VPS) with the repo checked out there. If you want to reach it
from elsewhere, put it behind a private tunnel (e.g. Tailscale, or an SSH tunnel) rather than
exposing the Vite dev server to the public internet — it has no authentication and was never
hardened for that.

### Read-only, published

`npm run build:readonly` produces a static build with a fixed `design/house.json` baked in at
build time (see [`src/env.ts`](src/env.ts) and the `VITE_READONLY` checks in
[`src/App.tsx`](src/App.tsx)). It's a genuinely static site — no server, no filesystem access —
that shows every sheet, the schedules, the framing takeoff, and both 3D views (finished and
framing), with the Save/History buttons and every editing tool replaced by a "Read-only" badge.
This is what's deployed to **[lbj-lakehouse.web.app](https://lbj-lakehouse.web.app)** via
Firebase Hosting.

To redeploy after changing the design or the code:

```bash
npm run deploy:firebase   # = npm run build:readonly && firebase deploy --only hosting
```

That uses the `lbj-lakehouse` Firebase project (see `.firebaserc`) and the Hosting config in
`firebase.json` (serves `dist/`, with a catch-all rewrite to `index.html`). Firebase Hosting's
free Spark plan covers this — it's static files only, no Cloud Functions or Firestore involved.

If you'd rather share a specific one-off snapshot than the live design:
- The "Export PDF" button (or `npm run smoke`'s export path) produces the full 36"×24" sheet set
  as a PDF — the most natural thing to email or drop in a shared drive.
- `npm run snapshot` renders every sheet and 3D view to PNGs in `snapshots/` (gitignored).
- `npm run takeoff -- --csv <folder>` / `-- --json <file>` exports the framing takeoff as plain
  data, if what you want to share is the numbers rather than the drawings.

## Disclaimer

These are preliminary design drawings, generated to help think through and estimate a design —
not construction documents. Every structural member size, span, connection, and the lateral
bracing shown is an assumption, to be designed and sealed by a licensed engineer for the actual
site and code jurisdiction before anything is built. Cost estimates are material-only budget
placeholders (see `src/model/costs.ts`), good to roughly ±25%, not a bid.
