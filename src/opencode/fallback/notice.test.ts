import { describe, expect, test } from "bun:test"
import { PROJECT } from "../../project"
import { notice, ownedKey } from "./notice"

describe("notice", () => {
  test("starts with [Model fallback: and wraps the text", () => {
    expect(notice("config ignored: routes")).toBe("[Model fallback: config ignored: routes]")
  })
})

describe("ownedKey", () => {
  test("is the plugin name, a dot and the name", () => {
    expect(ownedKey("route")).toBe("opencode-model-fallback.route")
    expect(ownedKey("route")).toBe(`${PROJECT.name}.route`)
  })
})
