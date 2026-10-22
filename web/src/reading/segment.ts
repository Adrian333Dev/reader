// Cuts a rendered document (a hast tree) into sentences and words for reading.
// Every piece of a sentence becomes <span class="s" data-s>; words also get class "w" and data-w.
// Code blocks, images and bare URLs are marked "skip": shown, never read.
import type { Element, ElementContent, Root, Text } from "hast"

export type Sentence = {
  text: string        // what is sent to the speech engine
  wordCount: number
  newBlock: boolean   // first sentence of a paragraph, heading, list item or cell
}

const BLOCK = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "td", "th", "dt", "dd", "blockquote", "figcaption", "summary", "div", "section"])
const SKIP = new Set(["pre", "img", "svg", "video", "audio", "iframe", "math", "script", "style"])
const MAX_SENTENCE = 400 // HeadTTS takes at most 500 characters per call
const ABBREVIATION = /(?:^|\s)(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|Inc|Ltd|No|Fig|approx|cf|[A-Z])\.$/

type Parent = Element | Root
type Block = { el: Parent; texts: Text[] }

export function segmentTree(tree: Root): Sentence[] {
  const sentences: Sentence[] = []
  const blocks: Block[] = []
  let current: Block | null = null

  const walk = (node: Parent, block: Parent, skipped: boolean) => {
    for (const child of node.children) {
      if (child.type === "text") {
        if (skipped) continue
        if (!current || current.el !== block) blocks.push((current = { el: block, texts: [] }))
        current.texts.push(child)
      } else if (child.type === "element") {
        const skip = markSkip(child) || skipped
        walk(child, BLOCK.has(child.tagName) ? child : block, skip)
      }
    }
  }
  walk(tree, tree, false)

  const replacements = new Map<Text, ElementContent[]>()
  for (const b of blocks) segmentBlock(b.texts, sentences, replacements)
  replaceTexts(tree, replacements)
  return sentences
}

function markSkip(el: Element): boolean {
  const text = toText(el).trim()
  const skip = SKIP.has(el.tagName) || (el.tagName === "a" && /^(https?:\/\/|www\.)/.test(text))
  if (!skip) return false
  el.properties.className = [...classes(el), "skip"]
  if (el.tagName === "pre") {
    const code = el.children.find((c): c is Element => c.type === "element" && c.tagName === "code")
    const lang = code && classes(code).map(String).find(c => c.startsWith("language-"))?.slice(9)
    el.properties.dataLabel = lang ? `${lang} · skipped` : "code · skipped"
  }
  return true
}

const classes = (el: Element) => (Array.isArray(el.properties.className) ? el.properties.className : [])
const toText = (n: ElementContent | Parent): string =>
  n.type === "text" ? n.value : "children" in n ? n.children.map(c => toText(c as ElementContent)).join("") : ""

function segmentBlock(texts: Text[], sentences: Sentence[], out: Map<Text, ElementContent[]>) {
  let full = ""
  const ranges = texts.map(t => {
    const start = full.length
    full += t.value
    return [start, full.length] as const
  })
  const local = splitSentences(full).map(([s, e], i) => {
    const words: [number, number][] = []
    for (const m of full.slice(s, e).matchAll(/\S+/g)) words.push([s + m.index, s + m.index + m[0].length])
    sentences.push({ text: full.slice(s, e).replace(/\s+/g, " ").trim(), wordCount: words.length, newBlock: i === 0 })
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

// Sentence ranges in a block: trimmed, rejoined after abbreviations, long ones cut.
function splitSentences(text: string): [number, number][] {
  const raw: [number, number][] = []
  for (const { index, segment } of new Intl.Segmenter("en", { granularity: "sentence" }).segment(text)) {
    const prev = raw.at(-1)
    if (prev && ABBREVIATION.test(text.slice(prev[0], prev[1]).trimEnd())) prev[1] = index + segment.length
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
      out.push([s, s + cut + 1])
      s += cut + 1
      while (/\s/.test(text[s])) s++
    }
    out.push([s, e])
  }
  return out
}
