import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { buildIndex, tokenize } from "../../src/tool/semantic"

describe("semantic.tokenize", () => {
  test("splits camelCase into separate tokens", () => {
    const tokens = tokenize("getUserName")
    expect(tokens).toContain("get")
    expect(tokens).toContain("user")
    expect(tokens).toContain("name")
  })

  test("splits snake_case into separate tokens", () => {
    const tokens = tokenize("get_user_name")
    expect(tokens).toContain("get")
    expect(tokens).toContain("user")
    expect(tokens).toContain("name")
  })

  test("lowercases all tokens", () => {
    const tokens = tokenize("GetUserName DatabaseConnection")
    for (const t of tokens) {
      expect(t).toBe(t.toLowerCase())
    }
  })

  test("filters out single-character tokens", () => {
    const tokens = tokenize("a b c foo bar")
    expect(tokens).not.toContain("a")
    expect(tokens).not.toContain("b")
    expect(tokens).not.toContain("c")
    expect(tokens).toContain("foo")
    expect(tokens).toContain("bar")
  })

  test("filters out pure numeric tokens", () => {
    const tokens = tokenize("version 123 port 8080")
    expect(tokens).not.toContain("123")
    expect(tokens).not.toContain("8080")
    expect(tokens).toContain("version")
    expect(tokens).toContain("port")
  })

  test("handles empty string", () => {
    const tokens = tokenize("")
    expect(tokens).toEqual([])
  })

  test("splits on punctuation and special characters", () => {
    const tokens = tokenize("import { foo } from './bar'")
    expect(tokens).toContain("import")
    expect(tokens).toContain("foo")
    expect(tokens).toContain("from")
    expect(tokens).toContain("bar")
  })
})

describe("semantic.buildIndex", () => {
  test("indexes files and produces non-empty results", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "auth.ts"),
          `export function authenticateUser(token: string) {\n  // validate JWT token for authentication\n  return verifyToken(token)\n}\n`,
        )
        await Bun.write(
          path.join(dir, "database.ts"),
          `export class DatabaseConnection {\n  constructor(private connectionString: string) {}\n  async query(sql: string) { return [] }\n}\n`,
        )
        await Bun.write(
          path.join(dir, "utils.ts"),
          `export function formatDate(date: Date): string {\n  return date.toISOString()\n}\n`,
        )
      },
    })

    const index = await buildIndex(tmp.path)
    expect(index.docs.length).toBe(3)
    expect(index.idf.size).toBeGreaterThan(0)
  })

  test("search for 'authentication' ranks auth file higher", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "auth.ts"),
          `export function authenticateUser(token: string) {\n  // validate JWT token for authentication\n  return verifyToken(token)\n}\nexport function login() { return authenticate() }\n`,
        )
        await Bun.write(
          path.join(dir, "database.ts"),
          `export class DatabaseConnection {\n  constructor(private url: string) {}\n  async query(sql: string) { return [] }\n}\n`,
        )
        await Bun.write(
          path.join(dir, "utils.ts"),
          `export function formatDate(date: Date): string {\n  return date.toISOString()\n}\n`,
        )
      },
    })

    const index = await buildIndex(tmp.path)
    const queryTokens = tokenize("authentication user login")

    // Compute scores manually for verification
    const scores = index.docs.map((doc) => {
      const qCounts = new Map<string, number>()
      for (const t of queryTokens) {
        qCounts.set(t, (qCounts.get(t) ?? 0) + 1)
      }
      let dot = 0
      let qMag = 0
      let dMag = 0

      const qEntries = Array.from(qCounts.entries())
      for (let i = 0; i < qEntries.length; i++) {
        const term = qEntries[i]![0]
        const count = qEntries[i]![1]
        const tf = count / queryTokens.length
        const termIdf = index.idf.get(term) ?? 0
        const qWeight = tf * termIdf
        const dWeight = (doc.tf.get(term) ?? 0) * termIdf
        dot += qWeight * dWeight
        qMag += qWeight * qWeight
      }

      const docEntries = Array.from(doc.tf.entries())
      for (let i = 0; i < docEntries.length; i++) {
        const termIdf = index.idf.get(docEntries[i]![0]) ?? 0
        dMag += (docEntries[i]![1] * termIdf) ** 2
      }

      const score = qMag === 0 || dMag === 0 ? 0 : dot / (Math.sqrt(qMag) * Math.sqrt(dMag))
      return { filePath: doc.filePath, score }
    })

    scores.sort((a, b) => b.score - a.score)
    // auth.ts should be the top result
    expect(path.basename(scores[0]!.filePath)).toBe("auth.ts")
    expect(scores[0]!.score).toBeGreaterThan(0)
  })

  test("search for 'database connection' ranks db file higher", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "auth.ts"),
          `export function authenticate(token: string) { return true }\n`,
        )
        await Bun.write(
          path.join(dir, "database.ts"),
          `export class DatabaseConnection {\n  private pool: any\n  constructor(connectionString: string) {\n    this.pool = createPool(connectionString)\n  }\n  async connect() { await this.pool.connect() }\n  async query(sql: string) { return await this.pool.query(sql) }\n}\n`,
        )
      },
    })

    const index = await buildIndex(tmp.path)
    const queryTokens = tokenize("database connection pool")

    const scores = index.docs.map((doc) => {
      const qCounts = new Map<string, number>()
      for (const t of queryTokens) {
        qCounts.set(t, (qCounts.get(t) ?? 0) + 1)
      }
      let dot = 0
      let qMag = 0
      let dMag = 0

      const qEntries = Array.from(qCounts.entries())
      for (let i = 0; i < qEntries.length; i++) {
        const term = qEntries[i]![0]
        const count = qEntries[i]![1]
        const tf = count / queryTokens.length
        const termIdf = index.idf.get(term) ?? 0
        const qWeight = tf * termIdf
        const dWeight = (doc.tf.get(term) ?? 0) * termIdf
        dot += qWeight * dWeight
        qMag += qWeight * qWeight
      }

      const docEntries = Array.from(doc.tf.entries())
      for (let i = 0; i < docEntries.length; i++) {
        const termIdf = index.idf.get(docEntries[i]![0]) ?? 0
        dMag += (docEntries[i]![1] * termIdf) ** 2
      }

      const score = qMag === 0 || dMag === 0 ? 0 : dot / (Math.sqrt(qMag) * Math.sqrt(dMag))
      return { filePath: doc.filePath, score }
    })

    scores.sort((a, b) => b.score - a.score)
    expect(path.basename(scores[0]!.filePath)).toBe("database.ts")
  })

  test("skips node_modules and .git directories", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "src", "main.ts"), `export const main = true\n`)
        await Bun.write(path.join(dir, "node_modules", "pkg", "index.ts"), `export const pkg = true\n`)
        await Bun.write(path.join(dir, ".git", "config.ts"), `export const gitConfig = true\n`)
      },
    })

    const index = await buildIndex(tmp.path)
    const paths = index.docs.map((d) => d.filePath)
    expect(paths.some((p) => p.includes("node_modules"))).toBe(false)
    expect(paths.some((p) => p.includes(".git"))).toBe(false)
    expect(paths.some((p) => p.includes("main.ts"))).toBe(true)
  })

  test("returns empty docs for empty directory", async () => {
    await using tmp = await tmpdir()
    const index = await buildIndex(tmp.path)
    expect(index.docs.length).toBe(0)
  })
})
