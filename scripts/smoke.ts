import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium, type Page } from 'playwright';
import { SHEET_IDS } from '../src/views/sheets/sheetList';

/**
 * End-to-end smoke test of the editor against a scratch copy of the design:
 * select and drag a wall, undo, save, pick up an on-disk edit, add a window, open 3D, export a PDF.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lbj-smoke-'));
const file = path.join(dir, 'house.json');
fs.copyFileSync('design/house.json', file);
process.env.LBJ_DESIGN = file;

const server = await createServer({ server: { port: 5198, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5198/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors: string[] = [];
const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
const step = (s: string) => console.log(`✓ ${s}`);

async function dragBy(page: Page, selector: string, dx: number, dy: number) {
  const box = await page.locator(selector).boundingBox();
  assert.ok(box, `no box for ${selector}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, y + (dy * i) / 8);
  await page.mouse.up();
}

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`${url}?sheet=A-101`);
  await page.waitForSelector('[data-hit="wall:P2"]');
  step('floor plan loads with editing overlay');

  // Garage walls drag like house walls, and the garage room follows.
  await dragBy(page, '[data-hit="wall:G2"]', -40, 0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Saved' }).waitFor();
  const g2 = read().walls.find((w: { id: string }) => w.id === 'G2');
  assert.ok(g2.start.x < -165, `G2 should move west, got ${g2.start.x}`);
  assert.equal(read().walls.find((w: { id: string }) => w.id === 'G1').start.x, g2.start.x);
  assert.ok(read().rooms.find((r: { id: string }) => r.id === 'r-garage').polygon.some((p: { x: number }) => p.x === g2.start.x));
  await page.keyboard.press('Meta+z');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Saved' }).waitFor();
  assert.equal(read().walls.find((w: { id: string }) => w.id === 'G2').start.x, -165);
  step(`garage wall drags (G2 to x=${g2.start.x}) and undoes`);

  // Zoom in so drags are meaningful.
  for (let i = 0; i < 4; i++) await page.getByTitle('Zoom in').click();
  await page.locator('[data-hit="wall:P2"]').click();
  await page.getByRole('heading', { name: /Wall P2/ }).waitFor();
  step('clicking a wall selects it');

  await dragBy(page, '[data-hit="wall:P2"]', 0, 60);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Saved' }).waitFor();
  const moved = read().walls.find((w: { id: string }) => w.id === 'P2');
  assert.ok(moved.start.y > 132, `P2 should move south, got ${moved.start.y}`);
  const bed = read().rooms.find((r: { id: string }) => r.id === 'r-bed');
  assert.ok(bed.polygon.some((p: { y: number }) => p.y === moved.start.y), 'bedroom corner follows the wall');
  step(`dragging moves the wall (P2 now at y=${moved.start.y}) and saving writes house.json`);

  await page.keyboard.press('Meta+z');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Saved' }).waitFor();
  assert.equal(read().walls.find((w: { id: string }) => w.id === 'P2').start.y, 132);
  step('undo restores the wall');

  const edited = read();
  edited.meta.project = 'Smoke Test Cabin';
  fs.writeFileSync(file, JSON.stringify(edited, null, 2));
  await page.locator('.topbar .title', { hasText: 'Smoke Test Cabin' }).waitFor({ timeout: 10000 });
  step('on-disk edits appear live');

  await page.keyboard.press('Escape');
  await page.keyboard.press('0');
  await page.keyboard.press('n');
  const we = await page.locator('[data-hit="wall:WE"]').boundingBox();
  assert.ok(we);
  await page.mouse.click(we.x + we.width / 2, we.y + we.height * 0.2);
  await page.getByRole('heading', { name: /Window W9/ }).waitFor();
  step('window tool adds W9 to the east wall');

  const histories = fs.readdirSync(path.join(dir, 'history'));
  assert.ok(histories.length >= 3, 'history snapshots are written');
  step(`${histories.length} history snapshots written`);

  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForSelector('canvas');
  await page.waitForTimeout(1500);
  step('3D view renders');

  await page.getByRole('button', { name: 'Sheets', exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    page.getByRole('button', { name: 'Export PDF' }).click(),
  ]);
  const pdf = path.join(dir, download.suggestedFilename());
  await download.saveAs(pdf);
  const size = fs.statSync(pdf).size;
  assert.ok(size > 50_000, `PDF too small (${size} bytes)`);
  const bytes = fs.readFileSync(pdf);
  assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
  const pages = (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  assert.equal(pages, SHEET_IDS.length, `expected ${SHEET_IDS.length} sheets, got ${pages}`);
  step(`PDF export (${pages} sheets, ${Math.round(size / 1024)} KB, ${download.suggestedFilename()})`);
  fs.copyFileSync(pdf, path.resolve('snapshots', 'drawings.pdf'));
} finally {
  await browser.close();
  await server.close();
}

const relevant = errors.filter((e) => !/GPU stall|WebGL|GL_/.test(e));
if (relevant.length) {
  console.error('✗ Console errors:\n  ' + relevant.join('\n  '));
  process.exit(1);
}
console.log('Smoke test passed.');
