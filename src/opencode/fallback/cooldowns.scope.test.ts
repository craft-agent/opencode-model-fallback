import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createCooldowns } from "./cooldowns"
import { fakeClock, START_MS, tempDirs } from "./cooldowns.testing"

const HOUR_MS = 3_600_000
const X = { providerID: "a", id: "x" }
const Y = { providerID: "a", id: "y" }
const OTHER = { providerID: "b", id: "x" }
const dirs = tempDirs()
afterEach(() => dirs.cleanup())

/** The file of a new directory. */
function newFile(): string {
  return join(dirs.make(), "cooldowns.json")
}

describe("the provider scope", () => {
  test("a limit on one model cools every model of its provider, every variant included, and no other provider", () => {
    const cooldowns = createCooldowns({ scope: "provider", now: fakeClock().now })
    cooldowns.cool(X, START_MS + HOUR_MS)
    expect(cooldowns.until(X)).toBe(START_MS + HOUR_MS)
    expect(cooldowns.until(Y)).toBe(START_MS + HOUR_MS)
    expect(cooldowns.until({ ...Y, variant: "high" })).toBe(START_MS + HOUR_MS)
    expect(cooldowns.until(OTHER)).toBeUndefined()
  })

  test("the provider is usable again after the end, and the later end wins", () => {
    const clock = fakeClock()
    const cooldowns = createCooldowns({ scope: "provider", now: clock.now })
    cooldowns.cool(X, START_MS + 2_000)
    cooldowns.cool(Y, START_MS + 1_000)
    expect(cooldowns.until(X)).toBe(START_MS + 2_000)
    cooldowns.cool({ ...Y, variant: "high" }, START_MS + 3_000)
    expect(cooldowns.until(X)).toBe(START_MS + 3_000)
    clock.advance(3_000)
    expect(cooldowns.until(Y)).toBeUndefined()
  })

  test("saves the provider as `provider/*` and a new store reads it back", () => {
    const clock = fakeClock()
    const file = newFile()
    createCooldowns({ file, scope: "provider", now: clock.now }).cool(X, START_MS + HOUR_MS)
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ version: 1, cooldowns: { "a/*": START_MS + HOUR_MS } })
    const reloaded = createCooldowns({ file, scope: "provider", now: clock.now })
    expect(reloaded.until(Y)).toBe(START_MS + HOUR_MS)
    expect(reloaded.until(OTHER)).toBeUndefined()
  })
})

describe("the model scope", () => {
  test("a limit on one model cools that model only, and is the default", () => {
    for (const options of [{}, { scope: "model" as const }]) {
      const cooldowns = createCooldowns({ ...options, now: fakeClock().now })
      cooldowns.cool(X, START_MS + HOUR_MS)
      expect(cooldowns.until(X)).toBe(START_MS + HOUR_MS)
      expect(cooldowns.until(Y)).toBeUndefined()
    }
  })

  test("saves the model as before", () => {
    const file = newFile()
    createCooldowns({ file, now: fakeClock().now }).cool(X, START_MS + HOUR_MS)
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ version: 1, cooldowns: { "a/x": START_MS + HOUR_MS } })
  })

  test("a provider's cooldown in the file still counts, written by another process or before the scope changed", () => {
    const file = newFile()
    writeFileSync(file, JSON.stringify({ version: 1, cooldowns: { "a/*": START_MS + HOUR_MS } }))
    const cooldowns = createCooldowns({ file, scope: "model", now: fakeClock().now })
    expect(cooldowns.until(Y)).toBe(START_MS + HOUR_MS)
    expect(cooldowns.until({ ...Y, variant: "high" })).toBe(START_MS + HOUR_MS)
    expect(cooldowns.until(OTHER)).toBeUndefined()
  })

  test("a provider's cooldown that another process saved joins the store's own at a save", () => {
    const clock = fakeClock()
    const file = newFile()
    const cooldowns = createCooldowns({ file, now: clock.now })
    cooldowns.cool(OTHER, START_MS + 1_000)
    createCooldowns({ file, scope: "provider", now: clock.now }).cool(X, START_MS + HOUR_MS)
    cooldowns.cool(OTHER, START_MS + 2_000)
    expect(cooldowns.until(Y)).toBe(START_MS + HOUR_MS)
    expect(JSON.parse(readFileSync(file, "utf8")).cooldowns).toEqual({
      "a/*": START_MS + HOUR_MS,
      "b/x": START_MS + 2_000,
    })
  })

  test("a file without a provider's cooldown loads as before", () => {
    const file = newFile()
    writeFileSync(file, JSON.stringify({ version: 1, cooldowns: { "a/x": START_MS + HOUR_MS } }))
    const cooldowns = createCooldowns({ file, now: fakeClock().now })
    expect(cooldowns.until(X)).toBe(START_MS + HOUR_MS)
    expect(cooldowns.until(Y)).toBeUndefined()
  })
})
