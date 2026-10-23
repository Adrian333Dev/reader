// Workspaces: each window's tabs, kept apart, handed out to bare addresses, and deleted when idle. Runs on a
// temporary data folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, utimes, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, isWorkspaceName, WORKSPACE_IDLE_MS, WORKSPACE_OPEN_MS } from './store.ts';

const DAY = 24 * 60 * 60 * 1000;
const tab = (id: string, docId: string | null = null) => ({ id, name: null, docId });
const exists = (file: string) => access(file).then(() => true, () => false);

async function freshStore() {
  const data = await mkdtemp(join(tmpdir(), 'reader-store-'));
  process.env.READER_DATA = data;
  return { data, store: createStore('/unused') };
}

// Sets a file's last-use time to `ago` before now.
const age = (file: string, ago: number) => utimes(file, new Date(Date.now() - ago), new Date(Date.now() - ago));

test('a workspace name is a safe file name', () => {
  for (const ok of ['3fa9c1', 'vscode-a', 'A_1', 'x'.repeat(40)]) assert.ok(isWorkspaceName(ok), ok);
  for (const bad of ['', '../x', 'a/b', '.hidden', '-a', 'a b', 'x'.repeat(41)]) assert.ok(!isWorkspaceName(bad), bad);
});

test('two workspaces keep their own tabs, order and current tab', async () => {
  const { store } = await freshStore();
  await store.saveWorkspace('a', { tabs: [tab('1'), tab('2'), tab('3')] });
  await store.saveWorkspace('a', { activeTab: '3' });
  await store.saveWorkspace('b', { tabs: [tab('9')], activeTab: '9' });
  await store.saveWorkspace('a', { tabs: [tab('3'), tab('1'), tab('2')] });
  assert.deepEqual(await store.getWorkspace('a'), { tabs: [tab('3'), tab('1'), tab('2')], activeTab: '3' });
  assert.deepEqual(await store.getWorkspace('b'), { tabs: [tab('9')], activeTab: '9' });
  assert.deepEqual(await store.getWorkspace('new'), { tabs: null, activeTab: null });
});

test('quick saves of the tabs and the current tab keep both', async () => {
  const { store } = await freshStore();
  await Promise.all([store.saveWorkspace('a', { tabs: [tab('1'), tab('2')] }), store.saveWorkspace('a', { activeTab: '2' })]);
  assert.deepEqual(await store.getWorkspace('a'), { tabs: [tab('1'), tab('2')], activeTab: '2' });
});

test('a bare address gets a new workspace when none exists, and each window a different one', async () => {
  const { store } = await freshStore();
  const first = await store.claimWorkspace();
  assert.ok(isWorkspaceName(first));
  await store.saveWorkspace(first, { tabs: [tab('1')] });
  const second = await store.claimWorkspace();
  assert.notEqual(second, first);
});

test('two windows opening at the same moment get different workspaces', async () => {
  const { store } = await freshStore();
  const [a, b] = await Promise.all([store.claimWorkspace(), store.claimWorkspace()]);
  assert.notEqual(a, b);
});

test('a closed window gets its workspace back: the most recently used one nobody has open', async () => {
  const { data, store } = await freshStore();
  const t0 = Date.now();
  await store.saveWorkspace('older', { tabs: [tab('1')] });
  await store.saveWorkspace('newer', { tabs: [tab('2')] });
  await store.saveWorkspace('busy', { tabs: [tab('3')] });
  const file = (name: string) => join(data, 'workspaces', `${name}.json`);
  await age(file('older'), 3 * DAY);
  await age(file('newer'), 1 * DAY);
  await age(file('busy'), 0);
  store.pingWorkspace('busy', t0);
  assert.equal(await store.claimWorkspace(t0), 'newer');
  assert.equal(await store.claimWorkspace(t0), 'older');
  // Released at once, or free after WORKSPACE_OPEN_MS without a ping.
  store.releaseWorkspace('busy');
  assert.equal(await store.claimWorkspace(t0), 'busy');
  // All three were claimed or pinged at t0, so past WORKSPACE_OPEN_MS all are free again: the newest file wins.
  assert.equal(await store.claimWorkspace(t0 + WORKSPACE_OPEN_MS + 1), 'busy');
});

test('an idle workspace is deleted with its documents, and the rest stay', async () => {
  const { data, store } = await freshStore();
  const shown = await store.create({ text: 'shown', tab: 'old1' });
  const earlier = await store.create({ text: 'pasted earlier', tab: 'old1' });
  const recent = await store.create({ text: 'recent', tab: 'r1' });
  const reading = await store.create({ text: 'being read', tab: 'k1' });
  const open = await store.create({ text: 'open window', tab: 'o1' });
  await store.saveWorkspace('old', { tabs: [tab('old1', shown.id)] });
  await store.saveWorkspace('recent', { tabs: [tab('r1', recent.id)] });
  await store.saveWorkspace('reading', { tabs: [tab('k1', reading.id)] });
  await store.saveWorkspace('open', { tabs: [tab('o1', open.id)] });
  const file = (name: string) => join(data, 'workspaces', `${name}.json`);
  const doc = (id: string) => join(data, 'docs', `${id}.json`);
  const stale = WORKSPACE_IDLE_MS + DAY;
  for (const name of ['old', 'reading', 'open']) await age(file(name), stale);
  for (const id of [shown.id, earlier.id, recent.id, open.id]) await age(doc(id), stale);
  // "recent" was opened 6 days ago. "reading" was not opened for 8, but its document just saved a position.
  // "open" has a window open now.
  await age(file('recent'), WORKSPACE_IDLE_MS - DAY);
  store.pingWorkspace('open');

  assert.equal(await store.cleanupWorkspaces(), 1);
  assert.ok(!(await exists(file('old'))));
  assert.ok(!(await exists(doc(shown.id))) && !(await exists(doc(earlier.id))));
  for (const kept of [file('recent'), file('reading'), file('open'), doc(recent.id), doc(reading.id), doc(open.id)]) {
    assert.ok(await exists(kept), kept);
  }
});

test('opening a workspace keeps it from expiring', async () => {
  const { data, store } = await freshStore();
  await store.saveWorkspace('a', { tabs: [tab('1')] });
  const file = join(data, 'workspaces', 'a.json');
  await age(file, WORKSPACE_IDLE_MS + DAY);
  await store.getWorkspace('a', Date.now() - WORKSPACE_OPEN_MS * 2); // opened, and the window since gone
  assert.equal(await store.cleanupWorkspaces(), 0);
  assert.ok(await exists(file));
});
