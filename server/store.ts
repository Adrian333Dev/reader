// Documents as JSON files in data/docs/, settings in data/settings.json.
import { readFile, writeFile, readdir, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export type DocFormat = 'md' | 'txt';

export type Doc = {
  id: string;
  title: string;
  format: DocFormat;
  createdAt: number;
  position: number;   // sentence index where reading stopped
  progress: number;   // 0..1
  text: string;
};

export type DocMeta = Omit<Doc, 'text'>;

export function createStore(root: string) {
  const dir = join(root, 'data/docs');
  const settingsFile = join(root, 'data/settings.json');
  const path = (id: string) => join(dir, `${id.replace(/[^a-z0-9-]/gi, '')}.json`);
  const meta = ({ text: _text, ...rest }: Doc): DocMeta => rest;

  async function list(): Promise<DocMeta[]> {
    await mkdir(dir, { recursive: true });
    const docs: DocMeta[] = [];
    for (const f of await readdir(dir)) {
      if (f.endsWith('.json')) docs.push(meta(JSON.parse(await readFile(join(dir, f), 'utf8'))));
    }
    return docs.sort((a, b) => b.createdAt - a.createdAt);
  }

  const get = async (id: string): Promise<Doc> => JSON.parse(await readFile(path(id), 'utf8'));

  async function create({ text, format = 'md', title }: { text: string; format?: DocFormat; title?: string }) {
    const doc: Doc = {
      id: `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`,
      title: title || titleFrom(text),
      format,
      createdAt: Date.now(),
      position: 0,
      progress: 0,
      text,
    };
    await mkdir(dir, { recursive: true });
    await writeFile(path(doc.id), JSON.stringify(doc));
    return meta(doc);
  }

  async function update(id: string, changes: Partial<Pick<Doc, 'title' | 'position' | 'progress'>>) {
    const doc = await get(id);
    if (changes.title !== undefined) doc.title = changes.title;
    if (changes.position !== undefined) doc.position = changes.position;
    if (changes.progress !== undefined) doc.progress = changes.progress;
    await writeFile(path(id), JSON.stringify(doc));
    return meta(doc);
  }

  const remove = (id: string) => unlink(path(id));

  async function getSettings(): Promise<Record<string, unknown>> {
    try { return JSON.parse(await readFile(settingsFile, 'utf8')); } catch { return {}; }
  }

  async function updateSettings(changes: Record<string, unknown>) {
    const settings = { ...(await getSettings()), ...changes };
    await mkdir(join(root, 'data'), { recursive: true });
    await writeFile(settingsFile, JSON.stringify(settings, null, 2));
    return settings;
  }

  return { list, get, create, update, remove, getSettings, updateSettings };
}

// First heading, else the first 6 words.
function titleFrom(text: string) {
  const heading = text.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m);
  if (heading) return clean(heading[1]).slice(0, 80);
  return clean(text).split(/\s+/).filter(Boolean).slice(0, 6).join(' ') || 'Untitled';
}

const clean = (s: string) => s.replace(/[`*_[\]()>#]/g, '').replace(/\s+/g, ' ').trim();
