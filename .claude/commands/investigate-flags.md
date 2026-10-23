---
description: Work through the open pronunciation flags and the most frequent unknown words, one fix at a time
---

Investigate the open pronunciation flags. Follow `pronunciation/investigate.md` exactly: it holds the causes, the file formats, Kokoro's sound alphabet and the lookup order. Read it whole first, then `pronunciation/fixes.tsv`, `pronunciation/units.tsv` and `pronunciation/sites.json`.

The tools, all through `pnpm flags` (`scripts/flags.ts` lists every option):

- `pnpm flags list`: the open flags. `pnpm flags unknown 20`: the most frequent words nothing knew.
- `pnpm flags replay <id> --fix "word|action|value|condition" --play`: plays the audio the flag saved, then the sentence made again with the proposed fix. Nothing on disk changes. `--unit` and `--site` do the same for `units.tsv` and `sites.json`.
- `pnpm flags close <id> --outcome fixed --fix "…" --check <word>`: on the user's yes, writes the fix line, writes the test line to `pronunciation/checks.jsonl` and closes the flag. `--outcome ticket --detail "<ticket id>"` closes a flag that became a ticket. `--outcome nofault` closes one that was not a fault. `pnpm flags add --fix "…" --check <word> --text "<sentence>"` does the same for an unknown word with no flag.

For each flag, in order:

1. Say the cause, the evidence from its `input`, and the proposed fix, in the report shape of `investigate.md`.
2. Replay it with the fix. Ask the user to listen to the "after" file and say whether it sounds right.
3. Only when the user says yes, run `close`. A fix the user rejects is revised and replayed; a fault of a new kind becomes a ticket (`flow new`), never a quick patch.

Then do the same for the unknown words whose guess is wrong. At the end run `pnpm test`.
