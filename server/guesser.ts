// misaki's neural guesser (rd-27): Kokoro sounds, with stress, for a word no list knows. Replaces HeadTTS's 1976 letter rules.
// The model is nekwo/misaki-en-us-g2p-onnx (Apache-2.0), in pronunciation/misaki/guesser/; about 5 ms a word on CPU.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ort from 'onnxruntime-node';

type Tables = { bos_id: number; eos_id: number; start_id: number; unknown_id: number; max_steps: number; graphemes: string; phonemes: string };

export async function createGuesser(root: string) {
  const dir = join(root, 'pronunciation/misaki/guesser');
  const t: Tables = JSON.parse(readFileSync(join(dir, 'tables.json'), 'utf8'));
  const session = await ort.InferenceSession.create(join(dir, 'model.onnx'));
  const known = new Map<string, string>();
  const ids = (n: number[]) => new ort.Tensor('int64', BigInt64Array.from(n.map(BigInt)), [1, n.length]);

  // Greedy decoding: [bos, ...letters, eos] in, sounds out one at a time until eos.
  async function run(word: string) {
    const letters = [...word.toLowerCase()].map(c => {
      const i = t.graphemes.indexOf(c);
      return i < 4 ? t.unknown_id : i;
    });
    const input = ids([t.bos_id, ...letters, t.eos_id]);
    const out = [t.start_id];
    for (let step = 0; step < t.max_steps; step++) {
      const { logits } = await session.run({ input_ids: input, decoder_input_ids: ids(out) });
      const [, rows, size] = logits.dims;
      const last = (logits.data as Float32Array).subarray((rows - 1) * size, rows * size);
      let best = 0;
      for (let i = 1; i < size; i++) if (last[i] > last[best]) best = i;
      if (best === t.eos_id) break;
      out.push(best);
    }
    return out.slice(1).map(i => (i < 4 ? '' : t.phonemes[i])).join('').replace(/^_/, '');
  }

  return {
    // The sounds of each word, guessed once and remembered.
    async guess(words: Iterable<string>) {
      for (const w of words) if (!known.has(w.toLowerCase())) known.set(w.toLowerCase(), await run(w));
    },
    get: (word: string) => known.get(word.toLowerCase()),
  };
}
