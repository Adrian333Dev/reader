# Pronunciation data

How Reader says words, read by `server/pronunciation.ts`. Each file is reloaded when it changes, so an edit takes effect on the next sentence made. The design is in ticket rd-7.

## fixes.tsv

Fixes come before every other source. Tab-separated, with a header row and 4 fields on every row:

```text
word	action	value	condition
src	say	S R C	
read	sound	ɹˈɛd	after:is,are,was
```

- `word`: the word as written. A word capitalised only because it starts a sentence is keyed in lower case. A link or path is keyed by its exact text.
- `action`: `say` speaks the words in `value` instead, each looked up in turn. `sound` uses `value` as Kokoro phonemes, the sound spelling the speech model reads.
- `condition`: empty, `before:a,an,the` (the next word is one of these) or `after:is,was` (the word before is one of these). A fix whose condition holds wins over one with none.

## units.tsv

Units read as words right after a number: "150ms", "60 km/h" (rd-12). Matched as written, so "MB" and "Mb" differ. Tab-separated, with a header row and 3 fields on every row: `unit`, `singular` (after 1), `plural`.

## checks.jsonl

One line per fix confirmed in an investigation: a sentence and the sounds its word must keep. `pnpm test` checks every line, so a later change that breaks a fix fails and names the word.

```text
{"text":"Use an inline scrollbar here.","word":"inline","phonemes":"ˈɪnlˌIn"}
```

## investigate.md

The instructions for an investigation, written to stand alone: the causes, the file formats, Kokoro's sound alphabet and the lookup order. Any model can follow them, a free external one included. `pnpm flags bundle` prints this file plus the current files, the open flags and the most frequent unknown words, to paste into a model that has no access to the repo. A model with tools runs the Claude Code command `/investigate-flags` (`.claude/commands/investigate-flags.md`) instead.

`pnpm flags` (`scripts/flags.ts`) is the tool for both. `list` shows the open flags, `unknown` the words nothing knew, `replay <id> --fix "…"` plays the flag's saved audio and then the sentence made again with the proposed fix, and `close <id>` writes the confirmed fix and its test line and closes the flag. A closed flag is a line in `data/pronunciation/flags-closed.jsonl`; `flags.jsonl` is never edited.

## sites.json

Site exceptions for the link reader (`server/spoken.ts`): a site's spoken name, its search parameter, and address parts to drop. A new site needs a line here, never code.

## misaki/

misaki's dictionaries (`us_gold.json`, `us_silver.json`) and its guesser model (`guesser/`), Apache 2.0. Kokoro learned its sounds from them.
