import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { settingVariables } from "../src/entry/settings"
import { PROJECT } from "../src/project"
import { PLUGIN_NAME } from "./package-name.mjs"

const ROOT = fileURLToPath(new URL("../", import.meta.url))

const OPTION_TYPES = ["text", "boolean", "number", "list", "path", "paths"]
const BOUNDED_OPTION_TYPES = ["number", "list", "paths"]

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))

/** Whether npm packs `path` for a `files` list: named itself, or inside a directory it names. */
function isPacked(path, files) {
  return files.some((entry) => path === entry || path.startsWith(`${entry}/`))
}

describe("project", () => {
  test("src/project.ts gives the program the name package.json does", () => {
    expect(PROJECT.name).toBe(PLUGIN_NAME)
  })

  test("every tool variable is a variable name, listed once and not a setting's", () => {
    for (const variable of PROJECT.toolVariables) {
      expect(variable).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/)
      expect(settingVariables()).not.toContain(variable)
    }
    expect(new Set(PROJECT.toolVariables).size).toBe(PROJECT.toolVariables.length)
  })

  test("the package's options are typed snake_case settings", () => {
    for (const [name, spec] of Object.entries(PROJECT.options)) {
      expect(name).toMatch(/^[a-z]+(?:_[a-z]+)*$/)
      const { type, ...bounds } = typeof spec === "string" ? { type: spec } : spec
      expect(OPTION_TYPES).toContain(type)
      for (const [key, value] of Object.entries(bounds)) {
        if (key === "integer") {
          expect(type).toBe("number")
          expect(value).toBe(true)
        } else {
          expect(["min", "max"]).toContain(key)
          expect(BOUNDED_OPTION_TYPES).toContain(type)
          expect(Number.isFinite(value)).toBe(true)
        }
      }
      if (bounds.min !== undefined && bounds.max !== undefined) expect(bounds.min).toBeLessThanOrEqual(bounds.max)
    }
  })
})

describe("package files", () => {
  test.each(["dist", "skills"])("%s is packed", (path) => {
    expect(isPacked(path, pkg.files)).toBe(true)
  })

  test("every export is a packed build the release checks the tarball for", () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/release-publish.yml"), "utf8")
    const built = workflow.match(/built=\(([^)]*)\)/)?.[1].split(/\s+/)
    expect(Object.keys(pkg.exports)).toContain("./rpc")
    for (const target of Object.values(pkg.exports).flatMap((entry) =>
      typeof entry === "string" ? [entry] : Object.values(entry),
    )) {
      expect(isPacked(target.replace(/^\.\//, ""), pkg.files)).toBe(true)
      expect(built).toContain(target.replace(/^\.\//, ""))
    }
  })

  test("the package ships no MCP server and no registry name", () => {
    expect(pkg.bin).toBeUndefined()
    expect(pkg.mcpName).toBeUndefined()
  })

  // The build bundles everything it imports, so installing the package
  // installs no packages.
  test("the package installs no runtime dependencies", () => {
    expect(pkg.dependencies ?? {}).toEqual({})
  })
})
