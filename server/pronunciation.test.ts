// The sound layer's output for words HeadTTS used to guess. Run with `pnpm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPronunciation } from './pronunciation.ts';
import { fixKey, soundOf, type Check } from './feedback.ts';

const root = new URL('..', import.meta.url).pathname;
const dataDir = mkdtempSync(join(tmpdir(), 'reader-pronunciation-'));
const { prepare } = await createPronunciation(root, dataDir);

// Each item as its phonemes, or the plain text HeadTTS reads itself.
const sounds = async (text: string, pieces?: Parameters<typeof prepare>[1]) => {
  const input = await prepare(text, pieces);
  return typeof input === 'string' ? [input] : input.map(i => (typeof i === 'string' ? i : i.value));
};
// The same, with the page text of each item instead.
const words = async (text: string, pieces?: Parameters<typeof prepare>[1]) => {
  const input = await prepare(text, pieces);
  return typeof input === 'string' ? [input] : input.map(i => (typeof i === 'string' ? i : i.subtitles));
};
// A sentence's pieces with one stretch of inline code.
const withCode = (text: string, code: string) => {
  const at = text.indexOf(code);
  return [{ type: 'text' as const, text: text.slice(0, at) }, { type: 'code' as const, text: code }, { type: 'text' as const, text: text.slice(at + code.length) }];
};

test('a word only misaki knows gets misaki sounds', async () => {
  assert.deepEqual(await sounds('TypeScript'), ['tˈIpskɹˌɪpt']);
});

test('a fix comes before every dictionary', async () => {
  assert.deepEqual(await sounds('inline'), ['ˈɪnlˌIn']);
  assert.deepEqual(await sounds('src'), ['ˈɛs ˈɑɹ sˈi']);
});

test('an unknown compound splits into known parts, the second one demoted', async () => {
  assert.deepEqual(await sounds('scrollbar'), ['skɹˈOlbˌɑɹ']);
});

test('a hyphen splits a word into parts read alone', async () => {
  assert.deepEqual(await sounds('written-out'), ['ɹˈɪtən ˈWt']);
});

test('short words take their weak form before another word, and punctuation stays in the phonemes', async () => {
  assert.deepEqual(await sounds('Use an inline scrollbar.'), ['jˈuz ', 'ɐn ', 'ˈɪnlˌIn ', 'skɹˈOlbˌɑɹ.']);
  assert.deepEqual(await sounds('the end'), ['ði ', 'ˈɛnd']);
  assert.deepEqual(await sounds('to go'), ['tə ', 'ɡˌO']);
});

test('a word\'s role picks its sound: "use" as a noun is yoos, as a verb yooz', async () => {
  assert.equal((await sounds('The use of it.'))[1], 'jˈus ');
  assert.equal((await sounds('Use it now.'))[0], 'jˈuz ');
  assert.equal((await sounds('Record the song.'))[0], 'ɹəkˈɔɹd ');
  assert.equal((await sounds('The record ended.'))[1], 'ɹˈɛkəɹd ');
});

test('camelCase splits at each capital', async () => {
  assert.deepEqual(await sounds('useState'), ['jˈuz stˈAt']);
});

test('a capitals word is spelled, even where HeadTTS lists it as a word', async () => {
  assert.deepEqual(await sounds('API'), ['ˈA pˈi ˈI']);
  assert.deepEqual(await sounds('MS'), ['ˈɛm ˈɛs']);
  assert.deepEqual(await sounds('HeadTTS'), ['hˈɛd tˈi tˈi ˈɛs']);
  assert.deepEqual(await sounds('US'), ['jˈu ˈɛs']);
});

test('a capitals word misaki lists in capitals is said as a word', async () => {
  assert.deepEqual(await sounds('NASA'), ['nˈæsə']);
});

test('a short lower-case word with no vowel that no list knows is spelled', async () => {
  assert.deepEqual(await sounds('tsx'), ['tˈi ˈɛs ˈɛks']);
  assert.deepEqual(await sounds('px'), ['pˈi ˈɛks']);
});

test('a known word glued to a short no-vowel rest spells the rest', async () => {
  assert.deepEqual(await sounds('headtts'), ['hˈɛd tˈi tˈi ˈɛs']);
});

test('misaki\'s glottal t before n is said as a t', async () => {
  assert.deepEqual(await sounds('button.'), ['bˈʌtən.']);
});

test('a fix can depend on the word before: read after "are" is red', async () => {
  assert.equal((await sounds('Units are read as amounts.'))[2], 'ɹˈɛd ');
  assert.equal((await sounds('I read books.'))[1], 'ɹˈid ');
});

test('a possessive of a word no dictionary lists keeps the word', async () => {
  assert.equal((await sounds("HeadTTS's list"))[0], 'hˈɛd tˈi tˈi ˈɛsɪz ');
});

test('punctuation in inline code is read by name, one item per mark', async () => {
  const text = 'a pause (, . ?) stays';
  const pieces = withCode(text, '(, . ?)');
  assert.deepEqual(await words(text, pieces), ['a ', 'pause ', '(, ', '. ', '?) ', 'stays']);
  const [, , open, period, question] = await sounds(text, pieces);
  assert.match(open, /^ɪn ɹˈWnd bɹˈækəts, kˈɑmə, $/);
  assert.match(period, /pˈɪɹiəd, $/);
  assert.match(question, /kwˈɛsʧᵊn mˈɑɹk $/);
});

test('a stress mark alone is read by name, so the words around it stay apart', async () => {
  const text = 'and ˈ marks the loud part.';
  const [, mark] = await sounds(text, withCode(text, 'ˈ'));
  assert.match(mark, /^stɹˈɛs mˈɑɹk $/);
});

test('quote marks never reach HeadTTS, in plain text either', async () => {
  for (const text of ['say "API" now', 'The audio did contain "button".', '"sounds" and “makes”']) {
    assert.ok((await sounds(text)).every(s => !/["“”]/.test(s)), text);
  }
});

test('an acronym nothing knows is spelled', async () => {
  assert.deepEqual(await sounds('XKQ'), ['ˈɛks kˈA kjˈu']);
});

test('each page word stays one item, with the page text as subtitle', async () => {
  assert.deepEqual(await words('Run `pnpm start` now.'), ['Run ', '`pnpm ', 'start` ', 'now.']);
});

test('every word goes as sounds, HeadTTS\'s own words too; numbers go as plain text for HeadTTS to read', async () => {
  const input = await prepare('The cat sat on 42 mats.');
  assert.ok(Array.isArray(input));
  assert.deepEqual(input.map(i => (typeof i === 'string' ? i : i.type)), ['phonetic', 'phonetic', 'phonetic', 'phonetic', '42 ', 'phonetic']);
});

test('a unit after a number is read as words, glued or apart, singular after 1', async () => {
  assert.deepEqual(await words('150ms 60 km/h, 1 ms.'), ['150ms ', '60 ', 'km/h, ', '1 ', 'ms.']);
  const [glued, sixty, kmh, , one] = await sounds('150ms 60 km/h, 1 ms.');
  assert.match(glued, /hˈʌndɹəd.* mˈɪlɪsˌɛkəndz $/);
  assert.match(sixty, /sˈɪksti/);
  assert.match(kmh, /pɜɹ ˈWəɹ, $/);
  assert.match(one, /mˈɪləsˌɛkənd\.$/);
});

test('a unit with no number before it is not read as a unit', async () => {
  assert.equal((await sounds('MS Word'))[0], 'ˈɛm ˈɛs ');
});

test('Kokoro phonemes in inline code are said as the sounds they spell', async () => {
  const text = 'misaki writes `bˈʌtən` here';
  assert.equal((await sounds(text, withCode(text, '`bˈʌtən`')))[2], 'bˈʌtən ');
});

test('quote marks and brackets stay out of phonemes; pauses stay in', async () => {
  assert.deepEqual(await sounds('"scrollbar".'), ['skɹˈOlbˌɑɹ.']);
  assert.deepEqual(await sounds('(scrollbar),'), ['skɹˈOlbˌɑɹ,']);
});

test('a single letter glued to a known word is said by its name', async () => {
  assert.deepEqual(await sounds('ycombinator'), ['wˈI kˈɑmbənˌAɾəɹ']);
  assert.deepEqual(await sounds('xbox'), ['ˈɛks bˈɑks']);
});

// pronunciation/checks.jsonl: one line per fix confirmed in an investigation, the sounds its word must keep in its sentence.
test('every saved fix still gives its word the sounds it was saved with', async () => {
  let lines: string[] = [];
  try { lines = readFileSync(join(root, 'pronunciation/checks.jsonl'), 'utf8').split('\n').filter(Boolean); } catch {}
  for (const line of lines) {
    const check: Check = JSON.parse(line);
    assert.equal(soundOf(await prepare(check.text, check.pieces), check.word), check.phonemes, `${check.word} in "${check.text}"`);
  }
});

test('a fix key drops the punctuation around a page word and a sentence-start capital', () => {
  assert.equal(fixKey('Inline,'), 'inline');
  assert.equal(fixKey('`pnpm'), 'pnpm');
  assert.equal(fixKey('API.'), 'API');
  assert.equal(fixKey('(https://example.com/a/)'), 'https://example.com/a/');
});

test('a word nothing knows gets misaki\'s guess and goes to the unknown-word log', async () => {
  assert.deepEqual(await sounds('blorptan'), ['blˈɔɹptæn']);
  await new Promise(r => setTimeout(r, 1200));
  const log = readFileSync(join(dataDir, 'pronunciation/unknown.jsonl'), 'utf8');
  assert.match(log, /"word":"blorptan","count":1,.*"guess":"blˈɔɹptæn"/);
});
