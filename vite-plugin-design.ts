import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { parseDesignText } from './src/model/schema';
import { stringifyDesign } from './src/model/format';

// LBJ_DESIGN lets tests point the app at a scratch copy.
const DESIGN = path.resolve(process.env.LBJ_DESIGN ?? 'design/house.json');
const HISTORY = path.join(path.dirname(DESIGN), 'history');

function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function snapshot(text: string, source: 'app' | 'disk') {
  fs.mkdirSync(HISTORY, { recursive: true });
  const files = fs.readdirSync(HISTORY).filter((f) => f.endsWith('.json')).sort();
  const last = files.at(-1);
  if (last && fs.readFileSync(path.join(HISTORY, last), 'utf8') === text) return;
  fs.writeFileSync(path.join(HISTORY, `house-${stamp()}-${source}.json`), text);
}

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/**
 * Serves design/house.json to the app, saves edits back to it, snapshots every version
 * into design/history/, and pushes on-disk edits (e.g. from Claude) to the open page.
 */
export function designPlugin(): Plugin {
  let lastWritten = '';
  return {
    name: 'lbj-design',
    configureServer(server) {
      if (fs.existsSync(DESIGN)) snapshot(fs.readFileSync(DESIGN, 'utf8'), 'disk');
      server.watcher.add(DESIGN);
      server.watcher.on('change', (file) => {
        if (path.resolve(file) !== DESIGN) return;
        const text = fs.readFileSync(DESIGN, 'utf8');
        if (text === lastWritten) return;
        if (parseDesignText(text).ok) snapshot(text, 'disk');
        server.ws.send({ type: 'custom', event: 'design:changed', data: { text } });
      });

      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/api/')) return next();
        const json = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        try {
          if (url === '/api/design' && req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json');
            res.end(fs.readFileSync(DESIGN, 'utf8'));
            return;
          }
          if (url === '/api/design' && req.method === 'PUT') {
            const r = parseDesignText(await readBody(req));
            if (!r.ok) return json(400, { errors: r.errors });
            const text = stringifyDesign(r.design);
            lastWritten = text;
            fs.writeFileSync(DESIGN, text);
            snapshot(text, 'app');
            return json(200, { ok: true, savedAt: new Date().toISOString() });
          }
          if (url === '/api/history' && req.method === 'GET') {
            fs.mkdirSync(HISTORY, { recursive: true });
            const files = fs
              .readdirSync(HISTORY)
              .filter((f) => f.endsWith('.json'))
              .sort()
              .reverse()
              .slice(0, 200)
              .map((name) => ({ name, size: fs.statSync(path.join(HISTORY, name)).size }));
            return json(200, files);
          }
          const m = url.match(/^\/api\/history\/([\w.-]+\.json)$/);
          if (m && req.method === 'GET') {
            const file = path.join(HISTORY, path.basename(m[1]));
            if (!fs.existsSync(file)) return json(404, { error: 'Not found' });
            res.setHeader('Content-Type', 'application/json');
            res.end(fs.readFileSync(file, 'utf8'));
            return;
          }
          json(404, { error: 'Unknown endpoint' });
        } catch (e) {
          json(500, { error: (e as Error).message });
        }
      });
    },
  };
}
