// The tab bar across the top, styled after the user's VS Code (screenshot of 2026-10-23): square tabs filling the
// bar's height from its left edge, a line between tabs, and + after the last. The current tab is brighter than the
// bar, with a thin light edge on top and a 2 px light-grey line along its bottom. Other tabs take the bar's colour.
// A tab is one document and shows its title until renamed with a double-click.
// Middle-click or × closes a tab; right-click opens its menu. Tabs shrink as more open.
// Dragging a tab sideways moves it; the new order is saved. The drag starts after 5 px of movement, so clicks still
// select. It is pointer-only: dnd-kit's keyboard drag would take Space, which plays and pauses.
import { useState } from "react"
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { arrayMove, horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Pencil, Plus, Volume2, X } from "lucide-react"
import type { DocMeta, Tab } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from "@/components/ui/context-menu"

type Props = {
  tabs: Tab[]
  activeTab?: string
  docs: DocMeta[]
  playingTab?: string
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
  onRename: (id: string, name: string | null) => void
  onReorder: (tabs: Tab[]) => void
}

export const tabTitle = (tab: Tab, docs: DocMeta[]) => tab.name ?? docs.find(d => d.id === tab.docId)?.title ?? "New tab"

type ItemProps = {
  tab: Tab
  title: string
  active: boolean
  playing: boolean
  editing: boolean
  onEdit: (editing: boolean) => void
  onSelect: () => void
  onClose: () => void
  onRename: (name: string | null) => void
}

function TabItem({ tab, title, active, playing, editing, onEdit, onSelect, onClose, onRename }: ItemProps) {
  // A tab being renamed stays put, so clicks and drags inside its text box select text instead.
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id: tab.id, disabled: editing })

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          {...listeners}
          role="tab"
          aria-selected={active}
          title={title}
          // Sideways only: the bar is one row tall.
          style={{ transform: CSS.Translate.toString(transform && { ...transform, y: 0 }), transition }}
          className={cn(
            "group relative flex min-w-20 max-w-56 shrink cursor-pointer items-center gap-1.5 border-r pr-1.5 pl-3 text-[13px]",
            active
              ? "bg-white text-foreground shadow-[inset_0_1px_0_#d9dce1] after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-[#4b4f56] dark:bg-[#1f2630] dark:shadow-[inset_0_1px_0_#3e4452] dark:after:bg-[#b4b4b4]"
              : "text-muted-foreground hover:bg-black/[0.03] hover:text-foreground dark:hover:bg-white/[0.03]",
            isDragging && "z-10 opacity-80 shadow-md",
          )}
          onClick={() => !editing && onSelect()}
          onAuxClick={e => { if (e.button === 1) { e.preventDefault(); onClose() } }}
          onDoubleClick={() => onEdit(true)}
        >
          {editing ? (
            <Input
              autoFocus
              defaultValue={title}
              className="h-6 px-1 text-[13px]"
              onClick={e => e.stopPropagation()}
              onFocus={e => e.target.select()}
              onBlur={e => {
                onEdit(false)
                const name = e.target.value.trim()
                // An emptied name goes back to following the document's title.
                if (name !== title) onRename(name || null)
              }}
              onKeyDown={e => {
                if (e.key === "Enter") e.currentTarget.blur()
                if (e.key === "Escape") { e.currentTarget.value = title; e.currentTarget.blur() }
              }}
            />
          ) : (
            <>
              <span className="min-w-0 flex-1 truncate">{title}</span>
              {playing && <Volume2 strokeWidth={2.75} className="size-3.5 shrink-0 [&>path:first-child]:fill-current" aria-label="Playing" />}
              <button
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded hover:bg-black/10 dark:hover:bg-white/10",
                  !active && "opacity-0 group-hover:opacity-100",
                )}
                aria-label={`Close ${title}`}
                title="Close tab (W)"
                onClick={e => { e.stopPropagation(); onClose() }}
              >
                <X className="size-3.5" />
              </button>
            </>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem onSelect={() => onEdit(true)}><Pencil /> Rename</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onClose}><X /> Close tab</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function TabBar({ tabs, activeTab, docs, playingTab, onSelect, onClose, onNew, onRename, onReorder }: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const dropped = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const from = tabs.findIndex(t => t.id === active.id)
    const to = tabs.findIndex(t => t.id === over.id)
    if (from >= 0 && to >= 0) onReorder(arrayMove(tabs, from, to))
  }

  return (
    <div className="flex h-[35px] shrink-0 border-b bg-sidebar">
      <div className="flex min-w-0 self-stretch">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dropped}>
          <SortableContext items={tabs.map(t => t.id)} strategy={horizontalListSortingStrategy}>
            {tabs.map(tab => (
              <TabItem
                key={tab.id}
                tab={tab}
                title={tabTitle(tab, docs)}
                active={tab.id === activeTab}
                playing={playingTab === tab.id}
                editing={editing === tab.id}
                onEdit={on => setEditing(on ? tab.id : null)}
                onSelect={() => onSelect(tab.id)}
                onClose={() => onClose(tab.id)}
                onRename={name => onRename(tab.id, name)}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>
      <Button variant="ghost" size="icon-sm" className="mx-1 shrink-0 self-center text-muted-foreground" aria-label="New tab" title="New tab (T)" onClick={onNew}>
        <Plus />
      </Button>
    </div>
  )
}
