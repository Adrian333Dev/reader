# Requirements, version 1

From the user, 2026-10-22. The goal is the simplest version they can use at once. It replaces Edge's Read Aloud, which keeps failing.

## The app

- A web page opened from localhost. No hosting.
- A local Node server behind it talks to HeadTTS.

## Documents

- Pasting content creates a new document. Markdown.
- Many documents exist side by side. The user switches between them.
- A document stays saved until the user deletes it.
- The user can create and delete documents.

## Reading

- The Markdown renders as a readable page.
- One button starts reading it aloud.
- Two highlights run together:
  - The sentence being read: a faint highlight.
  - The word being spoken inside it: a strong highlight.
- Clicking any word jumps playback there and reading continues from it.

## Speed

- Streaming: audio starts after the first sentence. Later sentences are synthesized while earlier ones play.
- Parallel streaming: several sentences are synthesized at once.

## Open for groundwork

- Layout: the user decides it in groundwork.
- Where documents are stored: browser storage or files on disk.
- Whether parallel synthesis speeds up CPU synthesis. HeadTTS runs `threads: 1`. Measure first.
- Pause and resume, speed and voice controls.
- Caching audio by sentence. The findings say the cache key is safe.

## Out of scope

`vision.md` describes a multi-client platform with a browser extension. Version 1 builds none of it.
