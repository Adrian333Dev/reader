// The page: sidebar of documents, and the reading pane with the player floating over its bottom.
import { useCallback, useEffect, useRef, useState } from "react"
import { ClipboardPaste } from "lucide-react"
import { toast } from "sonner"
import { api, DEFAULT_COLORS, type Doc, type DocFormat, type DocMeta, type EngineStatus, type Settings, type Voice } from "@/lib/api"
import { Player } from "@/reading/player"
import { Sidebar } from "@/components/sidebar"
import { ReaderView } from "@/components/reader-view"
import { PlayerBar } from "@/components/player-bar"
import { NewDocument } from "@/components/new-document"

const FILE_TYPES = /\.(md|markdown|txt)$/i

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

const fail = (what: string) => (e: Error) => toast.error(what, { description: e.message })

export default function App() {
  const [player] = useState(() => new Player())
  const [docs, setDocs] = useState<DocMeta[]>([])
  const [doc, setDoc] = useState<Doc | null>(null)
  const [composing, setComposing] = useState(false)
  const [voices, setVoices] = useState<Voice[]>([])
  const [settings, setSettings] = useState<Settings>({ speed: 1, ...DEFAULT_COLORS })
  const [engine, setEngine] = useState<EngineStatus>("starting")
  const uploadRef = useRef<HTMLInputElement>(null)

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

  const openDoc = useCallback((id: string) => {
    api.doc(id).then(d => {
      setDoc(d)
      setComposing(false)
      updateSettings({ lastDoc: id })
    }, fail("Couldn't open the document"))
  }, [updateSettings])

  const createDoc = useCallback(async (text: string, format: DocFormat = "md", title?: string) => {
    try {
      const meta = await api.createDoc({ text, format, title })
      setDocs(ds => [meta, ...ds])
      openDoc(meta.id)
    } catch (e) {
      fail("Couldn't save the document")(e as Error)
    }
  }, [openDoc])

  const createFromFiles = useCallback(async (files: Iterable<File>) => {
    for (const file of files) {
      if (!FILE_TYPES.test(file.name)) { toast.error(`${file.name} is not a .md or .txt file`); continue }
      await createDoc(await file.text(), /\.txt$/i.test(file.name) ? "txt" : "md", file.name.replace(FILE_TYPES, ""))
    }
  }, [createDoc])

  // First load: documents, voices, saved settings; reopen the last document.
  useEffect(() => {
    player.onError = fail("Couldn't make speech")
    Promise.all([api.docs(), api.voices(), api.settings()]).then(([list, v, saved]) => {
      setDocs(list)
      setVoices(v.voices)
      const merged = { voice: v.default, speed: 1, ...DEFAULT_COLORS, ...saved }
      setSettings(merged)
      player.setVoice(merged.voice)
      player.setSpeed(merged.speed)
      const last = list.find(d => d.id === merged.lastDoc) ?? list[0]
      if (last) openDoc(last.id)
    }, fail("Couldn't reach the Reader server"))
  }, [player, openDoc])

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

  // Ctrl+V anywhere outside a text field makes a new document; so does dropping a file.
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
    setDocs(ds => ds.map(d => (d.id === docId ? { ...d, ...changes } : d)))
    clearTimeout(positionTimers.current.get(docId))
    positionTimers.current.set(docId, window.setTimeout(() => {
      api.updateDoc(docId, changes).catch(fail("Couldn't save the reading position"))
    }, 800))
  }, [docId])

  const rename = (id: string, title: string) => {
    api.updateDoc(id, { title }).then(meta => {
      setDocs(ds => ds.map(d => (d.id === id ? meta : d)))
      setDoc(d => (d?.id === id ? { ...d, title: meta.title } : d))
    }, fail("Couldn't rename"))
  }

  const remove = (id: string) => {
    clearTimeout(positionTimers.current.get(id))
    api.deleteDoc(id).then(() => {
      setDocs(ds => ds.filter(d => d.id !== id))
      if (doc?.id === id) setDoc(null)
    }, fail("Couldn't delete"))
  }

  let main
  if (composing) main = <NewDocument onSave={text => createDoc(text)} onCancel={() => setComposing(false)} />
  else if (doc) main = <ReaderView key={doc.id} doc={doc} player={player} onPosition={savePosition} />
  else main = (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
      <ClipboardPaste className="size-8 stroke-[1.5]" />
      <p className="text-sm">Press <kbd className="rounded border px-1 font-sans">Ctrl</kbd> + <kbd className="rounded border px-1 font-sans">V</kbd> to read what's on your clipboard</p>
      <p className="text-xs">or drop a .md or .txt file here</p>
    </div>
  )

  return (
    <div className="flex h-svh flex-col">
      <div className="flex min-h-0 flex-1">
        <Sidebar
          docs={docs}
          activeId={composing ? undefined : doc?.id}
          onOpen={openDoc}
          onNew={() => { player.pause(); setComposing(true) }}
          onUpload={() => uploadRef.current?.click()}
          onRename={rename}
          onDelete={remove}
        />
        <main className="relative min-w-0 flex-1 bg-background">
          {main}
          {!composing && (
            <PlayerBar
              player={player}
              voices={voices}
              settings={settings}
              engine={engine}
              hasDoc={!!doc}
              onSettings={updateSettings}
            />
          )}
        </main>
      </div>
      <input
        ref={uploadRef}
        type="file"
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        multiple
        hidden
        onChange={e => { createFromFiles([...(e.target.files ?? [])]); e.target.value = "" }}
      />
    </div>
  )
}
