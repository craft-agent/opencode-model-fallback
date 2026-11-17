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

  test("gives every feature one shared queue of once-only notices", async () => {
    const { ctx } = fakeContext()
    const seen: unknown[] = []
    await startFeatures(ctx, [
      feature("a", [], { register: async (_ctx, api) => void api.notices.add("[from a]") }),
      feature("b", [], {
        async register(_ctx, api) {
          seen.push(api.notices)
          api.notices.add("[from b]")
        },
      }),
    ])
    const queue = seen[0] as { take(): string[] }
    expect(queue.take()).toEqual(["[from a]", "[from b]"])
    expect(queue.take()).toEqual([])
  })

  test("names each feature that stayed off in the once-only notices, after the features started", async () => {
    const { ctx } = fakeContext({ omit: ["session.switchModel"] })
    let queue: { take(): string[] } | undefined
    await startFeatures(ctx, [
      feature("moves", [], { calls: ["session.switchModel"] }),
      feature("broken", [], {
        async register() {
          throw new Error("boom")
        },
      }),
      feature("fine", [], {
        async register(_ctx, api) {
          queue = api.notices
          api.notices.add("[own]")
        },
      }),
    ])
    expect(queue!.take()).toEqual([
      "[own]",
      "[Model fallback: moves is off: session.switchModel is not available]",
      "[Model fallback: broken is off: boom]",
    ])
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
