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
  seen: boolean;      // opened at least once; an unseen document shows as unread
  group: string | null; // group id; null for a document outside every group (groups are archived; see Group)
  tab: string | null; // the tab it was pasted into, kept after the tab shows something else; null for none
  rank: number;       // sort key, highest first; a new document gets Date.now()
  text: string;
};

export type DocMeta = Omit<Doc, 'text'>;

// A group sits among the ungrouped documents by its rank, like a tab group in a browser.
// Archived: the page no longer shows groups, but the file and the API stay.
export type Group = { id: string; name: string; color: string; rank: number; collapsed: boolean };

// A tab is one document: a paste replaces it. `name` null follows the document's title.
export type Tab = { id: string; name: string | null; docId: string | null };

// READER_DATA moves documents, tabs, settings and groups elsewhere, so a test server never writes the user's own.
export function createStore(root: string) {
  const data = process.env.READER_DATA || join(root, 'data');
  const dir = join(data, 'docs');
  const settingsFile = join(data, 'settings.json');
  const groupsFile = join(data, 'groups.json');
  const tabsFile = join(data, 'tabs.json');
  const path = (id: string) => join(dir, `${id.replace(/[^a-z0-9-]/gi, '')}.json`);
  const meta = ({ text: _text, ...rest }: Doc): DocMeta => rest;

  async function list(): Promise<DocMeta[]> {
    await mkdir(dir, { recursive: true });
    const docs: DocMeta[] = [];
    for (const f of await readdir(dir)) {
      if (f.endsWith('.json')) docs.push(meta(withDefaults(JSON.parse(await readFile(join(dir, f), 'utf8')))));
    }
    return docs.sort((a, b) => b.rank - a.rank);
  }

  const get = async (id: string): Promise<Doc> => withDefaults(JSON.parse(await readFile(path(id), 'utf8')));

  async function create({ text, format = 'md', title, group = null, tab = null }: { text: string; format?: DocFormat; title?: string; group?: string | null; tab?: string | null }) {
    const doc: Doc = {
      id: `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`,
      title: title || titleFrom(text),
      format,
      createdAt: Date.now(),
      position: 0,
      progress: 0,
      seen: false,
      group,
      tab,
      rank: Date.now(),
      text,
    };
    await mkdir(dir, { recursive: true });
    await writeFile(path(doc.id), JSON.stringify(doc));
    return meta(doc);
  }

  async function update(id: string, changes: Partial<Pick<Doc, 'title' | 'position' | 'progress' | 'seen' | 'group' | 'tab' | 'rank'>>) {
    const doc = await get(id);
    for (const key of ['title', 'position', 'progress', 'seen', 'group', 'tab', 'rank'] as const) {
      if (changes[key] !== undefined) (doc as Record<string, unknown>)[key] = changes[key];
    }
    await writeFile(path(id), JSON.stringify(doc));
    return meta(doc);
  }

  const remove = (id: string) => unlink(path(id));

  async function getGroups(): Promise<Group[]> {
    try { return JSON.parse(await readFile(groupsFile, 'utf8')); } catch { return []; }
  }

  // The page sends the whole list; groups are few and change one click at a time.
  async function saveGroups(groups: Group[]) {
    await mkdir(data, { recursive: true });
    await writeFile(groupsFile, JSON.stringify(groups, null, 2));
    return groups;
  }

  // null until the first save, so the page knows to open one empty tab.
  async function getTabs(): Promise<Tab[] | null> {
    try { return JSON.parse(await readFile(tabsFile, 'utf8')); } catch { return null; }
  }

  // Only the known fields are kept, so the colour older tabs carried drops on the next save.
  async function saveTabs(tabs: Tab[]) {
    const clean = tabs.map(({ id, name, docId }) => ({ id, name, docId }));
    await mkdir(data, { recursive: true });
    await writeFile(tabsFile, JSON.stringify(clean, null, 2));
    return clean;
  }

  async function getSettings(): Promise<Record<string, unknown>> {
    try { return JSON.parse(await readFile(settingsFile, 'utf8')); } catch { return {}; }
  }

  async function updateSettings(changes: Record<string, unknown>) {
    const settings = { ...(await getSettings()), ...changes };
    await mkdir(data, { recursive: true });
    await writeFile(settingsFile, JSON.stringify(settings, null, 2));
    return settings;
  }

  return { list, get, create, update, remove, getSettings, updateSettings, getGroups, saveGroups, getTabs, saveTabs };
}

// Documents saved before groups, tabs or `seen` existed; one already started counts as seen. The first tabs take
// their groups' ids, so a document from before tabs belongs to the tab its group became.
const withDefaults = (doc: Doc): Doc => ({
  ...doc, group: doc.group ?? null, tab: doc.tab !== undefined ? doc.tab : doc.group ?? null,
  rank: doc.rank ?? doc.createdAt, seen: doc.seen ?? doc.progress > 0,
});

// First heading, else the first 6 words.
function titleFrom(text: string) {
  const heading = text.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m);
  if (heading) return clean(heading[1]).slice(0, 80);
  return clean(text).split(/\s+/).filter(Boolean).slice(0, 6).join(' ') || 'Untitled';
}

const clean = (s: string) => s.replace(/[`*_[\]()>#]/g, '').replace(/\s+/g, ' ').trim();
