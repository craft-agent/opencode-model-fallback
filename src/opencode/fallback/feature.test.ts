import { describe, expect, test } from "bun:test"
import type { Feature } from "./feature"
import { startFeatures } from "./feature"
import { fakeContext } from "./testing"

/** A feature that takes the hooks it declares, in order; `over` changes any part of it. */
function feature(name: string, hooks: Feature["hooks"] = [], over: Partial<Feature> = {}): Feature {
  return {
    name,
    calls: [],
    hooks,
    async register(_ctx, api) {
      for (const hook of hooks) await api.hook(hook, () => {})
    },
    ...over,
  }
}

describe("startFeatures", () => {
  test("runs a feature whose calls are all there", async () => {
    const { ctx, hooks } = fakeContext()
    const started = await startFeatures(ctx, [
      feature("moves", ["retry", "context"], {
        calls: ["session.switchModel", "session.update", "tool.transform", "rpc"],
      }),
    ])
    expect(started.running).toEqual(["moves"])
    expect(started.unavailable).toEqual([])
    expect(hooks.map((hook) => hook.name)).toEqual(["retry", "context"])
  })

  test("passes the handler to the host", async () => {
    const { ctx, hooks } = fakeContext()
    const handler = () => {}
    await startFeatures(ctx, [feature("a", ["retry"], { register: (_ctx, api) => api.hook("retry", handler) })])
    expect(hooks[0]!.handler).toBe(handler as never)
  })

  test("keeps a feature off when a call it needs is missing, and names the call", async () => {
    const { ctx, hooks } = fakeContext({ omit: ["session.switchModel"] })
    const started = await startFeatures(ctx, [
      feature("moves", ["retry"], { calls: ["session.update", "session.switchModel"] }),
      feature("launches", ["context"]),
    ])
    expect(started.running).toEqual(["launches"])
    expect(started.unavailable).toEqual([{ name: "moves", reason: "session.switchModel is not available" }])
    expect(hooks.map((hook) => hook.name)).toEqual(["context"])
  })

  test("treats a call that is not a function as missing", async () => {
    const { ctx } = fakeContext()
    ;(ctx as { rpc?: unknown }).rpc = {}
    const started = await startFeatures(ctx, [feature("quota", [], { calls: ["rpc"] })])
    expect(started.unavailable).toEqual([{ name: "quota", reason: "rpc is not available" }])
  })

  test("a feature with hooks needs session.hook", async () => {
    const { ctx } = fakeContext({ omit: ["session.hook"] })
    const started = await startFeatures(ctx, [feature("hooked", ["retry"]), feature("plain")])
    expect(started.running).toEqual(["plain"])
    expect(started.unavailable).toEqual([{ name: "hooked", reason: "session.hook is not available" }])
  })

  test("a rejected hook turns the feature off and disposes what it had taken; the others run", async () => {
    const { ctx, hooks, disposed } = fakeContext({ rejectHooks: ["http.request"] })
    const started = await startFeatures(ctx, [
      feature("first", ["context"]),
      feature("broken", ["retry", "http.request", "compaction"]),
      feature("last", ["generate"]),
    ])
    expect(started.running).toEqual(["first", "last"])
    expect(started.unavailable).toEqual([{ name: "broken", reason: "no such hook: http.request" }])
    expect(hooks.map((hook) => [hook.name, hook.disposed])).toEqual([
      ["context", false],
      ["retry", true],
      ["generate", false],
    ])
    expect(disposed).toEqual(["retry"])
  })

  test("a rejected hook turns the feature off even when the feature swallows it", async () => {
    const { ctx, hooks } = fakeContext({ rejectHooks: ["retry"] })
    const started = await startFeatures(ctx, [
      feature("swallows", ["context", "retry"], {
        async register(_ctx, api) {
          await api.hook("context", () => {})
          await api.hook("retry", () => {}).catch(() => {})
        },
      }),
    ])
    expect(started.running).toEqual([])
    expect(started.unavailable).toEqual([{ name: "swallows", reason: "no such hook: retry" }])
    expect(hooks.map((hook) => hook.disposed)).toEqual([true])
  })

  test("a hook the feature did not declare is refused and never reaches the host", async () => {
    const { ctx, hooks } = fakeContext()
    const started = await startFeatures(ctx, [
      feature("sneaky", ["retry"], { register: (_ctx, api) => api.hook("context", () => {}) }),
    ])
    expect(started.unavailable).toEqual([{ name: "sneaky", reason: "the hook context is not declared" }])
    expect(hooks).toEqual([])
  })

  test("a register that throws turns the feature off and disposes its registrations", async () => {
    const { ctx, hooks } = fakeContext()
    const started = await startFeatures(ctx, [
      feature("throws", ["retry"], {
        async register(_ctx, api) {
          await api.hook("retry", () => {})
          throw new Error("boom")
        },
      }),
      feature("other", ["context"]),
    ])
    expect(started.running).toEqual(["other"])
    expect(started.unavailable).toEqual([{ name: "throws", reason: "boom" }])
    expect(hooks.map((hook) => [hook.name, hook.disposed])).toEqual([
      ["retry", true],
      ["context", false],
    ])
  })

  test("takes back a tracked registration with the feature's hooks, and ignores a host that returns none", async () => {
    const { ctx, hooks } = fakeContext()
    const events: string[] = []
    const started = await startFeatures(ctx, [
      feature("wraps", ["retry"], {
        async register(_ctx, api) {
          await api.hook("retry", () => {})
          api.track({ dispose: async () => void events.push("transform") })
          api.track(undefined)
        },
      }),
    ])
    await started.dispose()
    expect(events).toEqual(["transform"])
    expect(hooks[0]!.disposed).toBe(true)
  })

  test("disposes newest first across features, and a dispose that throws does not stop the others", async () => {
    const { ctx, disposed } = fakeContext()
    const events: string[] = []
    const started = await startFeatures(ctx, [
      feature("a", ["retry", "context"]),
      feature("b", [], {
        async register(_ctx, api) {
          api.track({
            dispose: async () => {
              events.push("b")
              throw new Error("gone")
            },
          })
        },
      }),
      feature("c", ["generate"]),
    ])
    await started.dispose()
    expect(disposed).toEqual(["generate", "context", "retry"])
    expect(events).toEqual(["b"])
    await started.dispose()
    expect(disposed).toEqual(["generate", "context", "retry"])
  })

  test("with no features, runs nothing and disposes nothing", async () => {
    const { ctx, hooks } = fakeContext()
    const started = await startFeatures(ctx, [])
    expect(started.running).toEqual([])
    expect(started.unavailable).toEqual([])
    await started.dispose()
    expect(hooks).toEqual([])
  })
})
