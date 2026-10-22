// Calls to the Reader server. Types mirror server/store.ts and server/providers/types.ts.

export type DocFormat = "md" | "txt"
export type DocMeta = { id: string; title: string; format: DocFormat; createdAt: number; position: number; progress: number }
export type Doc = DocMeta & { text: string }
export type Voice = { id: string; name: string; gender: "male" | "female"; accent: string }
export type Synthesis = { audio: string; words: string[]; wtimes: number[]; wdurations: number[] }
export type EngineStatus = "starting" | "ready" | "down"

export type Settings = {
  voice?: string
  speed?: number
  sentenceColor?: string
  wordColor?: string
  lastDoc?: string
}

export const DEFAULT_COLORS = { sentenceColor: "#fde68a", wordColor: "#fbbf24" }

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status} ${await res.text()}`)
  return res.status === 204 ? (undefined as T) : res.json()
}

export const api = {
  docs: () => call<DocMeta[]>("/api/docs"),
  doc: (id: string) => call<Doc>(`/api/docs/${id}`),
  createDoc: (body: { text: string; format?: DocFormat; title?: string }) => call<DocMeta>("/api/docs", "POST", body),
  updateDoc: (id: string, body: Partial<Pick<DocMeta, "title" | "position" | "progress">>) => call<DocMeta>(`/api/docs/${id}`, "PATCH", body),
  deleteDoc: (id: string) => call<void>(`/api/docs/${id}`, "DELETE"),
  voices: () => call<{ voices: Voice[]; default: string }>("/api/voices"),
  status: () => call<{ tts: EngineStatus }>("/api/status"),
  settings: () => call<Settings>("/api/settings"),
  saveSettings: (body: Settings) => call<Settings>("/api/settings", "PATCH", body),
}

export const synth = (text: string, voice: string) => call<Synthesis>("/api/synth", "POST", { text, voice })
