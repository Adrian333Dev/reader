// Reader app server: the built page, documents and settings API, cached synthesis. Starts HeadTTS too.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { createHeadTTS } from './providers/headtts.ts';
import { createSpeech } from './speech.ts';
import { createStore } from './store.ts';

const root = new URL('..', import.meta.url).pathname;
const dist = join(root, 'web/dist');
const PORT = Number(process.env.PORT) || 4400;

const provider = createHeadTTS(root);
const speech = createSpeech(root, provider);
const store = createStore(root);

const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json',
};

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : (body as Buffer));
}

async function readBody(req: IncomingMessage) {
  let s = '';
  for await (const chunk of req) s += chunk;
  return s ? JSON.parse(s) : {};
}

async function api(req: IncomingMessage, res: ServerResponse, path: string) {
  const m = path.match(/^\/api\/docs\/([\w-]+)$/);
  if (path === '/api/status') return send(res, 200, { tts: provider.status() });
  if (path === '/api/voices') return send(res, 200, { voices: provider.voices(), default: provider.defaultVoice });
  if (path === '/api/settings' && req.method === 'GET') return send(res, 200, await store.getSettings());
  if (path === '/api/settings' && req.method === 'PATCH') return send(res, 200, await store.updateSettings(await readBody(req)));
  if (path === '/api/docs' && req.method === 'GET') return send(res, 200, await store.list());
  if (path === '/api/docs' && req.method === 'POST') return send(res, 201, await store.create(await readBody(req)));
  if (m && req.method === 'GET') return send(res, 200, await store.get(m[1]));
  if (m && req.method === 'PATCH') return send(res, 200, await store.update(m[1], await readBody(req)));
  if (m && req.method === 'DELETE') { await store.remove(m[1]); return send(res, 204, ''); }
  if (path === '/api/synth' && req.method === 'POST') {
    const { text, voice } = await readBody(req);
    if (!text || text.length > 500) return send(res, 400, { error: 'text must be 1 to 500 characters' });
    return send(res, 200, await speech.synthesize(text, voice || provider.defaultVoice));
  }
  send(res, 404, { error: 'not found' });
}

// The built page; any unknown path gets index.html.
async function page(res: ServerResponse, path: string) {
  const file = join(dist, normalize(path).replace(/^(\.\.[/\\])+/, ''));
  try {
    return send(res, 200, await readFile(file), TYPES[extname(file)] ?? 'application/octet-stream');
  } catch {
    send(res, 200, await readFile(join(dist, 'index.html')), 'text/html');
  }
}

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  try {
    if (path.startsWith('/api/')) return await api(req, res, path);
    await page(res, path === '/' ? '/index.html' : path);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') return send(res, 404, { error: 'not found' });
    console.error(err);
    send(res, 500, { error: err.message });
  }
}).listen(PORT, 'localhost', () => {
  console.log(`Reader: http://localhost:${PORT}`);
  provider.start();
});
