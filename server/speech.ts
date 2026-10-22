// Sentence synthesis with a disk cache, in front of whichever provider is active.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { SpeechProvider, Synthesis } from './providers/types.ts';

export function createSpeech(root: string, provider: SpeechProvider) {
  const dir = join(root, 'data/cache');
  const inFlight = new Map<string, Promise<Synthesis>>();

  async function synthesize(text: string, voice: string): Promise<Synthesis> {
    // Cache key: provider + model + voice + exact sentence text (headtts-findings.md: deterministic per sentence).
    const key = createHash('sha1').update(JSON.stringify([provider.id, provider.model, voice, text])).digest('hex');
    const file = join(dir, `${key}.json`);
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch {}
    const pending = inFlight.get(key);
    if (pending) return pending;
    const job = (async () => {
      const result = await provider.synthesize(text, voice);
      await mkdir(dir, { recursive: true });
      await writeFile(file, JSON.stringify(result));
      return result;
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, job);
    return job;
  }

  return { synthesize };
}
