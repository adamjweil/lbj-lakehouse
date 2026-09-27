import type { ReactNode } from 'react';
import type { Fixture } from '../../model/schema';
import { INK, LW, Text, TXT, useDraft } from '../draft/draft';

/** Plan symbol for a fixture, drawn in its local frame (back edge at -d/2). */
export function FixtureSymbol({ f }: { f: Fixture }) {
  const { p } = useDraft();
  const w = f.w;
  const d = f.d;
  const x0 = -w / 2;
  const y0 = -d / 2;
  const sw = p(LW.fine);
  const base = { fill: 'none', stroke: INK, strokeWidth: sw };
  const dashed = { ...base, strokeDasharray: `${p(5)} ${p(3)}` };
  const outline = <rect x={x0} y={y0} width={w} height={d} {...base} fill="#fff" />;
  const label = (s: string, size = TXT.tiny) => (
    <Text at={{ x: 0, y: 0 }} size={size} middle rotate={f.rotation ? -f.rotation : undefined}>
      {s}
    </Text>
  );
  let body: ReactNode;
  switch (f.kind) {
    case 'counter':
      body = (
        <>
          {outline}
          <line x1={x0} x2={-x0} y1={y0 + 12} y2={y0 + 12} {...dashed} />
        </>
      );
      break;
    case 'sink':
      body = (
        <>
          <rect x={x0 + 1} y={y0 + 1} width={w - 2} height={d - 2} rx={2} {...base} fill="#fff" />
          <rect x={x0 + 3} y={y0 + 4} width={w / 2 - 4} height={d - 7} rx={3} {...base} />
          <rect x={1} y={y0 + 4} width={w / 2 - 4} height={d - 7} rx={3} {...base} />
          <circle cx={x0 + 3 + (w / 2 - 4) / 2} cy={2} r={1} {...base} />
        </>
      );
      break;
    case 'range':
      body = (
        <>
          {outline}
          {[-1, 1].map((i) => [-1, 1].map((j) => (
            <circle key={`${i}${j}`} cx={(i * w) / 4} cy={(j * d) / 4 + 1} r={Math.min(w, d) / 6} {...base} />
          )))}
        </>
      );
      break;
    case 'fridge':
      body = (
        <>
          {outline}
          <line x1={x0} x2={-x0} y1={-y0 - 2} y2={-y0 - 2} {...base} />
          {label('REF')}
        </>
      );
      break;
    case 'dishwasher':
      body = (
        <>
          <rect x={x0} y={y0} width={w} height={d} {...dashed} />
          {label('DW')}
        </>
      );
      break;
    case 'island':
      body = (
        <>
          {outline}
          <line x1={x0} x2={-x0} y1={-y0 - 12} y2={-y0 - 12} {...dashed} />
          {[-1, 0, 1].map((i) => (
            <circle key={i} cx={(i * w) / 3.2} cy={-y0 + 9} r={7} {...base} />
          ))}
        </>
      );
      break;
    case 'table': {
      const along = d >= w;
      const n = Math.max(1, Math.floor((along ? d : w) / 28));
      const chairs: ReactNode[] = [];
      for (let i = 0; i < n; i++) {
        const t = ((i + 0.5) / n - 0.5) * (along ? d : w);
        for (const s of [-1, 1]) {
          chairs.push(
            along ? (
              <rect key={`${i}${s}`} x={s * (w / 2 + 4) - (s > 0 ? 0 : 16)} y={t - 8} width={16} height={16} rx={2} {...base} fill="#fff" />
            ) : (
              <rect key={`${i}${s}`} x={t - 8} y={s * (d / 2 + 4) - (s > 0 ? 0 : 16)} width={16} height={16} rx={2} {...base} fill="#fff" />
            ),
          );
        }
      }
      body = (
        <>
          {chairs}
          {outline}
        </>
      );
      break;
    }
    case 'chair':
      body = (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx={3} {...base} fill="#fff" />
          <line x1={x0} x2={-x0} y1={y0 + 5} y2={y0 + 5} {...base} />
        </>
      );
      break;
    case 'sofa':
      body = (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx={3} {...base} fill="#fff" />
          <rect x={x0 + 8} y={y0} width={w - 16} height={9} {...base} />
          <rect x={x0} y={y0} width={8} height={d} rx={2} {...base} />
          <rect x={-x0 - 8} y={y0} width={8} height={d} rx={2} {...base} />
          <line x1={0} x2={0} y1={y0 + 9} y2={-y0} {...base} />
        </>
      );
      break;
    case 'coffee-table':
    case 'nightstand':
      body = <rect x={x0} y={y0} width={w} height={d} rx={2} {...base} fill="#fff" />;
      break;
    case 'dresser':
      body = (
        <>
          {outline}
          <line x1={0} x2={0} y1={y0} y2={-y0} {...base} />
        </>
      );
      break;
    case 'bed':
      body = (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx={2} {...base} fill="#fff" />
          <rect x={x0 + 4} y={y0 + 4} width={w / 2 - 6} height={12} rx={3} {...base} />
          <rect x={2} y={y0 + 4} width={w / 2 - 6} height={12} rx={3} {...base} />
          <polyline points={`${x0},${y0 + 26} ${-x0},${y0 + 26}`} {...base} />
          <polyline points={`${x0},${y0 + 34} ${-x0 - 14},${y0 + 26}`} {...base} />
        </>
      );
      break;
    case 'toilet':
      body = (
        <>
          <rect x={x0} y={y0} width={w} height={8} rx={1.5} {...base} fill="#fff" />
          <ellipse cx={0} cy={y0 + 8 + (d - 8) / 2} rx={w / 2 - 2.5} ry={(d - 8) / 2} {...base} fill="#fff" />
          <ellipse cx={0} cy={y0 + 8 + (d - 8) / 2 + 1} rx={w / 2 - 6} ry={(d - 8) / 2 - 4} {...base} />
        </>
      );
      break;
    case 'vanity':
      body = (
        <>
          {outline}
          <ellipse cx={0} cy={1} rx={Math.min(w / 2 - 5, 9)} ry={d / 2 - 5} {...base} />
        </>
      );
      break;
    case 'shower':
      body = (
        <>
          <rect x={x0} y={y0} width={w} height={d} {...base} fill="#fff" />
          <rect x={x0 + 2} y={y0 + 2} width={w - 4} height={d - 4} {...base} />
          <line x1={x0 + 2} y1={y0 + 2} x2={-x0 - 2} y2={-y0 - 2} {...base} strokeWidth={p(LW.hair)} />
          <line x1={-x0 - 2} y1={y0 + 2} x2={x0 + 2} y2={-y0 - 2} {...base} strokeWidth={p(LW.hair)} />
          <circle cx={0} cy={0} r={2} {...base} fill="#fff" />
        </>
      );
      break;
    case 'tub':
      body = (
        <>
          {outline}
          <rect x={x0 + 3} y={y0 + 3} width={w - 6} height={d - 6} rx={8} {...base} />
        </>
      );
      break;
    case 'washer-dryer':
      body = (
        <>
          {outline}
          <circle cx={0} cy={1} r={Math.min(w, d) / 2 - 3} {...base} />
          {label('W/D')}
        </>
      );
      break;
    case 'water-heater':
      body = (
        <>
          {outline}
          {label('WH', TXT.tiny * 0.8)}
        </>
      );
      break;
    case 'stove':
      body = (
        <>
          <rect x={x0 - 8} y={y0 - 8} width={w + 16} height={d + 16} {...dashed} />
          {outline}
          <circle cx={0} cy={0} r={Math.min(w, d) / 2 - 3} {...base} />
          <circle cx={0} cy={0} r={3} {...base} />
        </>
      );
      break;
    case 'car': {
      // Local +y is the front of the car.
      const y = (f: number) => y0 + d * f;
      body = (
        <>
          <rect x={x0} y={y0} width={w} height={d} rx={w * 0.18} {...base} fill="#fff" />
          <path d={`M ${x0 + 4} ${y(0.72)} Q 0 ${y(0.68)} ${-x0 - 4} ${y(0.72)}`} {...base} />
          <path d={`M ${x0 + 6} ${y(0.62)} L ${-x0 - 6} ${y(0.62)} L ${-x0 - 9} ${y(0.33)} L ${x0 + 9} ${y(0.33)} Z`} {...base} />
          <path d={`M ${x0 + 8} ${y(0.24)} L ${-x0 - 8} ${y(0.24)} L ${-x0 - 6} ${y(0.14)} L ${x0 + 6} ${y(0.14)} Z`} {...base} />
          <rect x={x0 - 3} y={y(0.64)} width={3} height={5} {...base} />
          <rect x={-x0} y={y(0.64)} width={3} height={5} {...base} />
          {label('CAR')}
        </>
      );
      break;
    }
    case 'closet-rod':
      body = (
        <>
          <rect x={x0} y={y0} width={w} height={d} {...dashed} />
          <line x1={x0} x2={-x0} y1={0} y2={0} {...base} strokeDasharray={`${p(10)} ${p(3)} ${p(2)} ${p(3)}`} />
          <line x1={x0} x2={-x0} y1={y0 + 12} y2={y0 + 12} {...base} />
        </>
      );
      break;
  }
  return (
    <g transform={`translate(${f.x} ${f.y}) rotate(${f.rotation})`} data-fixture={f.id}>
      {body}
    </g>
  );
}
