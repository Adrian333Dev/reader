// The reader's right-click menu (rd-15): "Flag…" records what sounds wrong with a word or a selection, with its sentence,
// for a later investigation. Fixes come only from that investigation, never from the page.
import { useState, type ReactNode } from "react"
import { toast } from "sonner"
import { Flag } from "lucide-react"
import { saveFlag, type Doc } from "@/lib/api"
import type { Player } from "@/reading/player"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

// What was right-clicked: the selection if there is one, else the word. sentence: the word's, else the selection's first.
// mark: where the flagged text sits in the sentence, or null when a selection runs past it.
type Target = {
  text: string; sentence: number; mark: [number, number] | null
  box: { top: number; left: number; width: number; height: number }
}

// The w-th page word's place in its sentence, found by walking the words before it.
function wordAt(text: string, words: string[], w: number): [number, number] | null {
  let at = 0
  for (let i = 0; i <= w; i++) {
    const k = words[i] ? text.indexOf(words[i], at) : -1
    if (k < 0) return null
    if (i === w) return [k, k + words[i].length]
    at = k + words[i].length
  }
  return null
}

function targetOf(e: React.MouseEvent, player: Player): Target | null {
  const span = (e.target as HTMLElement).closest<HTMLElement>("span.w")
  const sel = getSelection()
  const range = sel && !sel.isCollapsed && sel.rangeCount ? sel.getRangeAt(0) : null
  const article = e.currentTarget.querySelector("article")
  const first = range && article?.contains(range.commonAncestorContainer)
    ? [...article.querySelectorAll<HTMLElement>("span.w")].find(s => range.intersectsNode(s))
    : undefined
  const selection = first ? range!.toString().trim() : ""
  const anchor = first ?? span
  if (!anchor) return null
  const s = Number(anchor.dataset.s)
  const sentence = player.sentences[s]?.text ?? ""
  const r = first ? range!.getBoundingClientRect() : anchor.getBoundingClientRect()
  const box = { top: r.top, left: r.left, width: r.width, height: r.height }
  if (selection) {
    const k = sentence.indexOf(selection)
    return { text: selection, sentence: s, mark: k < 0 ? null : [k, k + selection.length], box }
  }
  // The whole page word, which a link or inline code can split across several spans.
  const words = player.pageWords[s] ?? []
  const w = Number(anchor.dataset.w)
  return { text: words[w] ?? anchor.textContent ?? "", sentence: s, mark: wordAt(sentence, words, w), box }
}

export function FlagMenu({ doc, player, children }: { doc: Doc; player: Player; children: ReactNode }) {
  const [target, setTarget] = useState<Target | null>(null)
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState("")

  const submit = async () => {
    const s = target && player.sentences[target.sentence]
    if (!target || !s) return
    try {
      await saveFlag({
        word: target.text, text: s.text, pieces: s.pieces,
        before: player.sentences[target.sentence - 1]?.text, after: player.sentences[target.sentence + 1]?.text,
        // The Markdown of the sentence's block, since the page shows rendered text: backticks and link addresses matter.
        markdown: s.source && doc.text.slice(...s.source),
        doc: { id: doc.id, title: doc.title }, voice: player.voice, speed: player.speed, note: note.trim(),
      })
      toast.success(`Flagged “${target.text.trim()}”`)
      setOpen(false)
    } catch (e) {
      toast.error("Flag not saved", { description: (e as Error).message })
    }
  }

  const sentence = target ? (player.sentences[target.sentence]?.text ?? "") : ""
  const [from, to] = target?.mark ?? [0, 0]
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild className="select-text" onContextMenu={e => setTarget(targetOf(e, player))}>
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent className="w-36" onCloseAutoFocus={e => e.preventDefault()}>
          <ContextMenuItem disabled={!target} onSelect={() => { setNote(""); setOpen(true) }}><Flag /> Flag…</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div className="pointer-events-none fixed" style={target?.box} />
        </PopoverAnchor>
        {/* Focus leaving the box never closes it: the closing menu moves focus to the page as the box opens.
            A click outside or Escape still does. */}
        <PopoverContent align="start" className="w-96" onFocusOutside={e => e.preventDefault()}>
          <form className="flex flex-col gap-3" onSubmit={e => { e.preventDefault(); submit() }}>
            <p className="max-h-32 overflow-y-auto text-sm leading-relaxed">
              {target?.mark ? (
                <>
                  {sentence.slice(0, from)}
                  <mark className="rounded-sm bg-amber-200 px-0.5 text-foreground dark:bg-amber-400/35">{sentence.slice(from, to)}</mark>
                  {sentence.slice(to)}
                </>
              ) : (
                <mark className="rounded-sm bg-amber-200 px-0.5 text-foreground dark:bg-amber-400/35">{target?.text}</mark>
              )}
            </p>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="flag-note" className="text-xs text-muted-foreground">What's wrong</label>
              <Input
                id="flag-note"
                autoFocus
                autoComplete="off"
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="mumbled, too fast, wrong stress…"
              />
            </div>
            <Button type="submit" size="sm" className="self-end">Save</Button>
          </form>
        </PopoverContent>
      </Popover>
    </>
  )
}
