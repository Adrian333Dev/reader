// The tools for a pronunciation investigation (rd-16). The instructions are pronunciation/investigate.md.
//   pnpm flags list                  the open flags
//   pnpm flags unknown [n]           the n most frequent words nothing knew (default 20)
//   pnpm flags bundle                investigate.md plus the current files, flags and unknown words, for a model with no tools
//   pnpm flags replay <id> [options] the flag's saved audio against the sentence made again with the proposed fixes
//   pnpm flags close <id> [options]  writes confirmed fixes and a test line, and closes the flag
//   pnpm flags add [options]         the same for a fix that has no flag (an unknown word)
//   pnpm flags review <word> …       marks unknown words whose guess is right, so they leave the list
// <id> is the start of the flag's time. Options: --fix "word|action|value|condition" (fixes.tsv), --unit "unit|one|many"
// (units.tsv), --site '{"domain.com":{"name":"X"}}' (sites.json), --check <word> and --text "<sentence>" (a checks.jsonl line),
// --outcome fixed|ticket|nofault and --detail "<text>" (close), --play (replay: play both through Windows).
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPronunciation } from '../server/pronunciation.ts';
import { fixKey, soundOf, type Check } from '../server/feedback.ts';
import type { SpeechInput } from '../server/providers/types.ts';
import type { PathStyle, Piece } from '../server/spoken.ts';

type Saved = {
  time: string; word: string; sentence: string; pieces?: Piece[]; before?: string; after?: string; markdown?: string
  voice: string; input: SpeechInput; note: string
};
type Unknown = { word: string; count: number; example: string; guess: string };
type Sites = Record<string, Record<string, unknown>>;

const root = join(import.meta.dirname, '..');
const dataDir = process.env.READER_DATA || join(root, 'data');
const flagsPath = join(dataDir, 'pronunciation/flags.jsonl');
const closedPath = join(dataDir, 'pronunciation/flags-closed.jsonl');
const unknownPath = join(dataDir, 'pronunciation/unknown.jsonl');
const reviewedPath = join(dataDir, 'pronunciation/reviewed.txt');
const scratch = join(root, 'tmp/replay');
const HEADTTS = 'http://localhost:8882';

const fail = (message: string): never => { console.error(message); process.exit(1); };

function readLines<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as T);
}

const fixedWords = () =>
  new Set(readFileSync(join(root, 'pronunciation/fixes.tsv'), 'utf8').split('\n').slice(1).map(l => l.split('\t')[0].toLowerCase()));

// flags.jsonl holds open flags only: closing a flag moves it to flags-closed.jsonl.
const openFlags = () => readLines<Saved>(flagsPath);

function findFlag(id?: string) {
  const open = openFlags();
  const hits = id ? open.filter(f => f.time.startsWith(id)) : [];
  if (hits.length !== 1) fail(id ? `${hits.length} open flags start with "${id}". Open: ${open.map(f => f.time).join(', ') || 'none'}` : 'A flag id is needed.');
  return hits[0];
}

// A flag without the fields that only the page needs: what an investigation reads.
const shown = ({ time, word, sentence, before, after, markdown, note, input }: Saved) =>
  JSON.stringify({ time, word, sentence, before, after, markdown, note, input });

// reviewed.txt: words an investigation judged right, one per line in lower case. Only this script writes it, so the
// server's rewrites of unknown.jsonl never lose a mark.
const reviewedWords = () => new Set(existsSync(reviewedPath) ? readFileSync(reviewedPath, 'utf8').split('\n').filter(Boolean) : []);

function topUnknown(n: number) {
  const skip = new Set([...fixedWords(), ...reviewedWords()]);
  return readLines<Unknown>(unknownPath).filter(u => !skip.has(u.word)).slice(0, n)
    .map(({ word, count, example, guess }) => JSON.stringify({ word, count, example, guess }));
}

// --- the files a fix changes. Each takes the project root it changes, so a replay works on a copy.

function addFix(at: string, line: string) {
  const [word, action, value, condition = ''] = line.split('|').map(s => s.trim());
  if (!word || (action !== 'say' && action !== 'sound') || !value) fail(`--fix needs "word|say or sound|value|condition", got "${line}"`);
  const path = join(at, 'pronunciation/fixes.tsv');
  const text = readFileSync(path, 'utf8');
  const clash = text.split('\n').slice(1).map(l => l.split('\t')).find(f => f[0] === word && (f[3] ?? '') === condition);
  if (clash) fail(`fixes.tsv already has a line for "${word}" with that condition. Edit it instead.`);
  appendFileSync(path, `${text.endsWith('\n') ? '' : '\n'}${word}\t${action}\t${value}\t${condition}\n`);
}

function addUnit(at: string, line: string) {
  const [unit, one, many] = line.split('|').map(s => s.trim());
  if (!unit || !one || !many) fail(`--unit needs "unit|singular|plural", got "${line}"`);
  const path = join(at, 'pronunciation/units.tsv');
  const text = readFileSync(path, 'utf8');
  if (text.split('\n').slice(1).some(l => l.split('\t')[0] === unit)) fail(`units.tsv already has "${unit}". Edit it instead.`);
  appendFileSync(path, `${text.endsWith('\n') ? '' : '\n'}${unit}\t${one}\t${many}\n`);
}

// sites.json keeps one domain per line, sorted: { "name": "Amazon", "drop": ["a"] }
function addSite(at: string, json: string) {
  const path = join(at, 'pronunciation/sites.json');
  const sites: Sites = { ...JSON.parse(readFileSync(path, 'utf8')), ...JSON.parse(json) };
  const inline = (site: Record<string, unknown>) =>
    `{ ${Object.entries(site).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v).replace(/","/g, '", "')}`).join(', ')} }`;
  const body = Object.keys(sites).sort().map(domain => `  ${JSON.stringify(domain)}: ${inline(sites[domain])}`).join(',\n');
  writeFileSync(path, `{\n${body}\n}\n`);
}

type Changes = { fix?: string[]; unit?: string[]; site?: string[] };
function applyChanges(at: string, { fix = [], unit = [], site = [] }: Changes) {
  fix.forEach(l => addFix(at, l));
  unit.forEach(l => addUnit(at, l));
  site.forEach(j => addSite(at, j));
}

// --- speech

async function pathStyle(): Promise<PathStyle> {
  try { return JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8')).pathStyle === 'slashes' ? 'slashes' : 'innermost'; } catch { return 'innermost'; }
}

// A copy of pronunciation/ that a proposed fix can change, sharing the dictionaries. Its own data folder keeps the
// user's unknown-word log out of it.
function scratchRoot(changes: Changes) {
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(join(scratch, 'root/pronunciation'), { recursive: true });
  symlinkSync(join(root, 'node_modules'), join(scratch, 'root/node_modules'));
  symlinkSync(join(root, 'pronunciation/misaki'), join(scratch, 'root/pronunciation/misaki'));
  for (const file of ['fixes.tsv', 'units.tsv', 'sites.json']) copyFileSync(join(root, 'pronunciation', file), join(scratch, 'root/pronunciation', file));
  applyChanges(join(scratch, 'root'), changes);
  return join(scratch, 'root');
}

async function prepareWith(at: string, flagLike: { sentence: string; pieces?: Piece[] }) {
  const { prepare } = await createPronunciation(at, join(scratch, 'data'));
  return prepare(flagLike.sentence, flagLike.pieces, await pathStyle());
}

async function synthesize(input: SpeechInput, voice: string, file: string) {
  let res: Response;
  try {
    res = await fetch(`${HEADTTS}/v1/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input, voice, language: 'en-us', speed: 1, audioEncoding: 'wav' }),
    });
  } catch {
    return fail('HeadTTS does not answer on port 8882. Start it with `pnpm service start`.');
  }
  if (!res.ok) fail(`HeadTTS answered ${res.status}: ${await res.text()}`);
  writeFileSync(file, Buffer.from((await res.json()).audio, 'base64'));
}

const windowsPath = (file: string) => { try { return execFileSync('wslpath', ['-w', file], { encoding: 'utf8' }).trim(); } catch { return file; } };
const play = (file: string) =>
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `(New-Object Media.SoundPlayer '${windowsPath(file)}').PlaySync()`], { stdio: 'inherit' });

const items = (input: SpeechInput) =>
  typeof input === 'string' ? [{ word: input, sound: input }] : input.map(i => (typeof i === 'string' ? { word: i, sound: i } : { word: i.subtitles, sound: i.value }));

async function replay(flag: Saved, changes: Changes, wantPlay: boolean) {
  const after = await prepareWith(scratchRoot(changes), flag);
  const was = items(flag.input);
  const now = items(after);
  // Words whose sounds changed: the part of the sentence the fix touched.
  const changed = now.map((n, i) => ({ n, o: was[i] })).filter(({ n, o }) => !o || n.sound !== o.sound || n.word !== o.word);
  console.log(changed.length ? changed.map(({ n, o }) => `${n.word.trim()}: ${o?.sound.trim() ?? '(none)'} → ${n.sound.trim()}`).join('\n') : 'The sent sounds are the same as the flag saved.');
  const id = flag.time.replace(/\D/g, '');
  const before = join(scratch, `${id}-before.wav`);
  const afterFile = join(scratch, `${id}-after.wav`);
  await synthesize(flag.input, flag.voice, before);
  await synthesize(after, flag.voice, afterFile);
  console.log(`before: ${windowsPath(before)}\nafter:  ${windowsPath(afterFile)}`);
  if (wantPlay) { console.log('playing before…'); play(before); console.log('playing after…'); play(afterFile); }
}

// The test line for a word, with the sounds the current files give it. A line already there is not added twice.
async function writeCheck(word: string, sentence: string, pieces?: Piece[]) {
  const phonemes = soundOf(await prepareWith(root, { sentence, pieces }), fixKey(word));
  if (!phonemes) return fail(`"${word}" is not a word of the sentence after preparing it, so no test line was written.`);
  const check: Check = { text: sentence, ...(pieces?.some(p => p.type !== 'text') && { pieces }), word: fixKey(word), phonemes };
  const path = join(root, 'pronunciation/checks.jsonl');
  const line = JSON.stringify(check);
  if (existsSync(path) && readFileSync(path, 'utf8').split('\n').includes(line)) return;
  appendFileSync(path, line + '\n');
  console.log(`checks.jsonl: ${line}`);
}

// --- commands

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    fix: { type: 'string', multiple: true }, unit: { type: 'string', multiple: true }, site: { type: 'string', multiple: true },
    check: { type: 'string' }, text: { type: 'string' }, outcome: { type: 'string' }, detail: { type: 'string' }, play: { type: 'boolean' },
  },
});
const [command, arg] = positionals;
const changes: Changes = { fix: values.fix, unit: values.unit, site: values.site };

if (command === 'list') {
  const flags = openFlags();
  console.log(flags.length ? flags.map(shown).join('\n') : 'No open flags.');
} else if (command === 'unknown') {
  console.log(topUnknown(Number(arg) || 20).join('\n') || 'No unknown words.');
} else if (command === 'review') {
  if (positionals.length < 2) fail('review needs the words: pnpm flags review <word> …');
  const had = reviewedWords();
  const added = [...new Set(positionals.slice(1).map(w => w.toLowerCase()))].filter(w => !had.has(w));
  mkdirSync(join(dataDir, 'pronunciation'), { recursive: true });
  if (added.length) appendFileSync(reviewedPath, added.join('\n') + '\n');
  console.log(added.length ? `Reviewed: ${added.join(', ')}` : 'Already reviewed.');
} else if (command === 'bundle') {
  const file = (name: string) => readFileSync(join(root, 'pronunciation', name), 'utf8').trimEnd();
  const flags = openFlags();
  console.log([
    file('investigate.md'), '', '# The data', '',
    '## fixes.tsv', '```text', file('fixes.tsv'), '```', '',
    '## units.tsv', '```text', file('units.tsv'), '```', '',
    '## sites.json', '```json', file('sites.json'), '```', '',
    '## Open flags', '```jsonl', flags.map(shown).join('\n') || '(none)', '```', '',
    '## Unknown words', '```jsonl', topUnknown(30).join('\n') || '(none)', '```',
  ].join('\n'));
} else if (command === 'replay') {
  await replay(findFlag(arg), changes, !!values.play);
} else if (command === 'close' || command === 'add') {
  const flag = command === 'close' ? findFlag(arg) : undefined;
  const outcome = values.outcome ?? (command === 'close' ? undefined : 'fixed');
  if (command === 'close' && !['fixed', 'ticket', 'nofault'].includes(outcome ?? '')) fail('close needs --outcome fixed, ticket or nofault.');
  applyChanges(root, changes);
  const sentence = flag?.sentence ?? values.text;
  if (values.check) {
    if (!sentence) fail('--check needs --text "<sentence>" when there is no flag.');
    await writeCheck(values.check, sentence!, flag?.pieces);
  }
  if (flag) {
    // The whole flag moves to the closed file with its outcome. The rewrite is synchronous, so a flag the server appends
    // meanwhile can only be lost inside the same instant.
    appendFileSync(closedPath, JSON.stringify({ ...flag, closed: new Date().toISOString(), outcome, detail: values.detail }) + '\n');
    const rest = readFileSync(flagsPath, 'utf8').split('\n').filter(l => l && JSON.parse(l).time !== flag.time);
    writeFileSync(flagsPath, rest.length ? rest.join('\n') + '\n' : '');
    console.log(`Closed flag ${flag.time} (${outcome}).`);
  }
} else {
  fail('Usage: pnpm flags list | unknown [n] | bundle | replay <id> | close <id> | add | review <word> …');
}
process.exit(0);
