---
name: architect
description: "Orchestrate a structured review-implement-review loop for complex coding tasks. Spawns reviewer and coder agents that communicate via memory."
---

# Architect Skill

This skill activates the Architect Agent workflow — a structured orchestration pattern for complex coding tasks.

## How It Works

The Architect agent coordinates a loop of specialized subagents:

1. **Reviewer Agent (Initial)** — Analyzes the codebase relevant to your task, identifies patterns, conventions, and creates a review checklist
2. **Coder Agent** — Implements the changes based on a structured task specification
3. **Reviewer Agent (Iterate)** — Reviews only the diff from the coder, checks against the checklist
4. **Loop** — If issues are found, the coder is re-spawned to fix them. Repeats until the reviewer passes or max iterations (5) is reached.

## Usage

To use the Architect workflow, switch to the `@architect` agent or invoke this skill:

```
@architect Implement a new caching layer for the API endpoints
```

Or from the build agent:
```
Use the task tool to spawn the architect agent with: "Implement a new caching layer for the API endpoints"
```

## Memory Keys

The system uses namespaced memory keys for inter-agent communication:

| Key | Description |
|-----|-------------|
| `architect:status` | Current orchestration state (phase, iteration) |
| `architect:review:initial` | Initial codebase analysis from reviewer |
| `architect:task:spec` | Structured task spec for the coder |
| `architect:coder:diff_N` | Coder's change summary per iteration |
| `architect:review:iteration_N` | Reviewer's feedback per iteration |

## Benefits

- **Token efficient**: Reviewer and Coder run in separate sessions, communicating only via memory
- **Structured feedback**: Issues are categorized by severity with suggested fixes
- **Resumable**: If interrupted, the Architect reads `architect:status` and resumes from the correct phase
- **Quality assured**: Every code change is reviewed against a consistent checklist
