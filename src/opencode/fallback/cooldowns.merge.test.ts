import { afterEach, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createCooldowns } from "./cooldowns"
import { fakeClock, START_MS, tempDirs } from "./cooldowns.testing"

const A = { providerID: "a", id: "x" }
const B = { providerID: "b", id: "y" }
const dirs = tempDirs()
afterEach(() => dirs.cleanup())

/** Two stores, each over its own fake clock, on one file: two processes sharing a state directory. */
function twoStores() {
  const dir = dirs.make()
  const file = join(dir, "cooldowns.json")
  const clocks = [fakeClock(), fakeClock()] as const
  const [first, second] = clocks.map((clock) => createCooldowns({ file, now: clock.now }))
  return { dir, file, clocks, first: first!, second: second! }
}

const saved = (file: string) => JSON.parse(readFileSync(file, "utf8")).cooldowns

describe("cooldowns shared by two stores", () => {
  test("a save keeps what the other store recorded, in the file and in memory", () => {
    const { file, first, second } = twoStores()
    first.cool(A, START_MS + 1_000)
    second.cool(B, START_MS + 2_000)
    expect(saved(file)).toEqual({ "a/x": START_MS + 1_000, "b/y": START_MS + 2_000 })
    expect(second.until(A)).toBe(START_MS + 1_000)
    expect(second.until(B)).toBe(START_MS + 2_000)
  })

  test("a store sees the other's cooldown once it next saves, not before", () => {
    const { first, second } = twoStores()
    second.cool(B, START_MS + 2_000)
    expect(first.until(B)).toBeUndefined()
    first.cool(A, START_MS + 1_000)
    expect(first.until(B)).toBe(START_MS + 2_000)
  })

  test("the later end wins across stores, whichever store records it", () => {
    const { file, first, second } = twoStores()
    first.cool(A, START_MS + 1_000)
    second.cool(A, START_MS + 3_000)
    expect(saved(file)).toEqual({ "a/x": START_MS + 3_000 })
    first.cool(A, START_MS + 2_000)
    expect(first.until(A)).toBe(START_MS + 3_000)
    expect(saved(file)).toEqual({ "a/x": START_MS + 3_000 })
    first.cool(A, START_MS + 4_000)
    expect(second.until(A)).toBe(START_MS + 3_000)
    second.cool(B, START_MS + 1_500)
    expect(second.until(A)).toBe(START_MS + 4_000)
    expect(saved(file)).toEqual({ "a/x": START_MS + 4_000, "b/y": START_MS + 1_500 })
  })

  test("an end that has passed on the saving store's clock is dropped from the merge", () => {
    const { file, clocks, first, second } = twoStores()
    first.cool(A, START_MS + 1_000)
    clocks[1].advance(2_000)
    second.cool(B, START_MS + 5_000)
    expect(saved(file)).toEqual({ "b/y": START_MS + 5_000 })
    expect(second.until(A)).toBeUndefined()
  })

  test("a file the other store left unreadable is set aside at a save, and the save goes on", () => {
    const { dir, file, first, second } = twoStores()
    first.cool(A, START_MS + 1_000)
    writeFileSync(file, "{ broken")
    second.cool(B, START_MS + 2_000)
    expect(readFileSync(join(dir, "cooldowns.json.unreadable"), "utf8")).toBe("{ broken")
    expect(saved(file)).toEqual({ "b/y": START_MS + 2_000 })
    expect(readdirSync(dir).sort()).toEqual(["cooldowns.json", "cooldowns.json.unreadable"])
  })
})
