// The reader's right-click "Flag…" (rd-15): records a fault for a later investigation. Flags are the user's data.
// Fixes come only from an investigation; each one confirmed adds a test line to pronunciation/checks.jsonl (a Check).
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { SpeechInput } from './providers/types.ts';
import type { PathStyle, Piece } from './spoken.ts';

const MAX_MARKDOWN = 4000; // characters of Markdown source kept per flag

type Prepare =(text: string, pieces?: Piece[], style?: PathStyle) => SpeechInput | Promise<SpeechInput>;
export type Check = { text: string; pieces?: Piece[]; word: string; phonemes: string };
export type Flag = {
  word: string; text: string; pieces?: Piece[]; before?: string; after?: string; markdown?: string
  doc: { id: string; title: string }; voice: string; speed: number; note: string
};

// A page word as fixes.tsv keys it: quotes, brackets, backticks and the punctuation after it dropped. A word capitalised
// only as a sentence start is kept in lower case; API, useState and links keep theirs.
export function fixKey(word: string) {
  const key = word.trim().replace(/^["'“‘(\[<`*_]+/, '').replace(/["'”’)\]>`*_.,;:!?]+$/, '');
  return key.length > 1 && key === key[0].toUpperCase() + key.slice(1).toLowerCase() ? key.toLowerCase() : key;
}

// The sounds of the item a key matches, without its pauses: what a test line holds.
export function soundOf(input: SpeechInput, key: string) {
  if (typeof input === 'string') return null;
  const item = input.find(i => typeof i !== 'string' && fixKey(i.subtitles ?? '').toLowerCase() === key.toLowerCase());
  return item && typeof item !== 'string' ? item.value.replace(/[\s,.?!;:—…]+$/u, '').trim() : null;
}

export function createFeedback(root: string, prepare: Prepare, dataDir = process.env.READER_DATA || join(root, 'data')) {
  // One line of data/pronunciation/flags.jsonl, with the exact HeadTTS input so an investigation replays the same audio.
  async function saveFlag(flag: Flag, style?: PathStyle) {
    const input = await prepare(flag.text, flag.pieces, style);
    const { word, text, pieces, before, after, doc, voice, speed, note } = flag;
    // The block's Markdown source, cut at MAX_MARKDOWN so one huge paragraph or table cell can't bloat the file.
    const markdown = typeof flag.markdown === 'string'
      ? (flag.markdown.length > MAX_MARKDOWN ? flag.markdown.slice(0, MAX_MARKDOWN) + '…' : flag.markdown)
      : undefined;
    mkdirSync(join(dataDir, 'pronunciation'), { recursive: true });
    // pieces: the sentence's code and link labels, so a replay prepares the sentence the way the page sent it.
    const line = { time: new Date().toISOString(), word, sentence: text, pieces, before, after, markdown, doc, voice, speed, input, note };
    appendFileSync(join(dataDir, 'pronunciation/flags.jsonl'), JSON.stringify(line) + '\n');
  }

  return { saveFlag };
}
