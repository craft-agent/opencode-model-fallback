import { describe, expect, test } from "bun:test"
import { fakeCtx, future, mockRpcModule, past, signal, validates } from "./fake-ctx"

mockRpcModule()
const specifier = "./shared-window.js"
const { default: plugin } = await import(specifier)

const windows = {
  "window-1": ["provider-a/model-x", "provider-a/model-y"],
  "window-2": ["provider-b/*"],
}

async function setup() {
  const fake = fakeCtx({ windows })
  const cleanup = await plugin.setup(fake.ctx)
  const usable = (model: string) => fake.state.handlers.usable({ agent: "a", model }, { signal })
  const limited = (model: string, until: string) =>
    fake.emit("limited", { session_id: "s", agent: "a", model, kind: "quota", until })
  return { fake, cleanup, usable, limited }
}

describe("shared-window", () => {
  test("everything is usable before a limit", async () => {
    const { usable } = await setup()
    expect(await usable("provider-a/model-x")).toEqual({ usable: true })
  })

  test("a limit passes over the steps of its window, unwrapping data and ignoring the variant", async () => {
    const { usable, limited } = await setup()
    limited("provider-a/model-x#high", future)
    const answer = await usable("provider-a/model-y#low")
    expect(answer).toMatchObject({ usable: false })
    expect(answer.reason).toContain("window-1")
    expect(validates("usable", answer)).toBe(true)
    expect(await usable("provider-b/model-z")).toEqual({ usable: true })
    expect(await usable("provider-a/model-other")).toEqual({ usable: true })
  })

  test("* matches every model of the provider", async () => {
    const { usable, limited } = await setup()
    limited("provider-b/anything", future)
    expect(await usable("provider-b/other#v")).toMatchObject({ usable: false })
    expect(await usable("provider-a/model-x")).toEqual({ usable: true })
  })

  test("an ended window is usable again", async () => {
    const { usable, limited } = await setup()
    limited("provider-a/model-x", past)
    expect(await usable("provider-a/model-y")).toEqual({ usable: true })
  })

  test("a bad event does not throw", async () => {
    const { usable, fake } = await setup()
    expect(() => fake.emit("limited", { model: "provider-a/model-x" })).not.toThrow()
    expect(() => fake.emit("limited", undefined)).not.toThrow()
    expect(await usable("provider-a/model-x")).toEqual({ usable: true })
  })

  test("limit is never a limit; cleanup unsubscribes and disposes", async () => {
    const { fake, cleanup } = await setup()
    const answer = await fake.askLimit()
    expect(answer).toEqual({ limit: false })
    expect(validates("limit", answer)).toBe(true)
    expect(fake.listenerCount("limited")).toBe(1)
    await cleanup()
    expect(fake.listenerCount("limited")).toBe(0)
    expect(fake.state.disposed).toBe(true)
  })
})
