import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { SHEET_IDS } from '../src/views/sheets/sheetList';

/**
 * Renders every sheet and a few 3D views to snapshots/*.png so changes can be reviewed
 * without opening the app. Fails if the page logs errors.
 *   npm run snapshot            all views
 *   npm run snapshot A-101 3d   only the named views
 *   npm run snapshot 3d-framing the framing model in 3D, bare and sheathed
 */
/** Software rendering can take a while to settle after a long run of sheets. */
const SCENE_TIMEOUT = 120_000;
const only = process.argv.slice(2);
const want = (name: string) => only.length === 0 || only.includes(name);

const outDir = path.resolve('snapshots');
fs.mkdirSync(outDir, { recursive: true });

const server = await createServer({ server: { port: 5199, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5199/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors: string[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1100 }, deviceScaleFactor: 1 });
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  for (const sheet of SHEET_IDS) {
    if (!want(sheet)) continue;
    await page.goto(`${url}?sheet=${sheet}&mode=sheets`);
    await page.waitForSelector('svg.sheet');
    await page.waitForTimeout(300);
    // Hide app chrome so the sheet fills the shot.
    await page.locator('svg.sheet').screenshot({ path: path.join(outDir, `${sheet}.png`) });
    console.log(`✓ ${sheet}`);
  }

  if (want('3d')) {
    await page.goto(`${url}?mode=3d`);
    await page.waitForSelector('canvas');
    await page.waitForTimeout(2000);
    for (const preset of ['Lake view', 'Road view', 'Aerial', 'Site', 'Interior']) {
      const button = page.getByRole('button', { name: preset, exact: true });
      if (!(await button.count())) continue;
      await button.click();
      await page.waitForTimeout(2500);
      const file = `3d-${preset.toLowerCase().replace(/\s+/g, '-')}.png`;
      await page.locator('.scene').screenshot({ path: path.join(outDir, file), timeout: SCENE_TIMEOUT });
      console.log(`✓ ${file}`);
    }
  }

  if (want('3d-framing')) {
    const shots = [
      { file: '3d-framing.png', query: '?mode=3d&display=framing' },
      { file: '3d-framing-sheathed.png', query: '?mode=3d&display=framing&sheathing=1' },
    ];
    for (const { file, query } of shots) {
      await page.goto(`${url}${query}`);
      await page.waitForSelector('canvas');
      await page.waitForTimeout(2000);
      await page.getByRole('button', { name: 'Aerial', exact: true }).click();
      await page.waitForTimeout(2500);
      await page.locator('.scene').screenshot({ path: path.join(outDir, file), timeout: SCENE_TIMEOUT });
      console.log(`✓ ${file}`);
    }
  }
} finally {
  await browser.close();
  await server.close();
}

const relevant = errors.filter((e) => !/GPU stall|WebGL|THREE.WebGLRenderer|GL_/.test(e));
if (relevant.length) {
  console.error('✗ Console errors:');
  for (const e of relevant) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`Snapshots written to ${path.relative(process.cwd(), outDir)}/`);
