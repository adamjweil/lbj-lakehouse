import type { ReactNode } from 'react';
import type { Design } from '../../model/schema';
import { DISCIPLINES, disciplineOf, SHEETS, type SheetId } from './sheetList';
import { INK, INK_LIGHT, LW, PText, SHEET_H, SHEET_W, TXT, wrapText } from '../draft/draft';

export const SHEET_LIST: readonly { id: SheetId; title: string }[] = SHEETS;

export const MARGIN = 50;
export const TB_W = 380;
/** Drawing area left of the title block. */
export const AREA = { x: MARGIN + 30, y: MARGIN + 30, w: SHEET_W - MARGIN * 2 - TB_W - 60, h: SHEET_H - MARGIN * 2 - 60 };

export function SheetFrame(props: {
  id: SheetId;
  design: Design;
  children: ReactNode;
  svgRef?: React.Ref<SVGSVGElement>;
  viewBox?: string;
  className?: string;
  onPointerDown?: React.PointerEventHandler<SVGSVGElement>;
  onPointerMove?: React.PointerEventHandler<SVGSVGElement>;
  onPointerUp?: React.PointerEventHandler<SVGSVGElement>;
  onWheel?: React.WheelEventHandler<SVGSVGElement>;
  onDoubleClick?: React.MouseEventHandler<SVGSVGElement>;
  style?: React.CSSProperties;
}) {
  const { design } = props;
  const meta = design.meta;
  const idx = SHEET_LIST.findIndex((s) => s.id === props.id);
  const sheet = SHEET_LIST[idx];
  const tx = SHEET_W - MARGIN - TB_W;
  const ty = MARGIN;
  const th = SHEET_H - MARGIN * 2;
  const rev = meta.revisions.at(-1);
  const pad = 22;
  const line = (y: number) => <line x1={tx} x2={tx + TB_W} y1={y} y2={y} stroke={INK} strokeWidth={LW.thin} />;
  // Revisions, newest first: as many as fit above the sheet index, each up to three lines.
  const REV_LEADING = 13;
  const INDEX_PITCH = 14;
  const groups = DISCIPLINES.map((g) => ({ ...g, sheets: SHEET_LIST.filter((q) => disciplineOf(q.id) === g.key) })).filter((g) => g.sheets.length);
  // The sheet index is grouped by discipline and grows upward from the date block.
  const indexHeight = 40 + groups.reduce((h, g) => h + (g.sheets.length + 1) * INDEX_PITCH + 6, 0);
  const indexTop = ty + th - 190 - Math.max(230, indexHeight + 6);
  const indexRows: { y: number; title: string; sheet?: (typeof SHEET_LIST)[number] }[] = [];
  let iy = indexTop + 46;
  for (const g of groups) {
    indexRows.push({ y: iy, title: g.title });
    iy += INDEX_PITCH;
    for (const sh of g.sheets) {
      indexRows.push({ y: iy, title: sh.title, sheet: sh });
      iy += INDEX_PITCH;
    }
    iy += 6;
  }
  const revRows: { rev: number; date: string; lines: string[]; y: number }[] = [];
  let ry = ty + 430;
  for (const rv of [...meta.revisions].reverse()) {
    const lines = wrapText(rv.note, TB_W - pad * 2 - 108, TXT.tiny).slice(0, 3);
    const h = lines.length * REV_LEADING + 9;
    if (ry + h > indexTop - 16 || revRows.length >= 10) break;
    revRows.push({ rev: rv.rev, date: rv.date, lines, y: ry });
    ry += h;
  }
  const titleLines = wrapText((sheet?.title ?? '').toUpperCase(), TB_W - pad * 2, TXT.sub).slice(0, 2);

  return (
    <svg
      ref={props.svgRef}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={props.viewBox ?? `0 0 ${SHEET_W} ${SHEET_H}`}
      width={props.viewBox ? '100%' : '36in'}
      height={props.viewBox ? '100%' : '24in'}
      className={props.className}
      style={props.style}
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onWheel={props.onWheel}
      onDoubleClick={props.onDoubleClick}
    >
      <rect x={0} y={0} width={SHEET_W} height={SHEET_H} fill="#ffffff" data-paper="1" />
      <rect x={MARGIN} y={MARGIN} width={SHEET_W - MARGIN * 2} height={SHEET_H - MARGIN * 2} fill="none" stroke={INK} strokeWidth={LW.heavy} />
      <rect x={tx} y={ty} width={TB_W} height={th} fill="none" stroke={INK} strokeWidth={LW.heavy} />

      {props.children}

      {/* Title block */}
      <g>
        <PText x={tx + pad} y={ty + 62} size={TXT.big} weight="bold" spacing={1}>{meta.project.toUpperCase()}</PText>
        <PText x={tx + pad} y={ty + 92} size={TXT.label}>{meta.subtitle}</PText>
        <PText x={tx + pad} y={ty + 114} size={TXT.label} color={INK_LIGHT}>{meta.address}</PText>
        {line(ty + 136)}
        <rect x={tx + pad} y={ty + 156} width={TB_W - pad * 2} height={64} fill="none" stroke={INK} strokeWidth={LW.med} />
        <PText x={tx + TB_W / 2} y={ty + 184} size={TXT.label} weight="bold" anchor="middle" spacing={1}>PRELIMINARY</PText>
        <PText x={tx + TB_W / 2} y={ty + 205} size={TXT.note} anchor="middle" spacing={0.6}>NOT FOR CONSTRUCTION</PText>
        {line(ty + 240)}
        <PText x={tx + pad} y={ty + 266} size={TXT.tiny} color={INK_LIGHT}>PREPARED FOR</PText>
        <PText x={tx + pad} y={ty + 287} size={TXT.label}>{meta.client || '—'}</PText>
        <PText x={tx + pad} y={ty + 318} size={TXT.tiny} color={INK_LIGHT}>DESIGN</PText>
        <PText x={tx + pad} y={ty + 339} size={TXT.label}>{meta.designer}</PText>
        {line(ty + 360)}
        <PText x={tx + pad} y={ty + 386} size={TXT.tiny} color={INK_LIGHT} spacing={0.5}>REVISIONS</PText>
        <PText x={tx + pad} y={ty + 408} size={TXT.tiny} weight="bold">NO.</PText>
        <PText x={tx + pad + 34} y={ty + 408} size={TXT.tiny} weight="bold">DATE</PText>
        <PText x={tx + pad + 108} y={ty + 408} size={TXT.tiny} weight="bold">DESCRIPTION</PText>
        {revRows.map((rv) => (
          <g key={rv.rev}>
            <PText x={tx + pad} y={rv.y} size={TXT.tiny}>{rv.rev}</PText>
            <PText x={tx + pad + 34} y={rv.y} size={TXT.tiny}>{rv.date}</PText>
            {rv.lines.map((l, j) => (
              <PText key={j} x={tx + pad + 108} y={rv.y + j * REV_LEADING} size={TXT.tiny}>{l}</PText>
            ))}
          </g>
        ))}

        {line(indexTop)}
        <PText x={tx + pad} y={indexTop + 24} size={TXT.tiny} color={INK_LIGHT}>SHEET INDEX</PText>
        {indexRows.map((row) =>
          row.sheet ? (
            <PText key={row.sheet.id} x={tx + pad + 12} y={row.y} size={TXT.tiny} weight={row.sheet.id === props.id ? 'bold' : 'normal'}>
              {`${row.sheet.id}   ${row.sheet.title.toUpperCase()}`}
            </PText>
          ) : (
            <PText key={row.title} x={tx + pad} y={row.y} size={TXT.tiny} color={INK_LIGHT} spacing={0.5}>{row.title.toUpperCase()}</PText>
          ),
        )}
        {line(ty + th - 190)}
        <PText x={tx + pad} y={ty + th - 164} size={TXT.tiny} color={INK_LIGHT}>DATE</PText>
        <PText x={tx + pad} y={ty + th - 144} size={TXT.note}>{rev?.date ?? ''}</PText>
        <PText x={tx + TB_W / 2} y={ty + th - 164} size={TXT.tiny} color={INK_LIGHT}>REVISION</PText>
        <PText x={tx + TB_W / 2} y={ty + th - 144} size={TXT.note}>{rev ? `${rev.rev}` : '—'}</PText>
        {line(ty + th - 128)}
        <PText x={tx + pad} y={ty + th - 104} size={TXT.tiny} color={INK_LIGHT}>SHEET TITLE</PText>
        {titleLines.map((l, i) => (
          <PText key={i} x={tx + pad} y={ty + th - 82 + i * 20} size={titleLines.length > 1 ? TXT.label : TXT.sub} weight="bold">{l}</PText>
        ))}
        <PText x={tx + pad} y={ty + th - 18} size={54} weight="bold">{props.id}</PText>
        <PText x={tx + TB_W - pad} y={ty + th - 20} size={TXT.note} anchor="end">{`${idx + 1} OF ${SHEET_LIST.length}`}</PText>
      </g>
    </svg>
  );
}
