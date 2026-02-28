# 🚀 Aibo — Custom Features

> This file tracks every custom feature added to the **Aibo** fork (upstream: [anomalyco/opencode](https://github.com/anomalyco/opencode)).
> These are capabilities built on top of the base OpenCode agent that are unique to this repo.

---

## Table of Contents

| # | Feature | Status | Added | Tests |
|---|---------|--------|-------|-------|
| 1 | [Codebase Dependency Graph](#1-codebase-dependency-graph) | ✅ Complete | 2025-02 | 9/9 |
| 2 | [Semantic Code Search](#2-semantic-code-search) | ✅ Complete | 2025-02 | 12/12 |
| 3 | [Conversation Memory](#3-conversation-memory) | ✅ Complete | 2025-02 | 10/10 |
| 4 | [Test Generation Agent](#4-test-generation-agent) | ✅ Complete | 2025-02 | — |

**Total custom tests:** 31 passing · 84 assertions · 0 failures

---

## 1. Codebase Dependency Graph

**Tool ID:** `depgraph`
**Purpose:** Analyze import/export relationships between files so the agent understands how code is connected.

### What it does
- Builds a full dependency graph of TypeScript/JavaScript files in the project
- Supports three operations:
  - `dependencies` — lists all files a given file imports
  - `dependents` — lists all files that import a given file (reverse lookup)
  - `graph` — shows both directions at once
- Resolves relative imports, `import()`, `require()`, and index files
- Skips `node_modules`, `.git`, `dist`, `build`
- Graph is built lazily on first call and cached per project

### Files
| File | Type | Description |
|------|------|-------------|
| `packages/opencode/src/tool/depgraph.ts` | Source | Tool implementation + `buildGraph()` export |
| `packages/opencode/src/tool/depgraph.txt` | Config | Tool description text |
| `packages/opencode/test/tool/depgraph.test.ts` | Test | 9 tests covering all operations |

### Tests (9/9 ✅)
- Direct dependency detection
- Reverse dependent detection
- Standalone files (no imports/dependents)
- Circular dependency handling
- Non-existent file lookup
- `node_modules` skipping
- `index.ts` directory resolution
- Dynamic `import()` calls
- `require()` calls

---

## 2. Semantic Code Search

**Tool ID:** `semantic_search`
**Purpose:** Find relevant code files using natural language queries without knowing exact filenames or patterns.

### What it does
- Builds a TF-IDF index of all source files in the project
- Tokenizes code by splitting camelCase, snake_case, and punctuation boundaries
- Ranks results by cosine similarity between query and document vectors
- Returns top-N results with relevance scores and code snippet previews
- Supports: `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.go`, `.rs`, `.java`, `.md`
- Skips `node_modules`, `.git`, `dist`, `build`, `.next`, `.turbo`, `coverage`
- Index is built lazily on first query and cached per project
- Files > 100KB are skipped

### Files
| File | Type | Description |
|------|------|-------------|
| `packages/opencode/src/tool/semantic.ts` | Source | Tool implementation + `buildIndex()`, `tokenize()` exports |
| `packages/opencode/src/tool/semantic.txt` | Config | Tool description text |
| `packages/opencode/test/tool/semantic.test.ts` | Test | 12 tests covering tokenizer + index |

### Tests (12/12 ✅)
- **Tokenizer (7 tests):** camelCase splitting, snake_case splitting, lowercasing, single-char filtering, numeric filtering, empty string handling, punctuation splitting
- **Index (5 tests):** file indexing, auth query ranking, database query ranking, skip-directory enforcement, empty directory handling

---

## 3. Conversation Memory

**Tool IDs:** `memory_save`, `memory_read`
**Purpose:** Persist facts, decisions, and preferences across sessions so the agent remembers context.

### What it does
- **Save** (`memory_save`): Stores a memory with a topic, content, and type (`decision` / `preference` / `discovery`)
- **Read** (`memory_read`): Lists all memories or searches by keyword
- **Auto-inject**: Saved memories are automatically injected into the system prompt at the start of every session
- Memories are scoped per project
- Storage uses the existing `Storage.read/write/list/remove` JSON file store
- Memory injection is best-effort (errors are silently caught)

### Files
| File | Type | Description |
|------|------|-------------|
| `packages/opencode/src/session/memory.ts` | Source | `ConversationMemory` namespace (save, list, search, remove, inject) |
| `packages/opencode/src/tool/memory_save.ts` | Source | Save tool wrapping `ConversationMemory.save()` |
| `packages/opencode/src/tool/memory_save.txt` | Config | Save tool description |
| `packages/opencode/src/tool/memory_read.ts` | Source | Read tool wrapping `ConversationMemory.list/search()` |
| `packages/opencode/src/tool/memory_read.txt` | Config | Read tool description |
| `packages/opencode/src/session/system.ts` | Modified | Injects memories into `environment()` system prompt |
| `packages/opencode/test/session/memory.test.ts` | Test | 10 tests covering all operations |

### Tests (10/10 ✅)
- Save with all fields
- List sorted by newest first
- Search by topic keyword
- Search by content keyword
- Empty query returns all
- No-match search returns empty
- Remove specific memory
- Inject formatting
- Empty inject returns empty string
- Type correctness for all three types

---

## 4. Test Generation Agent

**Agent name:** `test`
**Purpose:** A specialized sub-agent that writes comprehensive tests for any source file.

### What it does
- Invokable as `@test` in conversations
- Reads source files, detects the testing framework in use, and generates test suites
- Covers happy path, edge cases, error handling, and integration points
- Mirrors source directory structure in test directories
- Runs generated tests automatically to verify they pass
- Has full read/write/edit/glob/grep/bash permissions

### Files
| File | Type | Description |
|------|------|-------------|
| `packages/opencode/src/agent/prompt/test.txt` | Config | System prompt for the test agent |
| `packages/opencode/src/agent/agent.ts` | Modified | Registers the `test` agent entry |

---

## Integration Points

These existing files were modified to wire up all four features:

| File | Changes |
|------|---------|
| `packages/opencode/src/tool/registry.ts` | Added imports + registration for `DepGraphTool`, `SemanticSearchTool`, `MemorySaveTool`, `MemoryReadTool` |
| `packages/opencode/src/agent/agent.ts` | Added `PROMPT_TEST` import + `test` agent definition |
| `packages/opencode/src/session/system.ts` | Added `ConversationMemory` import + memory injection in `environment()` |

---

## How to Verify

```bash
# Run all custom feature tests (from packages/opencode/)
bun test test/tool/depgraph.test.ts test/tool/semantic.test.ts test/session/memory.test.ts --timeout 30000

# Run existing registry tests to confirm nothing broke
bun test test/tool/registry.test.ts --timeout 30000
```

### Manual verification
| Feature | How to test |
|---------|-------------|
| Dependency Graph | Ask: *"What files depend on src/tool/tool.ts?"* — verify `depgraph` tool is invoked |
| Semantic Search | Ask: *"Find code related to session management"* — verify relevant files returned |
| Memory Save | Tell Aibo: *"Remember that we use Zod for validation"* — verify `memory_save` fires |
| Memory Read | Start a **new session** → ask: *"What do we use for validation?"* — verify it recalls |
| Test Agent | Type `@test` → ask it to write tests for any file |

---

## Adding a New Feature

When you add a new custom feature to this fork, update this file:

1. Add a row to the [Table of Contents](#table-of-contents)
2. Create a new `## N. Feature Name` section following the template above
3. List all files (source, config, test)
4. Document test counts
5. Update the total test count at the top

---

*Last updated: February 2026*
