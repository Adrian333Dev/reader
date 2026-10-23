// The "what to say" layer: which words are paths, and how a path is read. Run with `pnpm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isPath, speakLink, speakPath } from './spoken.ts';
import { createPronunciation } from './pronunciation.ts';

const root = new URL('..', import.meta.url).pathname;
const sites = JSON.parse(readFileSync(join(root, 'pronunciation/sites.json'), 'utf8'));
const { prepare } = await createPronunciation(root, mkdtempSync(join(tmpdir(), 'reader-spoken-')));

test('a path ends in a file extension, ends in a slash, or has slashes between words', () => {
  for (const p of ['main.ts', 'src/', 'src/components/ui/button.tsx', 'a/b/c', '.env', '~/.flow/wiki/'])
    assert.ok(isPath(p, false), p);
  assert.ok(isPath('web/src', true));
});

test('and/or, km/h, dates, versions and links stay words', () => {
  for (const w of ['and/or', 'km/h', '10/23', 'web/src', 'v1.3.0', 'e.g.', 'https://github.com/a/b.ts', 'www.example.com'])
    assert.ok(!isPath(w, false), w);
});

test('a path reads innermost first, a folder alone as "the … folder"', () => {
  assert.equal(speakPath('src/components/ui/button.tsx'), 'button dot TSX, in the UI folder, inside components, inside src');
  assert.equal(speakPath('src/'), 'the src folder');
  assert.equal(speakPath('main.ts'), 'main dot TS');
});

test('the slashes style reads the folders left to right', () => {
  assert.equal(speakPath('src/components/ui/button.tsx', 'slashes'), 'button dot TSX, in src slash components slash UI folder');
});

const items = async (text: string, pieces?: Parameters<typeof prepare>[1]) => {
  const input = await prepare(text, pieces);
  assert.ok(Array.isArray(input));
  return input.map(i => (typeof i === 'string' ? i : i.subtitles));
};

test('a path in inline code is one item, subtitled with the page word, so the highlight stays on it', async () => {
  const text = 'Open src/components/ui/button.tsx and check the header.';
  const pieces = [
    { type: 'text' as const, text: 'Open ' },
    { type: 'code' as const, text: 'src/components/ui/button.tsx' },
    { type: 'text' as const, text: ' and check the header.' },
  ];
  assert.deepEqual(await items(text, pieces), ['Open ', 'src/components/ui/button.tsx ', 'and ', 'check ', 'the ', 'header.']);
  const path = await prepare(text, pieces) as Exclude<Awaited<ReturnType<typeof prepare>>, string>;
  const item = path[1];
  assert.ok(typeof item !== 'string' && item.type === 'phonetic');
  // "S R C" from the fix line, said last: "…, inside S R C".
  assert.match(item.value, /ˈɛs ˈɑɹ sˈi $/);
});

test('one slash counts in inline code, never in plain text', async () => {
  const code = await prepare('See web/src now.', [{ type: 'text', text: 'See ' }, { type: 'code', text: 'web/src' }, { type: 'text', text: ' now.' }]);
  const plain = await prepare('See web/src now.');
  const sub = (i: Awaited<ReturnType<typeof prepare>>) => (Array.isArray(i) && typeof i[1] !== 'string' ? i[1].value : '');
  assert.notEqual(sub(code), sub(plain));
});

test('a command in inline code goes through the word layer', async () => {
  assert.deepEqual(await items('Run pnpm start now.', [{ type: 'text', text: 'Run ' }, { type: 'code', text: 'pnpm start' }, { type: 'text', text: ' now.' }]),
    ['Run ', 'pnpm ', 'start ', 'now.']);
});

const AMAZON = 'https://www.amazon.com/Toshiba-Class-Mini-LED-65Z670R-Built/dp/B0GNTCQM9R/?_encoding=UTF8&pd_rd_w=C6YIW&content-id=amzn1.sym.687c7350-b332-4824-99f9-6730b03e7216&pf_rd_p=687c7350-b332-4824-99f9-6730b03e7216&pf_rd_r=P76VP3RJZAEGT0H0MJC0&pd_rd_wg=HsGH8&pd_rd_r=1dc4915a-fdc1-4167-b1a8-c53ff1a94295&ref_=pd_hp_d_r_btf_dealz_sod';

test('a link reads as its site plus the words in its address; IDs and parameters go', () => {
  assert.equal(speakLink(AMAZON, sites), 'Amazon link: Toshiba Class Mini LED 65Z670R Built');
  assert.equal(speakLink('https://www.reddit.com/r/rust/comments/1g5xk2a/why_is_rust_so_fast/', sites), 'Reddit link: rust why is rust so fast');
  assert.equal(speakLink('https://example.org/blog/2024/03/hello-world.html'), 'example link: blog 2024 03 hello world');
  assert.equal(speakLink('https://news.ycombinator.com/item?id=41234567'), 'ycombinator link: item');
  assert.equal(speakLink('https://www.bbc.co.uk/'), 'bbc link');
  assert.equal(speakLink('www.example.com/docs'), 'example link: docs');
});

test('a search site reads its search words', () => {
  assert.equal(speakLink('https://www.google.com/search?q=kokoro+tts&sca_esv=abc123', sites), 'Google search: kokoro tts');
});

test('an address ending in a file is read by the path reader', () => {
  assert.equal(speakLink('https://github.com/hexgrad/misaki/blob/main/misaki/en.py', sites),
    'GitHub link: EN dot PY, in the misaki folder, inside misaki, inside hexgrad');
});

test('a link is one item subtitled with the page word', async () => {
  const text = `Buy it at ${AMAZON} today.`;
  assert.deepEqual(await items(text), ['Buy ', 'it ', 'at ', `${AMAZON} `, 'today.']);
});

test('a model number in a link is said as numbers and letters', async () => {
  const input = await prepare(`See ${AMAZON}`);
  assert.ok(Array.isArray(input) && typeof input[1] !== 'string');
  assert.match(input[1].value, /lˈɛd sˈɪksti fˈIv zˈi sˈɪks sˈɛvən ˈO ˈɑɹ bˈɪlt/);
});

test('pieces that do not join back into the text are ignored', async () => {
  assert.deepEqual(await items('See web/src now.', [{ type: 'code', text: 'something else' }]), ['See ', 'web/src ', 'now.']);
});
