/**
 * Browser Session Manager
 *
 * Manages agent-browser daemon lifecycle, session isolation, and profile modes.
 * Supports headless/headful, guest/persistent/user-profile, and multi-session.
 */

import { spawn, execSync } from "child_process"
import { Log } from "../../util/log"
import * as path from "path"
import * as os from "os"
import * as fs from "fs"

const log = Log.create({ service: "browser.session" })

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrowserSessionConfig {
  /** Headless (default) or headed (visible window) */
  mode: "headless" | "headed"
  /** Profile strategy */
  profile: "guest" | "persistent" | "user"
  /** Custom profile path (used when profile = "persistent") */
  profilePath?: string
  /** Session name for isolation (default: "aibo-default") */
  session?: string
  /** Custom viewport (default: 1280x720) */
  viewport?: { width: number; height: number }
  /** Default navigation timeout in ms */
  timeout?: number
  /** Allowed domains (security) */
  allowedDomains?: string[]
  /** Max output characters */
  maxOutput?: number
}

export interface BrowserCommandResult {
  success: boolean
  output: string
  error?: string
  /** Parsed JSON data if --json was used */
  data?: any
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: Required<BrowserSessionConfig> = {
  mode: "headless",
  profile: "guest",
  profilePath: path.join(os.homedir(), ".aibo", "browser-profile"),
  session: "aibo-default",
  viewport: { width: 1280, height: 720 },
  timeout: 25000,
  allowedDomains: [],
  maxOutput: 50000,
}

const PROFILES_DIR = path.join(os.homedir(), ".aibo", "browser-profiles")

// ---------------------------------------------------------------------------
// Binary resolution
// ---------------------------------------------------------------------------

let resolvedBinary: string | null = null

function findAgentBrowser(): string {
  if (resolvedBinary) return resolvedBinary

  // 1. Check if globally installed
  try {
    const globalPath = execSync("which agent-browser", { encoding: "utf-8" }).trim()
    if (globalPath && fs.existsSync(globalPath)) {
      resolvedBinary = globalPath
      log.info("found global agent-browser", { path: globalPath })
      return globalPath
    }
  } catch {}

  // 2. Check npx availability
  try {
    execSync("npx agent-browser --version", { encoding: "utf-8", timeout: 10000 })
    resolvedBinary = "npx agent-browser"
    log.info("using npx agent-browser")
    return resolvedBinary
  } catch {}

  throw new Error(
    "agent-browser is not installed. Install it with:\n" +
      "  npm install -g agent-browser\n" +
      "  agent-browser install\n\n" +
      "Or run: npx agent-browser install",
  )
}

// ---------------------------------------------------------------------------
// Command execution
// ---------------------------------------------------------------------------

function buildEnv(config: BrowserSessionConfig): Record<string, string> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>

  if (config.session) {
    env.AGENT_BROWSER_SESSION = config.session
  }
  if (config.timeout) {
    env.AGENT_BROWSER_DEFAULT_TIMEOUT = String(config.timeout)
  }
  if (config.maxOutput) {
    env.AGENT_BROWSER_MAX_OUTPUT = String(config.maxOutput)
  }
  if (config.allowedDomains && config.allowedDomains.length > 0) {
    env.AGENT_BROWSER_ALLOWED_DOMAINS = config.allowedDomains.join(",")
  }

  return env
}

function buildArgs(config: BrowserSessionConfig): string[] {
  const args: string[] = []

  if (config.mode === "headed") {
    args.push("--headed")
  }

  if (config.profile === "persistent" && config.profilePath) {
    args.push("--profile", config.profilePath)
  } else if (config.profile === "user") {
    args.push("--auto-connect")
  }

  return args
}

export async function execBrowser(
  command: string,
  commandArgs: string[] = [],
  config: Partial<BrowserSessionConfig> = {},
  options: { json?: boolean; timeout?: number; abort?: AbortSignal } = {},
): Promise<BrowserCommandResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const binary = findAgentBrowser()
  const globalArgs = buildArgs(cfg)
  const env = buildEnv(cfg)

  const allArgs = [...globalArgs, command, ...commandArgs]
  if (options.json) {
    allArgs.push("--json")
  }

  const fullCommand = binary.includes(" ")
    ? `${binary} ${allArgs.join(" ")}`
    : undefined

  const spawnCmd = binary.includes(" ") ? "sh" : binary
  const spawnArgs = binary.includes(" ")
    ? ["-c", `${binary} ${allArgs.join(" ")}`]
    : allArgs

  log.info("browser command", { command, args: allArgs })

  const timeout = options.timeout ?? cfg.timeout ?? 30000

  return new Promise<BrowserCommandResult>((resolve) => {
    let stdout = ""
    let stderr = ""
    let timedOut = false

    const proc = spawn(spawnCmd, spawnArgs, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeout + 5000,
    })

    const timer = setTimeout(() => {
      timedOut = true
      proc.kill("SIGTERM")
    }, timeout)

    if (options.abort) {
      const onAbort = () => {
        proc.kill("SIGTERM")
        clearTimeout(timer)
      }
      options.abort.addEventListener("abort", onAbort, { once: true })
      proc.once("exit", () => options.abort!.removeEventListener("abort", onAbort))
    }

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    proc.once("exit", (code) => {
      clearTimeout(timer)

      if (timedOut) {
        resolve({
          success: false,
          output: stdout,
          error: `Command timed out after ${timeout}ms`,
        })
        return
      }

      let data: any = undefined
      if (options.json && stdout.trim()) {
        try {
          data = JSON.parse(stdout.trim())
        } catch {
          // Not valid JSON, leave as string
        }
      }

      if (code !== 0 && !stdout.trim()) {
        resolve({
          success: false,
          output: stderr || `Command exited with code ${code}`,
          error: stderr || `Exit code: ${code}`,
          data,
        })
      } else {
        resolve({
          success: true,
          output: stdout.trim(),
          error: stderr.trim() || undefined,
          data,
        })
      }
    })

    proc.once("error", (err) => {
      clearTimeout(timer)
      resolve({
        success: false,
        output: "",
        error: err.message,
      })
    })
  })
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

export function getProfilePath(name: string): string {
  fs.mkdirSync(PROFILES_DIR, { recursive: true })
  return path.join(PROFILES_DIR, name)
}

export async function isInstalled(): Promise<boolean> {
  try {
    findAgentBrowser()
    return true
  } catch {
    return false
  }
}

export async function getVersion(): Promise<string> {
  const result = await execBrowser("--version", [], {}, { timeout: 5000 })
  return result.output.trim()
}

export async function ensureChromium(): Promise<BrowserCommandResult> {
  return execBrowser("install", [], {}, { timeout: 120000 })
}

export function resolveConfig(overrides: Partial<BrowserSessionConfig> = {}): Required<BrowserSessionConfig> {
  return { ...DEFAULT_CONFIG, ...overrides }
}
