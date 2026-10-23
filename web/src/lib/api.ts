// Calls to the Reader server. Types mirror server/store.ts and server/providers/types.ts.

export type DocFormat = "md" | "txt"
export type DocMeta = {
  id: string; title: string; format: DocFormat; createdAt: number; position: number; progress: number
  seen: boolean; group: string | null; tab: string | null; rank: number
}
export type Doc = DocMeta & { text: string }
export type Group = { id: string; name: string; color: string; rank: number; collapsed: boolean }
export type Tab = { id: string; name: string | null; docId: string | null }
export type Voice = { id: string; name: string; gender: "male" | "female"; accent: string }
export type Synthesis = { audio: string; words: string[]; wtimes: number[]; wdurations: number[] }
export type EngineStatus = "starting" | "ready" | "down"

export type Settings = {
  voice?: string
  speed?: number
  sentenceColor?: string
  wordColor?: string
}

export const DEFAULT_COLORS = { sentenceColor: "#fde68a", wordColor: "#fbbf24" }

async function call<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  })
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status} ${await res.text()}`)
  return res.status === 204 ? (undefined as T) : res.json()
}

// This window's tabs live in a workspace (rd-37). Its name is in the address (?w=3fa9c1). A bare address gets one from
// the server, and the name is written into the address, so a reload, a reopened tab or a restored VS Code window finds
// the same tabs. Mirrors server/store.ts.
export type Workspace = { tabs: Tab[] | null; activeTab: string | null }
let workspace = new URLSearchParams(location.search).get("w") ?? ""
let resolving: Promise<string> | undefined
export const resolveWorkspace = () => (resolving ??= (async () => {
  if (!workspace) workspace = (await call<{ name: string }>("/api/workspace/claim", "POST")).name
  // This also clears addresses from the version with history (?tab=…&doc=…).
  window.history.replaceState(null, "", `${location.pathname}?w=${encodeURIComponent(workspace)}`)
  return workspace
})())
const workspaceUrl = (action = "") => `/api/workspace${action}?w=${encodeURIComponent(workspace)}`

export const api = {
  docs: () => call<DocMeta[]>("/api/docs"),
  doc: (id: string) => call<Doc>(`/api/docs/${id}`),
  createDoc: (body: { text: string; format?: DocFormat; title?: string; group?: string | null; tab?: string | null }) =>
    call<DocMeta>("/api/docs", "POST", body),
  updateDoc: (id: string, body: Partial<Pick<DocMeta, "title" | "position" | "progress" | "seen" | "group" | "tab" | "rank">>) =>
    call<DocMeta>(`/api/docs/${id}`, "PATCH", body),
  groups: () => call<Group[]>("/api/groups"),
  saveGroups: (groups: Group[]) => call<Group[]>("/api/groups", "PUT", groups),
  workspace: () => call<Workspace>(workspaceUrl()),
  saveWorkspace: (changes: { tabs?: Tab[]; activeTab?: string }) => call<Workspace>(workspaceUrl(), "PUT", changes),
  // Tells the server this window is open, so no other bare address takes its workspace.
  pingWorkspace: () => call<void>(workspaceUrl("/ping"), "POST"),
  releaseWorkspace: () => navigator.sendBeacon(workspaceUrl("/release")),
  deleteDoc: (id: string) => call<void>(`/api/docs/${id}`, "DELETE"),
  voices: () => call<{ voices: Voice[]; default: string }>("/api/voices"),
  status: () => call<{ tts: EngineStatus }>("/api/status"),
  settings: () => call<Settings>("/api/settings"),
  saveSettings: (body: Settings) => call<Settings>("/api/settings", "PATCH", body),
}

// A sentence's parts in order, joining back into its text: plain text, inline code, or a link. Mirrors server/spoken.ts.
export type Piece = { type: "text" | "code" | "link"; text: string; href?: string }

export const synth = (text: string, voice: string, signal?: AbortSignal, pieces?: Piece[]) =>
  call<Synthesis>("/api/synth", "POST", { text, voice, pieces }, signal)

// The reader's right-click "Flag…" (rd-15). Mirrors server/feedback.ts.
export const saveFlag = (body: {
  word: string; text: string; pieces: Piece[]; before?: string; after?: string; markdown?: string
  doc: { id: string; title: string }; voice: string; speed: number; note: string
}) => call<object>("/api/flags", "POST", body)
