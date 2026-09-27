import { createContext, useContext, type ReactNode } from 'react';
import { add, dist, leftNormal, mul, norm, sub, type Vec } from '../../model/geometry';
import { formatFtIn } from '../../model/units';

/** SVG units per paper inch. Sheets are ARCH D (36" x 24"). */
export const PAPER = 100;
export const SHEET_W = 36 * PAPER;
export const SHEET_H = 24 * PAPER;
export const FONT = 'Helvetica, Arial, sans-serif';

/** Line weights and text sizes, in paper units (1/100"). */
export const LW = { hair: 0.35, fine: 0.6, thin: 0.9, med: 1.5, heavy: 2.4, cut: 3.4 };
/**
 * Text sizes. `tiny` is the smallest text on a sheet: 0.1", which still reads when a
 * 36" x 24" sheet is printed at half size. Notes and table cells are 1/8".
 */
export const TXT = { mark: 9, tiny: 10, note: 12, label: 15, sub: 18, title: 24, big: 36 };
/** Distance between the baselines of wrapped lines of a text size. */
export const leading = (size: number) => Math.round(size * 1.42);

export const INK = '#161616';
export const INK_LIGHT = '#6d6d6d';
/** Secondary text. Light grey suits lines; text needs more contrast to read. */
export const INK_SOFT = '#474747';
const textColor = (c: string | undefined) => (c === undefined ? INK : c === INK_LIGHT ? INK_SOFT : c);
export const POCHE = '#262626';
export const POCHE_INT = '#5a5a5a';
export const SELECT = '#1f6feb';

// ---------------------------------------------------------------- scale context

type DraftContext = { k: number };
const Ctx = createContext<DraftContext>({ k: 1 });

/** Converts paper units to model units inside a scaled drawing. */
export function useDraft() {
  const { k } = useContext(Ctx);
  return { k, p: (paper: number) => paper / k };
}

export const SCALES = {
  '1in20ft': { ratio: 1 / 240, label: '1" = 20\'-0"' },
  '1/8': { ratio: 1 / 96, label: '1/8" = 1\'-0"' },
  '3/16': { ratio: 1 / 64, label: '3/16" = 1\'-0"' },
  '1/4': { ratio: 1 / 48, label: '1/4" = 1\'-0"' },
  '3/8': { ratio: 1 / 32, label: '3/8" = 1\'-0"' },
  '1/2': { ratio: 1 / 24, label: '1/2" = 1\'-0"' },
  '3/4': { ratio: 1 / 16, label: '3/4" = 1\'-0"' },
  '1': { ratio: 1 / 12, label: '1" = 1\'-0"' },
  '1-1/2': { ratio: 1 / 8, label: '1-1/2" = 1\'-0"' },
} as const;
export type ScaleKey = keyof typeof SCALES;

/**
 * A drawing placed on the sheet. `origin` is where model point (0,0) lands, in paper units.
 */
export function DrawingView(props: {
  origin: Vec;
  scale: ScaleKey;
  children: ReactNode;
  gRef?: React.Ref<SVGGElement>;
}) {
  const k = SCALES[props.scale].ratio * PAPER;
  return (
    <Ctx.Provider value={{ k }}>
      <g ref={props.gRef} transform={`translate(${props.origin.x} ${props.origin.y}) scale(${k})`}>
        {props.children}
      </g>
    </Ctx.Provider>
  );
}

/** Where to put a model rectangle so it is centered in a paper box. */
export function centerIn(
  model: { x0: number; y0: number; x1: number; y1: number },
  box: { x: number; y: number; w: number; h: number },
  scale: ScaleKey,
): Vec {
  const k = SCALES[scale].ratio * PAPER;
  return {
    x: box.x + (box.w - (model.x1 - model.x0) * k) / 2 - model.x0 * k,
    y: box.y + (box.h - (model.y1 - model.y0) * k) / 2 - model.y0 * k,
  };
}

// ---------------------------------------------------------------- primitives (model units)

export const pts = (ps: Vec[]) => ps.map((p) => `${r(p.x)},${r(p.y)}`).join(' ');
const r = (n: number) => Math.round(n * 1000) / 1000;

export function Line(props: { a: Vec; b: Vec; w?: number; color?: string; dash?: number[]; cap?: 'round' | 'butt' | 'square' }) {
  const { p } = useDraft();
  return (
    <line
      x1={r(props.a.x)} y1={r(props.a.y)} x2={r(props.b.x)} y2={r(props.b.y)}
      stroke={props.color ?? INK}
      strokeWidth={p(props.w ?? LW.thin)}
      strokeDasharray={props.dash?.map((x) => p(x)).join(' ')}
      strokeLinecap={props.cap ?? 'butt'}
    />
  );
}

export function Poly(props: {
  points: Vec[];
  w?: number;
  stroke?: string;
  fill?: string;
  closed?: boolean;
  dash?: number[];
  opacity?: number;
}) {
  const { p } = useDraft();
  const common = {
    points: pts(props.points),
    stroke: props.stroke ?? (props.w === 0 ? 'none' : INK),
    strokeWidth: p(props.w ?? LW.thin),
    fill: props.fill ?? 'none',
    strokeDasharray: props.dash?.map((x) => p(x)).join(' '),
    strokeLinejoin: 'miter' as const,
    opacity: props.opacity,
  };
  return props.closed === false ? <polyline {...common} /> : <polygon {...common} />;
}

/** Many closed polygons as one path, so drawings with hundreds of pieces stay light in the PDF. */
export function Polys(props: { polys: Vec[][]; w?: number; stroke?: string; fill?: string; dash?: number[]; opacity?: number }) {
  const { p } = useDraft();
  if (!props.polys.length) return null;
  const d = props.polys
    .filter((poly) => poly.length > 1)
    .map((poly) => `M${poly.map((q) => `${r(q.x)} ${r(q.y)}`).join('L')}Z`)
    .join('');
  return (
    <path
      d={d}
      stroke={props.stroke ?? (props.w === 0 ? 'none' : INK)}
      strokeWidth={p(props.w ?? LW.fine)}
      fill={props.fill ?? 'none'}
      strokeDasharray={props.dash?.map((x) => p(x)).join(' ')}
      strokeLinejoin="miter"
      opacity={props.opacity}
    />
  );
}

/**
 * A note with a leader: the arrow points at `to`, and the text sits at `at`.
 * The text reads away from the arrow, so it anchors on the side facing it.
 */
export function Leader(props: { to: Vec; at: Vec; text: string | string[]; size?: number; dot?: boolean }) {
  const { p } = useDraft();
  const lines = Array.isArray(props.text) ? props.text : [props.text];
  const size = props.size ?? TXT.tiny;
  const right = props.at.x >= props.to.x;
  const elbow = { x: props.at.x + (right ? -p(4) : p(4)), y: props.at.y };
  const start = { x: elbow.x + (right ? -p(14) : p(14)), y: props.at.y };
  const d = norm(sub(props.to, start));
  const n = leftNormal(d);
  const back = sub(props.to, mul(d, p(9)));
  return (
    <g>
      <Poly points={[elbow, start, props.to]} closed={false} w={LW.fine} />
      {props.dot ? (
        <circle cx={r(props.to.x)} cy={r(props.to.y)} r={p(2.2)} fill={INK} />
      ) : (
        <Poly points={[props.to, add(back, mul(n, p(2.6))), sub(back, mul(n, p(2.6)))]} fill={INK} w={0} />
      )}
      {lines.map((l, i) => (
        <Text key={i} at={{ x: props.at.x, y: props.at.y + p(i * (size + 2.5)) }} size={size} anchor={right ? 'start' : 'end'} middle>
          {l}
        </Text>
      ))}
    </g>
  );
}

export function Text(props: {
  at: Vec;
  size?: number;
  anchor?: 'start' | 'middle' | 'end';
  weight?: 'normal' | 'bold';
  rotate?: number;
  color?: string;
  /** Vertically center on `at` instead of sitting on the baseline. */
  middle?: boolean;
  /** A white plate behind the text, so it reads over linework and hatching. On unless set to false. */
  plate?: boolean;
  children: ReactNode;
}) {
  const { p } = useDraft();
  const size = p(props.size ?? TXT.note);
  const y = props.at.y + (props.middle ? size * 0.36 : 0);
  const str = typeof props.children === 'string' || typeof props.children === 'number' ? String(props.children) : Array.isArray(props.children) ? props.children.join('') : '';
  const transform = props.rotate ? `rotate(${props.rotate} ${r(props.at.x)} ${r(props.at.y)})` : undefined;
  const w = p(textWidth(str, props.size ?? TXT.note)) * 0.97 + p(3);
  const anchor = props.anchor ?? 'middle';
  const x0 = anchor === 'start' ? props.at.x - p(1.5) : anchor === 'end' ? props.at.x - w + p(1.5) : props.at.x - w / 2;
  const text = (
    <text
      x={r(props.at.x)}
      y={r(y)}
      fontSize={r(size)}
      fontFamily={FONT}
      fontWeight={props.weight ?? 'normal'}
      textAnchor={props.anchor ?? 'middle'}
      fill={textColor(props.color)}
      transform={transform}
    >
      {props.children}
    </text>
  );
  if (props.plate === false || !str) return text;
  return (
    <g>
      <rect x={r(x0)} y={r(y - size * 0.84)} width={r(w)} height={r(size * 1.12)} fill="#fff" transform={transform} />
      {text}
    </g>
  );
}

/** Approximate text width in paper units (Helvetica caps). */
export const textWidth = (s: string, size: number) => s.length * size * 0.6;

/**
 * Architectural dimension between a and b, offset `off` model units along the left normal of a->b.
 * `extFrom` is how far from the measured points the extension lines begin.
 */
export function Dim(props: { a: Vec; b: Vec; off: number; text?: string; extFrom?: number; lift?: number }) {
  const { p } = useDraft();
  const d = norm(sub(props.b, props.a));
  const n = leftNormal(d);
  const sgn = Math.sign(props.off) || 1;
  const A = add(props.a, mul(n, props.off));
  const B = add(props.b, mul(n, props.off));
  const ext0 = props.extFrom ?? p(6);
  const extEnd = props.off + sgn * p(6);
  const tick = mul(norm(add(d, mul(n, 1))), p(6));
  let ang = (Math.atan2(d.y, d.x) * 180) / Math.PI;
  if (ang > 90.001) ang -= 180;
  if (ang <= -90.001) ang += 180;
  const t = (ang * Math.PI) / 180;
  const up = { x: Math.sin(t), y: -Math.cos(t) };
  const label = props.text ?? formatFtIn(dist(props.a, props.b));
  const fits = dist(props.a, props.b) > p(textWidth(label, TXT.note) + 6);
  const lift = p(4) + (fits ? 0 : p(TXT.note + 3)) * (props.lift ?? 1);
  const mid = add(mul(add(A, B), 0.5), mul(up, lift));
  return (
    <g>
      <Line a={add(props.a, mul(n, sgn * ext0))} b={add(props.a, mul(n, extEnd))} w={LW.hair} />
      <Line a={add(props.b, mul(n, sgn * ext0))} b={add(props.b, mul(n, extEnd))} w={LW.hair} />
      <Line a={sub(A, mul(d, p(6)))} b={add(B, mul(d, p(6)))} w={LW.hair} />
      <Line a={sub(A, tick)} b={add(A, tick)} w={LW.med} />
      <Line a={sub(B, tick)} b={add(B, tick)} w={LW.med} />
      <Text at={mid} rotate={ang || undefined}>{label}</Text>
    </g>
  );
}

/** A chain of dimensions through points that lie on one line. */
export function DimChain(props: { points: Vec[]; off: number; extFrom?: number }) {
  const ps = props.points;
  return (
    <g>
      {ps.slice(1).map((b, i) => (
        <Dim key={i} a={ps[i]} b={b} off={props.off} extFrom={props.extFrom} lift={i % 2 ? 2 : 1} />
      ))}
    </g>
  );
}

/** Opening/door tag bubble. */
export function Tag(props: { at: Vec; text: string; shape: 'circle' | 'hex' | 'diamond' }) {
  const { p } = useDraft();
  const rad = p(13);
  const c = props.at;
  let shape: ReactNode;
  if (props.shape === 'circle') {
    shape = <circle cx={c.x} cy={c.y} r={rad} fill="#fff" stroke={INK} strokeWidth={p(LW.thin)} />;
  } else {
    const n = props.shape === 'hex' ? 6 : 4;
    const R = props.shape === 'hex' ? rad * 1.1 : rad * 1.3;
    const ring = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + (props.shape === 'hex' ? 0 : Math.PI / 4) + (props.shape === 'diamond' ? Math.PI / 4 : 0);
      return { x: c.x + R * Math.cos(a), y: c.y + R * Math.sin(a) };
    });
    shape = <Poly points={ring} fill="#fff" w={LW.thin} />;
  }
  return (
    <g>
      {shape}
      <Text at={c} size={TXT.tiny} middle weight="bold">{props.text}</Text>
    </g>
  );
}

/** Elevation datum marker (drawn in elevation space: y = -height). */
export function LevelMark(props: { x: number; h: number; label: string; left?: boolean; lineFrom?: number }) {
  const { p } = useDraft();
  const y = -props.h;
  const dir = props.left ? -1 : 1;
  const R = p(6);
  const cx = props.x;
  return (
    <g>
      {props.lineFrom !== undefined && (
        <Line a={{ x: props.lineFrom, y }} b={{ x: cx, y }} w={LW.hair} dash={[8, 4]} color={INK_LIGHT} />
      )}
      <circle cx={cx} cy={y} r={R} fill="none" stroke={INK} strokeWidth={p(LW.thin)} />
      <path d={`M ${cx} ${y} L ${cx} ${y - R} A ${R} ${R} 0 0 1 ${cx + R} ${y} Z`} fill={INK} />
      <path d={`M ${cx} ${y} L ${cx} ${y + R} A ${R} ${R} 0 0 1 ${cx - R} ${y} Z`} fill={INK} />
      <Text at={{ x: cx + dir * p(10), y: y - p(3.5) }} anchor={props.left ? 'end' : 'start'} weight="bold">
        {props.label}
      </Text>
      <Text at={{ x: cx + dir * p(10), y: y + p(13) }} anchor={props.left ? 'end' : 'start'}>
        {`${props.h >= 0 ? '+' : ''}${formatFtIn(props.h)}`}
      </Text>
    </g>
  );
}

/** Roof pitch triangle. */
export function PitchMark(props: { at: Vec; pitch: number; flip?: boolean }) {
  const { p } = useDraft();
  const run = p(24);
  const rise = (run * props.pitch) / 12;
  const s = props.flip ? -1 : 1;
  const o = props.at;
  return (
    <g>
      <Poly points={[o, { x: o.x + s * run, y: o.y }, { x: o.x + s * run, y: o.y - rise }]} closed={false} w={LW.thin} />
      <Text at={{ x: o.x + (s * run) / 2, y: o.y + p(11) }} size={TXT.tiny}>12</Text>
      <Text at={{ x: o.x + s * run + s * p(4), y: o.y - rise / 2 + p(3.5) }} size={TXT.tiny} anchor={s > 0 ? 'start' : 'end'}>
        {+props.pitch.toFixed(2)}
      </Text>
    </g>
  );
}

// ---------------------------------------------------------------- paper-space items

export function PText(props: {
  x: number;
  y: number;
  size?: number;
  anchor?: 'start' | 'middle' | 'end';
  weight?: 'normal' | 'bold';
  color?: string;
  children: ReactNode;
  spacing?: number;
}) {
  return (
    <text
      x={props.x}
      y={props.y}
      fontSize={props.size ?? TXT.note}
      fontFamily={FONT}
      fontWeight={props.weight ?? 'normal'}
      textAnchor={props.anchor ?? 'start'}
      fill={textColor(props.color)}
      letterSpacing={props.spacing}
    >
      {props.children}
    </text>
  );
}

/** Word-wrapped paragraph in paper space; returns the height used via the render prop. */
export function wrapText(s: string, maxWidth: number, size: number): string[] {
  const words = s.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (textWidth(next, size) * 0.92 > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

export function ViewTitle(props: { x: number; y: number; num: string | number; title: string; scale?: ScaleKey; width?: number }) {
  const w = props.width ?? 380;
  return (
    <g>
      <circle cx={props.x + 20} cy={props.y} r={20} fill="none" stroke={INK} strokeWidth={LW.med} />
      <line x1={props.x} x2={props.x + 40} y1={props.y} y2={props.y} stroke={INK} strokeWidth={LW.thin} />
      <PText x={props.x + 20} y={props.y - 5} size={TXT.label} anchor="middle" weight="bold">{props.num}</PText>
      <line x1={props.x + 40} x2={props.x + 40 + w} y1={props.y} y2={props.y} stroke={INK} strokeWidth={LW.heavy} />
      <PText x={props.x + 48} y={props.y - 7} size={TXT.sub} weight="bold" spacing={0.6}>{props.title.toUpperCase()}</PText>
      {props.scale && (
        <PText x={props.x + 48} y={props.y + 18} size={TXT.note}>{`SCALE: ${SCALES[props.scale].label}`}</PText>
      )}
    </g>
  );
}

export function NorthArrow(props: { x: number; y: number }) {
  const { x, y } = props;
  return (
    <g>
      <circle cx={x} cy={y} r={32} fill="none" stroke={INK} strokeWidth={LW.thin} />
      <path d={`M ${x} ${y - 42} L ${x + 12} ${y + 18} L ${x} ${y + 8} L ${x - 12} ${y + 18} Z`} fill={INK} />
      <PText x={x} y={y - 48} size={TXT.label} anchor="middle" weight="bold">N</PText>
    </g>
  );
}

export function ScaleBar(props: { x: number; y: number; scale: ScaleKey }) {
  const k = SCALES[props.scale].ratio * PAPER;
  // Engineering scales get marks in tens of feet.
  const steps = SCALES[props.scale].ratio < 1 / 120 ? [0, 10, 20, 40, 80, 160] : [0, 1, 2, 4, 8, 16];
  const marks = steps.filter((f) => f * 12 * k <= 520);
  const h = 7;
  return (
    <g>
      {marks.slice(1).map((f, i) => {
        const x0 = props.x + marks[i] * 12 * k;
        const x1 = props.x + f * 12 * k;
        return (
          <rect key={f} x={x0} y={props.y} width={x1 - x0} height={h} fill={i % 2 ? '#fff' : INK} stroke={INK} strokeWidth={LW.fine} />
        );
      })}
      {marks.map((f) => (
        <PText key={f} x={props.x + f * 12 * k} y={props.y + h + 13} size={TXT.tiny} anchor="middle">{`${f}'`}</PText>
      ))}
    </g>
  );
}
