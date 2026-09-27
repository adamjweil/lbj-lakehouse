# LBJ Lake House

A local app for designing a one-bedroom lake cabin. `design/house.json` is the only source of truth. Every view is generated from it: the drawing sheets, the schedules, the framing model and its takeoff, the 3D model, and the PDF set.

## Commands

- `npm run dev`: start the app at http://localhost:5173.
- `npm run validate`: check `design/house.json` against the schema and the design rules, and print a room summary. Run this after every edit to the design. It also lists the framing and envelope items for the engineer; those never fail the check.
- `npm run takeoff`: print the framing takeoff: pieces, buy list, sheet goods, rough openings, hardware, roofing, envelope, and costs. Add `-- --cuts` for the cut list, `-- --csv <folder>` to write CSV files, or `-- --json <file>`.
- `npm test`: run the Vitest unit tests (geometry, validation, editing operations, framing, takeoff, and envelope).
- `npm run snapshot [A-101 3d 3d-framing ...]`: render the sheets and 3D views to `snapshots/*.png`. Use it to review a change visually.
- `npm run smoke`: run the end-to-end editor test against a scratch copy of the design, including PDF export.
- `npm run typecheck`: run the TypeScript checks.

## Editing the design (house.json)

When you save `design/house.json`, the running app reloads it through the `design:changed` HMR event. If the app has unsaved edits, it shows a banner instead of reloading. Every version is copied to `design/history/`.

**Units are inches.** Plan coordinates: +x is east and +y is **south** (the screen's down direction), with the origin at the NW outer corner. Heights are measured from the finished floor (FF = 0), so grade is at `-levels.floorHeight`.

- **Zones.** Walls and rooms without a `zone` belong to the house. Items with `"zone": "garage"` belong to the attached garage, which has its own floor level (`garage.floor`, relative to the house FF), plate height, and roof (`garage.roof`).
  - The house footprint, house roof, deck, and piers use house walls only.
  - Garage walls butt against the house's outer face; they do not overlap the house walls.
  - Opening sills and room ceiling heights are measured from the floor of their zone.
- **Roofs.** The roof underside crosses the plate height 4" in from the outer wall face (`roofHeelInset`: 1/2" of sheathing plus the `framing.roof.seat` rafter seat, 3-1/2" by default), so the ridge sits 2" lower on a 6:12 roof than it would if the roof sprang from the wall face.
  - `garage.roof.ridgeAxis` should run perpendicular to the wall shared with the house, so both eaves shed away from the house and the roof meets the house wall as a gable end. The edge against the house, an eave or a rake, takes `houseSideOverhang`.
  - Keep the garage roof below the sill of any window in the shared wall (validation checks this).
- `garage.entry`: the house–garage door (`openingId`). The landing and steps inside the garage are generated from it, running in the `stairs` direction. `garage.section` places Section 2, a cut across the wall shared with the house: `at` is measured along that wall.
- `walls[]`: centerline `start`/`end` points plus `thickness`. Exterior walls are 6", interior walls 4.5".
  - The exterior walls must chain into a closed loop.
  - Interior walls end on another wall's centerline, either at a T junction or at a corner.
  - Walls running across the ridge get a gable top when they're exterior or have `toRoof: true`.
  - `bearing` (optional) says whether the wall carries load. It defaults to true for exterior walls and for the partitions the ceiling joists bear on, and it decides whether openings get a real header or a flat one.
  - `layoutFrom: start|end` (optional) is the end the stud layout is measured from. Exterior layouts start at the building corner.
- `openings[]`:
  - `offset` is the distance along the wall from `start` to the opening's **center**.
  - `swing: left|right` is the swing side as seen when walking from the wall's `start` to its `end`. The left side of an eastward wall is north.
  - `hinge: start|end` says which jamb the hinge is on.
  - `kind` and `operation` must match (see `OPERATIONS` in `src/model/schema.ts`).
  - Tags are `D#` for doors and sliders, `W#` for windows. Keep them unique, and don't renumber: a removed opening leaves a "Not used" row in the schedule (write "Replaces W4" in the replacing opening's note to link them).
  - The `overhead` operation is a garage door.
- `rooms[]`: `polygon` points lie on wall centerlines. Net area is computed by insetting to the wall faces. `label` optionally overrides where the room label is placed.
- `fixtures[]`: `x` and `y` are the center point; `w` runs along the local x axis and `d` along local y. Local -y is the back of the fixture, the side that goes against the wall. `rotation` is in degrees, clockwise.
- `deck` and `porch`: platforms attached to one side of the house footprint (the deck on the lake side, the porch on the street side).
  - `offset` and `width` run along that side; `depth` extends away from the house.
  - `stairs.offset` is the stair's center, measured along the platform's outer edge.
  - The porch also has `railing` (guard on/off) and `skirt` (`solid`, `lattice`, or `none`). The deck always has a railing and no skirt.
  - In code, use `platforms(design)` to handle both; `deckGeom()` returns only the deck.
- `site` (optional): the lot and landscape, in the same plan coordinates. The layout assumes the lake is on the south side.
  - `lot` is the property-line polygon; its lake-side edge is the shoreline (bulkhead). The area is computed; the current lot is 0.85 acres.
  - `setbacks`, `waterBelowGrade`, `waterDepth`, `normalPool`, `streetWidth`, `drivewayWidth`, and `walkWidth` describe the surroundings. The driveway and walks are derived from the garage door, porch steps, and deck steps.
  - `dock`: the open, one-level boat dock. `center` is the gangway centerline; the slip sits on the west side and the lounge deck on the east. Its size sets its cost on A-100 (piles and deck area), so the default is kept modest: 22' x 28' with a 20' gangway and no boat lift. `lift: true` adds the lift to the plan, the 3D model, and the cost; `specs.dock.lift` is its wording.
  - `fence` (optional): perimeter fence (`style` is `metal` or `wood`). It runs along the street and side lines, `inset` inside the property line, with a `gateWidth` opening across the driveway; the shoreline stays open unless `lakeSide` is true.
  - `trees`: one entry per tree (`species` is `live-oak`, `cedar`, or `cedar-elm`; `height` in inches; `seed` picks a shape variant). Trees on the lake side of the house are kept smaller so they don't block the view; the 3D trees are drawn slightly see-through (`TREE_OPACITY` in `Trees.tsx`). Keep trees clear of the house, walks, driveway, and dock (validation warns).
  - In code, `src/model/site.ts` (`siteGeom`) derives everything; the 3D landscape is in `src/views/three/site/` (trees come from the `@dgreenheck/ez-tree` library), and the site plan is `src/views/plan/SitePlan.tsx` (sheet A-100).
- `specs`: the foundation, framing, roof, and boat dock materials, as short phrases. They feed the cover sheet data, the A-101 "Construction materials" notes, the A-102 and A-103 notes and plan callouts, the A-301 assembly notes, and the dock materials on A-100. Sizes the geometry already knows (pier diameter and spacing, roof pitch) are added by the sheets, so don't repeat them here. Start each phrase with a capital; the sheets lower-case it mid-sentence, except for abbreviations such as LVL.
- `framing`: the framing sizes and rules, as numbers. They drive the framing model; the `specs` phrases are only the printed wording, and validation warns (`spec-mismatch`) when a phrase states a different size, count, spacing, or thickness, quoting the phrase to use.
  - `lumber`: stock lengths, precut stud lengths, saw kerf, and the waste allowances.
  - `walls`, `openings`, `floor`, `ceiling`, `roof`, `garage`, `platforms`: stud, joist, and rafter sizes and spacings; plates; headers (sawn up to `header.maxSpan`, LVL above it); jack studs by opening width; ridge beams; deck and guard parts.
  - `roof.seat` also sets the roof geometry (see Roofs above).
  - Every structural size is an assumption for the engineer. Changing one re-frames the building; run `npm run validate` and look at the framing sheets.
- `envelope`: siding, weather barrier, insulation, and exterior trim, as numbers and short phrases. A-602 measures the quantities from the walls and roofs.
- Cost estimates live in `src/model/costs.ts`: material prices per opening, room finish, fixture, foundation item, dock item, framing size, sheet, connector, roofing item, and envelope item. Quantities are measured from the geometry, so only the rates in that file are editable by hand.
  - **Every estimate is material cost only.** No rate includes labor, equipment, delivery, tax, or markup, and no row prices labor. G-002 lists labor under what the estimate leaves out. Keep new rates and rows to the same rule.
  - Each material is priced on one sheet only: A-103 prices the foundation, the house floor framing and subfloor, and every beam on piers; A-601 the door and window units, finishes, and fixtures; S-602 the rest of the framing, its sheathing and connectors, and the roofing; A-602 the envelope; A-100 the dock. G-002 adds up those subtotals and prices nothing itself.
  - Every framing piece, panel, and connector carries `pricedOn` so nothing is counted twice. Keep that rule when adding a cost.
- `meta.section`: the building section cut, positioned along the ridge axis (`look` is `-` for west or north, `+` for east or south).
- `meta.revisions`: add an entry when you issue a change set. The newest entry appears in every title block.

After editing, keep the JSON in the app's canonical style: two-space indent, with points written on one line as `{ "x": 3, "y": 3 }`. The app rewrites the file in this style whenever it saves.

When moving a wall by hand, also move:
- the endpoints of any walls that meet it;
- any room polygon corners on it;
- the offsets of openings on walls whose `start` point moved.

`src/editor/ops.ts` (`moveWall`, `movePoint`) does all of this automatically.

## Code map

- `src/model/`: the schema (zod), units (feet-inches parse/format), `geometry.ts`, and `validate.ts`.
  - `geometry.ts` holds the shared derived geometry: wall joins (`wallEndCondition`, `wallTees`), openings, room net areas, roof frames (`roofFrames` returns the house and garage roofs), wall profiles, deck, stairs, piers, and the garage footprint and entry.
  - `validate.ts` holds the IRC-style checks.
  - `framing/`: the framing model. `frameModel(design)` returns every piece (`Member`), sheathing panel, connector, and rough opening, cached per design object.
    - A piece's solid is a polygon (`profile`) in a plane (`o`, `u`, `v`) extruded `t`. Wall pieces use the wall's plane, so their profiles are the framing elevation. Coordinates are inches: plan x and y, and z up from the finished floor.
    - Generators: `walls.ts`, `floor.ts`, `ceiling.ts`, `roof.ts`, `platforms.ts`, `sheathing.ts`, `hardware.ts`. `bearing.ts` decides which way ceiling joists run and what carries them; `levels.ts` has the framing levels; `layout.ts` has the 16" module and the splice rules.
    - Studs, joists, and rafters share one layout measured from the footprint corner, so they stack.
    - `takeoff.ts` makes the cut list, packs it into stock lengths, and makes the buy list. `csv.ts` exports it. `checks.ts` (`validateFraming`) holds the framing checks, kept apart from `validateDesign` because a sound design still raises questions for the engineer. `spans.ts` has the span limits from the 2021 IRC tables.
    - `project.ts` projects pieces into plans, sections, and details. Plan y points south, so the axes are left-handed; use `toward(view)` for the viewer's side.
  - `envelope/`: exterior wall faces, the envelope takeoff, and its checks.
  - `roofing.ts`: roofing quantities from the roof frames.
- `src/editor/`: the zustand store (undo/redo, gestures, save), the pure editing `ops.ts`, and `PlanOverlay.tsx` (floor plan hit targets, drags, and drawing tools).
- `src/views/draft/`: sheet units and drafting primitives. There are 100 SVG units per paper inch on a 36"×24" sheet. Inside a `DrawingView`, `useDraft().p(paper)` converts paper units to model inches.
- `src/views/{plan,elevation,section,axon}/`: the drawings (`section/GarageSection.tsx` is Section 2). `src/views/framing/`: the framing plans, wall framing elevations, and the details cut from the model.
- `src/views/sheets/`: the title block, sheet layouts, and schedules.
  - `sheetList.ts` is the one list of sheets. The title block, cover index, app tabs, PDF export, and the snapshot and smoke scripts all read it. To add a sheet, add it there and to `SHEET_COMPONENTS` in `Sheets.tsx`.
  - Sheets: G (cover, estimate summary), A (architectural), S (framing: S-001 notes and details, S-101 to S-103 plans, S-201 to S-203 wall elevations, S-601 cut list, S-602 schedules and cost, S-603 buy list).
  - `blocks.tsx` has the shared tables and note blocks. `table` wraps long cells onto more lines and tints alternate rows; pass `{ size }` to set a sheet apart (G-002 reads larger, since it's read more than measured from). `flowTable` is for a list with more rows than columns, split into as many columns as fit.
  - Text sizes are named in `TXT` (`src/views/draft/draft.tsx`): `mark` is the smallest, for a piece mark on a framing elevation; `tiny` is a table cell or plan label; `note` is running text. `Text` (drawing space) puts a white plate behind its string by default, so it reads over hatching and linework; pass `plate={false}` to turn that off.
- `src/views/three/`: the 3D model (`House3D`) and the scene, which has the site, sun, camera presets, and walk mode. World units are feet; `toWorld()` maps plan coordinates to world coordinates. `Framing3D` draws the stick frame from `frameModel`, merged into one mesh per material; the Framing and Sheathing buttons switch it on.
- `vite-plugin-design.ts`: the `/api/design` and `/api/history` endpoints, the file watcher, and the history snapshots.
- `scripts/`: the validate, takeoff, snapshot, and smoke CLIs.

## Conventions

- Geometry belongs in `src/model/` (shared geometry in `geometry.ts`, framing in `framing/`) so the 2D and 3D views can't disagree. Views read `frameModel(design)`; they don't place framing themselves.
- Draw many pieces as one path (`Polys` in `draft.tsx`), not one element each, so the PDF stays light.
- The drawings must stay pure render functions (the PDF export renders every sheet off-screen), so no browser-only APIs or effects in `src/views/{draft,plan,elevation,section,axon,sheets}`.
- These are preliminary design drawings, not construction documents. Keep the "not for construction" and "by engineer" notes. Framing check messages end with "verify with engineer".
