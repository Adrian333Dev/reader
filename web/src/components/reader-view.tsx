// One document, rendered like GitHub, with the reading highlights behind the text.
// Word changes go straight to the Highlighter; React never redraws the article while reading.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Play } from "lucide-react"
import type { Doc } from "@/lib/api"
import { renderDocument } from "@/reading/render"
import { Highlighter } from "@/reading/highlighter"
import type { Player } from "@/reading/player"
import { Button } from "@/components/ui/button"

const USER_SCROLL_HOLD_MS = 4000 // no auto-scroll this long after the user scrolls

type Props = { doc: Doc; player: Player; onPosition: (sentence: number, total: number) => void }

// The selection inside the article, if any.
function selectedRange(article: HTMLElement | null): Range | null {
  const sel = getSelection()
  if (!article || !sel || sel.isCollapsed || !sel.rangeCount) return null
  const range = sel.getRangeAt(0)
  return article.contains(range.commonAncestorContainer) ? range : null
}

// Typing into a field, or working a menu or popover, keeps its own keys.
const ownsKeys = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.closest("[role=menu],[role=dialog],[role=alertdialog]"))

export function ReaderView({ doc, player, onPosition }: Props) {
  const { content, sentences } = useMemo(() => renderDocument(doc.text, doc.format), [doc.text, doc.format])
  const scrollRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const articleRef = useRef<HTMLElement>(null)
  const userScrolledAt = useRef(0)
  const onPositionRef = useRef(onPosition)
  const [readButton, setReadButton] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => { onPositionRef.current = onPosition }, [onPosition])

  useLayoutEffect(() => {
    const h = new Highlighter(containerRef.current!, articleRef.current!)
    const follow = (s: number) => {
      const span = h.firstSpan(s)
      const box = scrollRef.current
      if (!span || !box || Date.now() - userScrolledAt.current < USER_SCROLL_HOLD_MS) return
      const r = span.getBoundingClientRect()
      const b = box.getBoundingClientRect()
      if (r.top < b.top + 40 || r.bottom > b.bottom - 130) span.scrollIntoView({ block: "center", behavior: "smooth" })
    }
    let last = -1
    player.onPosition = (s, w) => {
      h.set(s, w)
      if (s === last) return
      last = s
      follow(s)
      onPositionRef.current(s, sentences.length)
    }
    player.load(sentences, h.pageWords(), doc.position)
    h.set(player.index, -1)
    h.firstSpan(player.index)?.scrollIntoView({ block: "center" })
    // Pressing Play brings the current sentence back into view, even right after the user scrolled away.
    let wasPaused = player.state === "paused"
    const unsubscribe = player.subscribe(() => {
      const paused = player.state === "paused"
      if (wasPaused && !paused) {
        userScrolledAt.current = 0
        follow(player.index)
      }
      wasPaused = paused
    })
    return () => {
      unsubscribe()
      player.stop()
      player.onPosition = () => {}
      h.destroy()
    }
    // doc.position is read once, when the document opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, sentences])

  // Start at the first word of a range.
  const readFrom = (range: Range) => {
    const first = [...articleRef.current!.querySelectorAll<HTMLElement>("span.w")].find(span => range.intersectsNode(span))
    getSelection()?.removeAllRanges()
    setReadButton(null)
    if (first) player.play(Number(first.dataset.s), Number(first.dataset.w))
  }
  const readFromRef = useRef(readFrom)
  useEffect(() => { readFromRef.current = readFrom })

  // Space plays or pauses, or reads from the selection. Arrows move a sentence.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || ownsKeys(e.target)) return
      if (e.code === "Space") {
        e.preventDefault()
        if (e.repeat) return
        const range = selectedRange(articleRef.current)
        if (range) readFromRef.current(range)
        else player.toggle()
      } else if (e.key === "ArrowRight") { e.preventDefault(); player.next() }
      else if (e.key === "ArrowLeft") { e.preventDefault(); player.prev() }
    }
    // A focused button would also take Space as a click on key-up.
    const up = (e: KeyboardEvent) => { if (e.code === "Space" && !ownsKeys(e.target)) e.preventDefault() }
    const selection = () => {
      const range = selectedRange(articleRef.current)
      const container = containerRef.current
      if (!range || !container) return setReadButton(null)
      const r = range.getBoundingClientRect()
      const c = container.getBoundingClientRect()
      setReadButton({ top: r.top - c.top - 38, left: Math.max(0, r.left - c.left) })
    }
    window.addEventListener("keydown", down, true)
    window.addEventListener("keyup", up, true)
    document.addEventListener("selectionchange", selection)
    return () => {
      window.removeEventListener("keydown", down, true)
      window.removeEventListener("keyup", up, true)
      document.removeEventListener("selectionchange", selection)
    }
  }, [player])

  // A click on a word reads from it. Links open only with Ctrl or Cmd.
  const onClick = (e: React.MouseEvent) => {
    if (selectedRange(articleRef.current)) return
    const target = e.target as HTMLElement
    if (target.closest("a")) {
      if (e.ctrlKey || e.metaKey) return
      e.preventDefault()
    }
    const word = target.closest<HTMLElement>("span.w")
    if (word) player.play(Number(word.dataset.s), Number(word.dataset.w))
  }

  const userScrolled = () => { userScrolledAt.current = Date.now() }

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto"
      onWheel={userScrolled}
      onTouchMove={userScrolled}
      onPointerDown={e => e.target === e.currentTarget && userScrolled()}
    >
      <div ref={containerRef} className="relative mx-auto max-w-[808px] px-6 pt-10 pb-[40vh]">
        <article ref={articleRef} className="markdown-body reader-body relative z-10" onClick={onClick}>
          {content}
        </article>
        {readButton && (
          <Button
            size="sm"
            className="absolute z-20 shadow-md"
            style={{ top: readButton.top, left: readButton.left }}
            onMouseDown={e => e.preventDefault()}
            onClick={() => { const r = selectedRange(articleRef.current); if (r) readFrom(r) }}
          >
            <Play className="fill-current" /> Read from here
          </Button>
        )}
      </div>
    </div>
  )
}
