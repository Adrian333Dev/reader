// Speech provider: HeadTTS (Kokoro on CPU), run as a child process.
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderStatus, SpeechProvider, Synthesis } from './types.ts';

const URL = 'http://localhost:8882';

// Display names, in picker order: the voices the user rated best first.
const VOICE_NAMES: Record<string, string> = {
  am_puck: 'Puck', am_fenrir: 'Fenrir', am_adam: 'Adam', am_michael: 'Michael', am_onyx: 'Onyx', am_echo: 'Echo',
  am_eric: 'Eric', am_liam: 'Liam', am_santa: 'Santa', bm_george: 'George', bm_fable: 'Fable', bm_lewis: 'Lewis',
  bm_daniel: 'Daniel', af_heart: 'Heart', af_bella: 'Bella', af_nicole: 'Nicole', af_aoede: 'Aoede', af_kore: 'Kore',
  af_sarah: 'Sarah', af_nova: 'Nova', af_sky: 'Sky', af_alloy: 'Alloy', af_jessica: 'Jessica', af_river: 'River',
  bf_emma: 'Emma', bf_isabella: 'Isabella', bf_alice: 'Alice', bf_lily: 'Lily',
};

export function createHeadTTS(root: string): SpeechProvider {
  const template = JSON.parse(readFileSync(join(root, 'tts/headtts-cpu.json'), 'utf8'));
  let state: ProviderStatus = 'starting';
  let child: ChildProcess;

  function start() {
    // Resolve project-relative paths so the project can move.
    const cfg = structuredClone(template);
    cfg.tts.transformersModule = join(root, cfg.tts.transformersModule);
    cfg.tts.voicePath = join(root, cfg.tts.voicePath);
    mkdirSync(join(root, 'data'), { recursive: true });
    const cfgPath = join(root, 'data/headtts-config.json');
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

    // HeadTTS loads ./modules and ./dictionaries relative to its own folder.
    // nice 10: use idle cores, yield to the user's other work.
    child = spawn('nice', ['-n', '10', process.execPath, 'modules/headtts-node.mjs', '--config', cfgPath], {
      cwd: join(root, 'node_modules/@met4citizen/headtts'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', d => process.stdout.write(`[headtts] ${d}`));
    child.stderr?.on('data', d => process.stderr.write(`[headtts] ${d}`));
    child.on('exit', code => { state = 'down'; console.error(`[headtts] exited with code ${code}`); });
    process.on('exit', () => child.kill());
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { child.kill(); process.exit(0); });
    warmUp();
  }

  async function warmUp() {
    for (let i = 0; i < 300 && state !== 'down'; i++) {
      try {
        if ((await fetch(`${URL}/v1/hello`, { method: 'POST' })).ok) break;
      } catch {}
      await new Promise(r => setTimeout(r, 1000));
    }
    try {
      await synthesize('Ready.', template.tts.defaults.voice);
      state = 'ready';
      console.log('[headtts] ready');
    } catch (e) {
      state = 'down';
      console.error('[headtts] warm-up failed:', (e as Error).message);
    }
  }

  async function synthesize(text: string, voice: string): Promise<Synthesis> {
    const res = await fetch(`${URL}/v1/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: text, voice, language: 'en-us', speed: 1, audioEncoding: 'wav' }),
    });
    if (!res.ok) throw new Error(`HeadTTS HTTP ${res.status}: ${await res.text()}`);
    const { audio, words, wtimes, wdurations } = await res.json();
    return { audio, words, wtimes, wdurations };
  }

  return {
    id: 'headtts',
    model: `${template.tts.model}:${template.tts.dtype}`,
    defaultVoice: template.tts.defaults.voice,
    start,
    status: () => state,
    voices: () => Object.keys(VOICE_NAMES)
      .filter(id => template.tts.voices.includes(id))
      .map(id => ({
        id,
        name: VOICE_NAMES[id],
        gender: id[1] === 'm' ? 'male' : 'female',
        accent: id[0] === 'b' ? 'British' : 'American',
      })),
    synthesize,
  };
}
