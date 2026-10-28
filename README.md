# Reader

Paste Markdown, press play, and hear it read aloud while the sentence and the spoken word light up on the page. Speech runs on your own machine: free, offline, no account.

> **Early prototype.** It works well enough for its author's daily reading, and it has many rough edges. See [Current limitations](#current-limitations).

## Table of contents

- [Why](#why): the problem it solves
- [What it does](#what-it-does): the features that work today
- [Current limitations](#current-limitations): what is missing or broken
- [Where it is going](#where-it-is-going): the engine, and read-aloud inside Claude Code
- [Run it](#run-it): install and start
- [How it is built](#how-it-is-built): the parts and the tools behind them

## Why

Reading long text is slow and tiring, and AI tools now write more text than anyone can comfortably read. I have ADHD: in a long reply I lose my place, and my focus drifts. Listening while a highlight follows the voice keeps me on the text, and I get through far more of it.

Reader started as a replacement for Microsoft Edge's Read Aloud, which kept failing.

## What it does

- **2 highlights at once**: a faint background on the sentence being read, and a stronger one on the spoken word, moving left to right through it.
- **The page is the remote**: click any word to continue from there. Select text and press Space to start from it. Space plays and pauses, and the arrow keys move a sentence.
- **Markdown drawn like GitHub**, with coloured code blocks.
- **Tabs**: Ctrl+V anywhere makes a new document from the clipboard. Each document remembers where you stopped.
- **Local speech**: the Kokoro voice model, run by HeadTTS on the CPU, with 28 English voices. Audio starts after the first sentence, the next sentences are made while it plays, and sentences already heard come from a cache.
- **A pronunciation layer** before the voice: dictionaries, a part-of-speech tagger for words like "use", a guesser for unknown words, and readable file paths and links. Right-click a word and pick **Flag…** to report one read wrong.

## Current limitations

- **Pronunciation is still rough.** Some words come out wrong ("reworded" as "rayworded"), short words get swallowed ("want it" as "wanna"), and pauses after a colon or a heading are missed. Technical terms and command names are often misread. Each fix comes from a flag, one at a time.
- **Code blocks are not read.** They show on the page and are skipped.
- **Only on your own machine.** A Node server and a web page on `localhost`, with no hosted version and no browser extension.
- **Tested on one machine**: Windows with WSL (Ubuntu), Node 24, speech on the CPU. Starting the speech server uses `nice`, so plain Windows and macOS need changes.
- **The first start is slow**: HeadTTS downloads the voice model on its first request, which takes several minutes.
- **Few tests**: the pronunciation layer has some, the page has none.

## Where it is going

Reader is the first client of a **reading engine**, not a text-to-speech app. The engine turns any text into speech, with every word kept in step with the page, so the reading stays interactive: highlight, click, jump, continue.

1. **Split the engine out of the page.** Speech, word timing and pronunciation become a local service that any client can use.
2. **Read-aloud inside Claude Code.** A Claude Code plugin sends each reply to the engine and highlights it in the chat itself. 3 limits of Claude Code's plugin API block it today; each has an open feature request:
   - [#105558](https://github.com/anthropics/claude-code/issues/105558): highlight words inside a reply without losing its formatting
   - [#105559](https://github.com/anthropics/claude-code/issues/105559): keep the highlighted word on screen as the speech moves down
   - [#105560](https://github.com/anthropics/claude-code/issues/105560): read the engine's replies as they arrive

   A 👍 on them helps the Claude Code team see the demand.
3. **More clients**: a browser extension that reads any page, and editor integrations.
4. **Code read by meaning**: a reader per language that says what the code does, never character by character.
5. **Any voice**: the speech provider is one swappable part, so a cloud voice or a newer local model fits without touching the highlighting.

## Run it

Needs Node 24 or newer and pnpm, on Linux or WSL.

```sh
pnpm install
pnpm approve-builds --all
pnpm start
```

Then open `http://localhost:4400`. The first sentence waits for the voice model's download.

## How it is built

- `server/`: the Node server. It stores documents, runs the pronunciation layer, and calls HeadTTS one sentence at a time.
- `web/`: the page, in React with Vite, Tailwind and shadcn/ui. `web/src/reading/` splits sentences, plays audio and moves the highlights.
- `pronunciation/`: the fix lists and misaki's dictionaries, explained in its own `README.md`.
- `tts/`: the HeadTTS config and the voice files.

Built on [HeadTTS](https://github.com/met4citizen/HeadTTS), [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M), [misaki](https://github.com/hexgrad/misaki), [compromise](https://github.com/spencermountain/compromise) and [Shiki](https://shiki.style).
