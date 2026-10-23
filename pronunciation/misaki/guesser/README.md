---
license: apache-2.0
language:
  - en
library_name: onnxruntime
pipeline_tag: text-to-speech
base_model: PeterReid/graphemes_to_phonemes_en_us
tags:
  - phonemizer
  - g2p
  - grapheme-to-phoneme
  - onnx
  - kokoro
  - misaki
  - tts
---

# misaki G2P (US English) — ONNX

The phonemizer for **Kokoro 82M**, packaged to run on **onnxruntime alone** — no
PyTorch, no spaCy, and no espeak-ng.

It brings together what misaki uses for US English: its word lists, plus the
small neural model it falls back to for words that aren't in them.

## Files

| File | Size | SHA-256 |
|---|---:|---|
| `misaki-en_us-g2p.onnx` | 3,438,244 B | `757759c3e3ccb0bf59c379b1671c9834a27543ceaefd6846850823633b9665a1` |
| `misaki-en_us-g2p.json` | 5,724,857 B | `8a8e3350713b0a00102425a5d5bd6b58b34854c74a3e8d837589f55212c51658` |

- **`.onnx`** — the BART fallback model
  ([`PeterReid/graphemes_to_phonemes_en_us`](https://huggingface.co/PeterReid/graphemes_to_phonemes_en_us)),
  one full forward pass per decoding step.
- **`.json`** — the grapheme and phoneme tables and special ids; misaki's
  `us_gold` and `us_silver` word lists; and Kokoro v1.0's phoneme-to-token
  vocabulary (from [`hexgrad/Kokoro-82M`](https://huggingface.co/hexgrad/Kokoro-82M)
  `config.json`), so the output feeds Kokoro directly.

## How it was made

Built from misaki at `fba1236595f2` with transformers 5.17, using
[`scripts/phonemizer_misaki_g2p_onnx.py`](https://github.com/ArcadiaLabsLLC/hermes-agent/blob/main/scripts/phonemizer_misaki_g2p_onnx.py).

**Checked:** on 500 words, the ONNX model and the original PyTorch model decoded
identically for **500 / 500**.

## Using it

A runner that loads both files is
[`agent_runtime/speech_phonemize.py`](https://github.com/ArcadiaLabsLLC/hermes-agent/blob/main/agent_runtime/speech_phonemize.py)
(`MisakiG2P`).

**Known limit:** full misaki uses spaCy to tag each word's part of speech, so
it can tell apart words spelled the same but said differently ("I **read** it
yesterday" / "I **read** every day"). This package has no tagger, so such words
always get their most common pronunciation.

## Credits and licence

- Word lists and G2P logic: **misaki**, Apache-2.0.
- Fallback model: **PeterReid/graphemes_to_phonemes_en_us**, Apache-2.0.
- Vocabulary: **hexgrad/Kokoro-82M**, Apache-2.0.
- ONNX conversion and packaging: made for the Eternia launcher; released under
  Apache-2.0.

The ONNX export is not byte-for-byte reproducible between runs, so the
checksums above are the ones for the files published here.