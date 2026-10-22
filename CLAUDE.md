# Reader

## Project

A local read-aloud app for one user. Paste Markdown, press a button, hear it read with the sentence and the spoken word highlighted. It replaces Edge's Read Aloud, which keeps failing. A Node server and a React page on localhost, with speech from HeadTTS (the Kokoro model, on CPU). `pnpm start` builds the page and serves it at `http://localhost:4400`, which Windows opens too. `pnpm dev` runs the server with Vite's live-reload page on port 5173. `pnpm service on|off|start|stop|restart|status` (`scripts/service.ts`) keeps `pnpm start` running as a systemd user service; while it is on, code changes take effect only after `pnpm service restart`. Ticket `rd-1` holds the design decisions.

- `server/main.ts`: HTTP routes and the built page. `server/store.ts`: documents in `data/docs/`, tabs in `data/tabs.json`, settings in `data/settings.json`, and the archived groups in `data/groups.json`. A test server runs with `READER_DATA=tmp/e2e/data`, since the user's service on port 4400 reads and writes `data/` live. `server/speech.ts`: the sentence cache in `data/cache/`. `server/providers/headtts.ts`: starts and calls HeadTTS. A new speech engine is a new provider of the shape in `server/providers/types.ts`. Node 24 runs the `.ts` files directly.
- `web/`: the page, React with TypeScript, Vite, Tailwind and shadcn components (`web/src/components/ui/`, added with `pnpm dlx shadcn@latest add`). `web/src/reading/`: Markdown rendering and sentence splitting (`render.ts`, `segment.ts`), playback and word timing (`player.ts`), the highlight boxes (`highlighter.ts`). `web/src/components/`: tab bar, reader view, player bar. `web/src/archive/`: the grouped sidebar and the Library sidebar, both replaced by tabs and kept whole so they can return.
- `docs/context/requirements.md`: what version 1 must do.
- `docs/context/headtts-setup.md`: how HeadTTS runs and is called.
- `docs/context/headtts-findings.md`: the prototype's test results.
- `docs/context/vision.md`: background only.
- `tts/`: the HeadTTS config, the 28 English voice files, and a client from the prototype.

## Rules

- **`prototype-mode`** Build fast and improve by use: the user needs it working within hours. Make the technical calls yourself and name each in one line. Add what makes the app usable past `requirements.md`. Ask the user only about requirements, layout and features.
- **`pnpm-only`** Install and run with pnpm, never npm. A dependency with a build script needs `pnpm approve-builds`.
- **`user-commits`** The user commits. Never commit, and never suggest a commit or end a reply with one.
- **`no-notes`** Never run `flow note`. File deferred work and ideas as a ticket, or a line in a ticket's `## Tasks`.
- **`one-sentence-per-synthesis-call`** Send HeadTTS one sentence per request. A longer input changes the prosody, so cached audio and word timings stop matching.
- **`strip-punctuation-before-matching`** Strip punctuation from HeadTTS `words` and from page words before comparing them.
