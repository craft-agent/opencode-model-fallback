import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createCooldowns } from "./cooldowns"
import { fakeClock, START_MS, tempDirs } from "./cooldowns.testing"

const MODEL = { providerID: "a", id: "x" }
const dirs = tempDirs()
afterEach(() => dirs.cleanup())

/** A store over a fake clock and the file `content` in a new directory (no file when `undefined`). */
function openWith(content?: string, onProblem?: (text: string) => void) {
  const dir = dirs.make()
  const file = join(dir, "cooldowns.json")
  if (content !== undefined) writeFileSync(file, content)
  const cooldowns = createCooldowns({ file, now: fakeClock().now, onProblem })
  return { dir, file, cooldowns }
}

describe("an unreadable cooldowns file", () => {
  test.each([
    ["not JSON", "{ nope"],
    ["not an object", "[1, 2]"],
    ["of another version", JSON.stringify({ version: 2, cooldowns: {} })],
    ["without cooldowns", JSON.stringify({ version: 1 })],
    ["with cooldowns that are not an object", JSON.stringify({ version: 1, cooldowns: [] })],
  ])("is set aside when it is %s, and counts as empty", (_name, content) => {
    const { dir, file, cooldowns } = openWith(content)
    expect(cooldowns.until(MODEL)).toBeUndefined()
    expect(existsSync(file)).toBe(false)
    expect(readFileSync(join(dir, "cooldowns.json.unreadable"), "utf8")).toBe(content)
  })

  test("is set aside over an older one, and the next save writes a fresh file", () => {
    const dir = dirs.make()
    const file = join(dir, "cooldowns.json")
    const aside = join(dir, "cooldowns.json.unreadable")
    writeFileSync(aside, "older")
    writeFileSync(file, "{ newer")
    const cooldowns = createCooldowns({ file, now: fakeClock().now })
    expect(readFileSync(aside, "utf8")).toBe("{ newer")
    cooldowns.cool(MODEL, START_MS + 1_000)
    expect(JSON.parse(readFileSync(file, "utf8")).version).toBe(1)
    expect(readFileSync(aside, "utf8")).toBe("{ newer")
  })

  test("a missing file is empty and sets nothing aside", () => {
    const { dir, cooldowns } = openWith()
    expect(cooldowns.until(MODEL)).toBeUndefined()
    expect(readdirSync(dir)).toEqual([])
  })

  test("an entry that is not a live cooldown is dropped, and the rest are kept", () => {
    const content = JSON.stringify({
      version: 1,
      cooldowns: { "a/x": START_MS + 1_000, "a/y": START_MS - 1, "a/z": "soon", nonsense: START_MS + 1_000 },
    })
    const { dir, cooldowns } = openWith(content)
    expect(cooldowns.until(MODEL)).toBe(START_MS + 1_000)
    expect(cooldowns.until({ providerID: "a", id: "y" })).toBeUndefined()
    expect(readdirSync(dir)).toEqual(["cooldowns.json"])
  })
})

describe("a cooldowns file that cannot be saved", () => {
  /** A store whose directory cannot be made: a file stands where it should be. */
  function blocked(onProblem: (text: string) => void) {
    const dir = dirs.make()
    const blocker = join(dir, "blocker")
    writeFileSync(blocker, "")
    return createCooldowns({ file: join(blocker, "cooldowns.json"), now: fakeClock().now, onProblem })
  }

  test("keeps the cooldowns in memory and tells the problem once", () => {
    const problems: string[] = []
    const cooldowns = blocked((text) => problems.push(text))
    cooldowns.cool(MODEL, START_MS + 1_000)
    cooldowns.cool({ providerID: "b", id: "y" }, START_MS + 2_000)
    expect(cooldowns.until(MODEL)).toBe(START_MS + 1_000)
    expect(cooldowns.until({ providerID: "b", id: "y" })).toBe(START_MS + 2_000)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toStartWith("cooldowns not saved: ")
  })

  test("does not throw when telling the problem throws", () => {
    const cooldowns = blocked(() => {
      throw new Error("no notice")
    })
    expect(() => cooldowns.cool(MODEL, START_MS + 1_000)).not.toThrow()
    expect(cooldowns.until(MODEL)).toBe(START_MS + 1_000)
  })

  test("keeps the cooldowns in memory when the temporary file cannot be written", () => {
    const dir = dirs.make()
    const file = join(dir, "cooldowns.json")
    const problems: string[] = []
    const cooldowns = createCooldowns({ file, now: fakeClock().now, onProblem: (text) => problems.push(text) })
    mkdirSync(`${file}.${process.pid}.tmp`)
    cooldowns.cool(MODEL, START_MS + 1_000)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toStartWith("cooldowns not saved: ")
    expect(existsSync(file)).toBe(false)
    expect(cooldowns.until(MODEL)).toBe(START_MS + 1_000)
  })
})
