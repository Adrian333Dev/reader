// The keyboard shortcut list, opened with "?". The keys themselves live where they act: reader view, player, App.
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"

export const SHORTCUTS: [string, [string, string][]][] = [
  ["Playing", [
    ["Space", "Play or pause; with text selected, read from it"],
    ["Click", "Read from that word"],
    ["← →", "Previous or next sentence"],
    ["+ −", "Faster or slower"],
    ["V", "Choose a voice"],
    ["C", "Highlight colours"],
  ]],
  ["Tabs", [
    ["Ctrl V", "Paste into the tab, replacing its text"],
    ["Ctrl Z", "Undo the last paste in the tab"],
    ["Ctrl Shift Z", "Redo the paste"],
    ["T", "New tab"],
    ["W", "Close the tab"],
    ["Ctrl ← Ctrl →", "Previous or next tab"],
    ["1 – 9", "Go to that tab; 9 is the last"],
    ["N", "Type or paste into a box"],
    ["U", "Upload a file"],
    ["?", "This list"],
  ]],
]

export function Shortcuts({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {/* 448 px: wide enough for the longest label, narrow enough that a key stays close to it. The dialog's
          data-size width class outranks a plain max-w. A line between rows ties each label to its key. */}
      <AlertDialogContent className="max-h-[90svh] overflow-y-auto data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Keyboard shortcuts</AlertDialogTitle>
        </AlertDialogHeader>
        <div className="space-y-4 text-sm">
          {SHORTCUTS.map(([section, keys]) => (
            <section key={section}>
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">{section}</h3>
              {keys.map(([key, what]) => (
                <div key={key} className="flex items-baseline justify-between gap-4 border-b py-1.5 last:border-b-0">
                  <span>{what}</span>
                  <kbd className="shrink-0 rounded border bg-muted px-1.5 font-sans text-xs whitespace-nowrap">{key}</kbd>
                </div>
              ))}
            </section>
          ))}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Close</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
