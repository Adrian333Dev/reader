// The sound layer of the pronunciation step (rd-7): picks Kokoro phonemes for every word before HeadTTS sees the sentence,
// so HeadTTS's own letter-to-sound step never runs. A word no list knows gets misaki's neural guess (rd-27).
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import nlp from 'compromise';
// @ts-expect-error HeadTTS ships this module without types; ./headtts-language.d.mts types the parts used here.
import { Language as UntypedLanguage } from '../node_modules/@met4citizen/headtts/modules/language-en-us.mjs';
import type { Language as LanguageClass } from './headtts-language.d.mts';
import type { SpeechInput, SpeechItem } from './providers/types.ts';
import { spokenForm, type PathStyle, type Piece, type Sites } from './spoken.ts';
import { createGuesser } from './guesser.ts';

type Entry = string | Record<string, string | null> | null;
type Role = 'NOUN' | 'VERB' | 'ADJ' | null;
type Fix = { action: 'say' | 'sound'; value: string; before?: Set<string>; after?: Set<string> };
type Resolved = { phonemes: string; source: 'fix' | 'context' | 'misaki' | 'headtts' | 'split' } | null;
type Unknown = { word: string; count: number; first: string; example: string; guess: string };

// misaki's vowels, for the a/an/the/to choices that depend on the next word's first sound.
const VOWELS = new Set('AIOQWYaiuæɑɒɔəɛɜɪʊʌᵻ');

// Letters and digits only, lower case: how a page word and a tagger's word are compared.
const bare = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// compromise's role for each word, in order. Only noun, verb and adjective: misaki's past-tense entries are for one
// sense alone ("used" VBD is the "used to" sound), so a past-tense tag would misread "I used it".
function tagRoles(text: string): { word: string; role: Role }[] {
  const terms: { text: string; tags: string[] }[] = nlp(text).json().flatMap((s: { terms: unknown[] }) => s.terms);
  return terms.filter(t => bare(t.text)).map(t => ({
    word: bare(t.text),
    role: t.tags.includes('Verb') ? 'VERB' : t.tags.includes('Adjective') ? 'ADJ' : t.tags.includes('Noun') ? 'NOUN' : null,
  }));
}

export async function createPronunciation(root: string, dataDir = process.env.READER_DATA || join(root, 'data')) {
  const guesser = await createGuesser(root);
  const lang: LanguageClass = new (UntypedLanguage as typeof LanguageClass)();
  await lang.loadDictionary(join(root, 'node_modules/@met4citizen/headtts/dictionaries/en-us.txt'));
  const headtts = lang.dictionary ?? {};
  const punctuations = lang.punctuations;
  const gold: Record<string, Entry> = JSON.parse(readFileSync(join(root, 'pronunciation/misaki/us_gold.json'), 'utf8'));
  const silver: Record<string, Entry> = JSON.parse(readFileSync(join(root, 'pronunciation/misaki/us_silver.json'), 'utf8'));

  // pronunciation/fixes.tsv, after its header row: word, say|sound, value, condition ("before:a,an,the", "after:is,was"
  // or empty). Columns explained in pronunciation/README.md. Reloaded when the file changes.
  const fixesPath = join(root, 'pronunciation/fixes.tsv');
  let fixes = new Map<string, Fix[]>();
  let fixesTime = -1;
  function loadFixes() {
    const time = statSync(fixesPath, { throwIfNoEntry: false })?.mtimeMs ?? 0;
    if (time === fixesTime) return;
    fixesTime = time;
    fixes = new Map();
    const text = time ? readFileSync(fixesPath, 'utf8') : '';
    for (const line of text.split('\n').slice(1)) {
      const [word, action, value, condition] = line.split('\t').map(s => s.trim());
      if (!word || (action !== 'say' && action !== 'sound') || !value) continue;
      const before = condition?.startsWith('before:') ? new Set(condition.slice(7).split(',')) : undefined;
      const after = condition?.startsWith('after:') ? new Set(condition.slice(6).split(',')) : undefined;
      fixes.set(word, [...(fixes.get(word) ?? []), { action, value, before, after }]);
    }
  }

  // pronunciation/units.tsv, after its header row: unit, singular, plural. Read out only right after a number.
  // Reloaded when the file changes.
  const unitsPath = join(root, 'pronunciation/units.tsv');
  let units = new Map<string, [string, string]>();
  let unitsTime = -1;
  function loadUnits() {
    const time = statSync(unitsPath, { throwIfNoEntry: false })?.mtimeMs ?? 0;
    if (time === unitsTime) return;
    unitsTime = time;
    units = new Map();
    const text = time ? readFileSync(unitsPath, 'utf8') : '';
    for (const line of text.split('\n').slice(1)) {
      const [unit, one, many] = line.split('\t').map(s => s.trim());
      if (unit && one && many) units.set(unit, [one, many]);
    }
  }

  // pronunciation/sites.json: site exceptions for the link reader (spoken.ts). Reloaded when the file changes.
  const sitesPath = join(root, 'pronunciation/sites.json');
  let sites: Sites = {};
  let sitesTime = -1;
  function loadSites() {
    const time = statSync(sitesPath, { throwIfNoEntry: false })?.mtimeMs ?? 0;
    if (time === sitesTime) return;
    sitesTime = time;
    try {
      sites = time ? JSON.parse(readFileSync(sitesPath, 'utf8')) : {};
    } catch (e) {
      console.error('[pronunciation] sites.json not read, links use the general rule:', e);
      sites = {};
    }
  }

  // data/pronunciation/unknown.jsonl: every word that fell through to HeadTTS's guessing rules, most frequent first.
  const unknownPath = join(dataDir, 'pronunciation/unknown.jsonl');
  const unknown = new Map<string, Unknown>();
  try {
    for (const line of readFileSync(unknownPath, 'utf8').split('\n').filter(Boolean)) {
      const u: Unknown = JSON.parse(line);
      unknown.set(u.word, u);
    }
  } catch {}
  let saveTimer: NodeJS.Timeout | undefined;
  let logging = true; // off during prepare's first pass, which only collects the words to guess
  function logUnknown(word: string, sentence: string, guess: string) {
    if (!logging) return;
    const u = unknown.get(word) ?? { word, count: 0, first: new Date().toISOString(), example: sentence, guess };
    u.count++;
    unknown.set(word, u);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      mkdirSync(join(dataDir, 'pronunciation'), { recursive: true });
      const lines = [...unknown.values()].sort((a, b) => b.count - a.count).map(u => JSON.stringify(u));
      writeFileSync(unknownPath, lines.join('\n') + '\n');
    }, 1000);
  }

  // misaki writes a glottal t before a final n ("button" bˈʌʔn); Kokoro voices it as a noise before a pause. Said with a t.
  // An entry keyed by role (use: DEFAULT jˈuz, NOUN jˈus) gives the role's sound when the tagger found one.
  const glottal = (p: string) => p.replace(/ʔn/g, 'tən');
  const pick = (e: Entry | undefined, role: Role = null) =>
    glottal((e && typeof e === 'object' ? (role && e[role]) || e.DEFAULT : e) || '') || null;
  const capitalized = (w: string) => w[0].toUpperCase() + w.slice(1).toLowerCase();
  const variants = (w: string) => [...new Set([w, w.toLowerCase(), capitalized(w)])];
  const misaki = (dict: Record<string, Entry>, w: string, role: Role = null) =>
    variants(w).map(v => pick(dict[v], role)).find(Boolean) ?? null;
  const fromHeadTTS = (w: string) => headtts[w.toUpperCase()]?.join('') ?? null;
  // misaki's model, once prepare has run it on the word; until then HeadTTS's letter rules, and the word is noted.
  const misses = new Set<string>();
  const guess = (w: string) => {
    const g = guesser.get(w);
    if (g) return glottal(g);
    misses.add(w);
    return lang.phonemizeWord(lang.normalizeUpper(w).join('')).join('');
  };
  const spell = (w: string) => [...w.toUpperCase()].map(c => pick(gold[c]) ?? guess(c)).join(' ');
  const soundFix = (w: string) => (fixes.get(w) ?? fixes.get(w.toLowerCase()))?.find(f => f.action === 'sound' && !f.before)?.value;
  const known = (w: string) => soundFix(w) ?? misaki(gold, w) ?? fromHeadTTS(w) ?? misaki(silver, w);
  const demote = (p: string) => p.replace(/ˈ/g, 'ˌ');

  // misaki's get_special_case, without a part-of-speech tagger: a following word stands in for "used as a function word".
  function context(word: string, next: string | null): string | null {
    const vowel = () => {
      const p = next ? (resolve(next, null)?.phonemes ?? guess(next)) : '';
      return VOWELS.has(p.replace(/[ˈˌ]/g, '')[0]);
    };
    if (word === 'a' || word === 'A') return next ? 'ɐ' : 'ˈA';
    if (word === 'an' || word === 'An') return 'ɐn';
    if (word === 'I') return 'ˌI';
    if (word === 'to' || word === 'To') return next ? (vowel() ? 'tʊ' : 'tə') : pick(gold.to);
    if (word === 'in' || word === 'In') return next ? 'ɪn' : 'ˈɪn';
    if (word === 'the' || word === 'The') return vowel() ? 'ði' : 'ðə';
    return null;
  }

  // Each part looked up from the top; a part nothing knows is guessed, and logged unless this is a look-ahead (no sentence).
  function joinParts(parts: string[], sentence: string) {
    return parts.map(p => resolve(p, null, sentence)?.phonemes ?? (sentence ? unknownWord(p, sentence) : guess(p))).join(' ');
  }
  function unknownWord(word: string, sentence: string) {
    const g = guess(word);
    logUnknown(word.toLowerCase(), sentence, g);
    return g;
  }

  // A fix whose before/after condition holds wins over one with no condition.
  function findFix(word: string, next: string | null, prev: string | null) {
    const list = fixes.get(word) ?? fixes.get(word.toLowerCase());
    const holds = (f: Fix) =>
      (!f.before || (!!next && f.before.has(next.toLowerCase()))) && (!f.after || (!!prev && f.after.has(prev.toLowerCase())));
    return list?.find(f => (f.before || f.after) && holds(f)) ?? list?.find(f => !f.before && !f.after);
  }

  // The possessive or "is" ending after a word's sounds: s after a voiceless sound, ɪz after a hissing one, else z.
  function possessive(p: string) {
    const last = p.replace(/[ˈˌ.,?!;:\s]/g, '').slice(-1);
    return p + ('szʃʒʧʤ'.includes(last) ? 'ɪz' : 'ptkfθ'.includes(last) ? 's' : 'z');
  }

  // First match wins: fix, context rule, a capitals word, misaki gold (by role), HeadTTS, misaki silver, a possessive,
  // a split, a word with no vowel. Null: misaki's guesser must guess.
  function resolve(word: string, next: string | null, sentence = '', depth = 0, prev: string | null = null, role: Role = null): Resolved {
    const fix = findFix(word, next, prev);
    if (fix && depth < 3) {
      if (fix.action === 'sound') return { phonemes: fix.value, source: 'fix' };
      const words = fix.value.split(/\s+/).filter(Boolean);
      const phonemes = words.map((w, i) => resolve(w, words[i + 1] ?? null, sentence, depth + 1)?.phonemes ?? guess(w));
      return { phonemes: phonemes.join(' '), source: 'fix' };
    }
    const special = context(word, next);
    if (special) return { phonemes: special, source: 'context' };

    // An all-capital word of 2 to 5 letters is an abbreviation, spelled: MS → M S, each letter apart. Said as a
    // word only where misaki lists it in capitals (NASA). HeadTTS's dictionary is skipped: it keys every word in
    // capitals, so its "MS" is the title "Ms" ("mizz").
    if (/^[A-Z]{2,5}$/.test(word)) {
      const asWord = pick(gold[word]);
      if (asWord) return { phonemes: asWord, source: 'misaki' };
      // Each letter with its own stress and a space: joined ("tˌitˌiˈɛs") Kokoro runs TTS together into one word.
      return { phonemes: spell(word), source: 'split' };
    }
    const fromGold = misaki(gold, word, role);
    if (fromGold) return { phonemes: fromGold, source: 'misaki' };
    const fromDict = fromHeadTTS(word);
    if (fromDict) return { phonemes: fromDict, source: 'headtts' };
    const fromSilver = misaki(silver, word);
    if (fromSilver) return { phonemes: fromSilver, source: 'misaki' };

    // A possessive no dictionary lists: HeadTTS's → HeadTTS + z.
    const owner = word.match(/^(.+)['’]s$/su);
    const owned = owner && resolve(owner[1], null, sentence, depth);
    if (owned) return { phonemes: possessive(owned.phonemes), source: 'split' };
    // written-out, snake_case, a.b, a/b; then camelCase and HTTPServer.
    const joined = word.split(/[-_./]+/).filter(Boolean);
    if (joined.length > 1) return { phonemes: joinParts(joined, sentence), source: 'split' };
    const camel = word.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/);
    if (camel.length > 1) return { phonemes: joinParts(camel, sentence), source: 'split' };
    // A short word no list knows and with no vowel is an abbreviation in lower case: tsx, px, mb → spelled.
    if (/^[a-z]{2,5}$/i.test(word) && !/[aeiouy]/i.test(word)) return { phonemes: spell(word), source: 'split' };
    // A compound: the longest known first part plus a known rest, whose main stress becomes secondary. scrollbar → scroll + bar.
    // Last, a single first letter said by its name: ycombinator → Y combinator, xbox → X box.
    // A rest no list knows, of up to 5 letters with no vowel, is spelled apart: headtts → head + T T S.
    if (/^[a-z]{4,}$/i.test(word)) {
      for (let cut = word.length - 3; cut >= 1; cut--) {
        const first = cut === 1 ? pick(gold[word[0].toUpperCase()]) : known(word.slice(0, cut));
        if (!first) continue;
        const rest = word.slice(cut);
        const sound = known(rest);
        if (sound) return { phonemes: cut === 1 ? `${first} ${sound}` : first + demote(sound), source: 'split' };
        if (cut > 1 && rest.length <= 5 && !/[aeiouy]/i.test(rest)) return { phonemes: `${first} ${spell(rest)}`, source: 'split' };
      }
    }
    return null;
  }

  // Only the punctuation that makes a pause, so a phonetic item keeps its pauses. Quote marks, brackets, backticks and
  // slashes go: inside phonemes the model may voice them (a noise heard on `"button".`).
  const PAUSES = new Set(',.?!;:—…');
  const punctuation = (s: string) =>
    [...s].map(c => (/\s/.test(c) ? ' ' : PAUSES.has(punctuations[c] ?? '') ? punctuations[c] : '')).join('').replace(/ +/g, ' ');

  // A number's unit as words: "ms" → "milliseconds", "millisecond" after 1.
  const unitWords = (number: string, unit: string) => {
    const words = units.get(unit);
    return words && (number === '1' ? words[0] : words[1]);
  };
  // A quantity, never a code: HeadTTS's default reads 100 to 999 digit by digit ("150" → "one five oh").
  // Lower case: HeadTTS writes number words in capitals, which would read as abbreviations ("SIXTY" → S I X T Y).
  const quantity = (number: string) => (lang.convertNumberToWords(number, true) as string).toLowerCase();
  const numberWords = (number: string) => (lang.convertNumberToWords(number) as string).toLowerCase();
  const NUMBER = /^\d+(?:\.\d+)?$/;
  // The unit words of part i when it is a unit after a number token, as in "60 km/h".
  const unitAfter = (parts: string[][], i: number) => {
    const before = parts[i - 1];
    return parts[i] && before && !before[2].trim() && NUMBER.test(before[1]) ? unitWords(before[1], parts[i][1]) : undefined;
  };

  // HeadTTS's words, each cut into leading punctuation, the word, and trailing punctuation with its space.
  const split = (tokens: string[]) => tokens.map(t => t.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/su)!.slice(1));
  // The next word counts only inside the same clause: no punctuation between them.
  const nextWord = (parts: string[][], i: number) => {
    const next = parts[i + 1];
    return next && !/[^\s]/.test(parts[i][2]) && !next[0] ? next[1] || null : null;
  };
  const prevWord = (parts: string[][], i: number) => (i > 0 ? nextWord(parts, i - 1) && parts[i - 1][1] : null);

  // Phonemes for a spoken form of several words, as one phonetic item holds them. Every word is resolved; numbers are
  // said as HeadTTS says them; a word nothing knows is guessed and logged.
  function phonemesOf(words: string, sentence: string): string {
    const parts = split(lang.splitText(words));
    return parts.map(([lead, core, trail], i) => {
      let sound = '';
      if (/^\d+$/.test(core)) sound = phonemesOf(numberWords(core), sentence);
      // A model number: 65Z670R → 65 Z 670 R. Each part directly: HeadTTS's splitText keeps "670 R" as one word.
      else if (/\d/.test(core) && /\p{L}/u.test(core)) {
        sound = core.split(/(\d+)|[^\p{L}\p{N}]+/u).filter(Boolean).map(p => /^\d+$/.test(p)
          ? phonemesOf(numberWords(p), sentence).trim()
          : (resolve(p, null, sentence)?.phonemes ?? unknownWord(p, sentence))).join(' ');
      }
      else if (core) sound = resolve(core, nextWord(parts, i), sentence, 0, prevWord(parts, i))?.phonemes ?? unknownWord(core, sentence);
      return punctuation(lead) + sound + punctuation(trail);
    }).join('');
  }

  // A page word's path, link or other spoken form; the page's pieces say whether it sits in inline code.
  const PATH_TOKEN = /^([("'“‘[<]*)(.*?)([)"'”’\]>.,;:!?]*\s*)$/su;
  function spoken(token: string, inCode: boolean, style: PathStyle, sentence: string): SpeechItem | null {
    const [lead, body, trail] = token.match(PATH_TOKEN)!.slice(1);
    // A fix line for this exact link or path wins over the link and path readers.
    const fix = /[^\p{L}\p{N}]/u.test(body) ? findFix(body, null, null) : undefined;
    if (fix) {
      const sound = fix.action === 'sound' ? fix.value : phonemesOf(fix.value, sentence);
      return { type: 'phonetic', value: punctuation(lead) + sound + punctuation(trail), subtitles: token };
    }
    const words = body && spokenForm(body, inCode, style, sites);
    if (!words) return null;
    return { type: 'phonetic', value: punctuation(lead) + phonemesOf(words, sentence) + punctuation(trail), subtitles: token };
  }

  // Which characters of the sentence are inline code. Pieces that don't join back into the text are ignored.
  function codeMask(text: string, pieces: Piece[]) {
    const mask = new Array<boolean>(text.length).fill(false);
    if (pieces.map(p => p.text).join('') !== text) return mask;
    let at = 0;
    for (const p of pieces) {
      if (p.type === 'code') mask.fill(true, at, at + p.text.length);
      at += p.text.length;
    }
    return mask;
  }

  // Punctuation in inline code is read by name, "(, . ?)" → "in round brackets: comma, period, question mark".
  // A closing bracket is silent unless it stands alone.
  const MARKS: Record<string, string> = {
    ',': 'comma', '.': 'period', '?': 'question mark', '!': 'exclamation mark', ';': 'semicolon', ':': 'colon',
    '(': 'in round brackets', '[': 'in square brackets', '{': 'in curly brackets', ')': '', ']': '', '}': '',
    '"': 'quote', "'": 'apostrophe', '-': 'dash', '—': 'dash', '/': 'slash', '\\': 'backslash', '*': 'star',
    '#': 'hash', '@': 'at', '&': 'and', '%': 'percent', '+': 'plus', '=': 'equals', '<': 'less than', '>': 'greater than',
    '|': 'pipe', '~': 'tilde', '_': 'underscore', '$': 'dollar', '^': 'caret', '`': 'backtick',
  };
  function markNames(token: string) {
    const marks = [...token.trim()];
    const names = marks.map(c => MARKS[c]).filter(Boolean);
    if (!names.length) return marks.some(c => c in MARKS) ? 'close bracket' : null;
    return names.join(', ');
  }

  // A character only Kokoro's phoneme alphabet uses: stress marks and IPA letters.
  const IPA = /[ˈˌʌəɹɪʔæɑɔʊɛɜʃʒθðŋɡᵊʧʤɾ]/u;

  // Quote marks only mark text for the eye; HeadTTS would pass them to the model.
  const unquote = (s: string) => {
    const bare = s.replace(/["“”«»]/g, '');
    return /[\p{L}\p{N}]/u.test(bare) ? bare : s;
  };

  // Each token's role from the tagger, matched in order by its bare letters; a token the tagger split or skipped gets none.
  function rolesFor(parts: string[][], tagged: { word: string; role: Role }[]) {
    let j = 0;
    return parts.map(([, core]) => {
      const w = bare(core);
      if (!w) return null;
      for (let k = j; k < Math.min(j + 3, tagged.length); k++) {
        if (tagged[k].word === w) { j = k + 1; return tagged[k].role; }
      }
      return null;
    });
  }

  // Twice: the first pass only collects the words for misaki's guesser, which runs between the two.
  async function prepare(text: string, pieces: Piece[] = [], style: PathStyle = 'innermost'): Promise<SpeechInput> {
    loadFixes();
    loadSites();
    loadUnits();
    const tagged = tagRoles(text);
    misses.clear();
    logging = false;
    try {
      build(text, pieces, style, tagged);
    } finally {
      logging = true;
    }
    // A copy: another sentence prepared meanwhile clears the shared set while the guesser still walks it.
    if (misses.size) await guesser.guess([...misses]);
    return build(text, pieces, style, tagged);
  }

  // One item per HeadTTS word, so the page's highlight matches word for word; every word as sounds, numbers as text.
  function build(text: string, pieces: Piece[], style: PathStyle, tagged: { word: string; role: Role }[]): SpeechInput {
    const tokens: string[] = lang.splitText(text);
    const parts = split(tokens);
    const code = codeMask(text, pieces);
    const roles = rolesFor(parts, tagged);
    let at = 0;
    const items = parts.map(([lead, core, trail], i): SpeechItem => {
      const tokenStart = at;
      const start = at + lead.length;
      at += tokens[i].length;
      // A stress mark alone has no sound; said as nothing, the words around it run together ("and ˈ marks").
      if (/^[ˈˌ]+$/u.test(core)) {
        const names = [...core].map(c => (c === 'ˈ' ? 'stress mark' : 'second stress mark')).join(', ');
        return { type: 'phonetic', value: punctuation(lead) + phonemesOf(names, text) + punctuation(trail), subtitles: tokens[i] };
      }
      // Kokoro phonemes written in inline code (`bˈʌtən`) are said as the sounds they spell.
      if (code[start] && IPA.test(core) && /^[\p{L}ˈˌːᵊ]+$/u.test(core)) {
        return { type: 'phonetic', value: punctuation(lead) + core + punctuation(trail), subtitles: tokens[i] };
      }
      const names = !core && code[tokenStart] ? markNames(tokens[i]) : null;
      if (names) {
        const pause = /\s$/.test(tokens[i]) ? (i < parts.length - 1 && !parts[i + 1][1] ? ', ' : ' ') : '';
        return { type: 'phonetic', value: phonemesOf(names, text).trim() + pause, subtitles: tokens[i] };
      }
      // A unit right after a number, glued ("150ms") or after the number's own word ("60 km/h"), before any split.
      const glued = core.match(/^(\d+(?:\.\d+)?)(\D.*)$/su);
      const unit = glued
        ? unitWords(glued[1], glued[2]) && `${quantity(glued[1])} ${unitWords(glued[1], glued[2])}`
        : unitAfter(parts, i + 1) ? quantity(core) : unitAfter(parts, i);
      if (unit) {
        return { type: 'phonetic', value: punctuation(lead) + phonemesOf(unit, text) + punctuation(trail), subtitles: tokens[i] };
      }
      const form = spoken(tokens[i], code[start], style, text);
      if (form) return form;
      if (!core || /\d/.test(core)) return tokens[i];
      const r = resolve(core, nextWord(parts, i), text, 0, prevWord(parts, i), roles[i]);
      const phonemes = r?.phonemes ?? unknownWord(core, text);
      return { type: 'phonetic', value: punctuation(lead) + phonemes + punctuation(trail), subtitles: tokens[i] };
    }).map(item => (typeof item === 'string' ? unquote(item) : item));
    return items.every(i => typeof i === 'string') ? items.join('') : items;
  }

  return { prepare };
}
