import { describe, expect, test, beforeEach } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { ConversationMemory } from "../../src/session/memory"
import { Instance } from "../../src/project/instance"

// Helper to run code inside an Instance context with a temp directory
async function withInstance<T>(fn: () => Promise<T>): Promise<T> {
  const tmp = await tmpdir({ git: true })
  try {
    return await Instance.provide({
      directory: tmp.path,
      fn,
    })
  } finally {
    await tmp[Symbol.asyncDispose]()
  }
}

describe("ConversationMemory", () => {
  test("save creates a memory and returns it with all fields", async () => {
    await withInstance(async () => {
      const memory = await ConversationMemory.save({
        topic: "Validation library",
        content: "We use Zod for all runtime validation",
        type: "decision",
        sessionID: "test-session-1",
      })

      expect(memory.id).toMatch(/^mem_/)
      expect(memory.topic).toBe("Validation library")
      expect(memory.content).toBe("We use Zod for all runtime validation")
      expect(memory.type).toBe("decision")
      expect(memory.sessionID).toBe("test-session-1")
      expect(memory.createdAt).toBeGreaterThan(0)
    })
  })

  test("list returns all saved memories sorted by newest first", async () => {
    await withInstance(async () => {
      await ConversationMemory.save({
        topic: "First",
        content: "First memory",
        type: "decision",
        sessionID: "s1",
      })

      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10))

      await ConversationMemory.save({
        topic: "Second",
        content: "Second memory",
        type: "preference",
        sessionID: "s2",
      })

      const memories = await ConversationMemory.list()
      expect(memories.length).toBeGreaterThanOrEqual(2)

      // Should be sorted newest first
      const first = memories.find((m) => m.topic === "First")
      const second = memories.find((m) => m.topic === "Second")
      expect(first).toBeDefined()
      expect(second).toBeDefined()
      // Second should appear before First (newer)
      const idxFirst = memories.indexOf(first!)
      const idxSecond = memories.indexOf(second!)
      expect(idxSecond).toBeLessThan(idxFirst)
    })
  })

  test("search matches by keyword in topic", async () => {
    await withInstance(async () => {
      await ConversationMemory.save({
        topic: "Authentication strategy",
        content: "We use JWT tokens",
        type: "decision",
        sessionID: "s1",
      })

      await ConversationMemory.save({
        topic: "Code formatting",
        content: "We use Prettier with default config",
        type: "preference",
        sessionID: "s1",
      })

      const results = await ConversationMemory.search("authentication")
      expect(results.length).toBe(1)
      expect(results[0]!.topic).toBe("Authentication strategy")
    })
  })

  test("search matches by keyword in content", async () => {
    await withInstance(async () => {
      await ConversationMemory.save({
        topic: "Testing approach",
        content: "We prefer integration tests over unit tests for API routes",
        type: "preference",
        sessionID: "s1",
      })

      const results = await ConversationMemory.search("integration")
      expect(results.length).toBe(1)
      expect(results[0]!.topic).toBe("Testing approach")
    })
  })

  test("search with empty query returns all memories", async () => {
    await withInstance(async () => {
      await ConversationMemory.save({
        topic: "Mem A",
        content: "Content A",
        type: "discovery",
        sessionID: "s1",
      })

      const allResults = await ConversationMemory.search("")
      expect(allResults.length).toBeGreaterThanOrEqual(1)
    })
  })

  test("search returns empty array when no match", async () => {
    await withInstance(async () => {
      await ConversationMemory.save({
        topic: "Something",
        content: "Some content",
        type: "decision",
        sessionID: "s1",
      })

      const results = await ConversationMemory.search("zzzyyyxxx_nonexistent")
      expect(results.length).toBe(0)
    })
  })

  test("remove deletes a specific memory", async () => {
    await withInstance(async () => {
      const mem = await ConversationMemory.save({
        topic: "To be deleted",
        content: "This will be removed",
        type: "decision",
        sessionID: "s1",
      })

      await ConversationMemory.remove(mem.id)

      const memories = await ConversationMemory.list()
      const found = memories.find((m) => m.id === mem.id)
      expect(found).toBeUndefined()
    })
  })

  test("inject returns formatted string with all memories", async () => {
    await withInstance(async () => {
      await ConversationMemory.save({
        topic: "Validation",
        content: "Use Zod",
        type: "decision",
        sessionID: "s1",
      })

      await ConversationMemory.save({
        topic: "Style",
        content: "Prefer functional",
        type: "preference",
        sessionID: "s1",
      })

      const result = await ConversationMemory.inject()
      expect(result).toContain("[Decision]")
      expect(result).toContain("Validation")
      expect(result).toContain("Use Zod")
      expect(result).toContain("[Preference]")
      expect(result).toContain("Style")
      expect(result).toContain("Prefer functional")
    })
  })

  test("inject returns empty string when no memories", async () => {
    // Use a fresh temp dir that has no memories
    const tmp = await tmpdir({ git: true })
    try {
      const result = await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          return await ConversationMemory.inject()
        },
      })
      expect(result).toBe("")
    } finally {
      await tmp[Symbol.asyncDispose]()
    }
  })

  test("memory types are correctly stored", async () => {
    await withInstance(async () => {
      const decision = await ConversationMemory.save({
        topic: "D",
        content: "decision",
        type: "decision",
        sessionID: "s1",
      })
      const preference = await ConversationMemory.save({
        topic: "P",
        content: "preference",
        type: "preference",
        sessionID: "s1",
      })
      const discovery = await ConversationMemory.save({
        topic: "Disc",
        content: "discovery",
        type: "discovery",
        sessionID: "s1",
      })

      expect(decision.type).toBe("decision")
      expect(preference.type).toBe("preference")
      expect(discovery.type).toBe("discovery")
    })
  })
})
