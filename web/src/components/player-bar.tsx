// The player: one panel floating over the bottom of the reading pane.
// Top row: progress line and position. Bottom row: voice, back / play / forward, speed, colours.
import { useRef, useSyncExternalStore } from "react"
import { ChevronUp, Loader2, Palette, Pause, Play, SkipBack, SkipForward } from "lucide-react"
import { DEFAULT_COLORS, synth, type EngineStatus, type Settings, type Voice } from "@/lib/api"
import type { Player } from "@/reading/player"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const SPEEDS = [0.75, 1, 1.1, 1.25, 1.5, 1.75, 2]
const PRESETS = [
  { name: "Amber", sentenceColor: "#fde68a", wordColor: "#fbbf24" },
  { name: "Sky", sentenceColor: "#7dd3fc", wordColor: "#0ea5e9" },
  { name: "Green", sentenceColor: "#86efac", wordColor: "#22c55e" },
  { name: "Rose", sentenceColor: "#fda4af", wordColor: "#f43f5e" },
  { name: "Grey", sentenceColor: "#d4d4d4", wordColor: "#a3a3a3" },
]

type Props = {
  player: Player
  voices: Voice[]
  settings: Settings
  engine: EngineStatus
  hasDoc: boolean
  onSettings: (changes: Settings) => void
}

export function PlayerBar({ player, voices, settings, engine, hasDoc, onSettings }: Props) {
  const { state, index } = useSyncExternalStore(player.subscribe, player.getSnapshot)
  const sample = useRef<HTMLAudioElement | null>(null)
  const total = hasDoc ? player.sentences.length : 0
  const progress = total ? ((index + 1) / total) * 100 : 0
  const voice = voices.find(v => v.id === settings.voice)
  const speed = settings.speed ?? 1

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!total) return
    const r = e.currentTarget.getBoundingClientRect()
    player.jump(Math.min(total - 1, Math.floor(((e.clientX - r.left) / r.width) * total)))
  }

  // A new voice becomes the default. While paused, it says a short line.
  const chooseVoice = async (id: string) => {
    onSettings({ voice: id })
    player.setVoice(id)
    const v = voices.find(x => x.id === id)
    if (player.state !== "paused" || !v || engine !== "ready") return
    try {
      const r = await synth(`Hi, I'm ${v.name}. This is how I sound.`, id)
      sample.current?.pause()
      sample.current = new Audio(`data:audio/wav;base64,${r.audio}`)
      sample.current.playbackRate = speed
      await sample.current.play()
    } catch { /* the sample is optional */ }
  }

  const chooseSpeed = (value: string) => {
    onSettings({ speed: Number(value) })
    player.setSpeed(Number(value))
  }

  const groups = [
    ["Male", voices.filter(v => v.gender === "male")],
    ["Female", voices.filter(v => v.gender === "female")],
  ] as const

  return (
    <div className="absolute bottom-3 left-1/2 z-30 -translate-x-1/2 rounded-xl bg-popover px-2 pt-2 pb-1.5 shadow-[0_6px_24px_rgb(0_0_0/0.10),0_1px_3px_rgb(0_0_0/0.08)] dark:bg-[#161b22] dark:shadow-[0_6px_24px_rgb(0_0_0/0.5),0_0_0_1px_#262c36]">
      {/* Progress: a thin line, taller on hover, click to jump. The engine's state shows here while it is not ready. */}
      <div className="flex items-center gap-2.5 px-1.5 pb-1">
        <div className="group flex h-3 flex-1 cursor-pointer items-center" onClick={seek}>
          <div className="h-1 w-full overflow-hidden rounded-full bg-border transition-[height] group-hover:h-1.5">
            <div className="h-full bg-foreground/65" style={{ width: `${progress}%` }} />
          </div>
        </div>
        {engine !== "ready" ? (
          <span className={cn("flex items-center gap-1.5 text-xs whitespace-nowrap", engine === "down" ? "text-destructive" : "text-muted-foreground")}>
            {engine === "starting" && <Loader2 className="size-3.5 animate-spin" />}
            {engine === "starting" ? "Voice starting…" : "Voice engine stopped"}
          </span>
        ) : (
          total > 0 && <span className="text-xs text-muted-foreground tabular-nums">{index + 1} / {total}</span>
        )}
      </div>

      <div className="flex items-center gap-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2 pl-1.5" disabled={!voices.length}>
                <span className="flex size-5 items-center justify-center rounded-full bg-foreground text-[0.65rem] font-semibold text-background">
                  {voice?.name[0] ?? "?"}
                </span>
                {voice?.name ?? "Voice"}
                <ChevronUp className="text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="max-h-[min(28rem,70vh)] w-56 overflow-y-auto">
              <DropdownMenuRadioGroup value={settings.voice} onValueChange={chooseVoice}>
                {groups.map(([label, list], i) => (
                  <DropdownMenuGroup key={label}>
                    {i > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuLabel>{label}</DropdownMenuLabel>
                    {list.map(v => (
                      <DropdownMenuRadioItem key={v.id} value={v.id}>
                        {v.name}
                        <span className="ml-auto pr-5 text-xs text-muted-foreground">{v.accent}</span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuGroup>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="mx-1 h-5.5 w-px bg-border" />
          <Button variant="ghost" className="size-9.5 [&_svg]:size-[19px]" aria-label="Previous sentence" disabled={!total} onClick={() => player.prev()}>
            <SkipBack className="fill-current" />
          </Button>
          <Button
            className="size-11 rounded-full [&_svg]:size-[19px]"
            aria-label={state === "paused" ? "Play" : "Pause"}
            disabled={!total || engine !== "ready"}
            onClick={() => player.toggle()}
          >
            {state === "loading" ? <Loader2 className="animate-spin" /> : state === "playing" ? <Pause className="fill-current" /> : <Play className="ml-0.5 fill-current" />}
          </Button>
          <Button variant="ghost" className="size-9.5 [&_svg]:size-[19px]" aria-label="Next sentence" disabled={!total} onClick={() => player.next()}>
            <SkipForward className="fill-current" />
          </Button>
          <span className="mx-1 h-5.5 w-px bg-border" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-1 px-2 tabular-nums" aria-label="Speed">
                {speed}× <ChevronUp className="text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="w-28">
              <DropdownMenuRadioGroup value={String(speed)} onValueChange={chooseSpeed}>
                {SPEEDS.map(s => <DropdownMenuRadioItem key={s} value={String(s)} className="tabular-nums">{s}×</DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Highlight colours"><Palette /></Button>
            </PopoverTrigger>
            <PopoverContent side="top" align="end" className="w-64 space-y-3">
              <p className="text-sm font-medium">Highlight colours</p>
              <p className="text-sm leading-relaxed">
                <span className="reader-hl-sentence rounded px-0.5 py-0.5 box-decoration-clone">
                  The sentence being read, and the <span className="reader-hl-word rounded px-0.5">word</span> being spoken.
                </span>
              </p>
              {(["sentenceColor", "wordColor"] as const).map(key => (
                <label key={key} className="flex items-center justify-between text-sm">
                  {key === "sentenceColor" ? "Sentence" : "Word"}
                  <input
                    type="color"
                    value={settings[key] ?? DEFAULT_COLORS[key]}
                    onChange={e => onSettings({ [key]: e.target.value })}
                    className="h-7 w-12 cursor-pointer rounded border bg-transparent"
                  />
                </label>
              ))}
              <div className="flex items-center gap-1.5">
                {PRESETS.map(p => (
                  <button
                    key={p.name}
                    title={p.name}
                    aria-label={`${p.name} highlight`}
                    className="size-6 rounded-full border"
                    style={{ background: `linear-gradient(135deg, ${p.sentenceColor} 50%, ${p.wordColor} 50%)` }}
                    onClick={() => onSettings({ sentenceColor: p.sentenceColor, wordColor: p.wordColor })}
                  />
                ))}
                <Button variant="ghost" size="xs" className="ml-auto" onClick={() => onSettings(DEFAULT_COLORS)}>Reset</Button>
              </div>
            </PopoverContent>
          </Popover>
      </div>
    </div>
  )
}
