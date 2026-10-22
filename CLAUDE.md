# Reader

## Project

A local read-aloud app for one user. Paste Markdown, press a button, hear it read with the sentence and the spoken word highlighted. It replaces Edge's Read Aloud, which keeps failing. A Node server and a plain browser page on localhost, with speech from HeadTTS (the Kokoro model, on CPU). Nothing is built yet: groundwork comes first.

- `docs/context/requirements.md`: what version 1 must do, and what groundwork still decides.
- `docs/context/headtts-setup.md`: how to run HeadTTS and call it.
- `docs/context/headtts-findings.md`: the prototype's test results.
- `docs/context/vision.md`: background only.
- `tts/`: the HeadTTS config and a client from the prototype.

## Rules

- **`ship-the-smallest-usable-version`** Build what `requirements.md` lists and nothing past it. The user needs it in use within days.
- **`no-notes`** Never run `flow note`. File deferred work and ideas as a ticket, or a line in a ticket's `## Tasks`.
- **`one-sentence-per-synthesis-call`** Send HeadTTS one sentence per request. A longer input changes the prosody, so cached audio and word timings stop matching.
- **`strip-punctuation-before-matching`** Strip punctuation from HeadTTS `words` and from page words before comparing them.
