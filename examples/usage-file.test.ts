import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fakeCtx, future, mockRpcModule, past, signal, validates } from "./fake-ctx"

mockRpcModule()
const specifier = "./usage-file.js"
const { default: plugin } = await import(specifier)

let dir: string
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "usage-file-"))
})
afterAll(() => rm(dir, { recursive: true, force: true }))

async function setup(usage: unknown | undefined) {
  const file = join(dir, `${Math.random()}.json`)
  if (usage !== undefined) await writeFile(file, JSON.stringify(usage))
  const fake = fakeCtx({ file })
  const cleanup = await plugin.setup(fake.ctx)
  return { fake, cleanup }
}

describe("usage-file", () => {
  test("a spent provider with a reset ahead is unusable, naming the reset", async () => {
    const { fake } = await setup({ "provider-a": { left: 0, resets_at: future } })
    const answer = await fake.state.handlers.usable({ agent: "a", model: "provider-a/model-x#high" }, { signal })
    expect(answer.usable).toBe(false)
    expect(answer.reason).toContain(future)
    expect(validates("usable", answer)).toBe(true)
  })

  test("other providers, remaining usage and ended resets are usable", async () => {
    const { fake } = await setup({
      "provider-a": { left: 0, resets_at: past },
      "provider-b": { left: 0, resets_at: future },
      "provider-c": { left: 5, resets_at: future },
    })
    for (const model of ["provider-a/m", "provider-c/m", "provider-d/m"]) {
      const answer = await fake.state.handlers.usable({ agent: "a", model }, { signal })
      expect(answer).toEqual({ usable: true })
      expect(validates("usable", answer)).toBe(true)
    }
  })

  test("an unreadable file is usable", async () => {
    const { fake } = await setup(undefined)
    expect(await fake.state.handlers.usable({ agent: "a", model: "provider-a/m" }, { signal })).toEqual({
      usable: true,
    })
  })

  test("limit is never a limit, and cleanup disposes", async () => {
    const { fake, cleanup } = await setup({})
    const answer = await fake.askLimit()
    expect(answer).toEqual({ limit: false })
    expect(validates("limit", answer)).toBe(true)
    await cleanup()
    expect(fake.state.disposed).toBe(true)
  })
})
