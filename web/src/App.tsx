// The page: the tab bar on top, the reading pane below it, and the player floating over the pane's bottom.
// A tab is one document. Ctrl+V replaces the current tab's document; Ctrl+Z brings the one before it back.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { ClipboardPaste, Pencil, Upload } from "lucide-react"
import { toast } from "sonner"
import {
  api, DEFAULT_COLORS, type Doc, type DocFormat, type DocMeta, type EngineStatus, type Settings, type Tab, type Voice,
} from "@/lib/api"
import { Player } from "@/reading/player"
import { TabBar, tabTitle } from "@/components/tab-bar"
import { Shortcuts } from "@/components/shortcuts"
import { ReaderView } from "@/components/reader-view"
import { PlayerBar } from "@/components/player-bar"
import { NewDocument } from "@/components/new-document"
import { Button } from "@/components/ui/button"

const FILE_TYPES = /\.(md|markdown|txt)$/i

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

const fail = (what: string) => (e: Error) => toast.error(what, { description: e.message })

const tabId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

// Each tab's paste history, in memory only, so a reload clears it. `undo` holds the documents the tab showed
// before, newest last; `null` is the tab empty. A replaced document stays on disk while a history holds it.
type History = { undo: (string | null)[]; redo: (string | null)[] }

export default function App() {
  const [player] = useState(() => new Player())
  const [docs, setDocs] = useState<DocMeta[]>([])
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTab, setActiveTab] = useState<string | undefined>()
  const [doc, setDoc] = useState<Doc | null>(null)
  const [composing, setComposing] = useState(false)
  const [voices, setVoices] = useState<Voice[]>([])
  const [settings, setSettings] = useState<Settings>({ speed: 1, ...DEFAULT_COLORS })
  const [engine, setEngine] = useState<EngineStatus>("starting")
  const uploadRef = useRef<HTMLInputElement>(null)
  const { state: playState } = useSyncExternalStore(player.subscribe, player.getSnapshot)
  const playing = !!doc && !composing && playState !== "paused"

  // Async callbacks read the latest lists through these, not through a stale closure.
  const tabsRef = useRef(tabs)
  const activeRef = useRef(activeTab)
  const docsRef = useRef(docs)
  const histories = useRef(new Map<string, History>())
  const history = (id: string) => {
    if (!histories.current.has(id)) histories.current.set(id, { undo: [], redo: [] })
    return histories.current.get(id)!
  }

  // Settings save after a short pause, so dragging a colour picker sends one request.
  const pendingSettings = useRef<Settings>({})
  const settingsTimer = useRef<number | undefined>(undefined)
  const updateSettings = useCallback((changes: Settings) => {
    setSettings(s => ({ ...s, ...changes }))
    Object.assign(pendingSettings.current, changes)
    clearTimeout(settingsTimer.current)
    settingsTimer.current = window.setTimeout(() => {
      const body = pendingSettings.current
      pendingSettings.current = {}
      api.saveSettings(body).catch(fail("Couldn't save settings"))
    }, 400)
  }, [])

  const commitTabs = useCallback((next: Tab[]) => {
    tabsRef.current = next
    setTabs(next)
    api.saveTabs(next).catch(fail("Couldn't save the tabs"))
  }, [])

  const setDocList = (next: DocMeta[]) => { docsRef.current = next; setDocs(next) }

  // Shows a document in a tab and makes the tab current; by default the document the tab already holds.
  // A document that no longer exists leaves the tab empty.
  const show = useCallback((id: string, docId?: string | null) => {
    const tab = tabsRef.current.find(t => t.id === id)
    if (!tab) return
    if (docId === undefined) docId = tab.docId
    if (docId && !docsRef.current.some(d => d.id === docId)) docId = null
    if (tab.docId !== docId) commitTabs(tabsRef.current.map(t => (t.id === id ? { ...t, docId } : t)))
    activeRef.current = id
    setActiveTab(id)
    setComposing(false)
    updateSettings({ activeTab: id })
    if (!docId) return setDoc(null)
    api.doc(docId).then(d => {
      // The position saved here may still be on its way to the server; the page's copy is the newest.
      const meta = docsRef.current.find(x => x.id === d.id)
      // A quicker click on another tab wins.
      if (activeRef.current === id && tabsRef.current.find(t => t.id === id)?.docId === d.id) setDoc({ ...d, position: meta?.position ?? d.position })
    }, fail("Couldn't open the document"))
  }, [commitTabs, updateSettings])

  const newTab = useCallback((docId: string | null, open: boolean, id = tabId()) => {
    commitTabs([...tabsRef.current, { id, name: null, docId }])
    if (open) show(id)
  }, [commitTabs, show])

  // Deletes documents no tab shows and no history holds.
  const discard = useCallback((ids: (string | null)[]) => {
    const held = (id: string) =>
      tabsRef.current.some(t => t.docId === id) || [...histories.current.values()].some(h => h.undo.includes(id) || h.redo.includes(id))
    const gone = new Set(ids.filter((id): id is string => !!id && !held(id)))
    if (!gone.size) return
    setDocList(docsRef.current.filter(d => !gone.has(d.id)))
    for (const id of gone) api.deleteDoc(id).catch(fail("Couldn't delete"))
  }, [])

  // A paste replaces the current tab's document, and stops the voice if it was reading; with no tab, it opens one.
  // The replaced document goes on the tab's undo list. Upload's second and later files get tabs of their own.
  const createDoc = useCallback(async (text: string, format: DocFormat = "md", title?: string, target: "current" | "new" = "current") => {
    const into = target === "current" ? activeRef.current : undefined
    const tab = into ?? tabId()
    try {
      const meta = await api.createDoc({ text, format, title, tab })
      setDocList([meta, ...docsRef.current])
      if (!into) return newTab(meta.id, target === "current" || !activeRef.current, tab)
      const h = history(into)
      h.undo.push(tabsRef.current.find(t => t.id === into)?.docId ?? null)
      const dropped = h.redo
      h.redo = []
      show(into, meta.id)
      discard(dropped)
    } catch (e) {
      fail("Couldn't save the document")(e as Error)
    }
  }, [show, newTab, discard])

  const createFromFiles = useCallback(async (files: Iterable<File>) => {
    let i = 0
    for (const file of files) {
      if (!FILE_TYPES.test(file.name)) { toast.error(`${file.name} is not a .md or .txt file`); continue }
      await createDoc(await file.text(), /\.txt$/i.test(file.name) ? "txt" : "md", file.name.replace(FILE_TYPES, ""), i++ ? "new" : "current")
    }
  }, [createDoc])

  // Ctrl+Z shows the document the tab held before the last paste, at the sentence where it stopped; Ctrl+Shift+Z
  // goes forward again.
  const undo = (redo: boolean) => {
    const id = activeRef.current
    if (!id) return
    const h = history(id)
    const from = redo ? h.redo : h.undo
    if (!from.length) return
    const prev = from.pop()!
    ;(redo ? h.undo : h.redo).push(tabsRef.current.find(t => t.id === id)?.docId ?? null)
    show(id, prev)
  }

  // Closing a tab deletes its document and its history once the toast closes; Undo puts the tab back.
  // The tab to its right takes over, else the one to its left.
  const closeTab = useCallback((id: string) => {
    const list = tabsRef.current
    const i = list.findIndex(t => t.id === id)
    if (i < 0) return
    const tab = list[i]
    const h = histories.current.get(id) ?? { undo: [], redo: [] }
    histories.current.delete(id)
    commitTabs(list.filter(t => t.id !== id))
    if (id === activeRef.current) {
      const next = list[i + 1] ?? list[i - 1]
      if (next) show(next.id)
      else {
        activeRef.current = undefined
        setActiveTab(undefined)
        setDoc(null)
      }
    }
    const ids = [tab.docId, ...h.undo, ...h.redo]
    if (!ids.some(Boolean)) return
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      discard(ids)
    }
    toast(`Closed “${tabTitle(tab, docsRef.current)}”`, {
      action: {
        label: "Undo",
        onClick: () => {
          settled = true
          const rest = tabsRef.current
          commitTabs([...rest.slice(0, i), tab, ...rest.slice(i)])
          histories.current.set(id, h)
          show(id)
        },
      },
      onAutoClose: finish,
      onDismiss: finish,
    })
  }, [commitTabs, show, discard])

  // First load: documents, tabs, voices, saved settings. The last current tab opens. With no saved tabs yet,
  // one empty tab.
  useEffect(() => {
    player.onError = fail("Couldn't make speech")
    // Addresses from the version with history (?tab=…&doc=…) are cleared.
    if (location.search) window.history.replaceState(null, "", location.pathname)
    Promise.all([api.docs(), api.tabs(), api.voices(), api.settings()]).then(([list, savedTabs, v, saved]) => {
      setDocList(list)
      setVoices(v.voices)
      const merged = { voice: v.default, speed: 1, ...DEFAULT_COLORS, ...saved }
      setSettings(merged)
      player.setVoice(merged.voice)
      player.setSpeed(merged.speed)
      const first = (savedTabs ?? [{ id: tabId(), name: null, docId: null }]).map(({ id, name, docId }) => ({ id, name, docId }))
      if (savedTabs) { tabsRef.current = first; setTabs(first) }
      else commitTabs(first)
      const tab = first.find(t => t.id === merged.activeTab) ?? first[0]
      if (tab) show(tab.id)
    }, fail("Couldn't reach the Reader server"))
  }, [player, show, commitTabs])

  // Voice engine state, polled until ready and then now and then.
  useEffect(() => {
    let timer: number
    const poll = () => api.status().then(s => s.tts, () => "down" as const).then(s => {
      setEngine(s)
      timer = window.setTimeout(poll, s === "ready" ? 15000 : 2000)
    })
    poll()
    return () => clearTimeout(timer)
  }, [])

  // Highlight colours as CSS variables, read by .reader-hl-sentence and .reader-hl-word.
  useEffect(() => {
    const style = document.documentElement.style
    style.setProperty("--hl-sentence", settings.sentenceColor ?? DEFAULT_COLORS.sentenceColor)
    style.setProperty("--hl-word", settings.wordColor ?? DEFAULT_COLORS.wordColor)
  }, [settings.sentenceColor, settings.wordColor])

  // Ctrl+V anywhere outside a text field puts the clipboard in the current tab; so does dropping a file.
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      if (isEditable(e.target)) return
      const files = [...(e.clipboardData?.files ?? [])]
      const text = e.clipboardData?.getData("text/plain") ?? ""
      if (files.length) { e.preventDefault(); createFromFiles(files) }
      else if (text.trim()) { e.preventDefault(); createDoc(text) }
    }
    const over = (e: DragEvent) => e.preventDefault()
    const drop = (e: DragEvent) => {
      e.preventDefault()
      if (e.dataTransfer?.files.length) createFromFiles(e.dataTransfer.files)
    }
    window.addEventListener("paste", paste)
    window.addEventListener("dragover", over)
    window.addEventListener("drop", drop)
    return () => {
      window.removeEventListener("paste", paste)
      window.removeEventListener("dragover", over)
      window.removeEventListener("drop", drop)
    }
  }, [createDoc, createFromFiles])

  // Reading position, saved per document a moment after it changes.
  const positionTimers = useRef(new Map<string, number>())
  const docId = doc?.id
  const savePosition = useCallback((sentence: number, total: number) => {
    if (!docId) return
    const changes = { position: sentence, progress: total ? (sentence + 1) / total : 0 }
    setDocList(docsRef.current.map(d => (d.id === docId ? { ...d, ...changes } : d)))
    clearTimeout(positionTimers.current.get(docId))
    positionTimers.current.set(docId, window.setTimeout(() => {
      api.updateDoc(docId, changes).catch(fail("Couldn't save the reading position"))
    }, 800))
  }, [docId])

  const compose = () => { player.pause(); setComposing(true) }

  // Page-wide keys: Ctrl+Z and Ctrl+Shift+Z undo and redo a paste, T and W new and close tab, Ctrl+← and Ctrl+→
  // previous and next tab, 1 to 9 a tab by its place, N new, U upload, ? shortcut list. Enter on a button is dropped: the last button clicked keeps focus,
  // and Enter would press it again.
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  keys.current = e => {
    if (isEditable(e.target) || (e.target as HTMLElement).closest?.("[role=menu],[role=dialog],[role=alertdialog]")) return
    const z = e.key.toLowerCase() === "z"
    if (e.key === "Enter" && (e.target as HTMLElement).closest?.("button")) e.preventDefault()
    else if ((e.ctrlKey || e.metaKey) && !e.altKey && (z || e.key === "y")) undo(e.shiftKey || e.key === "y")
    else if (e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      // Ctrl+← and Ctrl+→: the previous and next tab, wrapping round at either end.
      const i = tabs.findIndex(t => t.id === activeTab)
      const next = tabs[(i + (e.key === "ArrowLeft" ? -1 : 1) + tabs.length) % tabs.length]
      if (next && next.id !== activeTab) show(next.id)
    }
    else if (e.ctrlKey || e.metaKey || e.altKey) return
    else if (e.key === "t") newTab(null, true)
    else if (e.key === "w" && activeTab) closeTab(activeTab)
    else if (/^[1-9]$/.test(e.key)) {
      // 1 to 8 go to that tab and 9 to the last, as in browsers.
      const next = e.key === "9" ? tabs.at(-1) : tabs[Number(e.key) - 1]
      if (next && next.id !== activeTab) show(next.id)
    }
    else if (e.key === "n") compose()
    else if (e.key === "u") uploadRef.current?.click()
    else if (e.key === "?") setShortcutsOpen(true)
    else return
    e.preventDefault()
  }
  useEffect(() => {
    const down = (e: KeyboardEvent) => keys.current(e)
    window.addEventListener("keydown", down)
    return () => window.removeEventListener("keydown", down)
  }, [])

  let main
  if (composing) main = <NewDocument onSave={text => createDoc(text)} onCancel={() => setComposing(false)} />
  else if (doc) main = <ReaderView key={doc.id} doc={doc} player={player} onPosition={savePosition} />
  else main = (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
      <ClipboardPaste className="size-8 stroke-[1.5]" />
      <p className="text-sm">Press <kbd className="rounded border px-1 font-sans">Ctrl</kbd> + <kbd className="rounded border px-1 font-sans">V</kbd> to read what's on your clipboard</p>
      <p className="text-xs">or drop a .md or .txt file here</p>
      <div className="mt-2 flex gap-2">
        <Button variant="outline" size="sm" onClick={() => uploadRef.current?.click()}><Upload /> Upload a file</Button>
        <Button variant="outline" size="sm" onClick={compose}><Pencil /> Type it in</Button>
      </div>
    </div>
  )

  const current = tabs.find(t => t.id === activeTab)

  return (
    <div className="flex h-svh flex-col">
      <TabBar
        tabs={tabs}
        activeTab={activeTab}
        docs={docs}
        playingTab={playing ? activeTab : undefined}
        onSelect={id => id !== activeTab && show(id)}
        onClose={closeTab}
        onNew={() => newTab(null, true)}
        onRename={(id, name) => commitTabs(tabsRef.current.map(t => (t.id === id ? { ...t, name } : t)))}
      />
      <main className="relative min-h-0 flex-1 bg-background">
        {main}
        {!composing && (
          <PlayerBar player={player} voices={voices} settings={settings} engine={engine} hasDoc={!!doc} onSettings={updateSettings} />
        )}
        <Button
          variant="outline"
          size="icon-sm"
          className="absolute right-4 bottom-4 z-30 rounded-full text-sm font-semibold text-muted-foreground shadow-sm"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
          onClick={() => setShortcutsOpen(true)}
        >
          {/* A bare "?": lucide's question icons all sit in a circle, which inside a round button doubles it. */}
          ?
        </Button>
      </main>
      <input
        ref={uploadRef}
        type="file"
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        multiple
        hidden
        onChange={e => { createFromFiles([...(e.target.files ?? [])]); e.target.value = "" }}
      />
      <Shortcuts open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      {/* The window title follows the current tab. */}
      <title>{current ? `${tabTitle(current, docs)} · Reader` : "Reader"}</title>
    </div>
  )
}
