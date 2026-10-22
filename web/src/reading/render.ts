// Markdown or plain text → React content plus the sentences to read.
import type { ReactNode } from "react"
import type { Root } from "hast"
import { Fragment, jsx, jsxs } from "react/jsx-runtime"
import { toJsxRuntime } from "hast-util-to-jsx-runtime"
import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import remarkRehype from "remark-rehype"
import { segmentTree, type Sentence } from "./segment"
import type { DocFormat } from "@/lib/api"

// remark-rehype drops raw HTML, so pasted pages cannot run scripts.
const markdown = unified().use(remarkParse).use(remarkGfm).use(remarkRehype)

export function renderDocument(text: string, format: DocFormat): { content: ReactNode; sentences: Sentence[] } {
  const tree = format === "txt" ? plainText(text) : (markdown.runSync(markdown.parse(frontMatterAsCode(text))) as Root)
  const sentences = segmentTree(tree)
  return { content: toJsxRuntime(tree, { Fragment, jsx, jsxs }), sentences }
}

// Front matter shows as a skipped yaml block.
const frontMatterAsCode = (text: string) => text.replace(/^---\n([\s\S]*?)\n---\n/, "```yaml\n$1\n```\n")

function plainText(text: string): Root {
  return {
    type: "root",
    children: text.split(/\n\s*\n/).map(p => ({
      type: "element",
      tagName: "p",
      properties: {},
      children: p.split("\n").flatMap((line, i) => [
        ...(i ? [{ type: "element" as const, tagName: "br", properties: {}, children: [] }] : []),
        { type: "text" as const, value: line },
      ]),
    })),
  }
}
