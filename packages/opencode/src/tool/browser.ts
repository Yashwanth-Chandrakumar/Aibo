import z from "zod"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import DESCRIPTION from "./browser.txt"
import {
  execBrowser,
  isInstalled,
  getProfilePath,
  type BrowserSessionConfig,
  type BrowserCommandResult,
} from "./browser/session"

const log = Log.create({ service: "browser" })

// ---------------------------------------------------------------------------
// Shared config schema
// ---------------------------------------------------------------------------

const ConfigSchema = z
  .object({
    mode: z
      .enum(["headless", "headed"])
      .default("headless")
      .describe("Browser display mode. 'headed' shows a visible window."),
    profile: z
      .enum(["guest", "persistent", "user"])
      .default("guest")
      .describe("Profile mode: guest (ephemeral), persistent (saved), or user (your Chrome)."),
    session: z
      .string()
      .default("aibo-default")
      .describe("Session name for multi-agent isolation."),
  })
  .partial()

type ConfigInput = z.infer<typeof ConfigSchema>

function toSessionConfig(input?: ConfigInput): Partial<BrowserSessionConfig> {
  if (!input) return {}
  return {
    mode: input.mode,
    profile: input.profile,
    session: input.session,
    profilePath: input.profile === "persistent" ? getProfilePath(input.session ?? "aibo-default") : undefined,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatResult(result: BrowserCommandResult): string {
  if (!result.success) {
    return `Error: ${result.error || "Unknown error"}\n${result.output}`
  }
  return result.output
}

async function ensureInstalled(): Promise<void> {
  const installed = await isInstalled()
  if (!installed) {
    throw new Error(
      "agent-browser is not installed.\n\n" +
        "Install it with:\n" +
        "  npm install -g agent-browser\n" +
        "  agent-browser install\n\n" +
        "This downloads a Chromium binary (~50MB) for browser automation.",
    )
  }
}

// ---------------------------------------------------------------------------
// Main tool
// ---------------------------------------------------------------------------

export const BrowserTool = Tool.define(
  "browser",
  async () => {
    return {
      description: DESCRIPTION,
      parameters: z.object({
        action: z
          .enum([
            // Navigation & page
            "open",
            "snapshot",
            "screenshot",
            "get_text",
            "get_url",
            "get_title",
            // Interaction
            "click",
            "fill",
            "type",
            "select",
            "check",
            "uncheck",
            "press",
            "scroll",
            "hover",
            // Waiting
            "wait_for",
            // Tabs
            "tab_list",
            "tab_new",
            "tab_switch",
            "tab_close",
            // State & debug
            "console",
            "errors",
            "cookies",
            // Diff
            "diff_snapshot",
            "diff_screenshot",
            // Session
            "close",
            "status",
          ])
          .describe("The browser action to perform. See tool description for details on each action."),
        url: z.string().optional().describe("URL to navigate to (for 'open', 'tab_new')."),
        selector: z
          .string()
          .optional()
          .describe(
            "Element selector — use @ref from snapshot (e.g. '@e1') or CSS selector. " +
              "Refs are preferred as they are deterministic.",
          ),
        text: z.string().optional().describe("Text to type or fill into an element."),
        key: z
          .string()
          .optional()
          .describe("Key to press (for 'press' action). e.g. 'Enter', 'Tab', 'Escape', 'Control+a'."),
        direction: z
          .enum(["up", "down", "left", "right"])
          .optional()
          .describe("Scroll direction (for 'scroll' action)."),
        pixels: z.number().optional().describe("Pixels to scroll (default: 500)."),
        tab_index: z.number().optional().describe("Tab index for tab_switch / tab_close."),
        interactive_only: z
          .boolean()
          .optional()
          .describe("For 'snapshot': only show interactive elements (buttons, inputs, links). Reduces output size."),
        compact: z
          .boolean()
          .optional()
          .describe("For 'snapshot': remove empty structural elements."),
        wait_text: z.string().optional().describe("For 'wait_for': text to wait for on page."),
        wait_url: z.string().optional().describe("For 'wait_for': URL pattern to wait for."),
        wait_ms: z.number().optional().describe("For 'wait_for': time in ms to wait."),
        wait_selector: z.string().optional().describe("For 'wait_for': CSS selector to wait for visibility."),
        baseline: z.string().optional().describe("For 'diff_screenshot': path to baseline image for comparison."),
        config: ConfigSchema.optional().describe("Browser configuration (mode, profile, session)."),
      }),

      async execute(params, ctx) {
        await ensureInstalled()
        const sessionCfg = toSessionConfig(params.config)

        await ctx.ask({
          permission: "browser",
          patterns: [params.action + (params.url ? `: ${params.url}` : "")],
          always: ["browser *"],
          metadata: {
            action: params.action,
            url: params.url,
            selector: params.selector,
          },
        })

        const result = await dispatch(params, sessionCfg, ctx.abort)

        ctx.metadata({
          title: result.title,
          metadata: {
            action: params.action,
            success: result.success,
            url: params.url,
            selector: params.selector,
          },
        })

        // Handle screenshot attachments
        if (params.action === "screenshot" && result.attachment) {
          return {
            title: result.title,
            metadata: {
              action: params.action,
              success: result.success,
            },
            output: result.output,
            attachments: [result.attachment],
          }
        }

        return {
          title: result.title,
          metadata: {
            action: params.action,
            success: result.success,
          },
          output: result.output,
        }
      },
    }
  },
)

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

interface DispatchResult {
  title: string
  success: boolean
  output: string
  attachment?: {
    type: "file"
    mime: string
    url: string
  }
}

async function dispatch(
  params: any,
  config: Partial<BrowserSessionConfig>,
  abort?: AbortSignal,
): Promise<DispatchResult> {
  const opts = { abort, timeout: 30000 }

  switch (params.action) {
    // -----------------------------------------------------------------------
    // Navigation & Page
    // -----------------------------------------------------------------------
    case "open": {
      if (!params.url) throw new Error("'url' is required for the 'open' action")
      const r = await execBrowser("open", [params.url], config, opts)
      return { title: `Opened ${params.url}`, success: r.success, output: formatResult(r) }
    }

    case "snapshot": {
      const args: string[] = []
      if (params.interactive_only) args.push("-i")
      if (params.compact) args.push("-c")
      const r = await execBrowser("snapshot", args, config, { ...opts, timeout: 15000 })
      return { title: "Page snapshot", success: r.success, output: formatResult(r) }
    }

    case "screenshot": {
      const tmpPath = `/tmp/aibo-screenshot-${Date.now()}.png`
      const r = await execBrowser("screenshot", [tmpPath], config, opts)
      if (r.success) {
        try {
          const { readFileSync } = await import("fs")
          const buf = readFileSync(tmpPath)
          const base64 = buf.toString("base64")
          const { unlinkSync } = await import("fs")
          try {
            unlinkSync(tmpPath)
          } catch {}
          return {
            title: "Screenshot captured",
            success: true,
            output: "Screenshot captured successfully.",
            attachment: {
              type: "file",
              mime: "image/png",
              url: `data:image/png;base64,${base64}`,
            },
          }
        } catch (err: any) {
          return {
            title: "Screenshot captured",
            success: true,
            output: `Screenshot saved to ${tmpPath}`,
          }
        }
      }
      return { title: "Screenshot failed", success: false, output: formatResult(r) }
    }

    case "get_text": {
      if (!params.selector) throw new Error("'selector' is required for 'get_text'")
      const r = await execBrowser("get", ["text", params.selector], config, opts)
      return { title: `Text from ${params.selector}`, success: r.success, output: formatResult(r) }
    }

    case "get_url": {
      const r = await execBrowser("get", ["url"], config, opts)
      return { title: "Current URL", success: r.success, output: formatResult(r) }
    }

    case "get_title": {
      const r = await execBrowser("get", ["title"], config, opts)
      return { title: "Page title", success: r.success, output: formatResult(r) }
    }

    // -----------------------------------------------------------------------
    // Interaction
    // -----------------------------------------------------------------------
    case "click": {
      if (!params.selector) throw new Error("'selector' is required for 'click'")
      const r = await execBrowser("click", [params.selector], config, opts)
      return { title: `Clicked ${params.selector}`, success: r.success, output: formatResult(r) }
    }

    case "fill": {
      if (!params.selector) throw new Error("'selector' is required for 'fill'")
      if (params.text === undefined) throw new Error("'text' is required for 'fill'")
      const r = await execBrowser("fill", [params.selector, params.text], config, opts)
      return { title: `Filled ${params.selector}`, success: r.success, output: formatResult(r) }
    }

    case "type": {
      if (!params.selector) throw new Error("'selector' is required for 'type'")
      if (params.text === undefined) throw new Error("'text' is required for 'type'")
      const r = await execBrowser("type", [params.selector, params.text], config, opts)
      return { title: `Typed into ${params.selector}`, success: r.success, output: formatResult(r) }
    }

    case "select": {
      if (!params.selector) throw new Error("'selector' is required for 'select'")
      if (params.text === undefined) throw new Error("'text' (value) is required for 'select'")
      const r = await execBrowser("select", [params.selector, params.text], config, opts)
      return { title: `Selected in ${params.selector}`, success: r.success, output: formatResult(r) }
    }

    case "check": {
      if (!params.selector) throw new Error("'selector' is required for 'check'")
      const r = await execBrowser("check", [params.selector], config, opts)
      return { title: `Checked ${params.selector}`, success: r.success, output: formatResult(r) }
    }

    case "uncheck": {
      if (!params.selector) throw new Error("'selector' is required for 'uncheck'")
      const r = await execBrowser("uncheck", [params.selector], config, opts)
      return { title: `Unchecked ${params.selector}`, success: r.success, output: formatResult(r) }
    }

    case "press": {
      if (!params.key) throw new Error("'key' is required for 'press'")
      const r = await execBrowser("press", [params.key], config, opts)
      return { title: `Pressed ${params.key}`, success: r.success, output: formatResult(r) }
    }

    case "scroll": {
      const dir = params.direction || "down"
      const px = params.pixels ? String(params.pixels) : "500"
      const args = [dir, px]
      if (params.selector) args.push("--selector", params.selector)
      const r = await execBrowser("scroll", args, config, opts)
      return { title: `Scrolled ${dir}`, success: r.success, output: formatResult(r) }
    }

    case "hover": {
      if (!params.selector) throw new Error("'selector' is required for 'hover'")
      const r = await execBrowser("hover", [params.selector], config, opts)
      return { title: `Hovered ${params.selector}`, success: r.success, output: formatResult(r) }
    }

    // -----------------------------------------------------------------------
    // Waiting
    // -----------------------------------------------------------------------
    case "wait_for": {
      if (params.wait_selector) {
        const r = await execBrowser("wait", [params.wait_selector], config, { ...opts, timeout: 30000 })
        return { title: `Waited for ${params.wait_selector}`, success: r.success, output: formatResult(r) }
      }
      if (params.wait_text) {
        const r = await execBrowser("wait", ["--text", params.wait_text], config, { ...opts, timeout: 30000 })
        return { title: `Waited for text "${params.wait_text}"`, success: r.success, output: formatResult(r) }
      }
      if (params.wait_url) {
        const r = await execBrowser("wait", ["--url", params.wait_url], config, { ...opts, timeout: 30000 })
        return { title: `Waited for URL ${params.wait_url}`, success: r.success, output: formatResult(r) }
      }
      if (params.wait_ms) {
        const r = await execBrowser("wait", [String(params.wait_ms)], config, {
          ...opts,
          timeout: params.wait_ms + 5000,
        })
        return { title: `Waited ${params.wait_ms}ms`, success: r.success, output: formatResult(r) }
      }
      // Default: wait for network idle
      const r = await execBrowser("wait", ["--load", "networkidle"], config, { ...opts, timeout: 30000 })
      return { title: "Waited for network idle", success: r.success, output: formatResult(r) }
    }

    // -----------------------------------------------------------------------
    // Tabs
    // -----------------------------------------------------------------------
    case "tab_list": {
      const r = await execBrowser("tab", [], config, opts)
      return { title: "Browser tabs", success: r.success, output: formatResult(r) }
    }

    case "tab_new": {
      const args = params.url ? ["new", params.url] : ["new"]
      const r = await execBrowser("tab", args, config, opts)
      return { title: `Opened new tab${params.url ? `: ${params.url}` : ""}`, success: r.success, output: formatResult(r) }
    }

    case "tab_switch": {
      if (params.tab_index === undefined) throw new Error("'tab_index' is required for 'tab_switch'")
      const r = await execBrowser("tab", [String(params.tab_index)], config, opts)
      return { title: `Switched to tab ${params.tab_index}`, success: r.success, output: formatResult(r) }
    }

    case "tab_close": {
      const args = params.tab_index !== undefined ? ["close", String(params.tab_index)] : ["close"]
      const r = await execBrowser("tab", args, config, opts)
      return { title: "Closed tab", success: r.success, output: formatResult(r) }
    }

    // -----------------------------------------------------------------------
    // State & Debug
    // -----------------------------------------------------------------------
    case "console": {
      const r = await execBrowser("console", [], config, opts)
      return { title: "Console output", success: r.success, output: formatResult(r) }
    }

    case "errors": {
      const r = await execBrowser("errors", [], config, opts)
      return { title: "Page errors", success: r.success, output: formatResult(r) }
    }

    case "cookies": {
      const r = await execBrowser("cookies", [], config, opts)
      return { title: "Cookies", success: r.success, output: formatResult(r) }
    }

    // -----------------------------------------------------------------------
    // Diff (Visual regression)
    // -----------------------------------------------------------------------
    case "diff_snapshot": {
      const r = await execBrowser("diff", ["snapshot"], config, opts)
      return { title: "Snapshot diff", success: r.success, output: formatResult(r) }
    }

    case "diff_screenshot": {
      if (!params.baseline) throw new Error("'baseline' path is required for 'diff_screenshot'")
      const r = await execBrowser("diff", ["screenshot", "--baseline", params.baseline], config, opts)
      return { title: "Screenshot diff", success: r.success, output: formatResult(r) }
    }

    // -----------------------------------------------------------------------
    // Session
    // -----------------------------------------------------------------------
    case "close": {
      const r = await execBrowser("close", [], config, { ...opts, timeout: 10000 })
      return { title: "Browser closed", success: r.success, output: formatResult(r) }
    }

    case "status": {
      const installed = await isInstalled()
      if (!installed) {
        return {
          title: "Browser status",
          success: false,
          output: "agent-browser is not installed. Run: npm install -g agent-browser && agent-browser install",
        }
      }
      const sessionInfo = [
        `Installed: true`,
        `Session: ${params.config?.session ?? "aibo-default"}`,
        `Mode: ${params.config?.mode ?? "headless"}`,
        `Profile: ${params.config?.profile ?? "guest"}`,
      ]
      return { title: "Browser status", success: true, output: sessionInfo.join("\n") }
    }

    default:
      throw new Error(`Unknown browser action: ${params.action}`)
  }
}
