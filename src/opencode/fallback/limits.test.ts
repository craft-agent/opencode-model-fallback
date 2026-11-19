import { describe, expect, test } from "bun:test"
import { startFeatures } from "./feature"
import { fakeClock, START_MS } from "./cooldowns.testing"
import type { RetryEvent } from "./limit"
import { LIMITS } from "./limits"
import { fakeContext, type FakeOptions } from "./testing"

const HOUR_MS = 3_600_000
const MODEL = { providerID: "a", id: "x", variant: "high" }

/** A retry event for `MODEL`; `error` and `decision` replace those of a quota error OpenCode will not retry. */
function retryEvent(overrides: Partial<Pick<RetryEvent, "error" | "decision" | "model">> = {}): RetryEvent {
  return {
    sessionID: "ses_1",
    model: MODEL,
    error: { type: "provider.quota", message: "out of quota" },
    decision: { retry: false },
    ...overrides,
  }
}

/** Starts the limits feature on a fake host with `options`, over a fake clock and no state file. */
async function start(options: FakeOptions["options"] = { routes: { worker: ["a/x"] } }, fake: FakeOptions = {}) {
  const clock = fakeClock()
  const host = fakeContext({ ...fake, options })
  const started = await startFeatures(host.ctx, [LIMITS], {
    now: clock.now,
    env: { HOME: "/home/tester" },
    persist: false,
  })
  return { ...host, ...started, clock }
}

describe("limits", () => {
  test("registers nothing with no routes configured", async () => {
    const { hooks, running } = await start({})
    expect(running).toEqual(["limits"])
    expect(hooks).toEqual([])
  })

  test("takes the retry hook when routes are configured", async () => {
    const { hooks, running } = await start()
    expect(running).toEqual(["limits"])
    expect(hooks.map((hook) => hook.name)).toEqual(["retry"])
  })

  test("is off, and says so, when the host has no hooks", async () => {
    const { running, unavailable } = await start(undefined, { omit: ["session.hook"] })
    expect(running).toEqual([])
    expect(unavailable).toEqual([{ name: "limits", reason: "session.hook is not available" }])
  })
})

describe("limits cooldowns", () => {
  /** What the cooldown store holds for `MODEL` after `event`, through a second feature that reads it. */
  async function coolingAfter(event: RetryEvent, options: FakeOptions["options"] = { routes: { worker: ["a/x"] } }) {
    const clock = fakeClock()
    const host = fakeContext({ options })
    let until: (() => number | undefined) | undefined
    await startFeatures(
      host.ctx,
      [
        LIMITS,
        {
          name: "reader",
          calls: [],
          hooks: [],
          async register(_ctx, api) {
            until = () => api.state.cooldowns.until(MODEL)
          },
        },
      ],
      { now: clock.now, env: { HOME: "/home/tester" }, persist: false },
    )
    await host.fire("retry", event)
    return { until: until!, clock, event }
  }

  test("a quota error with no wait cools the model for cooldown_ms (an hour by default)", async () => {
    expect((await coolingAfter(retryEvent())).until()).toBe(START_MS + HOUR_MS)
    const custom = await coolingAfter(retryEvent(), { routes: { worker: ["a/x"] }, cooldown_ms: 5_000 })
    expect(custom.until()).toBe(START_MS + 5_000)
  })

  test("a limit with a wait cools the model for the wait OpenCode reported", async () => {
    const quota = await coolingAfter(retryEvent({ decision: { retry: true, delay: 90_000 } }))
    expect(quota.until()).toBe(START_MS + 90_000)
    const rateLimit = await coolingAfter(
      retryEvent({
        error: { type: "provider.rate-limit", message: "slow down" },
        decision: { retry: true, delay: 20_000 },
      }),
    )
    expect(rateLimit.until()).toBe(START_MS + 20_000)
  })

  test("a rate limit over max_wait_ms is a limit, and one under it is not", async () => {
    const error = { type: "provider.rate-limit", message: "slow down" }
    const options = { routes: { worker: ["a/x"] }, max_wait_ms: 30_000 }
    expect((await coolingAfter(retryEvent({ error, decision: { retry: true, delay: 30_001 } }), options)).until()).toBe(
      START_MS + 30_001,
    )
    expect((await coolingAfter(retryEvent({ error, decision: { retry: true, delay: 30_000 } }), options)).until()).toBe(
      undefined,
    )
  })

  test("a rate limit is read from the provider's wait, not from a decision another plugin stretched", async () => {
    const stretched = { retry: true as const, delay: 5 * HOUR_MS }
    const error = { type: "provider.rate-limit", message: "slow down", retryAfterMs: 5_000 }
    expect((await coolingAfter(retryEvent({ error, decision: stretched }))).until()).toBeUndefined()
    const long = { ...error, retryAfterMs: HOUR_MS }
    expect((await coolingAfter(retryEvent({ error: long, decision: { retry: false } }))).until()).toBe(
      START_MS + HOUR_MS,
    )
  })

  test("a rate limit that names no wait cools by the decision from its fifth attempt on", async () => {
    const error = { type: "provider.rate-limit", message: "slow down" }
    const decision = { retry: true as const, delay: 5 * HOUR_MS }
    expect((await coolingAfter({ ...retryEvent({ error, decision }), attempt: 4 })).until()).toBeUndefined()
    expect((await coolingAfter({ ...retryEvent({ error, decision }), attempt: 5 })).until()).toBe(
      START_MS + 5 * HOUR_MS,
    )
  })

  test("a quota error cools the model for the provider's wait before the decision's", async () => {
    const error = { type: "provider.quota", message: "out of quota", retryAfterMs: 30_000 }
    expect((await coolingAfter(retryEvent({ error, decision: { retry: true, delay: 90_000 } }))).until()).toBe(
      START_MS + 30_000,
    )
  })

  test("asks a consumer about an error that is not a limit with the provider's wait", async () => {
    const { fire, rpcCalls } = await start(
      { routes: { worker: ["a/x"] } },
      { rpc: { limit: () => ({ limit: false }) } },
    )
    const error = { type: "provider.rate-limit", message: "slow down", retryAfterMs: 5_000 }
    await fire("retry", retryEvent({ error, decision: { retry: true, delay: 5 * HOUR_MS } }))
    expect(rpcCalls[0]!.input).toMatchObject({ wait_ms: 5 * HOUR_MS, retry_after_ms: 5_000 })
  })

  test("an error that is not a limit cools nothing", async () => {
    const error = { type: "provider.auth", status: 401, message: "bad key" }
    expect((await coolingAfter(retryEvent({ error, decision: { retry: true, delay: 60_000 } }))).until()).toBe(
      undefined,
    )
  })

  test("never changes OpenCode's decision", async () => {
    const decision = { retry: true as const, delay: 90_000 }
    const event = retryEvent({ decision })
    const { event: seen } = await coolingAfter(event)
    expect(seen.decision).toBe(decision)
    expect(decision).toEqual({ retry: true, delay: 90_000 })
  })

  test("never throws, whatever the event holds", async () => {
    const { fire } = await start()
    for (const event of [
      retryEvent({ model: undefined as never }),
      retryEvent({ error: undefined as never }),
      retryEvent({ decision: undefined as never }),
      {} as never,
      null as never,
    ]) {
      await expect(fire("retry", event)).resolves.toBeUndefined()
    }
  })
})
