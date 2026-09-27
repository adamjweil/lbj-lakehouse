import type { ReactNode } from 'react';
import type { Design } from '../../model/schema';
import { bbox, footprint, garageFootprint, platforms, rectPoints, roofFrame, garageRoofFrame, type Rect, type Vec } from '../../model/geometry';
import { pathRects, type SiteGeom } from '../../model/site';
import { formatFtIn } from '../../model/units';
import { Dim, INK, INK_LIGHT, LW, Line, Poly, Text, TXT, useDraft } from '../draft/draft';

type G = NonNullable<SiteGeom>;

/** Model-space extents of the site plan (street to the end of the dock). */
export function sitePlanBounds(g: G, margin: number): Rect {
  const L = g.lotRect;
  const pts: Vec[] = [
    { x: L.x0, y: g.street.y0 },
    { x: L.x1, y: L.y1 },
  ];
  if (g.dock) pts.push({ x: g.dock.body.x0, y: g.dock.body.y1 });
  const r = bbox(pts);
  return { x0: r.x0 - margin, y0: r.y0 - margin, x1: r.x1 + margin, y1: r.y1 + margin };
}

/** Canopy radius for plan symbols. */
const canopy = (species: string, height: number) => height * (species === 'live-oak' ? 0.42 : species === 'cedar' ? 0.26 : 0.3);

export function TreeSymbol({ x, y, species, height }: { x: number; y: number; species: string; height: number }) {
  const { p } = useDraft();
  const r = canopy(species, height);
  const n = species === 'cedar' ? 10 : 14;
  // Scalloped canopy outline.
  const pts: Vec[] = Array.from({ length: n * 2 }, (_, i) => {
    const a = (i / (n * 2)) * Math.PI * 2;
    const rr = i % 2 ? r * 0.86 : r;
    return { x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr };
  });
  return (
    <g>
      <Poly points={pts} w={LW.fine} fill={species === 'cedar' ? '#e3e8df' : '#eef1ea'} />
      <circle cx={x} cy={y} r={p(2)} fill={INK} />
    </g>
  );
}

export function SitePlanDrawing({ design, g }: { design: Design; g: G }) {
  const { p } = useDraft();
  const L = g.lotRect;
  const parts: ReactNode[] = [];

  // Water with wave marks beyond the shoreline.
  const waterBottom = (g.dock ? g.dock.body.y1 : L.y1) + p(60);
  const waves: ReactNode[] = [];
  for (let y = L.y1 + p(30); y < waterBottom; y += p(28)) {
    for (let x = L.x0 - p(40) + ((y / p(28)) % 2) * p(30); x < L.x1 + p(40); x += p(60)) {
      waves.push(<path key={`${x}-${y}`} d={`M ${x} ${y} q ${p(6)} ${-p(4)} ${p(12)} 0 t ${p(12)} 0`} fill="none" stroke={INK_LIGHT} strokeWidth={p(LW.hair)} />);
    }
  }
  parts.push(<g key="water">{waves}</g>);

  // Street.
  const st = g.street;
  const street: Rect = { x0: L.x0 - p(80), x1: L.x1 + p(80), y0: st.y0, y1: st.y1 };
  parts.push(
    <g key="street">
      <Line a={{ x: street.x0, y: st.y0 }} b={{ x: street.x1, y: st.y0 }} w={LW.med} />
      <Line a={{ x: street.x0, y: st.y1 }} b={{ x: street.x1, y: st.y1 }} w={LW.med} />
      <Line a={{ x: street.x0, y: (st.y0 + st.y1) / 2 }} b={{ x: street.x1, y: (st.y0 + st.y1) / 2 }} w={LW.thin} dash={[20, 10]} />
      <Text at={{ x: (L.x0 + L.x1) / 2, y: st.y0 + (st.y1 - st.y0) * 0.3 }} size={TXT.label} weight="bold" middle>
        STREET (NAME TBD)
      </Text>
    </g>,
  );

  // Driveway and walks.
  if (g.driveway) {
    const d = g.driveway;
    parts.push(
      <g key="drive">
        <Poly points={rectPoints(d)} w={LW.thin} fill="#f1efea" />
        <Text at={{ x: (d.x0 + d.x1) / 2, y: (d.y0 + d.y1) / 2 }} size={TXT.tiny} rotate={-90} middle>
          12' GRAVEL DRIVE
        </Text>
      </g>,
    );
  }
  g.paths.forEach((path, i) =>
    pathRects(path).forEach((r, j) => parts.push(<Poly key={`walk${i}-${j}`} points={rectPoints(r)} w={LW.fine} fill="#f5f3ee" />)),
  );

  // Building: roofs dashed, footprints filled.
  const fp = footprint(design);
  const gfp = garageFootprint(design);
  const plats = platforms(design);
  parts.push(
    <g key="building">
      {plats.map((q) => (
        <g key={q.kind}>
          <Poly points={rectPoints(q.rect)} w={LW.thin} fill="#fff" />
          {q.stairs && <Poly points={rectPoints(q.stairs.rect)} w={LW.fine} fill="#fff" />}
        </g>
      ))}
      <Poly points={fp} w={LW.heavy} fill="#d9d9d9" />
      {gfp && <Poly points={gfp} w={LW.heavy} fill="#e8e8e8" />}
      {[roofFrame(design), garageRoofFrame(design)].filter(Boolean).map((rf, i) => (
        <Poly key={i} points={rectPoints(rf!.planRect)} w={LW.hair} dash={[8, 4]} />
      ))}
      <Text at={{ x: (bbox(fp).x0 + bbox(fp).x1) / 2, y: (bbox(fp).y0 + bbox(fp).y1) / 2 - p(4) }} size={TXT.label} weight="bold" middle>
        RESIDENCE
      </Text>
      <Text at={{ x: (bbox(fp).x0 + bbox(fp).x1) / 2, y: (bbox(fp).y0 + bbox(fp).y1) / 2 + p(10) }} size={TXT.tiny} middle>
        FF = GRADE + 2'-6"
      </Text>
      {gfp && (
        <Text at={{ x: (bbox(gfp).x0 + bbox(gfp).x1) / 2, y: (bbox(gfp).y0 + bbox(gfp).y1) / 2 }} size={TXT.tiny} weight="bold" rotate={-90} middle>
          GARAGE
        </Text>
      )}
      {plats.map((q) => (
        <Text key={`t${q.kind}`} at={{ x: (q.rect.x0 + q.rect.x1) / 2 + p(40), y: (q.rect.y0 + q.rect.y1) / 2 }} size={TXT.tiny} middle>
          {q.kind.toUpperCase()}
        </Text>
      ))}
    </g>,
  );

  // Bulkhead and shoreline.
  parts.push(
    <g key="shore">
      <Poly points={rectPoints({ x0: L.x0, x1: L.x1, y0: L.y1 - 12, y1: L.y1 })} fill={INK} w={0} />
      <Text at={{ x: L.x0 + p(10), y: L.y1 + p(16) }} size={TXT.tiny} anchor="start">
        {`LIMESTONE BULKHEAD · LAKE LBJ NORMAL POOL EL. ${g.site.normalPool.toFixed(1)}'`}
      </Text>
    </g>,
  );

  // Dock.
  if (g.dock) {
    const d = g.dock;
    parts.push(
      <g key="dock">
        <Poly points={rectPoints(d.gangway)} w={LW.thin} fill="#fff" />
        <Poly points={rectPoints(d.body)} w={LW.med} fill="#fff" />
        <Poly points={rectPoints(d.slip)} w={LW.thin} fill="#eef3f6" />
        <Text at={{ x: d.body.x1 + p(12), y: (d.body.y0 + d.body.y1) / 2 - p(6) }} size={TXT.tiny} anchor="start" weight="bold">
          OPEN BOAT DOCK
        </Text>
        <Text at={{ x: d.body.x1 + p(12), y: (d.body.y0 + d.body.y1) / 2 + p(6) }} size={TXT.tiny} anchor="start">
          {d.lift.length ? 'W/ BOAT LIFT (LCRA PERMIT)' : 'LCRA PERMIT REQUIRED'}
        </Text>
      </g>,
    );
  }

  // Trees.
  parts.push(
    <g key="trees">
      {g.trees.map((t, i) => (
        <TreeSymbol key={i} {...t} />
      ))}
    </g>,
  );

  // Setbacks and property lines.
  const sb = g.setback;
  parts.push(
    <g key="lines">
      <Poly points={rectPoints(sb)} w={LW.thin} dash={[10, 6]} stroke={INK_LIGHT} />
      <Text at={{ x: (sb.x0 + sb.x1) / 2, y: sb.y0 + p(12) }} size={TXT.tiny} color={INK_LIGHT} middle>
        {`${formatFtIn(g.site.setbacks.street).replace(/-0"$/, '')} STREET SETBACK`}
      </Text>
      <Text at={{ x: sb.x0 + p(10), y: (sb.y0 + sb.y1) / 2 }} size={TXT.tiny} color={INK_LIGHT} rotate={-90} middle>
        {`${formatFtIn(g.site.setbacks.side).replace(/-0"$/, '')} SIDE SETBACK`}
      </Text>
      <Text at={{ x: (sb.x0 + sb.x1) / 2 - p(90), y: sb.y1 - p(8) }} size={TXT.tiny} color={INK_LIGHT} middle>
        {`${formatFtIn(g.site.setbacks.lake).replace(/-0"$/, '')} LAKE SETBACK (VERIFY)`}
      </Text>
      <Poly points={g.lot} w={LW.heavy} dash={[34, 8, 6, 8]} />
      <Text at={{ x: L.x0 + p(18), y: L.y0 - p(8) }} size={TXT.tiny} anchor="start" weight="bold">PROPERTY LINE</Text>
    </g>,
  );

  // Fence: a line with post ticks, and gate posts at the openings.
  if (g.fence) {
    const fence = g.fence;
    const ticks: ReactNode[] = [];
    fence.runs.forEach((r, i) => {
      const len = Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y);
      const d = { x: (r.b.x - r.a.x) / len, y: (r.b.y - r.a.y) / len };
      const n = { x: -d.y * p(4), y: d.x * p(4) };
      ticks.push(<Line key={`f${i}`} a={r.a} b={r.b} w={LW.thin} />);
      for (let t = p(24); t < len - p(6); t += p(24)) {
        const c = { x: r.a.x + d.x * t, y: r.a.y + d.y * t };
        ticks.push(<Line key={`f${i}-${t}`} a={{ x: c.x - n.x, y: c.y - n.y }} b={{ x: c.x + n.x, y: c.y + n.y }} w={LW.fine} />);
      }
    });
    fence.gates.forEach((gt, i) =>
      [gt.a, gt.b].forEach((q, j) => ticks.push(<rect key={`g${i}-${j}`} x={q.x - p(3)} y={q.y - p(3)} width={p(6)} height={p(6)} fill={INK} />)),
    );
    const gate = fence.gates[0];
    parts.push(
      <g key="fence">
        {ticks}
        {gate && (
          <Text at={{ x: (gate.a.x + gate.b.x) / 2, y: gate.a.y + p(14) }} size={TXT.tiny} middle>
            {`${formatFtIn(Math.abs(gate.b.x - gate.a.x)).replace(/-0"$/, '')} DRIVE GATE`}
          </Text>
        )}
        <Text at={{ x: L.x1 - p(14), y: L.y0 + p(170) }} size={TXT.tiny} rotate={-90} middle>
          {`${formatFtIn(fence.spec.height).replace(/-0"$/, '')} ${fence.spec.style === 'metal' ? 'BLACK METAL PICKET' : 'CEDAR BOARD'} FENCE`}
        </Text>
      </g>,
    );
  }

  // Area callout in the front yard.
  // Place the callout in the open part of the front yard, clear of the driveway.
  const drive = g.driveway;
  const cx = drive && drive.x1 < (L.x0 + L.x1) / 2 ? (drive.x1 + L.x1) / 2 : drive ? (L.x0 + drive.x0) / 2 : (L.x0 + L.x1) / 2;
  const cy = L.y0 + (L.y1 - L.y0) * 0.33;
  parts.push(
    <g key="area">
      <rect x={cx - p(78)} y={cy - p(22)} width={p(156)} height={p(44)} fill="#fff" stroke={INK} strokeWidth={p(LW.med)} />
      <Text at={{ x: cx, y: cy - p(6) }} size={TXT.sub} weight="bold" middle>
        {`LOT AREA ${g.acres.toFixed(2)} AC`}
      </Text>
      <Text at={{ x: cx, y: cy + p(12) }} size={TXT.note} middle>
        {`${Math.round(g.area / 144).toLocaleString('en-US')} SF`}
      </Text>
    </g>,
  );

  // Dimensions: lot, side yards, and house to water.
  const b = bbox([...fp, ...(gfp ?? [])]);
  const yardY = (b.y0 + b.y1) / 2 + p(30);
  parts.push(
    <g key="dims">
      <Dim a={{ x: L.x0, y: L.y0 }} b={{ x: L.x1, y: L.y0 }} off={p(90)} />
      <Dim a={{ x: L.x1, y: L.y0 }} b={{ x: L.x1, y: L.y1 }} off={p(40)} />
      <Dim a={{ x: L.x0, y: yardY }} b={{ x: b.x0, y: yardY }} off={0.01} extFrom={0} />
      <Dim a={{ x: b.x1, y: yardY }} b={{ x: L.x1, y: yardY }} off={0.01} extFrom={0} />
      <Dim a={{ x: b.x1 - p(20), y: bbox(fp).y1 }} b={{ x: b.x1 - p(20), y: L.y1 - 12 }} off={-0.01} extFrom={0} text={formatFtIn(L.y1 - bbox(fp).y1)} />
    </g>,
  );
  return <g>{parts}</g>;
}

/** Enlarged dock plan. */
export function DockPlanDrawing({ g }: { g: G }) {
  const { p } = useDraft();
  const d = g.dock;
  if (!d) return null;
  const parts: ReactNode[] = [];
  const shore = g.shoreY;
  parts.push(
    <g key="shore">
      <Poly points={rectPoints({ x0: d.body.x0 - p(40), x1: d.body.x1 + p(40), y0: shore - 12, y1: shore })} fill={INK} w={0} />
      <Text at={{ x: d.body.x0 - p(36), y: shore - p(10) }} size={TXT.tiny} anchor="start">BULKHEAD / SHORELINE</Text>
    </g>,
  );
  // Decking lines.
  const boards: ReactNode[] = [];
  for (const r of d.walkRects) {
    for (let y = r.y0 + 5.75; y < r.y1; y += 5.75) boards.push(<line key={`${r.x0}-${y}`} x1={r.x0} x2={r.x1} y1={y} y2={y} />);
  }
  parts.push(
    <g key="boards" stroke="#cfcfcf" strokeWidth={p(LW.hair)}>
      {boards}
    </g>,
  );
  for (const r of d.walkRects) parts.push(<Poly key={`w${r.x0}${r.y0}`} points={rectPoints(r)} w={LW.med} />);
  // Piles and lift.
  d.piles.forEach((q, i) => parts.push(<circle key={`p${i}`} cx={q.x} cy={q.y} r={5} fill="#fff" stroke={INK} strokeWidth={p(LW.thin)} />));
  d.lift.forEach((q, i) => parts.push(<rect key={`l${i}`} x={q.x - 3} y={q.y - 3} width={6} height={6} fill="#fff" stroke={INK} strokeWidth={p(LW.thin)} />));
  // Boat outline.
  const bx = (d.slip.x0 + d.slip.x1) / 2;
  const by = (d.slip.y0 + d.slip.y1) / 2 + 12;
  parts.push(
    <path
      key="boat"
      d={`M ${bx - 40} ${by + 132} L ${bx + 40} ${by + 132} L ${bx + 45} ${by + 20} Q ${bx + 42} ${by - 80} ${bx} ${by - 132} Q ${bx - 42} ${by - 80} ${bx - 45} ${by + 20} Z`}
      fill="none"
      stroke={INK}
      strokeWidth={p(LW.thin)}
      strokeDasharray={`${p(6)} ${p(3)}`}
    />,
  );
  // Labels.
  const label = (r: Rect, t: string, rotate?: number) => (
    <Text key={t} at={{ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 }} size={TXT.tiny} weight="bold" rotate={rotate} middle>
      {t}
    </Text>
  );
  parts.push(
    label(d.gangway, 'GANGWAY', -90),
    label(d.slip, d.lift.length ? 'BOAT SLIP + LIFT' : 'BOAT SLIP', -90),
    label(d.lounge, 'LOUNGE DECK', -90),
    label(d.head, 'WALK'),
  );
  // Dimensions.
  const B = d.body;
  parts.push(
    <g key="dims">
      <Dim a={{ x: B.x0, y: B.y1 }} b={{ x: B.x1, y: B.y1 }} off={-p(40)} />
      <Dim a={{ x: B.x0, y: B.y1 }} b={{ x: d.slip.x0, y: B.y1 }} off={-p(18)} />
      <Dim a={{ x: d.slip.x0, y: B.y1 }} b={{ x: d.slip.x1, y: B.y1 }} off={-p(18)} />
      <Dim a={{ x: d.slip.x1, y: B.y1 }} b={{ x: B.x1, y: B.y1 }} off={-p(18)} />
      <Dim a={{ x: B.x0, y: shore }} b={{ x: B.x0, y: B.y0 }} off={-p(30)} />
      <Dim a={{ x: B.x0, y: B.y0 }} b={{ x: B.x0, y: B.y1 }} off={-p(30)} />
      <Dim a={{ x: d.gangway.x0, y: shore + p(20) }} b={{ x: d.gangway.x1, y: shore + p(20) }} off={p(1)} extFrom={0} />
    </g>,
  );
  return <g>{parts}</g>;
}

export function dockPlanBounds(g: G, margin: number): Rect | null {
  const d = g.dock;
  if (!d) return null;
  return { x0: d.body.x0 - margin, x1: d.body.x1 + margin, y0: g.shoreY - margin, y1: d.body.y1 + margin };
}
