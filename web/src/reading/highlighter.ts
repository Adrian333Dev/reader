// Draws the reading highlights as boxes behind the text: one continuous rounded band per line
// for the sentence, one box for the spoken word. The text spans themselves stay unstyled.

const PAD_X = 3
const PAD_Y = 2

export class Highlighter {
  private sentenceSpans: HTMLElement[][] = []
  private wordSpans: HTMLElement[][][] = []
  private sentenceLayer = document.createElement("div")
  private wordLayer = document.createElement("div")
  private sentence = -1
  private word = -1
  private resize: ResizeObserver
  private container: HTMLElement

  // container: positioned element holding the article; boxes are placed in its coordinates.
  constructor(container: HTMLElement, article: HTMLElement) {
    this.container = container
    for (const l of [this.sentenceLayer, this.wordLayer]) {
      l.className = "pointer-events-none absolute inset-0"
      l.setAttribute("aria-hidden", "true")
      container.prepend(l)
    }
    for (const span of article.querySelectorAll<HTMLElement>("span.s")) {
      const s = Number(span.dataset.s)
      ;(this.sentenceSpans[s] ??= []).push(span)
      if (span.dataset.w !== undefined) ((this.wordSpans[s] ??= [])[Number(span.dataset.w)] ??= []).push(span)
    }
    this.resize = new ResizeObserver(() => this.draw())
    this.resize.observe(container)
  }

  pageWords(): string[][] {
    return this.sentenceSpans.map((_, s) => (this.wordSpans[s] ?? []).map(spans => spans.map(x => x.textContent).join("")))
  }

  firstSpan(sentence: number): HTMLElement | undefined {
    return this.sentenceSpans[sentence]?.[0]
  }

  set(sentence: number, word: number) {
    if (sentence === this.sentence && word === this.word) return
    const redrawSentence = sentence !== this.sentence
    for (const span of this.wordSpans[this.sentence]?.[this.word] ?? []) span.classList.remove("reader-word-active")
    this.sentence = sentence
    this.word = word
    // The word's own spans take a class too: in dark mode their text darkens over the solid word box.
    for (const span of word >= 0 ? this.wordSpans[sentence]?.[word] ?? [] : []) span.classList.add("reader-word-active")
    if (redrawSentence) this.drawLayer(this.sentenceLayer, this.lines(this.sentenceSpans[sentence] ?? []), "reader-hl-sentence")
    this.drawLayer(this.wordLayer, word >= 0 ? this.lines(this.wordSpans[sentence]?.[word] ?? []) : [], "reader-hl-word")
  }

  draw() {
    const [s, w] = [this.sentence, this.word]
    this.sentence = this.word = -2
    this.set(s, w)
  }

  destroy() {
    for (const span of this.wordSpans[this.sentence]?.[this.word] ?? []) span.classList.remove("reader-word-active")
    this.resize.disconnect()
    this.sentenceLayer.remove()
    this.wordLayer.remove()
  }

  // Merge the spans' rectangles into one rectangle per visual line.
  private lines(spans: HTMLElement[]): DOMRect[] {
    const origin = this.container.getBoundingClientRect()
    const rows: { top: number; bottom: number; left: number; right: number }[] = []
    for (const span of spans) {
      for (const r of span.getClientRects()) {
        if (!r.width) continue
        const row = rows.find(x => Math.abs(x.top - r.top) < r.height / 2)
        if (row) {
          row.left = Math.min(row.left, r.left)
          row.right = Math.max(row.right, r.right)
          row.bottom = Math.max(row.bottom, r.bottom)
        } else rows.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right })
      }
    }
    return rows.map(r => new DOMRect(r.left - origin.left - PAD_X, r.top - origin.top - PAD_Y, r.right - r.left + 2 * PAD_X, r.bottom - r.top + 2 * PAD_Y))
  }

  private drawLayer(layer: HTMLElement, rects: DOMRect[], className: string) {
    layer.replaceChildren(...rects.map(r => {
      const box = document.createElement("div")
      box.className = `absolute rounded-[5px] ${className}`
      Object.assign(box.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` })
      return box
    }))
  }
}
