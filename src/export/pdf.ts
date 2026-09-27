import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Design } from '../model/schema';
import { SHEET_COMPONENTS } from '../views/sheets/Sheets';
import { SHEETS } from '../views/sheets/sheetList';

/** Render every sheet at full size and write a 36" x 24" PDF set. */
export async function exportPdf(design: Design, progress: (msg: string) => void) {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'in', format: [36, 24] });
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:3600px;height:2400px;';
  document.body.appendChild(host);
  try {
    for (const [i, sheet] of SHEETS.entries()) {
      progress(`Sheet ${i + 1} of ${SHEETS.length}…`);
      // Render with the client renderer rather than renderToStaticMarkup: during development,
      // hot reload swaps edited components only for client roots, so a server render would
      // export the drawings as they were at page load.
      const root = createRoot(host);
      try {
        flushSync(() => root.render(createElement(SHEET_COMPONENTS[sheet.id], { design })));
        const svg = host.querySelector('svg');
        if (!svg) continue;
        if (i > 0) doc.addPage([36, 24], 'landscape');
        await svg2pdf(svg, doc, { x: 0, y: 0, width: 36, height: 24 });
      } finally {
        root.unmount();
      }
      // Let the UI breathe between sheets.
      await new Promise((r) => setTimeout(r, 0));
    }
    const rev = design.meta.revisions.at(-1);
    const name = `${design.meta.project.replace(/\W+/g, '-')}-rev${rev?.rev ?? 0}.pdf`;
    doc.setProperties({ title: `${design.meta.project} drawings`, subject: design.meta.subtitle });
    doc.save(name);
  } finally {
    host.remove();
  }
}
