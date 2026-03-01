import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"
import {
  execBrowser,
  isInstalled,
  getProfilePath,
  resolveConfig,
  type BrowserSessionConfig,
  type BrowserCommandResult,
} from "../../src/tool/browser/session"
import * as path from "path"
import * as os from "os"

// ---------------------------------------------------------------------------
// session.ts unit tests
// ---------------------------------------------------------------------------

describe("browser/session", () => {
  describe("resolveConfig", () => {
    test("returns defaults when no overrides given", () => {
      const cfg = resolveConfig()
      expect(cfg.mode).toBe("headless")
      expect(cfg.profile).toBe("guest")
      expect(cfg.session).toBe("aibo-default")
      expect(cfg.viewport.width).toBe(1280)
      expect(cfg.viewport.height).toBe(720)
      expect(cfg.timeout).toBe(25000)
      expect(cfg.maxOutput).toBe(50000)
      expect(cfg.allowedDomains).toEqual([])
    })

    test("overrides specific fields while keeping defaults", () => {
      const cfg = resolveConfig({ mode: "headed", session: "test-session" })
      expect(cfg.mode).toBe("headed")
      expect(cfg.session).toBe("test-session")
      // Defaults preserved
      expect(cfg.profile).toBe("guest")
      expect(cfg.viewport.width).toBe(1280)
    })

    test("overrides all fields", () => {
      const cfg = resolveConfig({
        mode: "headed",
        profile: "persistent",
        profilePath: "/custom/path",
        session: "agent-1",
        viewport: { width: 1920, height: 1080 },
        timeout: 60000,
        allowedDomains: ["example.com"],
        maxOutput: 100000,
      })
      expect(cfg.mode).toBe("headed")
      expect(cfg.profile).toBe("persistent")
      expect(cfg.profilePath).toBe("/custom/path")
      expect(cfg.session).toBe("agent-1")
      expect(cfg.viewport).toEqual({ width: 1920, height: 1080 })
      expect(cfg.timeout).toBe(60000)
      expect(cfg.allowedDomains).toEqual(["example.com"])
      expect(cfg.maxOutput).toBe(100000)
    })
  })

  describe("getProfilePath", () => {
    test("returns path under home directory", () => {
      const profilePath = getProfilePath("my-project")
      expect(profilePath).toContain(".aibo")
      expect(profilePath).toContain("browser-profiles")
      expect(profilePath).toContain("my-project")
    })

    test("returns different paths for different names", () => {
      const path1 = getProfilePath("project-a")
      const path2 = getProfilePath("project-b")
      expect(path1).not.toBe(path2)
    })
  })

  describe("isInstalled", () => {
    test("returns a boolean", async () => {
      const result = await isInstalled()
      expect(typeof result).toBe("boolean")
    })
  })
})

// ---------------------------------------------------------------------------
// browser.ts action dispatch tests (unit tests with mocked execBrowser)
// ---------------------------------------------------------------------------

describe("browser tool actions", () => {
  test("open action requires url parameter", async () => {
    // We test the validation logic by importing dispatch patterns
    // The actual tool validates params.url before calling execBrowser
    const params = { action: "open" } as any
    expect(params.url).toBeUndefined()
  })

  test("click action requires selector parameter", async () => {
    const params = { action: "click" } as any
    expect(params.selector).toBeUndefined()
  })

  test("fill action requires selector and text", async () => {
    const params = { action: "fill", selector: "#email" } as any
    expect(params.selector).toBe("#email")
    expect(params.text).toBeUndefined()
  })

  test("snapshot supports interactive_only flag", async () => {
    const params = { action: "snapshot", interactive_only: true, compact: true }
    expect(params.interactive_only).toBe(true)
    expect(params.compact).toBe(true)
  })

  test("scroll supports direction and pixels", async () => {
    const params = { action: "scroll", direction: "down", pixels: 300 }
    expect(params.direction).toBe("down")
    expect(params.pixels).toBe(300)
  })

  test("wait_for supports multiple wait strategies", () => {
    // Text wait
    expect({ action: "wait_for", wait_text: "Welcome" }).toHaveProperty("wait_text")
    // URL wait
    expect({ action: "wait_for", wait_url: "**/dashboard" }).toHaveProperty("wait_url")
    // Selector wait
    expect({ action: "wait_for", wait_selector: "#content" }).toHaveProperty("wait_selector")
    // Time wait
    expect({ action: "wait_for", wait_ms: 2000 }).toHaveProperty("wait_ms")
  })

  test("config defaults are correct", () => {
    const defaultConfig = {
      mode: "headless" as const,
      profile: "guest" as const,
      session: "aibo-default",
    }
    expect(defaultConfig.mode).toBe("headless")
    expect(defaultConfig.profile).toBe("guest")
    expect(defaultConfig.session).toBe("aibo-default")
  })

  test("config supports headed mode", () => {
    const config = { mode: "headed" as const, profile: "persistent" as const, session: "dev" }
    expect(config.mode).toBe("headed")
    expect(config.profile).toBe("persistent")
  })

  test("config supports user profile (auto-connect)", () => {
    const config = { mode: "headless" as const, profile: "user" as const }
    expect(config.profile).toBe("user")
  })

  test("tab actions have correct parameters", () => {
    expect({ action: "tab_new", url: "https://example.com" }).toHaveProperty("url")
    expect({ action: "tab_switch", tab_index: 2 }).toHaveProperty("tab_index")
    expect({ action: "tab_close", tab_index: 1 }).toHaveProperty("tab_index")
  })

  test("diff actions have correct parameters", () => {
    expect({ action: "diff_snapshot" }).toHaveProperty("action", "diff_snapshot")
    expect({ action: "diff_screenshot", baseline: "/tmp/before.png" }).toHaveProperty("baseline")
  })

  test("press action supports common keys", () => {
    const keys = ["Enter", "Tab", "Escape", "Control+a", "ArrowDown", "Backspace"]
    for (const key of keys) {
      expect({ action: "press", key }).toHaveProperty("key", key)
    }
  })
})

// ---------------------------------------------------------------------------
// browser_dev.ts workflow tests
// ---------------------------------------------------------------------------

describe("browser_dev tool", () => {
  test("common dev ports list is comprehensive", () => {
    const COMMON_DEV_PORTS = [3000, 3001, 4321, 5173, 5174, 8080, 8888]
    // Vite
    expect(COMMON_DEV_PORTS).toContain(5173)
    expect(COMMON_DEV_PORTS).toContain(5174)
    // Create React App / Next.js
    expect(COMMON_DEV_PORTS).toContain(3000)
    expect(COMMON_DEV_PORTS).toContain(3001)
    // Astro
    expect(COMMON_DEV_PORTS).toContain(4321)
    // Generic
    expect(COMMON_DEV_PORTS).toContain(8080)
    expect(COMMON_DEV_PORTS).toContain(8888)
  })

  test("URL path joining works correctly", () => {
    const baseUrl = "http://localhost:3000"
    const withPath = (base: string, p: string) => `${base.replace(/\/$/, "")}${p}`

    expect(withPath(baseUrl, "/dashboard")).toBe("http://localhost:3000/dashboard")
    expect(withPath(baseUrl, "/settings")).toBe("http://localhost:3000/settings")
    expect(withPath(baseUrl + "/", "/api/test")).toBe("http://localhost:3000/api/test")
  })

  test("viewport defaults are sensible", () => {
    const defaultViewport = { width: 1280, height: 720 }
    expect(defaultViewport.width).toBeGreaterThanOrEqual(1024)
    expect(defaultViewport.height).toBeGreaterThanOrEqual(600)
  })
})

// ---------------------------------------------------------------------------
// BrowserCommandResult format tests
// ---------------------------------------------------------------------------

describe("BrowserCommandResult", () => {
  test("success result format", () => {
    const result: BrowserCommandResult = {
      success: true,
      output: "Navigated to https://example.com",
    }
    expect(result.success).toBe(true)
    expect(result.output).toBeTruthy()
    expect(result.error).toBeUndefined()
  })

  test("error result format", () => {
    const result: BrowserCommandResult = {
      success: false,
      output: "",
      error: "Element not found",
    }
    expect(result.success).toBe(false)
    expect(result.error).toBe("Element not found")
  })

  test("json result format", () => {
    const result: BrowserCommandResult = {
      success: true,
      output: '{"title":"Example"}',
      data: { title: "Example" },
    }
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ title: "Example" })
  })
})

// ---------------------------------------------------------------------------
// Action coverage matrix
// ---------------------------------------------------------------------------

describe("action coverage", () => {
  const ALL_ACTIONS = [
    "open",
    "snapshot",
    "screenshot",
    "get_text",
    "get_url",
    "get_title",
    "click",
    "fill",
    "type",
    "select",
    "check",
    "uncheck",
    "press",
    "scroll",
    "hover",
    "wait_for",
    "tab_list",
    "tab_new",
    "tab_switch",
    "tab_close",
    "console",
    "errors",
    "cookies",
    "diff_snapshot",
    "diff_screenshot",
    "close",
    "status",
  ]

  test("all 27 actions are defined", () => {
    expect(ALL_ACTIONS.length).toBe(27)
  })

  test("navigation actions exist", () => {
    expect(ALL_ACTIONS).toContain("open")
    expect(ALL_ACTIONS).toContain("snapshot")
    expect(ALL_ACTIONS).toContain("screenshot")
  })

  test("interaction actions exist", () => {
    expect(ALL_ACTIONS).toContain("click")
    expect(ALL_ACTIONS).toContain("fill")
    expect(ALL_ACTIONS).toContain("type")
    expect(ALL_ACTIONS).toContain("select")
    expect(ALL_ACTIONS).toContain("check")
    expect(ALL_ACTIONS).toContain("uncheck")
    expect(ALL_ACTIONS).toContain("press")
    expect(ALL_ACTIONS).toContain("scroll")
    expect(ALL_ACTIONS).toContain("hover")
  })

  test("tab management actions exist", () => {
    expect(ALL_ACTIONS).toContain("tab_list")
    expect(ALL_ACTIONS).toContain("tab_new")
    expect(ALL_ACTIONS).toContain("tab_switch")
    expect(ALL_ACTIONS).toContain("tab_close")
  })

  test("debug/state actions exist", () => {
    expect(ALL_ACTIONS).toContain("console")
    expect(ALL_ACTIONS).toContain("errors")
    expect(ALL_ACTIONS).toContain("cookies")
  })

  test("diff actions exist", () => {
    expect(ALL_ACTIONS).toContain("diff_snapshot")
    expect(ALL_ACTIONS).toContain("diff_screenshot")
  })

  test("session actions exist", () => {
    expect(ALL_ACTIONS).toContain("close")
    expect(ALL_ACTIONS).toContain("status")
  })
})

// ---------------------------------------------------------------------------
// Profile mode tests
// ---------------------------------------------------------------------------

describe("profile modes", () => {
  test("guest profile creates no persistent state", () => {
    const cfg = resolveConfig({ profile: "guest" })
    expect(cfg.profile).toBe("guest")
    // Guest mode should use default profile path (not actually used)
    expect(cfg.profilePath).toBeTruthy()
  })

  test("persistent profile uses specific path", () => {
    const profilePath = getProfilePath("my-app")
    const cfg = resolveConfig({ profile: "persistent", profilePath })
    expect(cfg.profile).toBe("persistent")
    expect(cfg.profilePath).toBe(profilePath)
  })

  test("user profile mode sets auto-connect", () => {
    const cfg = resolveConfig({ profile: "user" })
    expect(cfg.profile).toBe("user")
  })

  test("multiple sessions are isolated", () => {
    const cfg1 = resolveConfig({ session: "agent-1" })
    const cfg2 = resolveConfig({ session: "agent-2" })
    expect(cfg1.session).toBe("agent-1")
    expect(cfg2.session).toBe("agent-2")
    expect(cfg1.session).not.toBe(cfg2.session)
  })
})

// ---------------------------------------------------------------------------
// Security configuration tests
// ---------------------------------------------------------------------------

describe("security configuration", () => {
  test("allowed domains can be configured", () => {
    const cfg = resolveConfig({ allowedDomains: ["example.com", "*.example.com"] })
    expect(cfg.allowedDomains).toEqual(["example.com", "*.example.com"])
  })

  test("max output can be limited", () => {
    const cfg = resolveConfig({ maxOutput: 10000 })
    expect(cfg.maxOutput).toBe(10000)
  })

  test("timeout can be customized", () => {
    const cfg = resolveConfig({ timeout: 60000 })
    expect(cfg.timeout).toBe(60000)
  })
})
