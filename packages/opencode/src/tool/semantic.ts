import z from "zod"
import path from "path"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Glob } from "../util/glob"
import { Filesystem } from "../util/filesystem"
import DESCRIPTION from "./semantic.txt"

const INDEXED_EXTENSIONS = ["ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "md"]
const SKIP_DIRS = ["node_modules", ".git", "dist", "build", ".next", ".turbo", "coverage"]
const MAX_FILE_SIZE = 100 * 1024 // 100KB
const SNIPPET_CONTEXT_LINES = 3

function shouldSkip(filePath: string): boolean {
  const sep1 = "/"
  const sep2 = "\\"
  return SKIP_DIRS.some(
    (dir) => filePath.includes(sep1 + dir + sep1) || filePath.includes(sep2 + dir + sep2),
  )
}

export function tokenize(text: string): string[] {
  const expanded = text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
  const parts = expanded.toLowerCase().split(/[^a-z0-9]+/)
  return parts.filter((t) => t.length > 1 && !/^\d+$/.test(t))
}

interface DocEntry {
  filePath: string
  tokens: string[]
  content: string
  tf: Map<string, number>
}

interface TFIDFIndex {
  docs: DocEntry[]
  idf: Map<string, number>
}

export async function buildIndex(rootDir: string): Promise<TFIDFIndex> {
  const pattern = "**/*.{" + INDEXED_EXTENSIONS.join(",") + "}"
  const files = await Glob.scan(pattern, { cwd: rootDir, absolute: true })

  const docs: DocEntry[] = []
  const df = new Map<string, number>()

  for (const file of files) {
    if (shouldSkip(file)) continue

    let content: string
    try {
      const stat = Filesystem.stat(file)
      if (!stat || stat.size > MAX_FILE_SIZE) continue
      content = await Filesystem.readText(file)
    } catch {
      continue
    }

    const tokens = tokenize(content)
    if (tokens.length === 0) continue

    const counts = new Map<string, number>()
    for (const t of tokens) {
      counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    const tf = new Map<string, number>()
    const seen = new Map<string, boolean>()
    const entries = Array.from(counts.entries())
    for (let i = 0; i < entries.length; i++) {
      const term = entries[i]![0]
      const count = entries[i]![1]
      tf.set(term, count / tokens.length)
      if (!seen.has(term)) {
        seen.set(term, true)
        df.set(term, (df.get(term) ?? 0) + 1)
      }
    }

    docs.push({ filePath: file, tokens, content, tf })
  }

  const N = docs.length
  const idf = new Map<string, number>()
  const dfEntries = Array.from(df.entries())
  for (let i = 0; i < dfEntries.length; i++) {
    const term = dfEntries[i]![0]
    const freq = dfEntries[i]![1]
    idf.set(term, Math.log((N + 1) / (freq + 1)) + 1)
  }

  return { docs, idf }
}

function cosineSimilarity(queryTokens: string[], doc: DocEntry, idf: Map<string, number>): number {
  const qCounts = new Map<string, number>()
  for (const t of queryTokens) {
    qCounts.set(t, (qCounts.get(t) ?? 0) + 1)
  }

  let dotProduct = 0
  let qMag = 0
  let dMag = 0

  const qEntries = Array.from(qCounts.entries())
  for (let i = 0; i < qEntries.length; i++) {
    const term = qEntries[i]![0]
    const count = qEntries[i]![1]
    const tf = count / queryTokens.length
    const termIdf = idf.get(term) ?? 0
    const qWeight = tf * termIdf
    const dWeight = (doc.tf.get(term) ?? 0) * termIdf
    dotProduct += qWeight * dWeight
    qMag += qWeight * qWeight
  }

  const docEntries = Array.from(doc.tf.entries())
  for (let i = 0; i < docEntries.length; i++) {
    const termIdf = idf.get(docEntries[i]![0]) ?? 0
    dMag += (docEntries[i]![1] * termIdf) ** 2
  }

  if (qMag === 0 || dMag === 0) return 0
  return dotProduct / (Math.sqrt(qMag) * Math.sqrt(dMag))
}

function extractSnippet(content: string, queryTokens: string[], maxLines: number = SNIPPET_CONTEXT_LINES): string {
  const lines = content.split("\n")
  const querySet = new Set(queryTokens)

  let bestLine = 0
  let bestScore = 0

  for (let i = 0; i < lines.length; i++) {
    const lineTokens = tokenize(lines[i]!)
    let score = 0
    for (const t of lineTokens) {
      if (querySet.has(t)) score++
    }
    if (score > bestScore) {
      bestScore = score
      bestLine = i
    }
  }

  const start = Math.max(0, bestLine - maxLines)
  const end = Math.min(lines.length, bestLine + maxLines + 1)
  return lines.slice(start, end).join("\n")
}

const indexCache = Instance.state(async () => {
  const index = await buildIndex(Instance.directory)
  return { index }
})

export const SemanticSearchTool = Tool.define("semantic_search", {
  description: DESCRIPTION,
  parameters: z.object({
    query: z.string().describe("Natural language search query to find relevant code files"),
    limit: z.number().optional().describe("Maximum number of results to return (default: 10)"),
  }),
  async execute(params, ctx) {
    if (!params.query || params.query.trim().length === 0) {
      return {
        title: "semantic_search",
        metadata: { matches: 0 },
        output: "Error: query must not be empty.",
      }
    }

    const rootDir = Instance.directory
    const limit = params.limit ?? 10
    const { index } = await indexCache()
    const queryTokens = tokenize(params.query)

    if (queryTokens.length === 0) {
      return {
        title: "semantic_search",
        metadata: { matches: 0 },
        output: "Error: query produced no searchable tokens after tokenization.",
      }
    }

    const scored: Array<{ doc: DocEntry; score: number }> = []
    for (const doc of index.docs) {
      const score = cosineSimilarity(queryTokens, doc, index.idf)
      if (score > 0) {
        scored.push({ doc, score })
      }
    }

    scored.sort((a, b) => b.score - a.score)
    const topResults = scored.slice(0, limit)

    if (topResults.length === 0) {
      return {
        title: "semantic_search: " + params.query,
        metadata: { matches: 0 },
        output: "No relevant files found for query: \"" + params.query + "\"",
      }
    }

    const backticks = String.fromCharCode(96, 96, 96)
    const output = topResults
      .map((r, i) => {
        const relPath = path.relative(rootDir, r.doc.filePath)
        const snippet = extractSnippet(r.doc.content, queryTokens)
        const snippetPreview = snippet.length > 300 ? snippet.slice(0, 300) + "..." : snippet
        return [
          (i + 1) + ". " + relPath + " (score: " + r.score.toFixed(4) + ")",
          backticks,
          snippetPreview,
          backticks,
        ].join("\n")
      })
      .join("\n\n")

    return {
      title: "semantic_search: " + params.query,
      metadata: { matches: topResults.length },
      output: "Found " + topResults.length + " relevant file(s) for \"" + params.query + "\":\n\n" + output,
    }
  },
})
