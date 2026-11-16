import { describe, expect, test } from "bun:test"
import { composeSetup } from "./compose"
import plugin from "./index"
import { fakeContext } from "./fallback/testing"
import type { Feature } from "./fallback/feature"
import { setupFallback } from "./fallback/setup"
import { ADD_ID, FAILING_ID, LABEL_ID, PROFILE, READ_ID, fixtureSpecs } from "./testing"
import { createV2Setup } from "./v2"

const FEATURE: Feature = {
  name: "retry-watch",
  calls: [],
  hooks: ["retry"],
  register: (_ctx, api) => api.hook("retry", () => {}),
}

const starter = () => createV2Setup(fixtureSpecs([]), { env: {}, profile: PROFILE })

describe("the plugin", () => {
  test("registers no hook with nothing configured, and hands back a cleanup", async () => {
    const { ctx, hooks } = fakeContext()
    const cleanup = await plugin.setup(ctx)
    expect(typeof cleanup).toBe("function")
    await (cleanup as () => Promise<void>)()
    expect(hooks).toEqual([])
  })
})

describe("composeSetup", () => {
  test("keeps the starter's tools and adds the fallback's hooks, which the cleanup takes back", async () => {
    const { ctx, tools, hooks, disposed } = fakeContext()
    const cleanup = await composeSetup(starter(), (fallbackCtx) => setupFallback(fallbackCtx, [FEATURE]))(ctx)
    expect([...tools.keys()]).toEqual([READ_ID, ADD_ID, LABEL_ID, FAILING_ID])
    expect(hooks.map((hook) => hook.name)).toEqual(["retry"])
    await (cleanup as () => Promise<void>)()
    expect(disposed).toEqual(["retry"])
  })

  test("a fallback setup that throws does not stop the tools", async () => {
    const { ctx, tools } = fakeContext()
    const cleanup = await composeSetup(starter(), async () => {
      throw new Error("bug")
    })(ctx)
    expect([...tools.keys()]).toEqual([READ_ID, ADD_ID, LABEL_ID, FAILING_ID])
    await (cleanup as () => Promise<void>)()
  })

  test("below the minimum version only the starter's tools register", async () => {
    const { ctx, tools, hooks } = fakeContext({ version: "2.1.1" })
    await composeSetup(starter(), (fallbackCtx) => setupFallback(fallbackCtx, [FEATURE]))(ctx)
    expect([...tools.keys()]).toHaveLength(4)
    expect(hooks).toEqual([])
  })

  test("runs the starter's own cleanup after the fallback's, even when that one throws", async () => {
    const { ctx } = fakeContext()
    const events: string[] = []
    const cleanup = await composeSetup(
      async () => async () => void events.push("starter"),
      async () => ({
        running: [],
        unavailable: [],
        dispose: async () => {
          events.push("fallback")
          throw new Error("gone")
        },
      }),
    )(ctx)
    await expect((cleanup as () => Promise<void>)()).rejects.toThrow("gone")
    expect(events).toEqual(["fallback", "starter"])
  })

  test("a starter that throws still fails the setup, as before", async () => {
    const { ctx } = fakeContext()
    await expect(
      composeSetup(async () => {
        throw new Error("bad settings")
      })(ctx),
    ).rejects.toThrow("bad settings")
  })
})
