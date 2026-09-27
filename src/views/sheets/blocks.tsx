import type { ReactNode, Ref } from 'react';
import type { Design } from '../../model/schema';
import type { CostRow } from '../../model/costs';
import { formatUsd } from '../../model/costs';
import { centerIn, DrawingView, INK, INK_LIGHT, leading, LW, PText, TXT, wrapText, type ScaleKey } from '../draft/draft';
import type { SheetFrame } from './SheetFrame';

export type FrameProps = Omit<Parameters<typeof SheetFrame>[0], 'id' | 'design' | 'children'>;

export type SheetProps = {
  design: Design;
  /** Interactive editing overlay, rendered inside the floor plan's model space. */
  overlay?: ReactNode;
  planRef?: Ref<SVGGElement>;
  frame?: FrameProps;
};

export type Block = { node: ReactNode; height: number };

/** Longest comfortable line of notes, in paper units: about 95 characters. */
const MEASURE = 760;
const ZEBRA = '#f4f4f4';

/**
 * A titled list of notes. A block much wider than a comfortable line is set in two
 * columns, so no line runs too long to follow back to the next one.
 */
export function noteBlock(x: number, y: number, w: number, title: string, items: string[], numbered = true, size: number = TXT.note): Block {
  const lh = leading(size);
  const gap = 50;
  const indent = numbered ? Math.round(size * 2.7) : 0;
  const count = w > ((MEASURE * size) / TXT.note) * 1.5 ? 2 : 1;
  const colW = (w - gap * (count - 1)) / count;
  const wrapped = items.map((item) => wrapText(item, colW - indent - 4, size));
  const heightOf = (lines: string[]) => lines.length * lh + 9;
  const total = wrapped.reduce((sum, l) => sum + heightOf(l), 0);
  const out: ReactNode[] = [
    <g key="t">
      <PText x={x} y={y} size={TXT.label} weight="bold" spacing={0.6}>{title.toUpperCase()}</PText>
      <line x1={x} x2={x + w} y1={y + 7} y2={y + 7} stroke={INK} strokeWidth={LW.thin} />
    </g>,
  ];
  const top = y + 34;
  let col = 0;
  let cy = top;
  let tallest = 0;
  wrapped.forEach((lines, i) => {
    // Start the second column once the first holds half of the notes.
    if (col < count - 1 && cy - top >= total / count - 1 && cy > top) {
      col++;
      cy = top;
    }
    const cx = x + col * (colW + gap);
    out.push(
      <g key={i}>
        {numbered && <PText x={cx} y={cy} size={size} weight="bold">{`${i + 1}.`}</PText>}
        {lines.map((l, j) => (
          <PText key={j} x={cx + indent} y={cy + j * lh} size={size}>{l}</PText>
        ))}
      </g>,
    );
    cy += heightOf(lines);
    tallest = Math.max(tallest, cy - top);
  });
  return { node: <g key={title}>{out}</g>, height: 34 + tallest + 8 };
}

export type Col = { title: string; w: number; align?: 'start' | 'middle' | 'end' };

export type TableBlock = Block & {
  /** Top and height of each body row, for anything drawn over the table. */
  rows: { y: number; h: number }[];
};

/**
 * A table. Cells that are too long for their column wrap onto more lines, and the row
 * grows to hold them. `foot` is an optional bold totals row under a heavier rule.
 */
export function table(x: number, y: number, title: string, cols: Col[], body: string[][], foot?: string[], o: { size?: number } = {}): TableBlock {
  const size = o.size ?? TXT.note;
  const lh = leading(size);
  const headSize = Math.round((size * TXT.tiny) / TXT.note);
  const headLh = leading(headSize);
  const pad = 9;
  const all = foot ? [...body, foot] : body;
  const w = cols.reduce((s, c) => s + c.w, 0);
  const heads = cols.map((c) => wrapText(c.title.toUpperCase(), c.w - 2 * pad, headSize));
  const headH = Math.max(size * 3.2, Math.max(1, ...heads.map((l) => l.length)) * headLh + 18);
  const cells = all.map((r) => cols.map((c, i) => wrapText(r[i] ?? '', c.w - 2 * pad, size)));
  const heights = cells.map((r) => Math.max(size * 3, Math.max(1, ...r.map((l) => l.length)) * lh + 18));
  const top = y + 12;
  const tops: number[] = [];
  let cy = top + headH;
  for (const h of heights) {
    tops.push(cy);
    cy += h;
  }
  const bottom = cy;
  const out: ReactNode[] = [
    <PText key="title" x={x} y={y} size={TXT.label} weight="bold" spacing={0.6}>{title.toUpperCase()}</PText>,
    <rect key="headfill" x={x} y={top} width={w} height={headH} fill="#e9e9e9" />,
  ];
  // Every other row is tinted, so the eye can follow a row across a wide table.
  body.forEach((_, j) => {
    if (j % 2 === 1) out.push(<rect key={`z${j}`} x={x} y={tops[j]} width={w} height={heights[j]} fill={ZEBRA} />);
  });
  const tx = (c: Col, cx: number) => (c.align === 'middle' ? cx + c.w / 2 : c.align === 'end' ? cx + c.w - pad : cx + pad);
  let cx = x;
  cols.forEach((c, i) => {
    if (i > 0) out.push(<line key={`v${i}`} x1={cx} x2={cx} y1={top} y2={bottom} stroke={INK} strokeWidth={LW.fine} />);
    const hl = heads[i];
    hl.forEach((l, k) => {
      out.push(
        <PText key={`h${i}-${k}`} x={tx(c, cx)} y={top + (headH - (hl.length - 1) * headLh) / 2 + headSize * 0.36 + k * headLh} size={headSize} weight="bold" anchor={c.align ?? 'start'}>
          {l}
        </PText>,
      );
    });
    all.forEach((_, j) => {
      const lines = cells[j][i];
      const isFoot = !!foot && j === body.length;
      lines.forEach((l, k) => {
        out.push(
          <PText
            key={`c${i}-${j}-${k}`}
            x={tx(c, cx)}
            y={tops[j] + (heights[j] - (lines.length - 1) * lh) / 2 + size * 0.36 + k * lh}
            size={size}
            anchor={c.align ?? 'start'}
            weight={isFoot ? 'bold' : 'normal'}
          >
            {l}
          </PText>,
        );
      });
    });
    cx += c.w;
  });
  all.forEach((_, j) => {
    const isFoot = !!foot && j === body.length;
    if (j > 0) out.push(<line key={`r${j}`} x1={x} x2={x + w} y1={tops[j]} y2={tops[j]} stroke={INK} strokeWidth={isFoot ? LW.thin : LW.hair} />);
  });
  out.push(
    <line key="headrule" x1={x} x2={x + w} y1={top + headH} y2={top + headH} stroke={INK} strokeWidth={LW.thin} />,
    <rect key="box" x={x} y={top} width={w} height={bottom - top} fill="none" stroke={INK} strokeWidth={LW.med} />,
  );
  return {
    node: <g key={title}>{out}</g>,
    height: bottom - y + 34,
    rows: body.map((_, j) => ({ y: tops[j], h: heights[j] })),
  };
}

export function stack(x: number, y: number, blocks: ((x: number, y: number) => Block)[]): ReactNode {
  let cy = y;
  return blocks.map((b, i) => {
    const r = b(x, cy);
    cy += r.height + 24;
    return <g key={i}>{r.node}</g>;
  });
}

/** A priced table with a subtotal row and a footnote about what the prices cover. */
export function costBlock(x: number, y: number, w: number, title: string, subtotalLabel: string, rows: CostRow[], footnote: string): Block {
  const cols: Col[] = [
    { title: 'Item', w: w - 520 },
    { title: 'Quantity', w: 170, align: 'end' },
    { title: 'Unit cost', w: 170, align: 'end' },
    { title: 'Est. cost', w: 180, align: 'end' },
  ];
  const t = table(x, y, title, cols, rows.map((r) => [r.item, r.qty, r.rate, formatUsd(r.cost)]), [
    subtotalLabel, '', '', formatUsd(rows.reduce((a, r) => a + r.cost, 0)),
  ]);
  const size = TXT.tiny;
  const lh = leading(size);
  const lines = wrapText(footnote, w, size);
  return {
    height: t.height + lines.length * lh,
    node: (
      <g>
        {t.node}
        {lines.map((l, i) => (
          <PText key={i} x={x} y={y + t.height - 14 + i * lh} size={size} color={INK_LIGHT}>{l}</PText>
        ))}
      </g>
    ),
  };
}

export function PlanView(props: {
  design: Design;
  scale: ScaleKey;
  bounds: { x0: number; y0: number; x1: number; y1: number };
  box: { x: number; y: number; w: number; h: number };
  children: ReactNode;
  gRef?: Ref<SVGGElement>;
}) {
  const origin = centerIn(props.bounds, props.box, props.scale);
  return (
    <DrawingView origin={origin} scale={props.scale} gRef={props.gRef}>
      {props.children}
    </DrawingView>
  );
}

/**
 * A dense table for long lists. Rows that do not fit in `maxHeight` continue in another
 * column to the right, under a repeated heading. Cells stay on one line, so size the
 * columns for the longest entry.
 */
export function flowTable(
  x: number,
  y: number,
  title: string,
  cols: Col[],
  body: string[][],
  o: { maxHeight: number; gap?: number; size?: number; foot?: string[] },
): Block & { width: number } {
  const size = o.size ?? TXT.tiny;
  const pitch = leading(size) + 4;
  const headH = 28;
  const gap = o.gap ?? 30;
  const pad = 7;
  const w = cols.reduce((s, c) => s + c.w, 0);
  const rows = o.foot ? [...body, o.foot] : body;
  const top = y + 12;
  const fits = Math.max(1, Math.floor((o.maxHeight - 12 - headH) / pitch));
  // Columns are filled evenly, so the last one is not left nearly empty.
  const perCol = Math.ceil(rows.length / Math.max(1, Math.ceil(rows.length / fits)));
  const chunks: string[][][] = [];
  for (let i = 0; i < rows.length; i += perCol) chunks.push(rows.slice(i, i + perCol));
  if (!chunks.length) chunks.push([]);
  const out: ReactNode[] = [<PText key="t" x={x} y={y} size={TXT.label} weight="bold" spacing={0.6}>{title.toUpperCase()}</PText>];
  chunks.forEach((chunk, k) => {
    const x0 = x + k * (w + gap);
    const h = headH + chunk.length * pitch;
    const parts: ReactNode[] = [<rect key="head" x={x0} y={top} width={w} height={headH} fill="#e9e9e9" />];
    chunk.forEach((_, j) => {
      if (j % 2 === 1) parts.push(<rect key={`z${j}`} x={x0} y={top + headH + j * pitch} width={w} height={pitch} fill={ZEBRA} />);
    });
    let cx = x0;
    cols.forEach((c, i) => {
      const tx = c.align === 'middle' ? cx + c.w / 2 : c.align === 'end' ? cx + c.w - pad : cx + pad;
      if (i > 0) parts.push(<line key={`v${i}`} x1={cx} x2={cx} y1={top} y2={top + h} stroke={INK} strokeWidth={LW.hair} />);
      parts.push(<PText key={`h${i}`} x={tx} y={top + headH / 2 + TXT.tiny * 0.36} size={TXT.tiny} weight="bold" anchor={c.align ?? 'start'}>{c.title.toUpperCase()}</PText>);
      chunk.forEach((r, j) => {
        const last = o.foot && k === chunks.length - 1 && j === chunk.length - 1;
        if (r[i]) {
          parts.push(
            <PText key={`c${i}-${j}`} x={tx} y={top + headH + j * pitch + pitch / 2 + size * 0.36} size={size} anchor={c.align ?? 'start'} weight={last ? 'bold' : 'normal'}>
              {r[i]}
            </PText>,
          );
        }
      });
      cx += c.w;
    });
    parts.push(
      <line key="headrule" x1={x0} x2={x0 + w} y1={top + headH} y2={top + headH} stroke={INK} strokeWidth={LW.fine} />,
      <rect key="box" x={x0} y={top} width={w} height={h} fill="none" stroke={INK} strokeWidth={LW.thin} />,
    );
    out.push(<g key={k}>{parts}</g>);
  });
  const tallest = Math.max(...chunks.map((c) => c.length));
  return { node: <g key={title}>{out}</g>, height: 12 + headH + tallest * pitch + 26, width: chunks.length * (w + gap) - gap };
}

/** The note every framing sheet carries. */
export const FRAMING_DISCLAIMER =
  'PRELIMINARY FRAMING FOR BUDGETING AND REVIEW. NOT FOR CONSTRUCTION. EVERY MEMBER SIZE, SPAN, CONNECTION, AND THE LATERAL BRACING IS AN ASSUMPTION TO BE DESIGNED AND SEALED BY A LICENSED ENGINEER.';
