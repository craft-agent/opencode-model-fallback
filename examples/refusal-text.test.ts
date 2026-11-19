import { describe, expect, test } from "bun:test"
import { fakeCtx, mockRpcModule, signal, validates } from "./fake-ctx"

mockRpcModule()
const specifier = "./refusal-text.js"
const { default: plugin } = await import(specifier)

async function setup(options: Record<string, unknown> = {}) {
  const fake = fakeCtx(options)
  const cleanup = await plugin.setup(fake.ctx)
  const limit = (error: Record<string, unknown>) => fake.askLimit({ type: "api", ...error })
  return { fake, cleanup, limit }
}

describe("refusal-text", () => {
  test("the built-in pattern turns minutes into wait_ms, in the message or the body", async () => {
    const { limit } = await setup()
    const fromMessage = await limit({ message: "Quota exhausted, retry in 5 minutes" })
    expect(fromMessage).toMatchObject({ limit: true, wait_ms: 300_000 })
    expect(validates("limit", fromMessage)).toBe(true)
    const fromBody = await limit({ message: "refused", body: '{"error":"quota exhausted. Try again in 1 minute"}' })
    expect(fromBody).toMatchObject({ limit: true, wait_ms: 60_000 })
  })

  test("other errors are not limits", async () => {
    const { limit } = await setup()
    const answer = await limit({ message: "bad request", body: "nope" })
    expect(answer).toEqual({ limit: false })
    expect(validates("limit", answer)).toBe(true)
  })

  test("configured patterns use their own wait_ms, or none", async () => {
    const { limit } = await setup({ patterns: [{ match: "balance is empty", wait_ms: 1000 }, { match: "try later" }] })
    expect(await limit({ message: "Balance is EMPTY" })).toMatchObject({ limit: true, wait_ms: 1000 })
    const noWait = await limit({ message: "x", body: "please try later" })
    expect(noWait).toMatchObject({ limit: true })
    expect(noWait).not.toHaveProperty("wait_ms")
    expect(validates("limit", noWait)).toBe(true)
  })

  test("usable is always true, and cleanup disposes", async () => {
    const { fake, cleanup } = await setup()
    const answer = await fake.state.handlers.usable({ agent: "a", model: "provider-a/m" }, { signal })
    expect(answer).toEqual({ usable: true })
    expect(validates("usable", answer)).toBe(true)
    await cleanup()
    expect(fake.state.disposed).toBe(true)
  })
})
