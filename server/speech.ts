// Sentence synthesis with a disk cache, in front of whichever provider is active.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, stat, unlink, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import type { SpeechInput, SpeechProvider, Synthesis } from './providers/types.ts';
import type { PathStyle, Piece } from './spoken.ts';

type Prepare = (text: string, pieces?: Piece[], style?: PathStyle) => SpeechInput | Promise<SpeechInput>;

const DAY_MS = 24 * 60 * 60 * 1000;
const KEEP_MS = 2 * DAY_MS; // a sentence's audio is deleted once unused this long

export function createSpeech(root: string, provider: SpeechProvider, prepare: Prepare) {
  const dir = join(root, 'data/cache');
  const inFlight = new Map<string, Promise<Synthesis>>();

  // A file's modified time is its last use: every cache read sets it, so a document still being read keeps its audio.
  async function cleanup(now = Date.now()) {
    let deleted = 0;
    for (const name of await readdir(dir).catch(() => [])) {
      const file = join(dir, name);
      const { mtimeMs } = await stat(file).catch(() => ({ mtimeMs: now }));
      if (now - mtimeMs > KEEP_MS && (await unlink(file).then(() => true, () => false))) deleted++;
    }
    if (deleted) console.log(`[cache] deleted ${deleted} sentences unused for 2 days`);
    return deleted;
  }
  cleanup().catch(e => console.error('[cache] cleanup failed:', e));
  setInterval(() => cleanup().catch(e => console.error('[cache] cleanup failed:', e)), DAY_MS).unref();

  async function synthesize(text: string, voice: string, pieces?: Piece[], style?: PathStyle): Promise<Synthesis> {
    // A pronunciation fault never stops reading: the sentence goes as plain text.
    let input: SpeechInput = text;
    try {
      input = await prepare(text, pieces, style);
    } catch (e) {
      console.error('[pronunciation]', JSON.stringify(text), e);
    }
    // Cache key: provider + model + voice + the prepared input (headtts-findings.md: deterministic per sentence).
    // A new fix changes the input only of the sentences it touches, so only those are made again.
    const key = createHash('sha1').update(JSON.stringify([provider.id, provider.model, voice, input])).digest('hex');
    const file = join(dir, `${key}.json`);
    try {
      const cached = JSON.parse(await readFile(file, 'utf8'));
      const now = new Date();
      utimes(file, now, now).catch(() => {});
      return cached;
    } catch {}
    const pending = inFlight.get(key);
    if (pending) return pending;
    const job = (async () => {
      const result = await provider.synthesize(input, voice);
      await mkdir(dir, { recursive: true });
      await writeFile(file, JSON.stringify(result));
      return result;
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, job);
    return job;
  }

  return { synthesize, cleanup };
}
