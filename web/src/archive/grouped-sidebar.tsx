// ARCHIVED 2026-10-23: tabs replaced groups (ticket rd-1). Kept whole, and still type-checked, so groups can return:
// import this Sidebar in App.tsx again, load api.groups(), and pass the group props. The server's /api/groups,
// data/groups.json and each document's `group` field were left as they were.
//
// Documents and groups, highest rank first; a group sits among the loose documents, like a tab group in a browser.
// Click opens; Ctrl+click and Shift+click select, and Delete removes the selection. Double-click renames.
// Right-click opens the row's menu. Rows and group headers drag to reorder.
import { useEffect, useState } from "react"
import { BookCheck, ChevronRight, FileText, FolderPlus, FolderMinus, PanelLeft, Pencil, Plus, Trash2, Upload, Volume2 } from "lucide-react"
import type { DocMeta, Group } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub,
  ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger,
} from "@/components/ui/context-menu"

// A group's colour gives only its hue: index.css draws chip, text and line at fixed lightness from it,
// so any colour, custom ones included, keeps the same contrast. A new group takes the first colour not in use.
export const GROUP_COLORS = [
  { name: "Moss", value: "oklch(0.6 0.1 150)" }, { name: "Amber", value: "oklch(0.6 0.1 75)" },
  { name: "Steel", value: "oklch(0.6 0.1 245)" }, { name: "Rose", value: "oklch(0.6 0.1 10)" },
  { name: "Pine", value: "oklch(0.6 0.1 190)" }, { name: "Clay", value: "oklch(0.6 0.1 45)" },
  { name: "Olive", value: "oklch(0.6 0.1 112)" }, { name: "Slate", value: "oklch(0.6 0.02 255)" },
]
const groupStyle = (color: string) => ({ "--group": color }) as React.CSSProperties

export type Placement = { id: string; group: string | null; rank: number }

type Props = {
  docs: DocMeta[]
  groups: Group[]
  activeId?: string
  playingId?: string
  onOpen: (id: string) => void
  onNew: () => void
  onUpload: () => void
  onRename: (id: string, title: string) => void
  onDelete: (ids: string[], groupIds?: string[]) => void
  onClear: (ids: string[]) => void
  onHide: () => void
  onBadColor: (text: string) => void
  onPlace: (placements: Placement[]) => void
  onGroups: (groups: Group[]) => void
}

type Item = { type: "doc"; doc: DocMeta; rank: number } | { type: "group"; group: Group; docs: DocMeta[]; rank: number }
type Drag = { type: "doc"; ids: string[] } | { type: "group"; id: string }

const byRank = <T extends { rank: number }>(a: T, b: T) => b.rank - a.rank

// Loose documents and groups in sidebar order, and the documents a reader sees, top to bottom.
export function sidebarLayout(docs: DocMeta[], groups: Group[]) {
  const groupIds = new Set(groups.map(g => g.id))
  const items: Item[] = [
    ...docs.filter(d => !d.group || !groupIds.has(d.group)).map(doc => ({ type: "doc" as const, doc, rank: doc.rank })),
    ...groups.map(group => ({ type: "group" as const, group, docs: docs.filter(d => d.group === group.id).sort(byRank), rank: group.rank })),
  ].sort(byRank)
  const visible = items.flatMap(i => (i.type === "doc" ? [i.doc] : i.group.collapsed ? [] : i.docs))
  return { items, visible, groupIds }
}

// n ranks, highest first, strictly between `above` and `below`; either end may be open.
function ranksBetween(n: number, above?: number, below?: number) {
  if (above === undefined && below === undefined) return Array.from({ length: n }, (_, i) => Date.now() - i)
  const lo = below ?? above! - n - 1
  const hi = above ?? below! + n + 1
  return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * (n - i)) / (n + 1))
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

export function Sidebar({ docs, groups, activeId, playingId, onOpen, onNew, onUpload, onRename, onDelete, onClear, onHide, onBadColor, onPlace, onGroups }: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [over, setOver] = useState<string | null>(null)

  const { items, visible, groupIds } = sidebarLayout(docs, groups)

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
      const [a, b] = [visible.findIndex(d => d.id === anchor), visible.findIndex(d => d.id === id)].sort((x, y) => x - y)
      setSelected(new Set(visible.slice(a, b + 1).map(d => d.id)))
    } else {
      setSelected(new Set())
      setAnchor(id)
      onOpen(id)
    }
  }

  // The documents a menu or drag acts on: the selection when the row is part of it, else the row alone.
  const targets = (id: string) => (selected.has(id) ? [...selected] : [id])

  const saveGroup = (id: string, changes: Partial<Group>) => onGroups(groups.map(g => (g.id === id ? { ...g, ...changes } : g)))

  const newGroup = (ids: string[]) => {
    const first = docs.find(d => d.id === ids[0])
    const inGroup = groups.find(g => g.id === first?.group)
    const used = new Set(groups.map(g => g.color))
    // A new group stands where its first document stood, or just above that document's old group.
    const rank = inGroup
      ? ranksBetween(1, items.map(i => i.rank).filter(r => r > inGroup.rank).at(-1), inGroup.rank)[0]
      : first?.rank ?? Date.now()
    const group: Group = {
      id: `g${Date.now().toString(36)}`,
      name: "New group",
      color: (GROUP_COLORS.find(c => !used.has(c.value)) ?? GROUP_COLORS[groups.length % GROUP_COLORS.length]).value,
      rank,
      collapsed: false,
    }
    onGroups([...groups, group])
    onPlace(ids.map((id, i) => ({ id, group: group.id, rank: ranksBetween(ids.length)[i] })))
    setSelected(new Set())
    setEditing(group.id)
  }

  const moveTo = (ids: string[], groupId: string | null) => {
    const siblings = groupId ? docs.filter(d => d.group === groupId && !ids.includes(d.id)) : items.filter(i => i.type === "group" || !ids.includes(i.doc.id))
    const top = Math.max(...siblings.map(s => s.rank), 0)
    onPlace(ranksBetween(ids.length, undefined, top).map((rank, i) => ({ id: ids[i], group: groupId, rank })))
    setSelected(new Set())
  }

  // Dropping places the dragged rows just above the row under the pointer, in that row's group.
  const dropOnDoc = (target: DocMeta) => {
    if (!drag) return
    const targetGroup = target.group && groupIds.has(target.group) ? target.group : null
    if (drag.type === "group") {
      const above = targetGroup ? groups.find(g => g.id === targetGroup)! : null
      return placeGroup(drag.id, above ? above.rank : target.rank)
    }
    if (drag.ids.includes(target.id)) return
    const siblings = targetGroup
      ? docs.filter(d => d.group === targetGroup && !drag.ids.includes(d.id)).sort(byRank).map(d => d.rank)
      : items.filter(i => i.type === "group" || !drag.ids.includes(i.doc.id)).map(i => i.rank)
    const above = siblings.filter(r => r > target.rank).at(-1)
    onPlace(ranksBetween(drag.ids.length, above, target.rank).map((rank, i) => ({ id: drag.ids[i], group: targetGroup, rank })))
  }

  const dropOnGroup = (group: Group) => {
    if (!drag) return
    if (drag.type === "group") return placeGroup(drag.id, group.rank)
    moveTo(drag.ids, group.id)
  }

  // Below every row: loose, at the bottom.
  const dropAtEnd = () => {
    if (!drag) return
    const bottom = Math.min(...items.map(i => i.rank), Date.now())
    if (drag.type === "group") return saveGroup(drag.id, { rank: bottom - 1 })
    onPlace(ranksBetween(drag.ids.length, bottom).map((rank, i) => ({ id: drag.ids[i], group: null, rank })))
  }

  const placeGroup = (id: string, beforeRank: number) => {
    if (groups.find(g => g.id === id)?.rank === beforeRank) return
    const above = items.map(i => i.rank).filter(r => r > beforeRank).at(-1)
    saveGroup(id, { rank: ranksBetween(1, above, beforeRank)[0] })
  }

  const dropProps = (key: string, onDrop: () => void) => ({
    onDragOver: (e: React.DragEvent) => { if (drag) { e.preventDefault(); e.stopPropagation(); setOver(key) } },
    onDragLeave: () => setOver(o => (o === key ? null : o)),
    onDrop: (e: React.DragEvent) => { if (!drag) return; e.preventDefault(); e.stopPropagation(); onDrop(); setDrag(null); setOver(null) },
  })
  const endDrag = () => { setDrag(null); setOver(null) }

  const renameInput = (value: string, done: (v: string | null) => void, placeholder?: string) => (
    <Input
      autoFocus
      defaultValue={value}
      placeholder={placeholder}
      className="h-7 text-sm"
      onClick={e => e.stopPropagation()}
      onFocus={e => e.target.select()}
      onBlur={e => done(e.target.value)}
      onKeyDown={e => {
        if (e.key === "Enter") done(e.currentTarget.value)
        if (e.key === "Escape") done(null)
      }}
    />
  )

  const docRow = (d: DocMeta) => {
    const ids = targets(d.id)
    const current = groups.find(g => g.id === d.group)
    return (
      <ContextMenu key={d.id}>
        <ContextMenuTrigger asChild>
          <div
            draggable={editing !== d.id}
            onDragStart={e => { e.dataTransfer.setData("text/x-reader-doc", d.id); setDrag({ type: "doc", ids }) }}
            onDragEnd={endDrag}
            {...dropProps(d.id, () => dropOnDoc(d))}
            className={cn(
              "group relative flex h-8.5 cursor-pointer items-center gap-2 rounded-md pr-1.5 pl-2 text-sm hover:bg-black/[0.045] dark:hover:bg-white/[0.05]",
              d.id === activeId && "bg-black/[0.065] font-medium dark:bg-white/[0.08]",
              selected.has(d.id) && "bg-sky-500/20 ring-1 ring-sky-500/60 ring-inset hover:bg-sky-500/25 dark:bg-sky-400/25 dark:ring-sky-400/70 dark:hover:bg-sky-400/30",
              over === d.id && "before:absolute before:inset-x-1 before:-top-px before:h-0.5 before:rounded before:bg-sky-500",
            )}
            onClick={e => clickDoc(e, d.id)}
            onDoubleClick={() => setEditing(d.id)}
          >
            {editing === d.id ? (
              renameInput(d.title, v => {
                setEditing(null)
                const title = v?.trim()
                if (title && title !== d.title) onRename(d.id, title)
              })
            ) : (
              <>
                <FileText className="size-4 shrink-0 text-muted-foreground" />
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
          <ContextMenuItem onSelect={() => newGroup(ids)}><FolderPlus /> Add to new group</ContextMenuItem>
          {groups.some(g => g.id !== d.group) && (
            <ContextMenuSub>
              <ContextMenuSubTrigger><span className="ml-6">Move to group</span></ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {groups.filter(g => g.id !== d.group).sort(byRank).map(g => (
                  <ContextMenuItem key={g.id} onSelect={() => moveTo(ids, g.id)}>
                    <span className="group-dot size-2.5 rounded-full" style={groupStyle(g.color)} /> {g.name}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          )}
          {current && <ContextMenuItem onSelect={() => moveTo(ids, null)}><FolderMinus /> Remove from group</ContextMenuItem>}
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

  const groupBlock = (g: Group, members: DocMeta[]) => (
    <div key={g.id}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            draggable={editing !== g.id}
            onDragStart={e => { e.dataTransfer.setData("text/x-reader-group", g.id); setDrag({ type: "group", id: g.id }) }}
            onDragEnd={endDrag}
            {...dropProps(g.id, () => dropOnGroup(g))}
            className={cn(
              "relative flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-1.5 hover:bg-black/[0.045] dark:hover:bg-white/[0.05]",
              over === g.id && "ring-2 ring-sky-500/60",
            )}
            onClick={() => editing !== g.id && saveGroup(g.id, { collapsed: !g.collapsed })}
            onDoubleClick={() => setEditing(g.id)}
          >
            <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", !g.collapsed && "rotate-90")} />
            {editing === g.id ? (
              renameInput(g.name, v => {
                setEditing(null)
                const name = v?.trim()
                if (name && name !== g.name) saveGroup(g.id, { name })
              })
            ) : (
              <>
                <span className="group-chip truncate rounded-[4px] px-1.5 text-xs leading-5 font-semibold" style={groupStyle(g.color)}>
                  {g.name}
                </span>
                {g.collapsed && <span className="text-xs text-muted-foreground tabular-nums">{members.length}</span>}
              </>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem onSelect={() => setEditing(g.id)}><Pencil /> Rename</ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger><span className="ml-6">Colour</span></ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {GROUP_COLORS.map(c => (
                <ContextMenuItem key={c.value} onSelect={() => saveGroup(g.id, { color: c.value })}>
                  <span className={cn("group-dot size-3 rounded-full", c.value === g.color && "ring-2 ring-foreground/50 ring-offset-1 ring-offset-popover")} style={groupStyle(c.value)} />
                  {c.name}
                </ContextMenuItem>
              ))}
              <ContextMenuSeparator />
              {/* Any CSS colour, applied on Enter. Keys stay in the field: the menu would take letters as a search
                  and arrows as moves. Escape still reaches the menu and closes it. */}
              <Input
                placeholder="#c2410c or rgb(…)"
                className="m-1 h-7 w-[calc(100%-0.5rem)] text-sm"
                onKeyDown={e => {
                  if (e.key === "Escape") return
                  e.stopPropagation()
                  if (e.key !== "Enter") return
                  const color = e.currentTarget.value.trim()
                  if (!color) return
                  if (!CSS.supports("color", color)) return onBadColor(color)
                  saveGroup(g.id, { color })
                  e.currentTarget.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
                }}
              />
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem
            onSelect={() => {
              // The documents step out in place, where the group stood.
              onPlace(ranksBetween(members.length, g.rank + 0.5, g.rank - 0.5).map((rank, i) => ({ id: members[i].id, group: null, rank })))
              onGroups(groups.filter(x => x.id !== g.id))
            }}
          >
            <FolderMinus /> Ungroup
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => onDelete(members.map(d => d.id), [g.id])}>
            <Trash2 /> Delete group
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {!g.collapsed && members.length > 0 && (
        <div className="group-line mt-0.5 ml-3 space-y-0.5 border-l-2 pl-1.5" style={groupStyle(g.color)}>
          {members.map(docRow)}
        </div>
      )}
    </div>
  )

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between py-2.5 pr-2 pl-2">
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={onHide} aria-label="Hide sidebar">
                <PanelLeft />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Hide sidebar (S)</TooltipContent>
          </Tooltip>
          <span className="text-[15px] font-semibold">Reader</span>
        </div>
        <div className="flex gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" onClick={onUpload} aria-label="Upload a file">
                <Upload />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Upload a .md or .txt file</TooltipContent>
          </Tooltip>
          <Button onClick={onNew}>
            <Plus /> New
          </Button>
        </div>
      </div>

      <nav className="flex flex-1 flex-col overflow-y-auto pb-2 pl-2 [scrollbar-gutter:stable]">
        <div className="space-y-0.5">
          {items.map(i => (i.type === "doc" ? docRow(i.doc) : groupBlock(i.group, i.docs)))}
        </div>
        <div className={cn("min-h-8 flex-1 rounded-md", over === "end" && "ring-2 ring-sky-500/60")} {...dropProps("end", dropAtEnd)} />
      </nav>
    </aside>
  )
}
