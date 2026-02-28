import z from "zod"
import path from "path"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Glob } from "../util/glob"
import { Filesystem } from "../util/filesystem"
import DESCRIPTION from "./depgraph.txt"

const EXTENSIONS = ["ts", "tsx", "js", "jsx"]
const SKIP_DIRS = ["node_modules", ".git", "dist", "build"]

// Regex patterns for import/require extraction
const IMPORT_FROM_RE = /(?:import|export)\s+(?:[\s\S]*?)\s+from\s+["']([^"']+)["']/g
const IMPORT_SIDE_EFFECT_RE = /import\s+["']([^"']+)["']/g
const DYNAMIC_IMPORT_RE = /import\s*\(\s*["']([^"']+)["']\s*\)/g
const REQUIRE_RE = /require\s*\(\s*["']([^"']+)["']\s*\)/g

interface DepGraph {
  /** file -> set of files it imports */
  dependencies: Map<string, Set<string>>
  /** file -> set of files that import it */
  dependents: Map<string, Set<string>>
}

function shouldSkip(filePath: string): boolean {
  return SKIP_DIRS.some((dir) => filePath.includes(`/${dir}/`) || filePath.includes(`\\${dir}\\`))
}

function extractImports(content: string): string[] {
  const specifiers: string[] = []
  for (const re of [IMPORT_FROM_RE, IMPORT_SIDE_EFFECT_RE, DYNAMIC_IMPORT_RE, REQUIRE_RE]) {
    re.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = re.exec(content)) !== null) {
      const specifier = match[1]
      if (specifier) specifiers.push(specifier)
    }
  }
  return specifiers
}

function resolveSpecifier(specifier: string, fromFile: string, allFiles: Set<string>): string | undefined {
  // Only resolve relative imports
  if (!specifier.startsWith(".")) return undefined

  const dir = path.dirname(fromFile)
  const base = path.resolve(dir, specifier)

  // Try exact match, then with extensions, then as directory index
  for (const ext of ["", ...EXTENSIONS.map((e) => `.${e}`)]) {
    const candidate = base + ext
    if (allFiles.has(candidate)) return candidate
  }
  // Try index files in directory
  for (const ext of EXTENSIONS) {
    const candidate = path.join(base, `index.${ext}`)
    if (allFiles.has(candidate)) return candidate
  }
  return undefined
}

export async function buildGraph(rootDir: string): Promise<DepGraph> {
  const pattern = `**/*.{${EXTENSIONS.join(",")}}`
  const files = await Glob.scan(pattern, {
    cwd: rootDir,
    absolute: true,
  })

  const filteredFiles = files.filter((f) => !shouldSkip(f))
  const allFiles = new Set<string>(filteredFiles)
  const dependencies = new Map<string, Set<string>>()
  const dependents = new Map<string, Set<string>>()

  // Initialize all files
  for (const file of filteredFiles) {
    dependencies.set(file, new Set())
    dependents.set(file, new Set())
  }

  for (const file of filteredFiles) {
    let content: string
    try {
      content = await Filesystem.readText(file)
    } catch {
      continue
    }

    const specifiers = extractImports(content)
    for (const specifier of specifiers) {
      const resolved = resolveSpecifier(specifier, file, allFiles)
      if (!resolved || resolved === file) continue

      dependencies.get(file)!.add(resolved)
      if (!dependents.has(resolved)) dependents.set(resolved, new Set())
      dependents.get(resolved)!.add(file)
    }
  }

  return { dependencies, dependents }
}

const graphCache = Instance.state(async () => {
  const graph = await buildGraph(Instance.directory)
  return { graph }
})

function formatFileList(files: Set<string> | string[], rootDir: string, label: string): string {
  const arr = Array.isArray(files) ? files : Array.from(files)
  if (arr.length === 0) return `No ${label} found.`
  return [`${label} (${arr.length}):`, ...arr.map((f) => `  - ${path.relative(rootDir, f)}`)].join("\n")
}

export const DepGraphTool = Tool.define("depgraph", {
  description: DESCRIPTION,
  parameters: z.object({
    file: z.string().describe("The file path to analyze (absolute or relative to project root)"),
    operation: z
      .enum(["dependencies", "dependents", "graph"])
      .describe(
        "Operation to perform: 'dependencies' (what this file imports), 'dependents' (what imports this file), 'graph' (both directions)",
      ),
  }),
  async execute(params, ctx) {
    const rootDir = Instance.directory
    let filePath = params.file
    if (!path.isAbsolute(filePath)) {
      filePath = path.resolve(rootDir, filePath)
    }

    // Normalize the path
    filePath = path.resolve(filePath)

    const { graph } = await graphCache()
    const deps = graph.dependencies.get(filePath)
    const revDeps = graph.dependents.get(filePath)

    if (!deps && !revDeps) {
      return {
        title: `depgraph: ${path.relative(rootDir, filePath)}`,
        metadata: {},
        output: `File not found in dependency graph: ${path.relative(rootDir, filePath)}\nMake sure the file exists and is a .ts, .tsx, .js, or .jsx file.`,
      }
    }

    const relFile = path.relative(rootDir, filePath)
    let output: string

    switch (params.operation) {
      case "dependencies":
        output = formatFileList(deps ?? new Set(), rootDir, `Dependencies of ${relFile}`)
        break
      case "dependents":
        output = formatFileList(revDeps ?? new Set(), rootDir, `Dependents of ${relFile}`)
        break
      case "graph": {
        const depsOutput = formatFileList(deps ?? new Set(), rootDir, `Dependencies (imports)`)
        const revOutput = formatFileList(revDeps ?? new Set(), rootDir, `Dependents (imported by)`)
        output = `Dependency graph for ${relFile}:\n\n${depsOutput}\n\n${revOutput}`
        break
      }
    }

    return {
      title: `depgraph: ${relFile}`,
      metadata: {},
      output,
    }
  },
})
