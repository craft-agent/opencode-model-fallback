import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createCooldowns } from "./cooldowns"
import { fakeClock, START_MS, tempDirs } from "./cooldowns.testing"

const MODEL = { providerID: "a", id: "x" }
const TOLD = "cooldowns file unreadable, set aside as cooldowns.json.unreadable"
const dirs = tempDirs()
afterEach(() => dirs.cleanup())

describe("telling an unreadable cooldowns file", () => {
  test("tells it once when the file is set aside at load", () => {
    const file = join(dirs.make(), "cooldowns.json")
    writeFileSync(file, "{ broken")
    const problems: string[] = []
    const cooldowns = createCooldowns({ file, now: fakeClock().now, onProblem: (text) => problems.push(text) })
    expect(problems).toEqual([TOLD])
    cooldowns.cool(MODEL, START_MS + 1_000)
    expect(problems).toEqual([TOLD])
  })

  test("tells it once when the file is set aside at a save, however often it happens", () => {
    const file = join(dirs.make(), "cooldowns.json")
    const problems: string[] = []
    const cooldowns = createCooldowns({ file, now: fakeClock().now, onProblem: (text) => problems.push(text) })
    cooldowns.cool(MODEL, START_MS + 1_000)
    expect(problems).toEqual([])
    writeFileSync(file, "{ broken")
    cooldowns.cool({ providerID: "b", id: "y" }, START_MS + 2_000)
    writeFileSync(file, "[]")
    cooldowns.cool({ providerID: "c", id: "z" }, START_MS + 3_000)
    expect(problems).toEqual([TOLD])
  })

  test("says it was ignored when the file cannot be set aside", () => {
    const file = join(dirs.make(), "cooldowns.json")
    writeFileSync(file, "{ broken")
    // A directory that is not empty where the aside name should go makes the rename fail.
    mkdirSync(`${file}.unreadable`)
    writeFileSync(join(`${file}.unreadable`, "keep"), "")
    const problems: string[] = []
    createCooldowns({ file, now: fakeClock().now, onProblem: (text) => problems.push(text) })
    expect(problems).toEqual(["cooldowns file unreadable, ignored"])
  })

  test("a missing file and a readable one tell nothing", () => {
    const file = join(dirs.make(), "cooldowns.json")
    const problems: string[] = []
    const store = () => createCooldowns({ file, now: fakeClock().now, onProblem: (text) => problems.push(text) })
    store().cool(MODEL, START_MS + 1_000)
    store()
    expect(problems).toEqual([])
  })

  test("is told apart from a failed save, each once", () => {
    const dir = dirs.make()
    const file = join(dir, "cooldowns.json")
    writeFileSync(file, "{ broken")
    const problems: string[] = []
    const cooldowns = createCooldowns({ file, now: fakeClock().now, onProblem: (text) => problems.push(text) })
    mkdirSync(`${file}.${process.pid}.tmp`)
    cooldowns.cool(MODEL, START_MS + 1_000)
    cooldowns.cool({ providerID: "b", id: "y" }, START_MS + 2_000)
    expect(problems).toHaveLength(2)
    expect(problems[0]).toBe(TOLD)
    expect(problems[1]).toStartWith("cooldowns not saved: ")
  })
})
