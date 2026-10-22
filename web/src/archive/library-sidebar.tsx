// ARCHIVED 2026-10-23: tabs-only replaced the Library (ticket rd-1). Kept whole, and still type-checked, so it can
// return: import this Sidebar in App.tsx again and pass the document props. Tabs no longer save a colour, so the
// squares show grey until tabs get colours back.
//
// The Library: every document ever pasted, newest first, under Today, Yesterday and older dates.
// A square in a tab's colour marks the tab a document was pasted into. Click opens; Ctrl+click and Shift+click
// select, and Delete removes the selection. Double-click renames. Right-click opens the row's menu.
// The grouped sidebar this replaced is in archive/grouped-sidebar.tsx.
import { useEffect, useState } from "react"
import { BookCheck, Pencil, Trash2, Upload, Volume2 } from "lucide-react"
import type { DocMeta, Tab } from "@/lib/api"
import { colorStyle } from "@/lib/colors"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from "@/components/ui/context-menu"

type Props = {
  docs: DocMeta[]
  tabs: (Tab & { color?: string })[]
  activeId?: string
  playingId?: string
  onOpen: (id: string) => void
  onUpload: () => void
  onRename: (id: string, title: string) => void
  onDelete: (ids: string[]) => void
  onClear: (ids: string[]) => void
}

// Library order, top to bottom: newest first.
export const libraryOrder = (docs: DocMeta[]) => [...docs].sort((a, b) => b.createdAt - a.createdAt)

const DAY = 86_400_000
function dayLabel(time: number) {
  const today = new Date().setHours(0, 0, 0, 0)
  if (time >= today) return "Today"
  if (time >= today - DAY) return "Yesterday"
  return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

// Reading progress: an unread dot until the document is first opened (the title is also bold), then a green ring
// filling clockwise once reading starts. Finished shows nothing.
function Progress({ value, seen }: { value: number; seen: boolean }) {
  if (!seen) return <span className="mx-1 size-[7px] rounded-full bg-foreground" aria-label="Unread" />
  if (value <= 0) return null
  if (value >= 0.999) return null
  const r = 6
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 16 16" className="size-4 -rotate-90" aria-label={`${Math.round(value * 100)}% read`}>
      <circle cx="8" cy="8" r={r} fill="none" strokeWidth="2.5" className="stroke-foreground/20" />
      <circle cx="8" cy="8" r={r} fill="none" strokeWidth="2.5" strokeLinecap="round" className="stroke-emerald-500"
        strokeDasharray={`${c * Math.min(value, 1)} ${c}`} />
    </svg>
  )
}

const isField = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

export function Sidebar({ docs, tabs, activeId, playingId, onOpen, onUpload, onRename, onDelete, onClear }: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)

  const ordered = libraryOrder(docs)
  const days: [string, DocMeta[]][] = []
  for (const d of ordered) {
    const label = dayLabel(d.createdAt)
    if (days.at(-1)?.[0] === label) days.at(-1)![1].push(d)
    else days.push([label, [d]])
  }

  // Delete removes the selection, or the open document when nothing is selected; Escape clears the selection.
  // F2 renames the open document.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isField(e.target) || (e.target as HTMLElement).closest?.("[role=menu],[role=dialog],[role=alertdialog]")) return
      if (selected.size && (e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); onDelete([...selected]); setSelected(new Set()) }
      else if (selected.size && e.key === "Escape") setSelected(new Set())
      else if (!selected.size && e.key === "Delete" && activeId) { e.preventDefault(); onDelete([activeId]) }
      else if (e.key === "F2" && activeId) { e.preventDefault(); setEditing(activeId) }
    }
    window.addEventListener("keydown", down)
    return () => window.removeEventListener("keydown", down)
  }, [selected, onDelete, activeId])

  const clickDoc = (e: React.MouseEvent, id: string) => {
    if (editing === id) return
    if (e.ctrlKey || e.metaKey) {
      setSelected(s => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n })
      setAnchor(id)
    } else if (e.shiftKey && anchor) {
      const [a, b] = [ordered.findIndex(d => d.id === anchor), ordered.findIndex(d => d.id === id)].sort((x, y) => x - y)
      setSelected(new Set(ordered.slice(a, b + 1).map(d => d.id)))
    } else {
      setSelected(new Set())
      setAnchor(id)
      onOpen(id)
    }
  }

  // The documents a menu acts on: the selection when the row is part of it, else the row alone.
  const targets = (id: string) => (selected.has(id) ? [...selected] : [id])

  const docRow = (d: DocMeta) => {
    const ids = targets(d.id)
    const tab = tabs.find(t => t.id === d.tab)
    return (
      <ContextMenu key={d.id}>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              "group relative flex h-8.5 cursor-pointer items-center gap-2 rounded-md pr-1.5 pl-2 text-sm hover:bg-black/[0.045] dark:hover:bg-white/[0.05]",
              d.id === activeId && "bg-black/[0.065] font-medium dark:bg-white/[0.08]",
              selected.has(d.id) && "bg-sky-500/20 ring-1 ring-sky-500/60 ring-inset hover:bg-sky-500/25 dark:bg-sky-400/25 dark:ring-sky-400/70 dark:hover:bg-sky-400/30",
            )}
            onClick={e => clickDoc(e, d.id)}
            onDoubleClick={() => setEditing(d.id)}
          >
            {editing === d.id ? (
              <Input
                autoFocus
                defaultValue={d.title}
                className="h-7 text-sm"
                onClick={e => e.stopPropagation()}
                onFocus={e => e.target.select()}
                onBlur={e => { setEditing(null); const t = e.target.value.trim(); if (t && t !== d.title) onRename(d.id, t) }}
                onKeyDown={e => {
                  if (e.key === "Enter") e.currentTarget.blur()
                  if (e.key === "Escape") { e.currentTarget.value = d.title; e.currentTarget.blur() }
                }}
              />
            ) : (
              <>
                <span
                  className={cn("mx-1 size-2 shrink-0 rounded-[2px]", tab?.color ? "group-dot" : "bg-foreground/15")}
                  style={tab?.color ? colorStyle(tab.color) : undefined}
                  title={tab ? `From tab “${tab.name ?? d.title}”` : undefined}
                />
                <span className={cn("min-w-0 flex-1 truncate", !d.seen ? "font-semibold text-foreground" : "text-foreground/80")}>{d.title}</span>
                <span className="flex" title={playingId === d.id ? "Playing" : !d.seen ? "Unread" : `${Math.round(d.progress * 100)}% read`}>
                  {playingId === d.id
                    ? <Volume2 strokeWidth={2.75} className="size-4 text-foreground [&>path:first-child]:fill-current" />
                    : <Progress value={d.progress} seen={d.seen} />}
                </span>
              </>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-52">
          {ids.length === 1 && <ContextMenuItem onSelect={() => setEditing(d.id)}><Pencil /> Rename</ContextMenuItem>}
          {ids.some(id => { const x = docs.find(y => y.id === id); return !!x && (!x.seen || x.progress < 0.999) }) && (
            <ContextMenuItem onSelect={() => { onClear(ids); setSelected(new Set()) }}><BookCheck /> Mark as read</ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => { onDelete(ids); setSelected(new Set()) }}>
            <Trash2 /> {ids.length > 1 ? `Delete ${ids.length} documents` : "Delete"}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex h-11 items-center justify-between pr-2 pl-3">
        <span className="text-sm font-semibold">Library</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onUpload} aria-label="Upload a file">
              <Upload />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Upload a .md or .txt file (U)</TooltipContent>
        </Tooltip>
      </div>

      <nav className="flex-1 overflow-y-auto pb-2 pl-2 [scrollbar-gutter:stable]">
        {days.map(([label, list]) => (
          <section key={label} className="mb-2">
            <h3 className="px-2 pt-1 pb-1 text-xs font-medium text-muted-foreground">{label}</h3>
            <div className="space-y-0.5">{list.map(docRow)}</div>
          </section>
        ))}
      </nav>
    </aside>
  )
}
