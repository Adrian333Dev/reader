// Cuts a rendered document (a hast tree) into sentences and words for reading.
// Every piece of a sentence becomes <span class="s" data-s>; words also get class "w" and data-w.
// Code blocks and images are marked "skip": shown, never read. Bare URLs are read; the server says them short.
import type { Element, ElementContent, Root, Text } from "hast"
import type { Piece } from "@/lib/api"

export type Sentence = {
  text: string        // what is sent to the speech engine
  pieces: Piece[]     // the same text cut into plain text, inline code and links, so the server can read paths
  wordCount: number
  newBlock: boolean   // first sentence of a paragraph, heading, list item or cell
  source?: [number, number] // where its block (paragraph, heading, list item, cell) sits in the parsed Markdown
}

const BLOCK = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "td", "th", "dt", "dd", "blockquote", "figcaption", "summary", "div", "section"])
const SKIP = new Set(["pre", "img", "svg", "video", "audio", "iframe", "math", "script", "style"])
const MAX_SENTENCE = 400 // HeadTTS takes at most 500 characters per call
const ABBREVIATION = /(?:^|\s)(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|Inc|Ltd|No|Fig|approx|cf|[A-Z])\.$/

type Parent = Element | Root
type Kind = Omit<Piece, "text">
type Block = { el: Parent; texts: Text[]; kinds: Kind[] }

const TEXT: Kind = { type: "text" }

export function segmentTree(tree: Root): Sentence[] {
  const sentences: Sentence[] = []
  const blocks: Block[] = []
  let current: Block | null = null

  // `kind`: whether the text sits in inline code or a link; code inside a link counts as code.
  const walk = (node: Parent, block: Parent, skipped: boolean, kind: Kind) => {
    for (const child of node.children) {
      if (child.type === "text") {
        if (skipped) continue
        if (!current || current.el !== block) blocks.push((current = { el: block, texts: [], kinds: [] }))
        current.texts.push(child)
        current.kinds.push(kind)
      } else if (child.type === "element") {
        const skip = markSkip(child) || skipped
        const inner: Kind = child.tagName === "code" ? { type: "code" }
          : child.tagName === "a" ? { type: "link", href: String(child.properties.href ?? "") }
          : kind
        walk(child, BLOCK.has(child.tagName) ? child : block, skip, inner)
      }
    }
  }
  walk(tree, tree, false, TEXT)

  const replacements = new Map<Text, ElementContent[]>()
  for (const b of blocks) {
    const { start, end } = b.el.position ?? {}
    const source = start?.offset != null && end?.offset != null ? ([start.offset, end.offset] as [number, number]) : undefined
    segmentBlock(b.texts, b.kinds, sentences, replacements, source)
  }
  replaceTexts(tree, replacements)
  return sentences
}

function markSkip(el: Element): boolean {
  if (!SKIP.has(el.tagName)) return false
  el.properties.className = [...classes(el), "skip"]
  return true
}

const classes = (el: Element) => (Array.isArray(el.properties.className) ? el.properties.className : [])

function segmentBlock(texts: Text[], kinds: Kind[], sentences: Sentence[], out: Map<Text, ElementContent[]>, source?: [number, number]) {
  let full = ""
  const charKinds: Kind[] = []
  const ranges = texts.map((t, ti) => {
    const start = full.length
    full += t.value
    for (let c = 0; c < t.value.length; c++) charKinds.push(kinds[ti])
    return [start, full.length] as const
  })
  const local = splitSentences(full).map(([s, e], i) => {
    const words: [number, number][] = []
    for (const m of full.slice(s, e).matchAll(/\S+/g)) words.push([s + m.index, s + m.index + m[0].length])
    const pieces = piecesOf(full, charKinds, s, e)
    sentences.push({ text: pieces.map(p => p.text).join(""), pieces, wordCount: words.length, newBlock: i === 0, source })
    return { index: sentences.length - 1, range: [s, e] as const, words }
  })
  if (!local.length) return

  texts.forEach((t, ti) => {
    const [ns, ne] = ranges[ti]
    const cuts = new Set([ns, ne])
    for (const l of local) for (const c of [...l.range, ...l.words.flat()]) if (c > ns && c < ne) cuts.add(c)
    const points = [...cuts].sort((a, b) => a - b)
    const pieces: ElementContent[] = []
    for (let i = 0; i < points.length - 1; i++) {
      const [a, b] = [points[i], points[i + 1]]
      const value = t.value.slice(a - ns, b - ns)
      const l = local.find(x => a >= x.range[0] && a < x.range[1])
      if (!l) { pieces.push({ type: "text", value }); continue }
      const wi = l.words.findIndex(([ws, we]) => a >= ws && a < we)
      pieces.push({
        type: "element",
        tagName: "span",
        properties: wi >= 0 ? { className: ["s", "w"], dataS: l.index, dataW: wi } : { className: ["s"], dataS: l.index },
        children: [{ type: "text", value }],
      })
    }
    out.set(t, pieces)
  })
}

// A sentence's text, trimmed with each whitespace run cut to one space, as runs of the same kind.
function piecesOf(full: string, charKinds: Kind[], s: number, e: number): Piece[] {
  while (s < e && /\s/.test(full[s])) s++
  while (e > s && /\s/.test(full[e - 1])) e--
  const pieces: Piece[] = []
  for (let c = s; c < e; c++) {
    const space = /\s/.test(full[c])
    if (space && /\s/.test(full[c - 1])) continue
    const kind = charKinds[c]
    const last = pieces.at(-1)
    if (last && last.type === kind.type && last.href === kind.href) last.text += space ? " " : full[c]
    else pieces.push({ ...kind, text: space ? " " : full[c] })
  }
  return pieces
}

function replaceTexts(node: Parent, map: Map<Text, ElementContent[]>) {
  const children: (typeof node.children)[number][] = []
  for (const c of node.children) {
    if (c.type === "text") children.push(...(map.get(c) ?? [c]))
    else {
      if (c.type === "element") replaceTexts(c, map)
      children.push(c)
    }
  }
  node.children = children as typeof node.children
}

// Sentence ranges in a block: trimmed, rejoined after abbreviations and mid-word breaks, long ones cut.
function splitSentences(text: string): [number, number][] {
  const raw: [number, number][] = []
  for (const { index, segment } of new Intl.Segmenter("en", { granularity: "sentence" }).segment(text)) {
    const prev = raw.at(-1)
    // Rejoined: after an abbreviation, and inside a word, such as the "?" of a link.
    const midWord = index > 0 && !/\s/.test(text[index - 1])
    if (prev && (midWord || ABBREVIATION.test(text.slice(prev[0], prev[1]).trimEnd()))) prev[1] = index + segment.length
    else raw.push([index, index + segment.length])
  }
  const out: [number, number][] = []
  for (let [s, e] of raw) {
    while (s < e && /\s/.test(text[s])) s++
    while (e > s && /\s/.test(text[e - 1])) e--
    if (!/[\p{L}\p{N}]/u.test(text.slice(s, e))) continue
    while (e - s > MAX_SENTENCE) {
      const window = text.slice(s, s + MAX_SENTENCE)
      let cut = Math.max(window.lastIndexOf("; "), window.lastIndexOf(": "), window.lastIndexOf(", "))
      if (cut < MAX_SENTENCE / 3) cut = window.lastIndexOf(" ")
      // One word longer than the limit, such as a long link: it ends the piece, whole.
      let end = s + cut + 1
      if (cut <= 0) {
        const space = text.indexOf(" ", s + MAX_SENTENCE)
        end = space < 0 || space >= e ? e : space
      }
      out.push([s, end])
      s = end
      while (s < e && /\s/.test(text[s])) s++
    }
    if (s < e) out.push([s, e])
  }
  return out
}
