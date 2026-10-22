// A paste box for a new document. Ctrl+V outside it is the quicker path.
import { useState } from "react"
import { Button } from "@/components/ui/button"

export function NewDocument({ onSave, onCancel }: { onSave: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState("")
  const save = () => text.trim() && onSave(text)

  return (
    <div className="mx-auto flex h-full w-full max-w-[760px] flex-col gap-3 p-6">
      <textarea
        autoFocus
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save() }}
        placeholder="Paste or type Markdown or plain text…"
        className="flex-1 resize-none rounded-lg border bg-transparent p-4 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
      />
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-xs text-muted-foreground">Ctrl + Enter saves</span>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button disabled={!text.trim()} onClick={save}>Save and read</Button>
      </div>
    </div>
  )
}
