# Running HeadTTS

HeadTTS is a Node server that turns text into speech with the Kokoro model and returns a timestamp for every word. Verified on 2026-07-22 in the `tts-lab` prototype (`headtts-findings.md`).

- **Install**: `pnpm install` in the project root. pnpm blocks the build scripts of `@met4citizen/headtts`, `onnxruntime-node` and `protobufjs`. `pnpm approve-builds --all` runs them and records them under `allowBuilds` in `pnpm-workspace.yaml`.
- **Config**: `tts/headtts-cpu.json`. CPU, `fp32`, `threads: 1`, port 8882, the 28 English voices, default `am_michael`. `transformersModule` and `voicePath` are relative to the project root.
- **Voices**: the npm package ships no `voices/` folder. The 28 English voice files sit in `tts/voices/`, copied from the `kokoro-js` package, which uses the same format.
- **Start**: `pnpm start` runs `server/main.ts`. It writes `data/headtts-config.json` with absolute paths, then starts HeadTTS at `nice 10` inside `node_modules/@met4citizen/headtts`. HeadTTS loads `./modules` and `./dictionaries` by relative path, so it must start in that folder.
- **First request**: downloads the model once into `@huggingface/transformers/.cache` inside `node_modules`. Allow several minutes. A fresh install loses it.
- **Speed** (measured 2026-10-22, 16 cores): `fp32` with 1 worker makes speech 4× faster than playback; `q8` only 1.4×. 2 or 4 workers are slower than 1, because one worker already uses every core.
- **Device**: keep `cpu`. The default `webgpu` is unreliable in Node. `cuda` fails with `libcublasLt.so.13: cannot open shared object file` until the CUDA 13 libraries are installed in WSL.
- **Client**: `tts/synth.mjs`. Run it directly for a smoke test while HeadTTS runs.

## Calls

`POST http://localhost:8882/v1/hello` answers with the version. Use it as a readiness check.

`POST http://localhost:8882/v1/synthesize`:

```json
{ "input": "This is an example.", "voice": "af_bella", "language": "en-us", "speed": 1, "audioEncoding": "wav" }
```

```json
{ "audio": "<base64 WAV>", "words": ["This ", "is ", "an ", "example."],
  "wtimes": [440, 656, 876, 1050], "wdurations": [236, 240, 194, 1035] }
```

- `input` is one string of up to 500 characters. Send one sentence per call.
- `wtimes` and `wdurations` are milliseconds from the start of that call's audio.
- `words` keeps the source text. `$5` stays `"$5 "`. `words.join("")` equals the input.
- Sentence-ending punctuation attaches to the last word (`"example."`). Strip it before matching to the page.
- An array `input` must hold strings.
