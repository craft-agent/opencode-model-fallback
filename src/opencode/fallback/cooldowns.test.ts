import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createCooldowns, MAX_COOLDOWN_END_MS } from "./cooldowns"
import { fakeClock, START_MS, tempDirs } from "./cooldowns.testing"

const HOUR_MS = 3_600_000
const MODEL = { providerID: "a", id: "x" }
const HIGH = { ...MODEL, variant: "high" }
const dirs = tempDirs()
afterEach(() => dirs.cleanup())

/** A cooldowns store over a fake clock and a file in a new directory. */
function setup(onProblem?: (text: string) => void) {
  const clock = fakeClock()
  const file = join(dirs.make(), "state", "cooldowns.json")
  const open = () => createCooldowns({ file, now: clock.now, onProblem })
  return { clock, file, open, cooldowns: open() }
}

describe("cooldowns in memory", () => {
  test("a model cools until its end and is usable again after it", () => {
    const clock = fakeClock()
    const cooldowns = createCooldowns({ now: clock.now })
    expect(cooldowns.until(MODEL)).toBeUndefined()
    cooldowns.cool(MODEL, START_MS + HOUR_MS)
    expect(cooldowns.until(MODEL)).toBe(START_MS + HOUR_MS)
    clock.advance(HOUR_MS - 1)
    expect(cooldowns.until(MODEL)).toBe(START_MS + HOUR_MS)
    clock.advance(1)
    expect(cooldowns.until(MODEL)).toBeUndefined()
  })

  test("the later end wins, whichever comes first", () => {
    const cooldowns = createCooldowns({ now: fakeClock().now })
    cooldowns.cool(MODEL, START_MS + 2_000)
    cooldowns.cool(MODEL, START_MS + 1_000)
    expect(cooldowns.until(MODEL)).toBe(START_MS + 2_000)
    cooldowns.cool(MODEL, START_MS + 3_000)
    expect(cooldowns.until(MODEL)).toBe(START_MS + 3_000)
  })

  test("a variant cools on its own, and a model without one cools every variant", () => {
    const cooldowns = createCooldowns({ now: fakeClock().now })
    cooldowns.cool(HIGH, START_MS + 1_000)
    expect(cooldowns.until(HIGH)).toBe(START_MS + 1_000)
    expect(cooldowns.until(MODEL)).toBeUndefined()
    expect(cooldowns.until({ ...MODEL, variant: "low" })).toBeUndefined()
    cooldowns.cool(MODEL, START_MS + 5_000)
    expect(cooldowns.until(MODEL)).toBe(START_MS + 5_000)
    expect(cooldowns.until(HIGH)).toBe(START_MS + 5_000)
    expect(cooldowns.until({ ...MODEL, variant: "low" })).toBe(START_MS + 5_000)
    expect(cooldowns.until({ providerID: "a", id: "y" })).toBeUndefined()
  })

  test.each([START_MS, START_MS - 1, Number.NaN, Number.POSITIVE_INFINITY])("ignores an end of %p", (end) => {
    const cooldowns = createCooldowns({ now: fakeClock().now })
    cooldowns.cool(MODEL, end)
    expect(cooldowns.until(MODEL)).toBeUndefined()
  })

  test("an end past the latest date is cut to it, so it can always be written as a time", () => {
    const cooldowns = createCooldowns({ now: fakeClock().now })
    cooldowns.cool(MODEL, MAX_COOLDOWN_END_MS * 2)
    expect(cooldowns.until(MODEL)).toBe(MAX_COOLDOWN_END_MS)
    expect(() => new Date(cooldowns.until(MODEL)!).toISOString()).not.toThrow()
  })
})

describe("cooldowns in a file", () => {
  test("saves the cooldowns as versioned JSON in a directory it creates", () => {
    const { cooldowns, file } = setup()
    cooldowns.cool(MODEL, START_MS + 1_000)
    cooldowns.cool(HIGH, START_MS + 2_000)
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      version: 1,
      cooldowns: { "a/x": START_MS + 1_000, "a/x#high": START_MS + 2_000 },
    })
  })

  test("writes through a temporary file that is renamed away", () => {
    const { cooldowns, file } = setup()
    cooldowns.cool(MODEL, START_MS + 1_000)
    cooldowns.cool(HIGH, START_MS + 2_000)
    expect(readdirSync(join(file, ".."))).toEqual(["cooldowns.json"])
  })

  test("a new store reads what the last one saved", () => {
    const { open, cooldowns } = setup()
    cooldowns.cool(MODEL, START_MS + 1_000)
    cooldowns.cool(HIGH, START_MS + 2_000)
    const reloaded = open()
    expect(reloaded.until(MODEL)).toBe(START_MS + 1_000)
    expect(reloaded.until(HIGH)).toBe(START_MS + 2_000)
  })

  test("drops what has ended when it loads and when it saves", () => {
    const { clock, file, open, cooldowns } = setup()
    cooldowns.cool(MODEL, START_MS + 1_000)
    cooldowns.cool(HIGH, START_MS + 5_000)
    clock.advance(2_000)
    cooldowns.cool({ providerID: "b", id: "y" }, START_MS + 9_000)
    expect(Object.keys(JSON.parse(readFileSync(file, "utf8")).cooldowns)).toEqual(["a/x#high", "b/y"])
    clock.advance(4_000)
    expect(open().until(HIGH)).toBeUndefined()
    expect(open().until({ providerID: "b", id: "y" })).toBe(START_MS + 9_000)
  })

  test("a cooldown that changes nothing saves nothing", () => {
    const { cooldowns, file } = setup()
    cooldowns.cool(MODEL, START_MS + 2_000)
    writeFileSync(file, "sentinel")
    cooldowns.cool(MODEL, START_MS + 1_000)
    expect(readFileSync(file, "utf8")).toBe("sentinel")
  })

  test("keeps no file when nothing cools", () => {
    const { file } = setup()
    expect(existsSync(file)).toBe(false)
  })
})
