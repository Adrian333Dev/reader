# Reading Engine vision (background only)

Written before version 1 was narrowed. `requirements.md` decides what gets built. The sections on platform, multiple clients and the browser extension are not in version 1.

---

# Reading Engine — Product Vision

## Overview

The Reading Engine is an open-source platform for synchronized text-to-speech that transforms rendered content into an interactive reading experience. Rather than functioning as a traditional TTS application, the Reading Engine provides a unified playback system that combines high-quality speech synthesis with precise, real-time synchronization between spoken audio and the original content.

The core objective is to reproduce—and eventually surpass—the reading experience offered by Microsoft Edge's Read Aloud feature while remaining browser-independent, extensible, and provider-agnostic.

The Reading Engine is designed as a platform rather than a single application. Multiple clients should be able to connect to the same engine, allowing the same reading experience to exist across browsers, desktop applications, and future integrations.

---

# Product Goals

The Reading Engine should provide a reading experience that feels natural, interactive, and tightly coupled with the content being consumed.

Its primary goals are:

- High-quality, natural speech synthesis.
- Precise word-level synchronization between spoken audio and rendered content.
- Immediate interaction with the document during playback.
- Browser-first experience without being limited to browsers.
- Provider-independent speech generation.
- Extensible architecture capable of supporting multiple clients.

The engine should prioritize the reading experience rather than speech generation alone.

---

# Product Identity

The Reading Engine is **not** a text-to-speech application.

Text-to-speech is only one component of the overall system.

The actual responsibility of the Reading Engine is to transform rendered content into an interactive reading experience by combining:

- content processing,
- speech generation,
- synchronization,
- playback,
- highlighting,
- navigation,
- and user interaction.

Speech synthesis is an implementation detail within a much larger reading pipeline.

---

# Core Principles

## Reading First

Every design decision should improve the reading experience rather than optimize speech generation in isolation.

The user should feel like they are reading alongside the audio instead of simply listening to generated speech.

---

## Playback and Highlighting Are One System

Playback and highlighting must never be treated as separate features.

They represent different views of the same reading state.

Whenever playback advances, highlighting advances.

Whenever the user interacts with highlighted content, playback immediately reflects that interaction.

Both remain synchronized at all times.

---

## The Document Is the Primary Interface

The content itself is the playback interface.

Rather than relying primarily on transport controls, users interact directly with the document.

Examples include:

- selecting content to begin reading,
- clicking another word while playback is active,
- immediately continuing reading from the newly selected position.

The document should always feel interactive.

---

## Content-Agnostic Design

The Reading Engine should not depend on the origin or format of content.

Clients are responsible for extracting content from their respective environments.

Once extracted, every source should be treated identically.

Potential content sources include:

- HTML
- Markdown
- PDF
- documentation
- articles
- rendered applications
- future desktop applications

The engine should never require source-specific behavior.

---

## Provider Independence

Speech generation should remain independent from the rest of the reading pipeline.

The engine should support multiple speech providers without affecting playback behavior.

Possible providers include:

- local AI models
- cloud providers
- future custom engines

Changing the speech provider should never require changes to synchronization, playback, or highlighting.

---

# User Experience

The intended reading workflow is intentionally simple.

1. The user selects rendered content.
2. Reading begins immediately.
3. Spoken audio and highlighting remain synchronized.
4. The user may pause or resume at any time.
5. The user may click anywhere within the selected content.
6. Playback immediately continues from the newly selected location.
7. Highlighting instantly follows the new playback position.

The experience should feel immediate and responsive.

Users should never feel like they are controlling an audio player.

Instead, they should feel like they are navigating a living document.

---

# Synchronization Philosophy

Synchronization is the defining capability of the Reading Engine.

Every rendered reading unit (typically a word) should exist as part of a unified playback timeline.

Each reading unit conceptually contains:

- its logical position within the content,
- its visual position inside the rendered document,
- its corresponding spoken position within playback.

This unified representation enables:

- precise highlighting,
- accurate playback,
- seamless seeking,
- pause and resume,
- direct interaction with the document,
- future multi-client synchronization.

The playback timeline is therefore not merely an audio timeline.

It is a representation of the document itself.

---

# Interactive Reading

Reading should remain interactive throughout playback.

Users should never be forced to stop playback before navigating elsewhere in the content.

If a user clicks another word while reading:

- playback immediately moves to that location,
- highlighting updates,
- speech continues naturally from the selected position.

This behavior should feel instantaneous.

The document should always remain fully interactive.

---

# Browser-First Approach

Version 1 focuses on browser-based reading.

The browser client should allow users to select rendered content directly from webpages and begin reading immediately.

The initial focus is HTML content, while keeping the design flexible enough to support additional rendered formats in the future without requiring changes to the engine itself.

Future versions may introduce specialized integrations for selected websites where a more seamless experience is possible.

These integrations are enhancements rather than requirements.

---

# Extensibility

The Reading Engine is intended to become a reusable platform.

The core engine should be capable of serving multiple clients simultaneously.

Potential future clients include:

- browser extensions,
- desktop applications,
- dedicated document readers,
- editor integrations,
- external applications through a public API.

Every client should share the same reading behavior and synchronization model.

---

# Design Philosophy

The Reading Engine should feel invisible.

The user should not think about speech synthesis, synchronization, or playback management.

They should simply select content and read naturally alongside the generated speech.

Every interaction should reinforce the feeling that the document itself is alive—continuously synchronized with spoken audio and immediately responsive to user input.

The ultimate goal is not to build another text-to-speech tool.

The goal is to establish a universal reading engine capable of delivering a consistent, high-quality reading experience across any rendered content, regardless of where that content originates.
