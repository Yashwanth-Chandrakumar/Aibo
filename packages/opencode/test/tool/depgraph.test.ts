import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { buildGraph } from "../../src/tool/depgraph"

async function createTempProject() {
  const tmp = await tmpdir({
    init: async (dir) => {
      // a.ts imports b.ts and c.ts
      await Bun.write(
        path.join(dir, "src", "a.ts"),
        `import { foo } from "./b"\nimport { bar } from "./c"\nexport const a = foo + bar\n`,
      )
      // b.ts imports c.ts
      await Bun.write(path.join(dir, "src", "b.ts"), `import { bar } from "./c"\nexport const foo = bar + 1\n`)
      // c.ts has no imports
      await Bun.write(path.join(dir, "src", "c.ts"), `export const bar = 42\n`)
      // d.ts is standalone (no imports, nobody imports it)
      await Bun.write(path.join(dir, "src", "d.ts"), `export const standalone = true\n`)
      // circular: e.ts imports f.ts, f.ts imports e.ts
      await Bun.write(path.join(dir, "src", "e.ts"), `import { y } from "./f"\nexport const x = y\n`)
      await Bun.write(path.join(dir, "src", "f.ts"), `import { x } from "./e"\nexport const y = x\n`)
    },
  })
  return tmp
}

describe("depgraph.buildGraph", () => {
  test("correctly identifies direct dependencies", async () => {
    await using tmp = await createTempProject()
    const graph = await buildGraph(tmp.path)

    const aPath = path.join(tmp.path, "src", "a.ts")
    const bPath = path.join(tmp.path, "src", "b.ts")
    const cPath = path.join(tmp.path, "src", "c.ts")

    const aDeps = graph.dependencies.get(aPath)
    expect(aDeps).toBeDefined()
    expect(aDeps!.has(bPath)).toBe(true)
    expect(aDeps!.has(cPath)).toBe(true)
    expect(aDeps!.size).toBe(2)
  })

  test("correctly identifies dependents (reverse references)", async () => {
    await using tmp = await createTempProject()
    const graph = await buildGraph(tmp.path)

    const aPath = path.join(tmp.path, "src", "a.ts")
    const bPath = path.join(tmp.path, "src", "b.ts")
    const cPath = path.join(tmp.path, "src", "c.ts")

    // c.ts is imported by a.ts and b.ts
    const cDependents = graph.dependents.get(cPath)
    expect(cDependents).toBeDefined()
    expect(cDependents!.has(aPath)).toBe(true)
    expect(cDependents!.has(bPath)).toBe(true)
    expect(cDependents!.size).toBe(2)
  })

  test("standalone file has no dependencies and no dependents", async () => {
    await using tmp = await createTempProject()
    const graph = await buildGraph(tmp.path)

    const dPath = path.join(tmp.path, "src", "d.ts")
    const dDeps = graph.dependencies.get(dPath)
    const dRev = graph.dependents.get(dPath)

    expect(dDeps).toBeDefined()
    expect(dDeps!.size).toBe(0)
    expect(dRev).toBeDefined()
    expect(dRev!.size).toBe(0)
  })

  test("handles circular dependencies without infinite loops", async () => {
    await using tmp = await createTempProject()
    const graph = await buildGraph(tmp.path)

    const ePath = path.join(tmp.path, "src", "e.ts")
    const fPath = path.join(tmp.path, "src", "f.ts")

    // e imports f
    expect(graph.dependencies.get(ePath)!.has(fPath)).toBe(true)
    // f imports e
    expect(graph.dependencies.get(fPath)!.has(ePath)).toBe(true)
    // both are dependents of each other
    expect(graph.dependents.get(ePath)!.has(fPath)).toBe(true)
    expect(graph.dependents.get(fPath)!.has(ePath)).toBe(true)
  })

  test("non-existent file returns undefined from graph", async () => {
    await using tmp = await createTempProject()
    const graph = await buildGraph(tmp.path)

    const missingPath = path.join(tmp.path, "src", "missing.ts")
    expect(graph.dependencies.get(missingPath)).toBeUndefined()
    expect(graph.dependents.get(missingPath)).toBeUndefined()
  })

  test("skips node_modules files", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "node_modules", "some-pkg", "index.ts"),
          `export const pkg = true\n`,
        )
        await Bun.write(
          path.join(dir, "src", "main.ts"),
          `import { pkg } from "some-pkg"\nexport const main = pkg\n`,
        )
      },
    })

    const graph = await buildGraph(tmp.path)
    const nodeModulesFile = path.join(tmp.path, "node_modules", "some-pkg", "index.ts")
    expect(graph.dependencies.has(nodeModulesFile)).toBe(false)
  })

  test("resolves index files in directories", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "src", "utils", "index.ts"), `export const util = 1\n`)
        await Bun.write(
          path.join(dir, "src", "main.ts"),
          `import { util } from "./utils"\nexport const main = util\n`,
        )
      },
    })

    const graph = await buildGraph(tmp.path)
    const mainPath = path.join(tmp.path, "src", "main.ts")
    const indexPath = path.join(tmp.path, "src", "utils", "index.ts")

    const mainDeps = graph.dependencies.get(mainPath)
    expect(mainDeps).toBeDefined()
    expect(mainDeps!.has(indexPath)).toBe(true)
  })

  test("handles dynamic imports", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "src", "target.ts"), `export const val = 1\n`)
        await Bun.write(
          path.join(dir, "src", "loader.ts"),
          `const mod = await import("./target")\nexport const loaded = mod.val\n`,
        )
      },
    })

    const graph = await buildGraph(tmp.path)
    const loaderPath = path.join(tmp.path, "src", "loader.ts")
    const targetPath = path.join(tmp.path, "src", "target.ts")

    expect(graph.dependencies.get(loaderPath)!.has(targetPath)).toBe(true)
  })

  test("handles require() calls", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "src", "mod.js"), `module.exports = { x: 1 }\n`)
        await Bun.write(
          path.join(dir, "src", "consumer.js"),
          `const mod = require("./mod")\nmodule.exports = mod.x\n`,
        )
      },
    })

    const graph = await buildGraph(tmp.path)
    const consumerPath = path.join(tmp.path, "src", "consumer.js")
    const modPath = path.join(tmp.path, "src", "mod.js")

    expect(graph.dependencies.get(consumerPath)!.has(modPath)).toBe(true)
  })
})
