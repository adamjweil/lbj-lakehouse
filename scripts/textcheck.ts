import { createServer } from 'vite';
import { chromium } from 'playwright';
import { SHEET_IDS } from '../src/views/sheets/sheetList';

/**
 * Finds text that is hard to read on the sheets: text that overlaps other text, text that
 * runs across a table rule, text smaller than the minimum, and text off the sheet.
 *   npm run textcheck            every sheet
 *   npm run textcheck S-601      only the named sheets
 *   npm run textcheck -- --all   list every finding, not the first few
 * It exits 0 either way; read the findings and fix the ones that matter.
 */
const args = process.argv.slice(2);
const all = args.includes('--all');
const only = args.filter((a) => !a.startsWith('--'));
const sheets = SHEET_IDS.filter((id) => !only.length || only.includes(id));
/** Smallest text allowed, in paper units (1/100"). */
const MIN_SIZE = 8;

type Finding = { kind: string; text: string; with?: string; x: number; y: number; size?: number };

const server = await createServer({ server: { port: 5196, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5196/';
const browser = await chromium.launch();
let total = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1200 }, deviceScaleFactor: 1 });
  // The script runner names inner functions with a helper the page does not have.
  await page.addInitScript('window.__name = (f) => f');
  for (const sheet of sheets) {
    await page.goto(`${url}?sheet=${sheet}&mode=sheets`);
    await page.waitForSelector('svg.sheet');
    await page.waitForTimeout(400);
    const findings: Finding[] = await page.evaluate((minSize) => {
      const svg = document.querySelector('svg.sheet') as SVGSVGElement;
      const vb = svg.viewBox.baseVal;
      const box = svg.getBoundingClientRect();
      const k = vb.width / box.width;
      const toSheet = (r: DOMRect) => ({ x0: vb.x + (r.left - box.left) * k, y0: vb.y + (r.top - box.top) * k, x1: vb.x + (r.right - box.left) * k, y1: vb.y + (r.bottom - box.top) * k });
      const texts = [...svg.querySelectorAll('text')]
        .map((el) => {
          const r = toSheet(el.getBoundingClientRect());
          const m = (el as SVGTextElement).getScreenCTM();
          const scale = m ? Math.hypot(m.a, m.b) * k : 1;
          const rotated = m ? Math.abs(m.b) > 1e-3 : false;
          return { el, r, text: (el.textContent ?? '').trim(), size: parseFloat(el.getAttribute('font-size') ?? '0') * scale, rotated, paper: !el.closest('g[transform*="scale"]') };
        })
        .filter((t) => t.text.length > 0);
      const out: { kind: string; text: string; with?: string; x: number; y: number; size?: number }[] = [];
      const area = (r: { x0: number; y0: number; x1: number; y1: number }) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
      for (let i = 0; i < texts.length; i++) {
        const a = texts[i];
        if (a.size < minSize - 0.05) out.push({ kind: 'small', text: a.text, x: a.r.x0, y: a.r.y0, size: a.size });
        if (a.r.x0 < 50 || a.r.x1 > 3550 || a.r.y0 < 50 || a.r.y1 > 2350) out.push({ kind: 'off-sheet', text: a.text, x: a.r.x0, y: a.r.y0 });
        for (let j = i + 1; j < texts.length; j++) {
          const b = texts[j];
          // The glyphs fill about the middle of the line box, so shrink the boxes before comparing.
          const sa = { x0: a.r.x0 + 1, x1: a.r.x1 - 1, y0: a.r.y0 + (a.r.y1 - a.r.y0) * 0.22, y1: a.r.y1 - (a.r.y1 - a.r.y0) * 0.22 };
          const sb = { x0: b.r.x0 + 1, x1: b.r.x1 - 1, y0: b.r.y0 + (b.r.y1 - b.r.y0) * 0.22, y1: b.r.y1 - (b.r.y1 - b.r.y0) * 0.22 };
          const hit = { x0: Math.max(sa.x0, sb.x0), y0: Math.max(sa.y0, sb.y0), x1: Math.min(sa.x1, sb.x1), y1: Math.min(sa.y1, sb.y1) };
          if (area(hit) > 0.08 * Math.min(area(sa), area(sb)) && area(hit) > 4) out.push({ kind: 'overlap', text: a.text, with: b.text, x: hit.x0, y: hit.y0 });
        }
      }
      // Table rules: plumb lines drawn on the paper, not in a scaled drawing.
      const rules = [...svg.querySelectorAll('line')]
        .filter((l) => !l.closest('g[transform*="scale"]'))
        .map((l) => toSheet(l.getBoundingClientRect()))
        .filter((r) => r.x1 - r.x0 < 1 && r.y1 - r.y0 > 10);
      for (const t of texts) {
        if (!t.paper || t.rotated) continue;
        const mid = (t.r.y0 + t.r.y1) / 2;
        const rule = rules.find((r) => r.x0 > t.r.x0 + 2 && r.x0 < t.r.x1 - 2 && mid > r.y0 && mid < r.y1);
        if (rule) out.push({ kind: 'crosses-rule', text: t.text, x: t.r.x0, y: t.r.y0 });
      }
      return out;
    }, MIN_SIZE);
    total += findings.length;
    const kinds = new Map<string, number>();
    for (const f of findings) kinds.set(f.kind, (kinds.get(f.kind) ?? 0) + 1);
    console.log(`${findings.length ? '!' : '✓'} ${sheet}  ${[...kinds].map(([k, n]) => `${n} ${k}`).join(', ') || 'clean'}`);
    const shown = all ? findings : findings.slice(0, 8);
    for (const f of shown) {
      const where = `(${Math.round(f.x)}, ${Math.round(f.y)})`;
      const clip = (s: string) => (s.length > 44 ? `${s.slice(0, 44)}…` : s);
      if (f.kind === 'overlap') console.log(`    overlap ${where}: "${clip(f.text)}" and "${clip(f.with ?? '')}"`);
      else if (f.kind === 'small') console.log(`    small ${where}: ${f.size?.toFixed(1)} units, "${clip(f.text)}"`);
      else console.log(`    ${f.kind} ${where}: "${clip(f.text)}"`);
    }
    if (!all && findings.length > shown.length) console.log(`    … and ${findings.length - shown.length} more`);
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(`${total} finding(s) on ${sheets.length} sheet(s)`);
