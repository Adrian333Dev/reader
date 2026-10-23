// Documents as JSON files in data/docs/, settings in data/settings.json, each window's tabs in data/workspaces/.
import { readFile, writeFile, readdir, unlink, mkdir, stat, utimes } from 'node:fs/promises';
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

// A workspace is one window's tabs in order, and the tab it shows. The window's address names it (?w=<name>); a bare
// address is given one (claimWorkspace). Both fields are null until the first save, so the page opens one empty tab.
export type Workspace = { tabs: Tab[] | null; activeTab: string | null };

// The name becomes a file name, so only these are accepted.
export const isWorkspaceName = (name: string) => /^[a-z0-9][a-z0-9_-]{0,39}$/i.test(name);

// A workspace nobody opened, saved or read in for this long is deleted with its documents.
export const WORKSPACE_IDLE_MS = 7 * 24 * 60 * 60 * 1000;

// A workspace is open in a window while that page has pinged within this time. Pages ping every 20 s, and a hidden
// tab's timers can slow to once a minute, so it is generous. Kept in memory: a server restart frees every workspace.
export const WORKSPACE_OPEN_MS = 2 * 60 * 1000;

// READER_DATA moves documents, tabs, settings and groups elsewhere, so a test server never writes the user's own.
export function createStore(root: string) {
  const data = process.env.READER_DATA || join(root, 'data');
  const dir = join(data, 'docs');
  const settingsFile = join(data, 'settings.json');
  const groupsFile = join(data, 'groups.json');
  const workspaceDir = join(data, 'workspaces');
  const workspaceFile = (name: string) => join(workspaceDir, `${name}.json`);
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

  async function readWorkspace(name: string): Promise<Workspace> {
    try {
      const saved = JSON.parse(await readFile(workspaceFile(name), 'utf8'));
      return { tabs: saved.tabs ?? null, activeTab: saved.activeTab ?? null };
    } catch {
      return { tabs: null, activeTab: null };
    }
  }

  // Which workspaces have a window open: the time each page last said so.
  const pinged = new Map<string, number>();
  const isOpen = (name: string, now: number) => now - (pinged.get(name) ?? -Infinity) < WORKSPACE_OPEN_MS;
  const pingWorkspace = (name: string, now = Date.now()) => { pinged.set(name, now); };
  const releaseWorkspace = (name: string) => { pinged.delete(name); };

  // Opening a workspace counts as using it, which keeps it from expiring.
  async function getWorkspace(name: string, now = Date.now()) {
    pingWorkspace(name, now);
    const workspace = await readWorkspace(name);
    await utimes(workspaceFile(name), new Date(now), new Date(now)).catch(() => {});
    return workspace;
  }

  // Claims and saves run one after the other. The page sends the tabs and the current tab in quick succession and each
  // save reads the file first, so two at once would lose one; two windows opening at once would claim the same one.
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(job: () => Promise<T>) {
    const run = queue.then(job);
    queue = run.catch(() => {});
    return run;
  }

  // The name for a window that has none: the workspace used most recently that no window has open, so a closed window
  // comes back as it was, else a new one.
  function claimWorkspace(now = Date.now()) {
    return serial(async () => {
      const files = (await readdir(workspaceDir).catch(() => [])).filter(f => f.endsWith('.json'));
      const names = files.map(f => f.replace(/\.json$/, '')).filter(isWorkspaceName);
      let best: { name: string; time: number } | undefined;
      for (const name of names.filter(n => !isOpen(n, now))) {
        const { mtimeMs } = await stat(workspaceFile(name));
        if (!best || mtimeMs > best.time) best = { name, time: mtimeMs };
      }
      let name = best?.name ?? randomBytes(3).toString('hex');
      // A new name must not be one of the workspaces already open.
      while (!best && names.includes(name)) name = randomBytes(3).toString('hex');
      pingWorkspace(name, now);
      return name;
    });
  }

  // Only the known tab fields are kept, so the colour older tabs carried drops on the next save.
  function saveWorkspace(name: string, changes: { tabs?: Tab[]; activeTab?: string | null }) {
    return serial(async () => {
      const current = await readWorkspace(name);
      const next: Workspace = {
        tabs: Array.isArray(changes.tabs) ? changes.tabs.map(({ id, name, docId }) => ({ id, name, docId })) : current.tabs,
        activeTab: changes.activeTab !== undefined ? changes.activeTab : current.activeTab,
      };
      await mkdir(workspaceDir, { recursive: true });
      await writeFile(workspaceFile(name), JSON.stringify(next, null, 2));
      return next;
    });
  }

  // Deletes the workspaces idle for WORKSPACE_IDLE_MS, with the documents they own: the ones their tabs show, and
  // the ones once pasted into their tabs (a tab's undo list). A workspace's last use is the newest time among its
  // file (set by every open and save) and its documents (set when a reading position saves).
  async function cleanupWorkspaces(now = Date.now()) {
    const docs = await list();
    let deleted = 0;
    for (const file of await readdir(workspaceDir).catch(() => [])) {
      const name = file.replace(/\.json$/, '');
      // A workspace with a window open is in use, however long its tabs went unchanged.
      if (!file.endsWith('.json') || !isWorkspaceName(name) || isOpen(name, now)) continue;
      const { tabs } = await readWorkspace(name);
      const tabIds = new Set((tabs ?? []).map(t => t.id));
      const shown = new Set((tabs ?? []).map(t => t.docId));
      const owned = docs.filter(d => shown.has(d.id) || (d.tab !== null && tabIds.has(d.tab)));
      let lastUse = (await stat(workspaceFile(name))).mtimeMs;
      for (const d of owned) lastUse = Math.max(lastUse, (await stat(path(d.id)).catch(() => ({ mtimeMs: 0 }))).mtimeMs);
      if (now - lastUse <= WORKSPACE_IDLE_MS) continue;
      for (const d of owned) await unlink(path(d.id)).catch(() => {});
      await unlink(workspaceFile(name));
      deleted++;
    }
    return deleted;
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

  return { list, get, create, update, remove, getSettings, updateSettings, getGroups, saveGroups, getWorkspace, saveWorkspace, claimWorkspace, pingWorkspace, releaseWorkspace, cleanupWorkspaces };
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
