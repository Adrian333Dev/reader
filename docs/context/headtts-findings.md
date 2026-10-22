# HeadTTS / Kokoro Timestamp Verification — Test Report

## Environment

| Item | Value |
|---|---|
| Date | 2026-07-22 |
| HeadTTS | `@met4citizen/headtts` v1.3.0 |
| Model | `onnx-community/Kokoro-82M-v1.0-ONNX-timestamped` |
| Transformers.js | `@huggingface/transformers` v4.2.0 |
| dtype / device | `q8` / `cpu` |
| Voice | `af_bella` |
| Speed | `1.0` |
| Sample rate | 24 000 Hz |
| Node | v24.15.0 |
| Platform | Linux (WSL2) |

Config: `headtts-cpu.json` (modified from the default: `device="cpu"`, `dtype="q8"`,
`transformersModule` set to absolute CJS path — see Setup note below).

---

## Top-line answers

### 1. Is chunk synthesis deterministic and context-independent? → Is caching by chunk text safe?

**Caching by chunk text is SAFE — with one critical constraint.**

- **Determinism**: YES. Synthesizing the same sentence string twice produces byte-identical PCM
  samples and identical `wtimes`/`wdurations` across every probe tested. (max_abs_diff = 0 in all
  cases.)

- **Context independence caveat**: NO — if you embed a sentence in a longer string and send it in
  one REST call, Kokoro processes all phonemes in a single model forward pass, and the sentence's
  prosody changes materially (all three probes came out 700–850 ms **shorter** when embedded vs
  standalone).

  However, this does NOT threaten the cache because the Reading Engine synthesizes each chunk as
  an independent REST call. As long as each chunk goes through `/v1/synthesize` on its own
  (`input` = just that chunk's text), the output is fully deterministic. **Never batch multiple
  chunks into one call and cache the parts.**

  **Cache key**: `hash(chunk_text + voice + speed + model)` — safe as designed.

### 2. Do timestamps stay in sync with audio?

**YES — no desync detected.** All 6 inputs in TEST 2 passed all invariants. Ratios of
`lastWordEnd / audioDurationMs` ranged from **0.83 to 1.01** — the sub-1.0 values simply reflect
trailing silence appended by the encoder. No instance of the known timestamp-drop bug (ratio << 1)
was observed.

### 3. How does HeadTTS tokenize/normalize tricky inputs?

**`words[]` preserves source text verbatim — no in-place expansion.** `$5` comes back as `"$5 "`
(not `"five "` + `"dollars "`), `£20` as `"£20 "`, `1999` as `"1999."`, `3.14` as `"3.14."`,
`Dr.` as `"Dr. "`. The G2P expansion to spoken phonemes happens internally for audio synthesis,
but the timestamp metadata stays aligned to the original text tokens. `words.join("")` exactly
reconstructs the original input string. **Source → spoken word alignment is 1:1 (no token
explosion), which is the best possible case for our word-highlighting implementation.**

---

## TEST 1 — Chunk independence + determinism

### Method

- **1a (Determinism):** synthesize each probe sentence twice with identical parameters; decode both
  WAVs to Int16 PCM; compare sample-by-sample and compare `wtimes` arrays.
- **1b (Context):** synthesize probe standalone; also synthesize `"Hello there. <probe> Goodbye
  now."` as a single string. Extract the probe's time segment from the combined WAV using the
  `wtimes` returned for those words; compare segment duration and PCM to standalone.

Probe sentences: `"The cat sat on the mat."` / `"She sells sea shells."` /
`"Numbers like 1999 matter."` — voice `af_bella`, speed 1.

### Results — 1a: Determinism

| Sentence | Samples (run 1 / run 2) | max\_abs\_diff | wtimes match | Verdict |
|---|---|---|---|---|
| The cat sat on the mat. | 49 200 / 49 200 | **0** | ✓ | DETERMINISTIC |
| She sells sea shells. | 49 200 / 49 200 | **0** | ✓ | DETERMINISTIC |
| Numbers like 1999 matter. | 77 400 / 77 400 | **0** | ✓ | DETERMINISTIC |

→ **All deterministic. Byte-identical PCM and wtimes across runs.**

### Results — 1b: Context independence

| Sentence | Standalone dur | Embedded segment dur | Δ dur | Context changes audio? |
|---|---|---|---|---|
| The cat sat on the mat. | 2 050 ms | 1 325 ms | −725 ms | **YES** |
| She sells sea shells. | 2 050 ms | 1 357 ms | −693 ms | **YES** |
| Numbers like 1999 matter. | 3 225 ms | 2 374 ms | −851 ms | **YES** |

All three embedded segments differ in length and PCM from the standalone version.
The embedded segments are 700–850 ms shorter — Kokoro compresses prosody (faster, less pause) when
it sees more surrounding context in one forward pass.

**Verdict:** Context-independent synthesis is not a Kokoro property, it is a *usage constraint*.
Synthesizing each chunk as a separate REST call (which the Reading Engine already does) guarantees
determinism and makes caching safe.

---

## TEST 2 — Timestamp / audio integrity

### Method

POST each input to `/v1/synthesize`; assert:
- `words.length === wtimes.length === wdurations.length`
- `wtimes` non-decreasing; all `wtimes ≥ 0`; all `wdurations > 0`; no `NaN`/`undefined`
- `lastWordEnd = wtimes[last] + wdurations[last]` is within `audioDurationMs + 200 ms` tolerance
  and ratio `lastWordEnd / audioDurationMs ≥ 0.5`

Audio duration computed from the WAV header (24 000 Hz sample rate).

### Results

| Input | #Words | Audio (ms) | LastEnd (ms) | Ratio | Inv | Bound | NotShort | PASS |
|---|---|---|---|---|---|---|---|---|
| `$5` | 1 | 1 350 | 1 119 | 0.829 | OK | ✓ | ✓ | ✓ |
| `1999` | 1 | 1 975 | 1 808 | 0.915 | OK | ✓ | ✓ | ✓ |
| `Dr. Smith` | 2 | 1 925 | 1 669 | 0.867 | OK | ✓ | ✓ | ✓ |
| `3.14` | 1 | 2 050 | 1 771 | 0.864 | OK | ✓ | ✓ | ✓ |
| `Hello world.` | 2 | 1 650 | 1 644 | 0.996 | OK | ✓ | ✓ | ✓ |
| (multi-clause, 24 words) | 24 | 9 250 | 9 317 | 1.007 | OK | ✓ | ✓ | ✓ |

→ **All invariants pass. No desync detected.** Ratios < 1.0 reflect trailing silence; the single
ratio > 1.0 (1.007) is within tolerance.

The ratios for single-word "number" inputs (`$5`, `1999`, `3.14`) cluster around 0.83–0.92 because
HeadTTS appends a fixed silence pad after the spoken sequence ends.

---

## TEST 3 — Spoken-tokenization golden set

### Method

Synthesize the three golden sentences; record `words[]`, `wtimes`, `wdurations`.

### Results

**`"I paid $5 today."`**
```
words:      ["I ", "paid ", "$5 ", "today."]
wtimes:     [454,   641,    930,   1213]
wdurations: [207,   309,    303,    875]
joined:     "I paid $5 today."
```

**`"It cost £20 in 1999."`**
```
words:      ["It ", "cost ", "£20 ", "in ", "1999."]
wtimes:     [439,    623,    970,   1346,  1434]
wdurations: [204,    367,    396,    108,  1561]
joined:     "It cost £20 in 1999."
```

**`"Dr. Smith read 3.14."`**
```
words:      ["Dr. ", "Smith ", "read ", "3.14."]
wtimes:     [454,    1242,    1519,   1775]
wdurations: [808,     297,     276,   1523]
joined:     "Dr. Smith read 3.14."
```

### Analysis

| Token | Returned as | Expansion in `words[]`? | Notes |
|---|---|---|---|
| `$5` | `"$5 "` | No | Spoken internally, returns source token |
| `£20` | `"£20 "` | No | Same — pound symbol kept |
| `1999` | `"1999."` | No | Spoken as "nineteen ninety-nine" internally |
| `3.14` | `"3.14."` | No | Spoken as "three point one four" internally |
| `Dr.` | `"Dr. "` | No | Spoken as "Doctor" internally |

- `words.join("")` reconstructs the original input string exactly for all three cases.
- Word mapping is **1:1**: each source text token (including special forms) maps to exactly one
  `words[]` entry and one timestamp span.
- The 808 ms duration for `"Dr. "` is consistent with "Doctor" being spoken (roughly 2 syllables
  at moderate pace, with preceding silence).
- One challenge for source→spoken alignment: `"1999."` ends with the sentence period attached to
  the number. The aligner will need to strip trailing punctuation before matching to the on-screen
  source word.

---

## Surprises / recommendations

1. **Module resolution gotcha (setup):** The npm-installed package's Worker thread cannot resolve
   `@huggingface/transformers` by bare specifier because Node ESM workers resolve relative to the
   worker file's location, not the parent process. Fix: set `transformersModule` in the config to
   the absolute path of `transformers.node.cjs`. This is already done in `headtts-cpu.json`.

2. **Array input to the REST API** is accepted but expected to be an array of *strings* (or special
   object items like `{ type: "silence", ... }`). Passing `[{ input: "..." }]` silently produces
   empty words with short audio — not useful. Always send strings in the array, or just use a
   single string (which is what the Reading Engine will do anyway).

3. **Cache key is safe, not redundant.** Since the model is deterministic and chunks are always
   synthesized independently, the cache key `hash(text + voice + speed + model)` is sufficient.
   No neighbor context needs to be included.

4. **Timestamp trailing-silence gap**: The typical ratio of `lastWordEnd / audioDurationMs` is
   ~0.83–0.92 for short inputs, meaning 8–17% of audio duration is post-word silence. The audio
   player can stop highlight advancement after `lastWordEnd` without waiting for the silent tail.

5. **Punctuation attachment in `words[]`**: Sentence-ending punctuation attaches to the last word
   token (`"mat."`, `"1999."`, `"3.14."`). The aligner should normalize both source and spoken
   tokens by stripping punctuation before matching.

---

## Artifacts

| File | Contents |
|---|---|
| `artifacts/test1-results.json` | Raw TEST 1 results (determinism + context PCM comparisons) |
| `artifacts/test2-results.json` | Raw TEST 2 per-input table |
| `artifacts/test3-golden.json` | Golden tokenization records |
| `artifacts/probe-standalone.wav` | "The cat sat on the mat." synthesized standalone |
| `artifacts/hello-world.wav` | "Hello world." synthesized standalone |
| `artifacts/dr-smith.wav` | "Dr. Smith read 3.14." synthesized standalone |

Scripts retained: `synth.mjs`, `test1-determinism.mjs`, `test2-timestamps.mjs`,
`test3-tokenization.mjs`.
