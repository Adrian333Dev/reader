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
- Code blocks are skipped, whatever the language, JSON included. They stay on the page but are not read. Prose is read.

## Speed

- Streaming: audio starts after the first sentence. Later sentences are synthesized while earlier ones play.
- Synthesis runs ahead: 8 sentences are ready before they are needed.

## Added in groundwork, 2026-10-22

Ticket `rd-1` holds the reasons.

- Ctrl+V anywhere on the page creates a document from the clipboard. Upload of `.md` and `.txt` files is the secondary path.
- Documents are listed newest first, and renamed by double-click or from the title.
- Selecting text and pressing Space, or the Read button, starts reading there.
- A bottom player: progress, previous and next sentence, a round play button, voice and speed.
- Each document remembers where reading stopped. Sentences already heard replay from a disk cache.
- Documents are files on disk under `data/`.
- Several parallel synthesis workers measured slower than one, so one worker runs at low priority.

## Out of scope

`vision.md` describes a multi-client platform with a browser extension. Version 1 builds none of it.
