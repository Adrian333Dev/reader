// Documents, newest first. Double-click renames; the "…" menu renames or deletes.
import { useState } from "react"
import { FileText, MoreHorizontal, Pencil, Plus, Trash2, Upload } from "lucide-react"
import type { DocMeta } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"

type Props = {
  docs: DocMeta[]
  activeId?: string
  onOpen: (id: string) => void
  onNew: () => void
  onUpload: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
}

const progressLabel = (p: number) => (p <= 0 ? "New" : p >= 0.999 ? "Done" : `${Math.round(p * 100)}%`)

export function Sidebar({ docs, activeId, onOpen, onNew, onUpload, onRename, onDelete }: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<DocMeta | null>(null)

  const commit = (id: string, value: string) => {
    setEditing(null)
    const title = value.trim()
    if (title && title !== docs.find(d => d.id === id)?.title) onRename(id, title)
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between py-2.5 pr-2 pl-4">
        <span className="text-[15px] font-semibold">Reader</span>
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

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {docs.map(d => (
          <div
            key={d.id}
            className={cn(
              "group relative flex h-8.5 cursor-pointer items-center gap-2 rounded-md pr-1 pl-2 text-sm hover:bg-black/[0.045] dark:hover:bg-white/[0.05]",
              d.id === activeId && "bg-black/[0.065] font-medium dark:bg-white/[0.08]",
            )}
            onClick={() => editing !== d.id && onOpen(d.id)}
            onDoubleClick={() => setEditing(d.id)}
          >
            {editing === d.id ? (
              <Input
                autoFocus
                defaultValue={d.title}
                className="h-7 text-sm"
                onClick={e => e.stopPropagation()}
                onFocus={e => e.target.select()}
                onBlur={e => commit(d.id, e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") commit(d.id, e.currentTarget.value)
                  if (e.key === "Escape") setEditing(null)
                }}
              />
            ) : (
              <>
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{d.title}</span>
                {/* The percentage gives way to the "…" button on hover or while its menu is open. */}
                <span className="pr-1.5 text-xs font-normal text-muted-foreground tabular-nums group-hover:hidden group-has-[[aria-expanded=true]]:hidden">
                  {progressLabel(d.progress)}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Document actions"
                      className="hidden group-hover:inline-flex focus-visible:inline-flex aria-expanded:inline-flex hover:bg-black/[0.07] dark:hover:bg-white/[0.1]"
                      onClick={e => e.stopPropagation()}
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={e => e.stopPropagation()}>
                    <DropdownMenuItem onSelect={() => setEditing(d.id)}>
                      <Pencil /> Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(d)}>
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        ))}
      </nav>

      <AlertDialog open={!!deleting} onOpenChange={open => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>The document and its reading position are removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => deleting && onDelete(deleting.id)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  )
}
