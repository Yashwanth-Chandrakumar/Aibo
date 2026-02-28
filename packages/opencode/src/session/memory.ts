import { Storage } from "../storage/storage"
import { Instance } from "../project/instance"

export namespace ConversationMemory {
  export interface Memory {
    id: string
    topic: string
    content: string
    type: "decision" | "preference" | "discovery"
    createdAt: number
    sessionID: string
  }

  function projectID(): string {
    return Instance.project.id ?? "global"
  }

  function memoryKey(id: string): string[] {
    return ["memory", projectID(), id]
  }

  function listPrefix(): string[] {
    return ["memory", projectID()]
  }

  export async function save(input: {
    topic: string
    content: string
    type: Memory["type"]
    sessionID: string
  }): Promise<Memory> {
    const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const memory: Memory = {
      id,
      topic: input.topic,
      content: input.content,
      type: input.type,
      createdAt: Date.now(),
      sessionID: input.sessionID,
    }
    await Storage.write(memoryKey(id), memory)
    return memory
  }

  export async function list(): Promise<Memory[]> {
    const keys = await Storage.list(listPrefix())
    const memories: Memory[] = []
    for (const key of keys) {
      try {
        const mem = await Storage.read<Memory>(key)
        if (mem) memories.push(mem)
      } catch {
        // skip corrupt/missing entries
      }
    }
    memories.sort((a, b) => b.createdAt - a.createdAt)
    return memories
  }

  export async function search(query: string): Promise<Memory[]> {
    const all = await list()
    if (!query || query.trim().length === 0) return all

    const terms = query.toLowerCase().split(/\s+/)
    return all.filter((m) => {
      const text = `${m.topic} ${m.content}`.toLowerCase()
      return terms.some((t) => text.includes(t))
    })
  }

  export async function remove(memoryID: string): Promise<void> {
    await Storage.remove(memoryKey(memoryID))
  }

  export async function inject(): Promise<string> {
    const memories = await list()
    if (memories.length === 0) return ""

    const lines = memories.map((m) => {
      const typeLabel = m.type.charAt(0).toUpperCase() + m.type.slice(1)
      return `  - [${typeLabel}] ${m.topic}: ${m.content}`
    })
    return lines.join("\n")
  }
}
