// Plays sentences in order, keeps a few synthesized ahead, and reports the spoken word.
import { synth, type Synthesis } from "@/lib/api"
import type { Sentence } from "./segment"

const AHEAD = 8           // sentences synthesized ahead of the one playing
const LEAD_MS = 150       // audio kept before the first word
const BLOCK_PAUSE_MS = 250 // extra pause before a new paragraph, heading or list item

export type PlayState = "paused" | "loading" | "playing"
type Clip = { url: string; times: { start: number; end: number }[] }
type Current = { index: number; audio: HTMLAudioElement; clip: Clip }

export class Player {
  sentences: Sentence[] = []
  pageWords: string[][] = []  // per sentence, the page's words, for matching
  voice = ""
  speed = 1
  index = 0
  state: PlayState = "paused"
  onPosition: (sentence: number, word: number) => void = () => {}
  onError: (error: Error) => void = () => {}

  // Speech rate at 1×, learned from every sentence made; 15 characters a second until the first arrives.
  private rate = { chars: 0, ms: 0 }
  private cache = new Map<string, Promise<Clip>>()
  private lengths = new Map<string, number>() // played length at 1× of each sentence made, by cache key
  private current: Current | null = null
  private run = 0
  private aborter = new AbortController() // cancels the speech requests of the document loaded before
  private listeners = new Set<() => void>()
  private snapshot = { state: this.state, index: 0 }

  // React reads { state, index } through useSyncExternalStore.
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  getSnapshot = () => this.snapshot
  private emit() {
    this.snapshot = { state: this.state, index: this.index }
    this.listeners.forEach(fn => fn())
  }

  // A new document: playback stops, and the request still on its way for the old one is cancelled.
  // Loading starts no synthesis; only Play does.
  load(sentences: Sentence[], pageWords: string[][], index = 0) {
    this.stop()
    this.aborter.abort()
    this.aborter = new AbortController()
    for (const p of this.cache.values()) p.then(c => URL.revokeObjectURL(c.url), () => {})
    this.cache.clear()
    this.lengths.clear()
    this.sentences = sentences
    this.pageWords = pageWords
    this.index = Math.min(index, Math.max(0, sentences.length - 1))
    this.emit()
  }

  setVoice(voice: string) {
    if (voice === this.voice) return
    this.voice = voice
    this.current = null // paused audio is in the old voice
    if (this.state !== "paused") this.play(this.index)
  }

  setSpeed(speed: number) {
    this.speed = speed
    if (this.current) this.current.audio.playbackRate = speed
  }

  toggle() {
    if (this.state !== "paused") return this.pause()
    // Resume mid-sentence when the paused audio is still the current sentence.
    const c = this.current
    if (c && c.index === this.index && !c.audio.ended) {
      const run = ++this.run
      c.audio.playbackRate = this.speed
      c.audio.play().then(() => { this.setState("playing"); this.loop(run) })
    } else this.play(this.index)
  }

  pause() {
    this.current?.audio.pause()
    this.run++
    this.setState("paused")
  }

  stop() {
    this.pause()
    if (this.current) this.current.audio.src = ""
    this.current = null
  }

  // Seconds left at the current speed. Sentences already made count their real length, the playing one only
  // what is left of its audio; the rest are estimated from the speech rate learned so far.
  remaining() {
    const cps = this.rate.ms ? (this.rate.chars * 1000) / this.rate.ms : 15
    let ms = 0
    for (let i = this.index; i < this.sentences.length; i++) {
      const s = this.sentences[i]
      if (i > this.index && s.newBlock) ms += BLOCK_PAUSE_MS
      const c = this.current
      if (i === this.index && c?.index === i && !c.audio.ended) ms += c.audio.duration * 1000 - c.audio.currentTime * 1000
      else ms += this.lengths.get(`${this.voice}|${i}`) ?? (s.text.length / cps) * 1000
    }
    return Math.max(0, ms) / 1000 / this.speed
  }

  next() { if (this.index < this.sentences.length - 1) this.jump(this.index + 1) }
  prev() { if (this.index > 0) this.jump(this.index - 1) }

  // Move without changing play or pause.
  jump(index: number, word = 0) {
    if (this.state === "paused") {
      this.index = index
      this.current = null
      this.onPosition(index, -1)
      this.emit()
    } else this.play(index, word)
  }

  async play(index = this.index, word = 0) {
    if (!this.sentences.length) return
    const run = ++this.run
    this.current?.audio.pause()
    this.index = index
    this.onPosition(index, -1)
    // Already playing (the next sentence, a jump, a new voice): stay "playing", so the button doesn't flicker.
    if (this.state === "paused") this.setState("loading")
    this.prefetch(index, run)
    let clip: Clip
    try {
      clip = await this.clip(index)
    } catch (e) {
      if (run === this.run) { this.setState("paused"); this.onError(e as Error) }
      return
    }
    if (run !== this.run) return

    const audio = new Audio(clip.url)
    audio.preservesPitch = true
    audio.playbackRate = this.speed
    await new Promise(r => audio.addEventListener("loadedmetadata", r, { once: true }))
    if (run !== this.run) return
    const startMs = word > 0 && clip.times[word] ? clip.times[word].start - 60 : (clip.times[0]?.start ?? 0) - LEAD_MS
    audio.currentTime = Math.max(0, startMs) / 1000
    this.current = { index, audio, clip }
    await audio.play()
    this.setState("playing")
    this.loop(run)
  }

  // Follows the audio clock: reports the spoken word, moves on when the sentence's audio ends.
  // The audio keeps its natural trailing silence, so periods get their pause.
  private loop(run: number) {
    const { index, audio, clip } = this.current!
    let lastWord = -2
    const tick = () => {
      if (run !== this.run) return
      if (audio.ended) {
        if (this.index >= this.sentences.length - 1) { this.setState("paused"); this.current = null; return }
        const pause = this.sentences[this.index + 1].newBlock ? BLOCK_PAUSE_MS / this.speed : 0
        setTimeout(() => { if (run === this.run) this.play(this.index + 1) }, pause)
        return
      }
      const t = audio.currentTime * 1000
      let w = 0
      while (w + 1 < clip.times.length && clip.times[w + 1].start <= t) w++
      if (w !== lastWord) { lastWord = w; this.onPosition(index, w) }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  // One request at a time, from the playing sentence forward.
  private async prefetch(from: number, run: number) {
    for (let i = from; i < Math.min(from + AHEAD, this.sentences.length); i++) {
      if (run !== this.run) return
      try { await this.clip(i) } catch { return }
    }
  }

  private clip(index: number): Promise<Clip> {
    const key = `${this.voice}|${index}`
    let p = this.cache.get(key)
    if (!p) {
      const text = this.sentences[index].text
      p = synth(text, this.voice, this.aborter.signal).then(r => {
        const bytes = Uint8Array.from(atob(r.audio), c => c.charCodeAt(0))
        // Played from LEAD_MS before the first word to the end of the audio, trailing silence included.
        const ms = Math.max(0, wavMs(bytes) - Math.max(0, (r.wtimes[0] ?? 0) - LEAD_MS))
        this.lengths.set(key, ms)
        this.rate.chars += text.length
        this.rate.ms += ms
        return {
          url: URL.createObjectURL(new Blob([bytes], { type: "audio/wav" })),
          times: align(this.pageWords[index] ?? [], r),
        }
      })
      // Only its own entry: a cancelled request from the old document shares keys with the new one.
      p.catch(() => { if (this.cache.get(key) === p) this.cache.delete(key) })
      this.cache.set(key, p)
    }
    return p
  }

  private setState(s: PlayState) {
    this.state = s
    this.emit()
  }
}

// A PCM WAV's length in ms: data bytes over the header's bytes per second (offset 28).
function wavMs(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const byteRate = bytes.length > 44 ? view.getUint32(28, true) : 0
  return byteRate ? ((bytes.length - 44) / byteRate) * 1000 : 0
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")

// Page words → { start, end } in ms, matched in order to the engine's words after stripping punctuation.
export function align(pageWords: string[], { words, wtimes, wdurations }: Synthesis) {
  const times: ({ start: number; end: number } | null)[] = pageWords.map(() => null)
  let j = 0
  pageWords.forEach((w, i) => {
    const p = norm(w)
    if (!p) return
    for (let k = j; k < Math.min(j + 4, words.length); k++) {
      if (norm(words[k]) === p) { times[i] = { start: wtimes[k], end: wtimes[k] + wdurations[k] }; j = k + 1; return }
    }
  })
  // Unmatched words sit between their matched neighbours.
  return times.map((t, i) => {
    if (t) return t
    const before = times.slice(0, i).findLast(Boolean)
    const after = times.slice(i + 1).find(Boolean)
    const start = before?.end ?? after?.start ?? 0
    return { start, end: after?.start ?? start }
  })
}
