import type { Design, Fixture, Opening, Room, Wall } from '../model/schema';
import { FIXTURE_KINDS, OPERATIONS, ROOM_TYPES, SIDES } from '../model/schema';
import {
  designSummary, footprintBounds, garageSharedAxis, openingHead, roomStats, wallLength, wallFace, roomsForOpening,
} from '../model/geometry';
import { formatFtIn, formatSqft } from '../model/units';
import { useStore } from '../editor/store';
import {
  addOpening, deleteFixture, deleteOpening, deleteRoom, deleteWall, movePoint, nextId, setWallLength,
} from '../editor/ops';
import { CheckField, ColorField, LengthField, NumberField, Readout, Section, SelectField, TextField } from './fields';

const OP_LABELS: Record<string, string> = {
  swing: 'Hinged', pocket: 'Pocket', bifold: 'Bifold', barn: 'Barn', cased: 'Cased opening', overhead: 'Overhead', sliding: 'Sliding glass',
  casement: 'Casement', 'double-hung': 'Double-hung', awning: 'Awning', slider: 'Horizontal slider', fixed: 'Fixed',
};

export function Inspector({ design, readOnly }: { design: Design; readOnly?: boolean }) {
  const selection = useStore((s) => s.selection);
  const apply = useStore((s) => s.apply);
  const select = useStore((s) => s.select);
  const edit = readOnly ? () => {} : apply;

  let body: React.ReactNode;
  if (selection?.kind === 'wall') {
    const w = design.walls.find((x) => x.id === selection.id);
    body = w ? <WallPanel design={design} w={w} edit={edit} /> : null;
  } else if (selection?.kind === 'opening') {
    const o = design.openings.find((x) => x.id === selection.id);
    body = o ? <OpeningPanel design={design} o={o} edit={edit} /> : null;
  } else if (selection?.kind === 'room') {
    const r = design.rooms.find((x) => x.id === selection.id);
    body = r ? <RoomPanel design={design} r={r} edit={edit} /> : null;
  } else if (selection?.kind === 'fixture') {
    const f = design.fixtures.find((x) => x.id === selection.id);
    body = f ? <FixturePanel design={design} f={f} edit={edit} /> : null;
  }
  if (!body) body = <HousePanel design={design} edit={edit} />;

  return (
    <div className={`inspector ${readOnly ? 'readonly' : ''}`}>
      {selection && (
        <button className="link back" onClick={() => select(null)}>
          ← House settings
        </button>
      )}
      {body}
    </div>
  );
}

type Edit = (fn: (d: Design) => void) => void;

function WallPanel({ design, w, edit }: { design: Design; w: Wall; edit: Edit }) {
  const upd = (fn: (x: Wall) => void) =>
    edit((d) => {
      const t = d.walls.find((x) => x.id === w.id);
      if (t) fn(t);
    });
  const select = useStore((s) => s.select);
  const face = wallFace(design, w);
  const openings = design.openings.filter((o) => o.wallId === w.id);
  return (
    <>
      <h3>
        Wall <code>{w.id}</code>{' '}
        <span className="muted">
          {w.zone ? `${w.zone} · ` : ''}
          {w.type}
          {face ? ` · ${face} face` : ''}
        </span>
      </h3>
      <Section title="Geometry">
        <LengthField label="Length" value={wallLength(w)} min={1} onChange={(v) => v && edit((d) => setWallLength(d, w.id, v))} hint="Moves the end point; connected walls follow" />
        <LengthField label="Start X" value={w.start.x} onChange={(v) => v !== undefined && edit((d) => movePoint(d, w.start, { x: v, y: w.start.y }))} />
        <LengthField label="Start Y" value={w.start.y} onChange={(v) => v !== undefined && edit((d) => movePoint(d, w.start, { x: w.start.x, y: v }))} />
        <LengthField label="End X" value={w.end.x} onChange={(v) => v !== undefined && edit((d) => movePoint(d, w.end, { x: v, y: w.end.y }))} />
        <LengthField label="End Y" value={w.end.y} onChange={(v) => v !== undefined && edit((d) => movePoint(d, w.end, { x: w.end.x, y: v }))} />
        <p className="hint">Drag the wall to move it, or drag its end handles. Connected walls, room corners, and openings stay attached.</p>
      </Section>
      <Section title="Construction">
        <SelectField label="Type" value={w.type} options={['exterior', 'interior'] as const} onChange={(v) => upd((x) => { x.type = v; })} />
        <LengthField label="Thickness" value={w.thickness} min={1} onChange={(v) => v && upd((x) => { x.thickness = v; })} />
        <LengthField label="Height" value={w.height} optional placeholder={`${formatFtIn(w.zone === 'garage' && design.garage ? design.garage.plateHeight : design.levels.wallHeight)} (default)`} onChange={(v) => upd((x) => { if (v === undefined) delete x.height; else x.height = v; })} />
        <CheckField label="Full height to roof" value={!!w.toRoof} onChange={(v) => upd((x) => { if (v) x.toRoof = true; else delete x.toRoof; })} hint="Only applies to walls running across the ridge" />
        <TextField label="Note" value={w.note ?? ''} onChange={(v) => upd((x) => { if (v) x.note = v; else delete x.note; })} />
      </Section>
      <Section title={`Openings (${openings.length})`}>
        {openings.map((o) => (
          <button key={o.id} className="chip" onClick={() => select({ kind: 'opening', id: o.id })}>
            {o.tag} · {OP_LABELS[o.operation]} {formatFtIn(o.width)}
          </button>
        ))}
        <div className="btns">
          {(['door', 'window', 'slider'] as const).map((k) => (
            <button
              key={k}
              onClick={() => {
                let id: string | null = null;
                edit((d) => {
                  id = addOpening(d, w.id, wallLength(w) / 2, k);
                });
                if (id) select({ kind: 'opening', id });
              }}
            >
              + {k}
            </button>
          ))}
        </div>
      </Section>
      <div className="btns danger-zone">
        <button className="danger" onClick={() => { edit((d) => deleteWall(d, w.id)); select(null); }}>
          Delete wall
        </button>
      </div>
    </>
  );
}

function OpeningPanel({ design, o, edit }: { design: Design; o: Opening; edit: Edit }) {
  const select = useStore((s) => s.select);
  const upd = (fn: (x: Opening) => void) =>
    edit((d) => {
      const t = d.openings.find((x) => x.id === o.id);
      if (t) fn(t);
    });
  const w = design.walls.find((x) => x.id === o.wallId);
  const L = w ? wallLength(w) : 0;
  const rooms = roomsForOpening(design, o).map((r) => r.name).join(' / ');
  return (
    <>
      <h3>
        {o.kind === 'window' ? 'Window' : o.kind === 'slider' ? 'Sliding door' : 'Door'} <code>{o.tag}</code>
        <span className="muted"> {rooms}</span>
      </h3>
      <Section title="Type">
        <TextField label="Tag" value={o.tag} onChange={(v) => v && upd((x) => { x.tag = v; })} />
        <SelectField
          label="Kind"
          value={o.kind}
          options={['door', 'window', 'slider'] as const}
          onChange={(v) =>
            upd((x) => {
              x.kind = v;
              x.operation = OPERATIONS[v][0];
              if (v !== 'window') x.sill = 0;
            })
          }
        />
        <SelectField
          label="Operation"
          value={o.operation}
          options={OPERATIONS[o.kind].map((op) => ({ value: op, label: OP_LABELS[op] }))}
          onChange={(v) => upd((x) => { x.operation = v; })}
        />
        {o.kind === 'door' && o.operation === 'swing' && (
          <div className="btns">
            <button onClick={() => upd((x) => { x.swing = x.swing === 'right' ? 'left' : 'right'; })}>Flip swing side</button>
            <button onClick={() => upd((x) => { x.hinge = x.hinge === 'end' ? 'start' : 'end'; })}>Flip hinge</button>
          </div>
        )}
      </Section>
      <Section title="Size and position">
        <LengthField label="Width" value={o.width} min={6} onChange={(v) => v && upd((x) => { x.width = v; })} />
        <LengthField label="Height" value={o.height} min={6} onChange={(v) => v && upd((x) => { x.height = v; })} />
        {o.kind === 'window' && <LengthField label="Sill height" value={o.sill} min={0} onChange={(v) => v !== undefined && upd((x) => { x.sill = v; })} />}
        <Readout label="Head height">{formatFtIn(openingHead(o))}</Readout>
        <LengthField label="Center from start" value={o.offset} onChange={(v) => v !== undefined && upd((x) => { x.offset = v; })} hint={`Along wall ${o.wallId}, from its start point`} />
        <LengthField label="Center from end" value={L - o.offset} onChange={(v) => v !== undefined && upd((x) => { x.offset = L - v; })} />
        <Readout label="Wall">
          <button className="link" onClick={() => select({ kind: 'wall', id: o.wallId })}>{o.wallId}</button> ({formatFtIn(L)})
        </Readout>
      </Section>
      <Section title="Notes">
        <TextField label="Note" value={o.note ?? ''} onChange={(v) => upd((x) => { if (v) x.note = v; else delete x.note; })} />
      </Section>
      <div className="btns danger-zone">
        <button className="danger" onClick={() => { edit((d) => deleteOpening(d, o.id)); select(null); }}>
          Delete {o.kind}
        </button>
      </div>
    </>
  );
}

function RoomPanel({ design, r, edit }: { design: Design; r: Room; edit: Edit }) {
  const select = useStore((s) => s.select);
  const s = roomStats(design, r);
  const upd = (fn: (x: Room) => void) =>
    edit((d) => {
      const t = d.rooms.find((x) => x.id === r.id);
      if (t) fn(t);
    });
  return (
    <>
      <h3>{r.name} <span className="muted">{formatSqft(s.area)}</span></h3>
      <Section title="Room">
        <TextField label="Name" value={r.name} onChange={(v) => v && upd((x) => { x.name = v; })} />
        <SelectField label="Type" value={r.type} options={ROOM_TYPES} onChange={(v) => upd((x) => { x.type = v; })} />
        <Readout label="Net size">{formatFtIn(s.width, 1)} x {formatFtIn(s.depth, 1)}</Readout>
        <Readout label="Net area">{formatSqft(s.area)}</Readout>
        <p className="hint">Room corners follow the walls. To reshape a room, move its walls.</p>
      </Section>
      <Section title="Ceiling">
        <SelectField label="Ceiling" value={r.ceiling} options={['flat', 'vaulted'] as const} onChange={(v) => upd((x) => { x.ceiling = v; })} />
        {r.ceiling === 'flat' && (
          <LengthField label="Height" value={r.ceilingHeight} optional placeholder={`${formatFtIn(design.levels.wallHeight)} (plate)`} onChange={(v) => upd((x) => { if (v === undefined) delete x.ceilingHeight; else x.ceilingHeight = v; })} />
        )}
      </Section>
      <Section title="Finishes">
        <TextField label="Floor" value={r.finishes.floor} onChange={(v) => upd((x) => { x.finishes.floor = v; })} />
        <TextField label="Walls" value={r.finishes.walls} onChange={(v) => upd((x) => { x.finishes.walls = v; })} />
        <TextField label="Ceiling" value={r.finishes.ceiling} onChange={(v) => upd((x) => { x.finishes.ceiling = v; })} />
      </Section>
      <Section title="Label" defaultOpen={false}>
        <LengthField label="Label X" value={s.center.x} onChange={(v) => v !== undefined && upd((x) => { x.label = { x: v, y: s.center.y }; })} />
        <LengthField label="Label Y" value={s.center.y} onChange={(v) => v !== undefined && upd((x) => { x.label = { x: s.center.x, y: v }; })} />
        <button onClick={() => upd((x) => { delete x.label; })}>Center label</button>
      </Section>
      <div className="btns danger-zone">
        <button className="danger" onClick={() => { edit((d) => deleteRoom(d, r.id)); select(null); }}>Delete room</button>
      </div>
    </>
  );
}

function FixturePanel({ design, f, edit }: { design: Design; f: Fixture; edit: Edit }) {
  const select = useStore((s) => s.select);
  const upd = (fn: (x: Fixture) => void) =>
    edit((d) => {
      const t = d.fixtures.find((x) => x.id === f.id);
      if (t) fn(t);
    });
  return (
    <>
      <h3>{f.label ?? f.kind} <span className="muted">{f.id}</span></h3>
      <Section title="Fixture">
        <SelectField label="Kind" value={f.kind} options={FIXTURE_KINDS} onChange={(v) => upd((x) => { x.kind = v; })} />
        <TextField label="Label" value={f.label ?? ''} onChange={(v) => upd((x) => { if (v) x.label = v; else delete x.label; })} />
        <LengthField label="Width" value={f.w} min={1} onChange={(v) => v && upd((x) => { x.w = v; })} />
        <LengthField label="Depth" value={f.d} min={1} onChange={(v) => v && upd((x) => { x.d = v; })} />
      </Section>
      <Section title="Placement">
        <LengthField label="Center X" value={f.x} onChange={(v) => v !== undefined && upd((x) => { x.x = v; })} />
        <LengthField label="Center Y" value={f.y} onChange={(v) => v !== undefined && upd((x) => { x.y = v; })} />
        <NumberField label="Rotation" value={f.rotation} suffix="°" onChange={(v) => upd((x) => { x.rotation = ((v % 360) + 360) % 360; })} />
        <div className="btns">
          <button onClick={() => upd((x) => { x.rotation = (x.rotation + 270) % 360; })}>⟲ 90°</button>
          <button onClick={() => upd((x) => { x.rotation = (x.rotation + 90) % 360; })}>⟳ 90°</button>
          <button
            onClick={() => {
              const id = nextId(design.fixtures.map((x) => x.id), `f-${f.kind}-`);
              edit((d) => {
                d.fixtures.push({ ...f, id, x: f.x + 12, y: f.y + 12 });
              });
              select({ kind: 'fixture', id });
            }}
          >
            Duplicate
          </button>
        </div>
        <p className="hint">Drag the fixture on the plan. Press R to rotate it.</p>
      </Section>
      <div className="btns danger-zone">
        <button className="danger" onClick={() => { edit((d) => deleteFixture(d, f.id)); select(null); }}>Delete</button>
      </div>
    </>
  );
}

function HousePanel({ design, edit }: { design: Design; edit: Edit }) {
  const s = designSummary(design);
  const today = new Date().toISOString().slice(0, 10);
  const lastRev = design.meta.revisions.at(-1);
  return (
    <>
      <h3>{design.meta.project} <span className="muted">{formatSqft(s.gross)} · {formatFtIn(s.width)} x {formatFtIn(s.depth)}</span></h3>
      <Section title="Project">
        <TextField label="Project" value={design.meta.project} onChange={(v) => edit((d) => { d.meta.project = v; })} />
        <TextField label="Subtitle" value={design.meta.subtitle} onChange={(v) => edit((d) => { d.meta.subtitle = v; })} />
        <TextField label="Address" value={design.meta.address} onChange={(v) => edit((d) => { d.meta.address = v; })} />
        <TextField label="Prepared for" value={design.meta.client} placeholder="Owner name" onChange={(v) => edit((d) => { d.meta.client = v; })} />
        <SelectField label="Lake side" value={design.meta.lakeSide} options={SIDES} onChange={(v) => edit((d) => { d.meta.lakeSide = v; })} />
      </Section>
      <Section title="Heights">
        <LengthField label="Floor above grade" value={design.levels.floorHeight} min={0} onChange={(v) => v !== undefined && edit((d) => { d.levels.floorHeight = v; })} />
        <LengthField label="Plate height" value={design.levels.wallHeight} min={72} onChange={(v) => v && edit((d) => { d.levels.wallHeight = v; })} />
        <LengthField label="Floor framing" value={design.levels.floorDepth} min={4} onChange={(v) => v && edit((d) => { d.levels.floorDepth = v; })} />
        <Readout label="Ridge above grade">{formatFtIn(s.ridgeAboveGrade)}</Readout>
      </Section>
      <Section title="Roof">
        <NumberField label="Pitch" value={design.roof.pitch} min={0} max={24} suffix=":12" onChange={(v) => edit((d) => { d.roof.pitch = v; })} />
        <SelectField label="Ridge runs" value={design.roof.ridgeAxis} options={[{ value: 'x', label: 'East–west' }, { value: 'y', label: 'North–south' }]} onChange={(v) => edit((d) => { d.roof.ridgeAxis = v; })} />
        <LengthField label="Eave overhang" value={design.roof.overhang} min={0} onChange={(v) => v !== undefined && edit((d) => { d.roof.overhang = v; })} />
        <LengthField label="Rake overhang" value={design.roof.gableOverhang} min={0} onChange={(v) => v !== undefined && edit((d) => { d.roof.gableOverhang = v; })} />
        <LengthField label="Roof depth" value={design.roof.thickness} min={2} onChange={(v) => v && edit((d) => { d.roof.thickness = v; })} />
      </Section>
      <PlatformSection design={design} edit={edit} kind="deck" />
      {design.porch && <PlatformSection design={design} edit={edit} kind="porch" />}
      {design.garage && <GarageSection design={design} edit={edit} />}
      <Section title="Foundation" defaultOpen={false}>
        <SelectField label="Type" value={design.foundation.type} options={['piers', 'crawlspace', 'slab'] as const} onChange={(v) => edit((d) => { d.foundation.type = v; })} />
        <LengthField label="Beam spacing" value={design.foundation.beamSpacing} min={24} onChange={(v) => v && edit((d) => { d.foundation.beamSpacing = v; })} />
        <LengthField label="Pier spacing" value={design.foundation.pierSpacing} min={24} onChange={(v) => v && edit((d) => { d.foundation.pierSpacing = v; })} />
        <LengthField label="Pier size" value={design.foundation.pierSize} min={6} onChange={(v) => v && edit((d) => { d.foundation.pierSize = v; })} />
      </Section>
      <Section title="Section cut" defaultOpen={false}>
        <LengthField label={design.roof.ridgeAxis === 'x' ? 'Cut at X' : 'Cut at Y'} value={design.meta.section.at} onChange={(v) => v !== undefined && edit((d) => { d.meta.section.at = v; })} />
        <SelectField label="Looking" value={design.meta.section.look} options={[{ value: '-', label: design.roof.ridgeAxis === 'x' ? 'West' : 'North' }, { value: '+', label: design.roof.ridgeAxis === 'x' ? 'East' : 'South' }]} onChange={(v) => edit((d) => { d.meta.section.look = v; })} />
      </Section>
      <Section title="Materials" defaultOpen={false}>
        {(Object.keys(design.materials) as (keyof Design['materials'])[]).map((k) => (
          <ColorField key={k} label={k} value={design.materials[k]} onChange={(v) => edit((d) => { d.materials[k] = v; })} />
        ))}
      </Section>
      <Section title="Revisions" defaultOpen={false}>
        {design.meta.revisions.slice().reverse().map((r) => (
          <div key={r.rev} className="rev">
            <b>{r.rev}</b> <span className="muted">{r.date}</span> {r.note}
          </div>
        ))}
        <RevisionForm
          onIssue={(note) =>
            edit((d) => {
              d.meta.revisions.push({ rev: (lastRev?.rev ?? 0) + 1, date: today, note });
            })
          }
        />
      </Section>
    </>
  );
}

function RevisionForm({ onIssue }: { onIssue: (note: string) => void }) {
  return (
    <form
      className="rev-form"
      onSubmit={(e) => {
        e.preventDefault();
        const input = (e.currentTarget.elements.namedItem('note') as HTMLInputElement);
        if (input.value.trim()) {
          onIssue(input.value.trim());
          input.value = '';
        }
      }}
    >
      <input name="note" placeholder="What changed in this revision?" onKeyDown={(e) => e.stopPropagation()} />
      <button type="submit">Issue revision</button>
    </form>
  );
}

function GarageSection({ design, edit }: { design: Design; edit: Edit }) {
  const g = design.garage!;
  const s = designSummary(design);
  const doors = design.openings.filter((o) => o.kind === 'door');
  const upd = (fn: (x: NonNullable<Design['garage']>) => void) =>
    edit((d) => {
      if (d.garage) fn(d.garage);
    });
  return (
    <Section title="Garage" defaultOpen={false}>
      <Readout label="Size">{formatFtIn(s.garageWidth)} x {formatFtIn(s.garageDepth)} · {formatSqft(s.garageArea)}</Readout>
      <p className="hint">To resize the garage, drag walls G1–G3 on the plan.</p>
      <LengthField label="Slab below floor" value={-g.floor} min={0} onChange={(v) => v !== undefined && upd((x) => { x.floor = -v; })} />
      <LengthField label="Plate height" value={g.plateHeight} min={72} onChange={(v) => v && upd((x) => { x.plateHeight = v; })} hint="Above the slab" />
      <NumberField label="Roof pitch" value={g.roof.pitch} min={0} max={24} suffix=":12" onChange={(v) => upd((x) => { x.roof.pitch = v; })} />
      <SelectField label="Ridge runs" value={g.roof.ridgeAxis} options={[{ value: 'x', label: 'East–west' }, { value: 'y', label: 'North–south' }]} onChange={(v) => upd((x) => { x.roof.ridgeAxis = v; })} />
      <LengthField label="Eave overhang" value={g.roof.overhang} min={0} onChange={(v) => v !== undefined && upd((x) => { x.roof.overhang = v; })} />
      <LengthField label="Rake overhang" value={g.roof.gableOverhang} min={0} onChange={(v) => v !== undefined && upd((x) => { x.roof.gableOverhang = v; })} />
      <SelectField
        label="Entry door"
        value={g.entry.openingId}
        options={doors.map((o) => ({ value: o.id, label: `${o.tag} (${o.wallId})` }))}
        onChange={(v) => upd((x) => { x.entry.openingId = v; })}
      />
      <LengthField label="Landing" value={g.entry.landing} min={36} onChange={(v) => v && upd((x) => { x.entry.landing = v; })} />
      <LengthField label="Stair width" value={g.entry.stairWidth} min={30} onChange={(v) => v && upd((x) => { x.entry.stairWidth = v; })} />
      <SelectField label="Steps run" value={g.entry.stairs} options={SIDES} onChange={(v) => upd((x) => { x.entry.stairs = v; })} />
      <LengthField label="Section 2 at" value={g.section.at} onChange={(v) => v !== undefined && upd((x) => { x.section.at = v; })} />
      <SelectField
        label="Section 2 looks"
        value={g.section.look}
        options={[
          { value: '-', label: garageSharedAxis(design) === 'x' ? 'West' : 'North' },
          { value: '+', label: garageSharedAxis(design) === 'x' ? 'East' : 'South' },
        ]}
        onChange={(v) => upd((x) => { x.section.look = v; })}
      />
    </Section>
  );
}

type PlatformSpec = Design['deck'];

/** Settings for the deck or the porch. */
function PlatformSection({ design, edit, kind }: { design: Design; edit: Edit; kind: 'deck' | 'porch' }) {
  const spec = (kind === 'deck' ? design.deck : design.porch) as PlatformSpec;
  const porch = kind === 'porch' ? design.porch : undefined;
  const fb = footprintBounds(design);
  const houseLen = spec.side === 'north' || spec.side === 'south' ? fb.x1 - fb.x0 : fb.y1 - fb.y0;
  const title = kind === 'deck' ? 'Deck' : 'Porch';
  const upd = (fn: (x: PlatformSpec) => void) =>
    edit((d) => {
      const target = kind === 'deck' ? d.deck : d.porch;
      if (target) fn(target);
    });
  const updPorch = (fn: (x: NonNullable<Design['porch']>) => void) =>
    edit((d) => {
      if (d.porch) fn(d.porch);
    });
  return (
    <Section title={title} defaultOpen={kind === 'deck'}>
      <CheckField label={title} value={spec.enabled} onChange={(v) => upd((x) => { x.enabled = v; })} />
      {spec.enabled && (
        <>
          <SelectField label="Side" value={spec.side} options={SIDES} onChange={(v) => upd((x) => { x.side = v; })} />
          <LengthField label="Depth" value={spec.depth} min={24} onChange={(v) => v && upd((x) => { x.depth = v; })} />
          <LengthField label="Width" value={spec.width} min={24} onChange={(v) => v && upd((x) => { x.width = v; })} />
          <LengthField label="Offset" value={spec.offset} onChange={(v) => v !== undefined && upd((x) => { x.offset = v; })} />
          <button onClick={() => upd((x) => { x.offset = 0; x.width = houseLen; })}>Match house length</button>
          {porch && (
            <>
              <CheckField label="Guard railing" value={porch.railing} onChange={(v) => updPorch((x) => { x.railing = v; })} hint="Required when the surface is more than 30 in. above grade" />
              <SelectField label="Skirt" value={porch.skirt} options={['solid', 'lattice', 'none'] as const} onChange={(v) => updPorch((x) => { x.skirt = v; })} />
            </>
          )}
          {(!porch || porch.railing) && (
            <LengthField label="Railing" value={spec.railingHeight} min={30} onChange={(v) => v && upd((x) => { x.railingHeight = v; })} />
          )}
          <CheckField label="Stairs" value={spec.stairs.enabled} onChange={(v) => upd((x) => { x.stairs.enabled = v; })} />
          {spec.stairs.enabled && (
            <>
              <LengthField label="Stair center" value={spec.stairs.offset} onChange={(v) => v !== undefined && upd((x) => { x.stairs.offset = v; })} />
              <LengthField label="Stair width" value={spec.stairs.width} min={36} onChange={(v) => v && upd((x) => { x.stairs.width = v; })} />
            </>
          )}
        </>
      )}
    </Section>
  );
}
