import { describe, expect, test } from "bun:test"
import { PROJECT } from "../../project"
import { createOnceNotices, notice, ownedKey } from "./notice"

describe("createOnceNotices", () => {
  test("hands back what was added, oldest first, and then nothing", () => {
    const once = createOnceNotices()
    expect(once.take()).toEqual([])
    once.add("a")
    once.add("b")
    expect(once.take()).toEqual(["a", "b"])
    expect(once.take()).toEqual([])
  })

  test("keeps what is added after a take for the next one", () => {
    const once = createOnceNotices()
    once.add("a")
    once.take()
    once.add("b")
    expect(once.take()).toEqual(["b"])
  })
})

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
