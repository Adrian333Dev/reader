# Running HeadTTS

HeadTTS is a Node server that turns text into speech with the Kokoro model and returns a timestamp for every word. Verified on 2026-07-22 in the `tts-lab` prototype (`headtts-findings.md`).

- **Install**: `npm install` in the project root.
- **Config**: `tts/headtts-cpu.json`. CPU, `q8`, voices `af_bella` and `am_fenrir`, port 8882, `threads: 1`. `transformersModule` is an absolute path into this project's `node_modules`. Fix it if the project moves.
- **Start**: from the project root, `(cd node_modules/@met4citizen/headtts && node modules/headtts-node.mjs --config "$OLDPWD/tts/headtts-cpu.json")`. The server loads `./modules`, `./dictionaries` and `./voices` by relative path, so it must start in that folder. The npm package ships all three.
- **First request**: downloads the model once. Allow several minutes.
- **Device**: keep `cpu`. The default `webgpu` is unreliable in Node.
- **Client**: `tts/synth.mjs`. Run it directly for a smoke test.

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
