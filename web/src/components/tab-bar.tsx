// The tab bar across the top, styled after the user's VS Code (screenshot of 2026-10-23): square tabs filling the
// bar's height from its left edge, a line between tabs, and + after the last. The current tab is brighter than the
// bar, with a thin light edge on top and a 2 px light-grey line along its bottom. Other tabs take the bar's colour.
// A tab is one document and shows its title until renamed with a double-click.
// Middle-click or × closes a tab; right-click opens its menu. Tabs shrink as more open.
import { useState } from "react"
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
}

export const tabTitle = (tab: Tab, docs: DocMeta[]) => tab.name ?? docs.find(d => d.id === tab.docId)?.title ?? "New tab"

export function TabBar({ tabs, activeTab, docs, playingTab, onSelect, onClose, onNew, onRename }: Props) {
  const [editing, setEditing] = useState<string | null>(null)

  return (
    <div className="flex h-[35px] shrink-0 border-b bg-sidebar">
      <div className="flex min-w-0 self-stretch">
        {tabs.map(tab => {
          const title = tabTitle(tab, docs)
          const active = tab.id === activeTab
          return (
            <ContextMenu key={tab.id}>
              <ContextMenuTrigger asChild>
                <div
                  role="tab"
                  aria-selected={active}
                  title={title}
                  className={cn(
                    "group relative flex min-w-20 max-w-56 shrink cursor-pointer items-center gap-1.5 border-r pr-1.5 pl-3 text-[13px]",
                    active
                      ? "bg-white text-foreground shadow-[inset_0_1px_0_#d9dce1] after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-[#4b4f56] dark:bg-[#1f2630] dark:shadow-[inset_0_1px_0_#3e4452] dark:after:bg-[#b4b4b4]"
                      : "text-muted-foreground hover:bg-black/[0.03] hover:text-foreground dark:hover:bg-white/[0.03]",
                  )}
                  onClick={() => editing !== tab.id && onSelect(tab.id)}
                  onAuxClick={e => { if (e.button === 1) { e.preventDefault(); onClose(tab.id) } }}
                  onDoubleClick={() => setEditing(tab.id)}
                >
                  {editing === tab.id ? (
                    <Input
                      autoFocus
                      defaultValue={title}
                      className="h-6 px-1 text-[13px]"
                      onClick={e => e.stopPropagation()}
                      onFocus={e => e.target.select()}
                      onBlur={e => {
                        setEditing(null)
                        const name = e.target.value.trim()
                        // An emptied name goes back to following the document's title.
                        if (name !== title) onRename(tab.id, name || null)
                      }}
                      onKeyDown={e => {
                        if (e.key === "Enter") e.currentTarget.blur()
                        if (e.key === "Escape") { e.currentTarget.value = title; e.currentTarget.blur() }
                      }}
                    />
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate">{title}</span>
                      {playingTab === tab.id && <Volume2 strokeWidth={2.75} className="size-3.5 shrink-0 [&>path:first-child]:fill-current" aria-label="Playing" />}
                      <button
                        className={cn(
                          "grid size-5 shrink-0 place-items-center rounded hover:bg-black/10 dark:hover:bg-white/10",
                          !active && "opacity-0 group-hover:opacity-100",
                        )}
                        aria-label={`Close ${title}`}
                        title="Close tab (W)"
                        onClick={e => { e.stopPropagation(); onClose(tab.id) }}
                      >
                        <X className="size-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-44">
                <ContextMenuItem onSelect={() => setEditing(tab.id)}><Pencil /> Rename</ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => onClose(tab.id)}><X /> Close tab</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )
        })}
      </div>
      <Button variant="ghost" size="icon-sm" className="mx-1 shrink-0 self-center text-muted-foreground" aria-label="New tab" title="New tab (T)" onClick={onNew}>
        <Plus />
      </Button>
    </div>
  )
}
