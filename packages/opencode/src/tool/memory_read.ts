import z from "zod"
import { Tool } from "./tool"
import { ConversationMemory } from "../session/memory"
import DESCRIPTION from "./memory_read.txt"

export const MemoryReadTool = Tool.define("memory_read", {
  description: DESCRIPTION,
  parameters: z.object({
    query: z.string().optional().describe("Optional keyword to filter memories. If omitted, all memories are returned."),
  }),
  async execute(params, ctx) {
    const memories = params.query
      ? await ConversationMemory.search(params.query)
      : await ConversationMemory.list()

    if (memories.length === 0) {
      const msg = params.query
        ? `No memories found matching "${params.query}".`
        : "No memories saved for this project yet."
      return {
        title: "memory_read",
        metadata: { count: 0 },
        output: msg,
      }
    }

    const formatted = memories.map((m) => {
      const typeLabel = m.type.charAt(0).toUpperCase() + m.type.slice(1)
      const date = new Date(m.createdAt).toISOString().split("T")[0]
      return `- [${typeLabel}] **${m.topic}**: ${m.content} (saved ${date}, id: ${m.id})`
    })

    return {
      title: params.query ? `memory_read: ${params.query}` : "memory_read: all",
      metadata: { count: memories.length },
      output: `Found ${memories.length} memor${memories.length === 1 ? "y" : "ies"}:\n\n${formatted.join("\n")}`,
    }
  },
})
