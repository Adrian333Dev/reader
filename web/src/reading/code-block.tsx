// A code block (rd-28), drawn like GitHub's: Shiki's colours, long lines wrapped with their extra rows indented, and a
// copy icon shown on hover. Never read aloud; segment.ts marks the <pre> "skip".
import { useEffect, useState, type ComponentProps, type CSSProperties } from "react"
import type { Element, ElementContent } from "hast"
import { Check, Copy } from "lucide-react"
import { bundledLanguages, bundledLanguagesAlias, codeToTokens, type ThemedToken } from "shiki"
import { Button } from "@/components/ui/button"

const THEMES = { light: "github-light", dark: "github-dark" } as const
const COPIED_MS = 1500

// The plain text of a hast node.
const textOf = (n: ElementContent): string => (n.type === "text" ? n.value : n.type === "element" ? n.children.map(textOf).join("") : "")

export function CodeBlock({ node, className }: ComponentProps<"pre"> & { node?: Element }) {
  const code = node?.children.find((c): c is Element => c.type === "element" && c.tagName === "code")
  const langClass = code && (Array.isArray(code.properties.className) ? code.properties.className : []).map(String).find(c => c.startsWith("language-"))
  const lang = langClass?.slice(9).toLowerCase() ?? "text"
  const text = (code ? textOf(code) : "").replace(/\n$/, "")
  const lines = text.split("\n")

  // Plain lines first; coloured once Shiki has loaded the language. An unknown language stays plain.
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null)
  useEffect(() => {
    if (!(lang in bundledLanguages || lang in bundledLanguagesAlias)) return
    let live = true
    codeToTokens(text, { lang: lang as keyof typeof bundledLanguages, themes: THEMES })
      .then(r => { if (live) setTokens(r.tokens) })
      .catch(e => console.error("[code-block]", lang, e))
    return () => { live = false }
  }, [text, lang])

  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), COPIED_MS)
    })
  }

  return (
    <pre className={`${className ?? ""} code-block`}>
      <Button variant="outline" size="icon-sm" className="code-copy" onClick={copy} aria-label="Copy code" title="Copy">
        {copied ? <Check /> : <Copy />}
      </Button>
      <code>
        {lines.map((line, i) => (
          <span key={i} className="code-line">
            {tokens?.[i]
              ? tokens[i].map((t, j) => <span key={j} style={t.htmlStyle as CSSProperties}>{t.content}</span>)
              : line}
            {"\n"}
          </span>
        ))}
      </code>
    </pre>
  )
}
