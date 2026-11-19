import { describe, expect, test } from "bun:test"
import { fakeClock, START_MS } from "./cooldowns.testing"
import { EVENTS } from "./events"
import { startFeatures } from "./feature"
import { AGENT, ROUTES } from "./launch.testing"
import { LIMITS } from "./limits"
import { MOVES } from "./moves"
import { CHILD, FIRST, SESSION_ID, retryEvent, startMoves } from "./moves.testing"
import { LIMITS_RPC } from "./rpc"
import { FEATURES, setupFallback } from "./setup"
import { fakeContext } from "./testing"

const HOUR_MS = 3_600_000
const WAIT_MS = 90_000
const ISO = (ms: number) => new Date(ms).toISOString()

describe("events", () => {
  test("registers LIMITS_RPC with no handlers when routes are configured", async () => {
    const host = await startMoves({ features: [EVENTS, LIMITS] })
    expect(host.running).toEqual(["events", "limits"])
    expect(host.registered).toEqual([{ definition: LIMITS_RPC, handlers: {} }])
  })

  test("registers nothing with no routes configured", async () => {
    const host = fakeContext()
    const setup = await setupFallback(host.ctx, FEATURES, { env: { HOME: "/home/tester" }, persist: false })
    expect(setup.running).toContain("events")
    expect(host.registered).toEqual([])
  })

  test("is off, and says so once, when the host cannot register an RPC; the others run", async () => {
    const host = fakeContext({ omit: ["rpc.register"], options: { routes: { worker: ["a/x"] } } })
    const setup = await setupFallback(host.ctx, [EVENTS, LIMITS], { env: { HOME: "/home/tester" }, persist: false })
    expect(setup.running).toEqual(["limits"])
    expect(setup.unavailable).toEqual([{ name: "events", reason: "rpc.register is not available" }])
  })

  test("is off, with its reason, when the registration throws", async () => {
    const host = fakeContext({ options: { routes: { worker: ["a/x"] } } })
    host.ctx.rpc!.register = async () => {
      throw new Error("taken")
    }
    const setup = await setupFallback(host.ctx, [EVENTS, LIMITS], { env: { HOME: "/home/tester" }, persist: false })
    expect(setup.running).toEqual(["limits"])
    expect(setup.unavailable).toEqual([{ name: "events", reason: "taken" }])
  })
})

describe("a limited event", () => {
  test("is emitted once for a quota event, after the cooldown, with its fields", async () => {
    const host = await startMoves({ features: [EVENTS, LIMITS], sessions: { [SESSION_ID]: CHILD } })
    await host.retry()
    expect(host.emits).toEqual([
      {
        name: "limited",
        data: {
          session_id: SESSION_ID,
          agent: AGENT,
          model: "a/x",
          kind: "quota",
          until: ISO(START_MS + HOUR_MS),
        },
      },
    ])
  })

  test("carries the wait of the limit and the model's variant", async () => {
    const host = await startMoves({ features: [EVENTS, LIMITS] })
    await host.retry({
      model: { providerID: "a", id: "x", variant: "high" },
      decision: { retry: true, delay: WAIT_MS },
    })
    expect(host.emits).toEqual([
      {
        name: "limited",
        data: {
          session_id: SESSION_ID,
          agent: AGENT,
          model: "a/x#high",
          kind: "quota",
          until: ISO(START_MS + WAIT_MS),
          wait_ms: WAIT_MS,
        },
      },
    ])
  })

  test("names no agent as empty, and a consumer's limit with its reason", async () => {
    const host = await startMoves({
      features: [EVENTS, LIMITS],
      rpc: { limit: () => ({ limit: true, wait_ms: 5_000, reason: "balance is empty" }) },
    })
    await host.retry({
      agent: undefined,
      error: { type: "provider.other", message: "no funds" },
    })
    expect(host.emits).toEqual([
      {
        name: "limited",
        data: {
          session_id: SESSION_ID,
          agent: "",
          model: "a/x",
          kind: "consumer",
          until: ISO(START_MS + 5_000),
          wait_ms: 5_000,
          reason: "balance is empty",
        },
      },
    ])
  })

  test("is not emitted for an error that is no limit", async () => {
    const host = await startMoves({ features: [EVENTS, LIMITS] })
    await host.retry({ error: { type: "provider.auth", message: "bad key" } })
    expect(host.emits).toEqual([])
  })

  test("is emitted once when limits and moves both see the event", async () => {
    const host = await startMoves({ features: [EVENTS, LIMITS, MOVES] })
    await host.retry()
    expect(host.emits).toHaveLength(1)
  })

  test.each([
    ["rejects", () => Promise.reject(new Error("no listener"))],
    [
      "throws",
      () => {
        throw new Error("host down")
      },
    ],
  ])("leaves the retry as it was when the emit %s", async (_name, emit) => {
    const host = await startMoves({ features: [EVENTS, LIMITS, MOVES], emit })
    const decision = { retry: true as const, delay: 7_000 }
    const event = await host.retry({ decision })
    expect(host.emits).toHaveLength(1)
    expect(event.decision).toEqual({ retry: true, delay: 0 })
    expect(host.cooling({ providerID: "a", id: "x" })).toBe(START_MS + 7_000)
  })

  test("leaves the cooldown as it was when the emit throws before it returns a promise", async () => {
    const host = fakeContext({ options: { routes: ROUTES } })
    host.ctx.rpc!.register = async () => ({
      async dispose() {},
      events: {
        emit(): Promise<void> {
          throw new Error("sync")
        },
      },
    })
    const reader = { cooling: () => undefined as number | undefined }
    await startFeatures(
      host.ctx,
      [
        EVENTS,
        LIMITS,
        {
          name: "reader",
          calls: [],
          hooks: [],
          async register(_ctx, api) {
            reader.cooling = () => api.state.cooldowns.until(FIRST)
          },
        },
      ],
      { now: fakeClock().now, env: { HOME: "/home/tester" }, persist: false },
    )
    await expect(host.fire("retry", retryEvent())).resolves.toBeUndefined()
    expect(reader.cooling()).toBe(START_MS + HOUR_MS)
  })
})
