import z from "zod"
import { Tool } from "./tool"
import { ConversationMemory } from "../session/memory"
import DESCRIPTION from "./memory_save.txt"

export const MemorySaveTool = Tool.define("memory_save", {
  description: DESCRIPTION,
  parameters: z.object({
    topic: z.string().describe("A short label for the memory (e.g. 'Validation library', 'API auth strategy')"),
    content: z
      .string()
      .describe("The detailed content of the memory (e.g. 'We use Zod for all runtime validation')"),
    type: z
      .enum(["decision", "preference", "discovery"])
      .describe("The type of memory: decision, preference, or discovery"),
  }),
  async execute(params, ctx) {
    const memory = await ConversationMemory.save({
      topic: params.topic,
      content: params.content,
      type: params.type,
      sessionID: ctx.sessionID,
    })

    return {
      title: `Saved memory: ${params.topic}`,
      metadata: { memoryID: memory.id },
      output: `Memory saved successfully.\n\nID: ${memory.id}\nType: ${memory.type}\nTopic: ${memory.topic}\nContent: ${memory.content}`,
    }
  },
})
