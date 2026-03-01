import z from "zod"
import { Tool } from "./tool"
import { Log } from "../util/log"
import DESCRIPTION from "./browser_dev.txt"
import { execBrowser, isInstalled, type BrowserSessionConfig } from "./browser/session"

const log = Log.create({ service: "browser.dev" })

const COMMON_DEV_PORTS = [3000, 3001, 4321, 5173, 5174, 8080, 8888]

async function detectDevServer(): Promise<string | null> {
  for (const port of COMMON_DEV_PORTS) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 1000)
      const resp = await fetch(`http://localhost:${port}`, {
        signal: controller.signal,
        method: "HEAD",
      })
      clearTimeout(timer)
      if (resp.ok || resp.status < 500) {
        return `http://localhost:${port}`
      }
    } catch {
      // Port not responding, try next
    }
  }
  return null
}

export const BrowserDevTool = Tool.define("browser_dev", async () => {
  return {
    description: DESCRIPTION as string,
    parameters: z.object({
      url: z
        .string()
        .optional()
        .describe(
          "The dev server URL to check. If not provided, auto-detects common ports (3000, 5173, etc.).",
        ),
      path: z
        .string()
        .optional()
        .describe("Path to append to the base URL (e.g. '/dashboard', '/settings')."),
      full_check: z
        .boolean()
        .default(true)
        .describe("If true (default), performs snapshot + screenshot + error check. If false, only snapshot."),
      viewport: z
        .object({
          width: z.number().default(1280),
          height: z.number().default(720),
        })
        .optional()
        .describe("Custom viewport size for the check."),
    }),

    async execute(params, ctx) {
      const installed = await isInstalled()
      if (!installed) {
        return {
          title: "Browser not installed",
          metadata: { action: "browser_dev", success: false } as Record<string, any>,
          output:
            "agent-browser is not installed.\n\n" +
            "Install it with:\n" +
            "  npm install -g agent-browser\n" +
            "  agent-browser install",
        }
      }

      await ctx.ask({
        permission: "browser",
        patterns: [params.url ?? "localhost:*"],
        always: ["browser *"],
        metadata: { action: "browser_dev", url: params.url },
      })

      // Resolve URL
      let baseUrl = params.url
      if (!baseUrl) {
        baseUrl = await detectDevServer()
        if (!baseUrl) {
          return {
            title: "No dev server found",
            metadata: { action: "browser_dev", success: false } as Record<string, any>,
            output:
              `No local dev server detected on common ports (${COMMON_DEV_PORTS.join(", ")}).\n\n` +
              "Make sure your dev server is running, or provide an explicit URL.",
          }
        }
      }

      const fullUrl = params.path ? `${baseUrl.replace(/\/$/, "")}${params.path}` : baseUrl

      const config: Partial<BrowserSessionConfig> = {
        mode: "headless",
        profile: "guest",
        session: "aibo-dev-check",
      }

      if (params.viewport) {
        config.viewport = params.viewport
      }

      const report: string[] = []
      const attachments: any[] = []
      let overallSuccess = true

      // 1. Open the page
      report.push(`## Dev Server Check: ${fullUrl}\n`)

      const openResult = await execBrowser("open", [fullUrl], config, {
        abort: ctx.abort,
        timeout: 30000,
      })

      if (!openResult.success) {
        return {
          title: `Failed to open ${fullUrl}`,
          metadata: { action: "browser_dev", success: false, url: fullUrl } as Record<string, any>,
          output: `Failed to open ${fullUrl}:\n${openResult.error || openResult.output}`,
        }
      }
      report.push(`✅ Page loaded successfully`)

      // 2. Wait for network idle
      await execBrowser("wait", ["--load", "networkidle"], config, {
        abort: ctx.abort,
        timeout: 15000,
      })

      // 3. Get page title and URL
      const titleResult = await execBrowser("get", ["title"], config, { abort: ctx.abort, timeout: 5000 })
      const urlResult = await execBrowser("get", ["url"], config, { abort: ctx.abort, timeout: 5000 })
      report.push(`📄 Title: ${titleResult.output.trim() || "(empty)"}`)
      report.push(`🔗 URL: ${urlResult.output.trim()}`)
      report.push("")

      // 4. Take snapshot
      const snapshotResult = await execBrowser("snapshot", ["-i", "-c"], config, {
        abort: ctx.abort,
        timeout: 15000,
      })
      if (snapshotResult.success) {
        const lines = snapshotResult.output.split("\n")
        const interactiveCount = lines.filter((l) => l.includes("[ref=")).length
        report.push(`### Accessibility Snapshot`)
        report.push(`Found **${interactiveCount}** interactive elements.\n`)
        // Truncate if very long
        const snapshotText =
          snapshotResult.output.length > 5000
            ? snapshotResult.output.slice(0, 5000) + "\n... (truncated)"
            : snapshotResult.output
        report.push("```")
        report.push(snapshotText)
        report.push("```\n")
      } else {
        report.push(`⚠️ Snapshot failed: ${snapshotResult.error}`)
        overallSuccess = false
      }

      if (params.full_check) {
        // 5. Take screenshot
        const tmpPath = `/tmp/aibo-dev-check-${Date.now()}.png`
        const screenshotResult = await execBrowser("screenshot", [tmpPath], config, {
          abort: ctx.abort,
          timeout: 15000,
        })
        if (screenshotResult.success) {
          try {
            const { readFileSync, unlinkSync } = await import("fs")
            const buf = readFileSync(tmpPath)
            const base64 = buf.toString("base64")
            try {
              unlinkSync(tmpPath)
            } catch {}
            report.push(`### Screenshot`)
            report.push(`✅ Screenshot captured successfully.\n`)
            attachments.push({
              type: "file" as const,
              mime: "image/png",
              url: `data:image/png;base64,${base64}`,
            })
          } catch {
            report.push(`📸 Screenshot saved to ${tmpPath}`)
          }
        } else {
          report.push(`⚠️ Screenshot failed: ${screenshotResult.error}`)
        }

        // 6. Check console errors
        const consoleResult = await execBrowser("console", [], config, {
          abort: ctx.abort,
          timeout: 5000,
        })
        const errorsResult = await execBrowser("errors", [], config, {
          abort: ctx.abort,
          timeout: 5000,
        })

        report.push(`### Console & Errors`)

        const consoleOutput = consoleResult.output.trim()
        const errorsOutput = errorsResult.output.trim()

        if (errorsOutput && errorsOutput !== "No errors" && errorsOutput !== "[]") {
          report.push(`🔴 **JavaScript Errors Found:**`)
          report.push("```")
          report.push(errorsOutput)
          report.push("```")
          overallSuccess = false
        } else {
          report.push(`✅ No JavaScript errors detected.`)
        }

        if (consoleOutput && consoleOutput !== "No messages" && consoleOutput !== "[]") {
          const warningLines = consoleOutput
            .split("\n")
            .filter((l) => l.toLowerCase().includes("warn") || l.toLowerCase().includes("error"))
          if (warningLines.length > 0) {
            report.push(`\n⚠️ **Console warnings/errors (${warningLines.length}):**`)
            report.push("```")
            report.push(warningLines.slice(0, 20).join("\n"))
            report.push("```")
          } else {
            report.push(`✅ Console clean (${consoleOutput.split("\n").length} messages, no warnings).`)
          }
        } else {
          report.push(`✅ Console is clean.`)
        }
      }

      // 7. Close the browser
      await execBrowser("close", [], config, { abort: ctx.abort, timeout: 5000 })

      report.push("")
      report.push(`---`)
      report.push(overallSuccess ? `### ✅ All checks passed` : `### ⚠️ Some issues detected — see above`)

      const output = report.join("\n")

      return {
        title: `Dev check: ${fullUrl}`,
        metadata: {
          action: "browser_dev",
          success: overallSuccess,
          url: fullUrl,
        } as Record<string, any>,
        output,
        ...(attachments.length > 0 ? { attachments } : {}),
      }
    },
  }
})
