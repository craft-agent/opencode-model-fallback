import { describe, expect, test } from "bun:test"
import { START_MS } from "./cooldowns.testing"
import { CHILD, FIRST, SESSION_ID, startMoves } from "./moves.testing"
import { LIMITS } from "./limits"
import { MOVES } from "./moves"
import { MOVES_KEY, readMoves } from "./moves.record"
import { catalogModel } from "./testing"

const B = { providerID: "b", id: "y" }
const C = { providerID: "c", id: "z" }
const MOVED = { retry: true, delay: 0 }
const HOUR_MS = 3_600_000
/** An error the package's own rule does not take for a limit. */
const AUTH = { type: "provider.auth", status: 401, message: "bad key" }
const WAITING = { retry: true as const, delay: 60_000 }

/** The questions of one method that were put over the fake's RPC. */
function asked(rpcCalls: { method: string; input: unknown }[], method: string) {
  return rpcCalls.filter((call) => call.method === method).map((call) => call.input)
}

describe("moves with a consumer's say on steps", () => {
  test("passes over a step the consumer refuses", async () => {
    const { retry, switches, rpcCalls } = await startMoves({
      rpc: { usable: (input) => ({ usable: (input as { model: string }).model !== "b/y" }) },
    })
    expect((await retry()).decision).toEqual(MOVED)
    expect(switches).toEqual([{ sessionID: SESSION_ID, model: C }])
    expect(asked(rpcCalls, "usable")).toEqual([
      { agent: "worker", model: "b/y" },
      { agent: "worker", model: "c/z" },
    ])
  })

  test("asks only the steps after the place, that passed the own checks, up to the first usable", async () => {
    const { retry, rpcCalls } = await startMoves({
      catalog: [catalogModel(FIRST), catalogModel(C)],
      rpc: { usable: () => ({ usable: true }) },
    })
    await retry()
    expect(asked(rpcCalls, "usable")).toEqual([{ agent: "worker", model: "c/z" }])
  })

  test("stops a child when the consumer refuses every step left", async () => {
    const { retry, switches, sessions } = await startMoves({
      sessions: { [SESSION_ID]: CHILD },
      rpc: { usable: () => ({ usable: false, reason: "gone" }) },
    })
    expect((await retry()).decision).toEqual({ retry: false })
    expect(switches).toEqual([])
    expect(readMoves(sessions[SESSION_ID]!.metadata)[0]).toMatchObject({
      to: null,
      reason: "a/x hit a quota limit; no usable step left",
    })
  })

  test("leaves a primary agent to OpenCode when the consumer refuses every step left", async () => {
    const { retry, switches } = await startMoves({ rpc: { usable: () => ({ usable: false }) } })
    const event = await retry({ decision: WAITING })
    expect(event.decision).toEqual(WAITING)
    expect(switches).toEqual([])
  })

  test.each([
    ["nobody answering", undefined],
    ["a consumer that throws", { usable: () => Promise.reject(new Error("down")) }],
    ["a consumer that answers off the schema", { usable: () => 3 }],
  ])("moves as it did alone with %s", async (_name, rpc) => {
    const { retry, switches } = await startMoves({ rpc })
    expect((await retry()).decision).toEqual(MOVED)
    expect(switches).toEqual([{ sessionID: SESSION_ID, model: B }])
  })
})

describe("a limit a consumer names", () => {
  const limited = { limit: () => ({ limit: true, wait_ms: 30_000, reason: "balance is empty" }) }

  test("cools the model for the consumer's wait and moves the session, saying why", async () => {
    const { retry, switches, cooling, sessions, rpcCalls } = await startMoves({
      rpc: limited,
      sessions: { [SESSION_ID]: { metadata: { owner: "me" } } },
    })
    const event = await retry({ error: AUTH, decision: WAITING })
    expect(event.decision).toEqual(MOVED)
    expect(switches).toEqual([{ sessionID: SESSION_ID, model: B }])
    expect(cooling(FIRST)).toBe(START_MS + 30_000)
    expect(readMoves(sessions[SESSION_ID]!.metadata)).toEqual([
      { from: "a/x", to: "b/y", reason: "a/x hit a limit: balance is empty", at: new Date(START_MS).toISOString() },
    ])
    expect(sessions[SESSION_ID]!.metadata).toMatchObject({ owner: "me", [MOVES_KEY]: expect.any(Array) })
    expect(asked(rpcCalls, "limit")).toEqual([
      {
        agent: "worker",
        model: "a/x",
        error: { type: "provider.auth", status: 401, message: "bad key" },
        wait_ms: 60_000,
      },
    ])
  })

  test("says only that the model hit a limit when the consumer gives no reason", async () => {
    const { retry, sessions } = await startMoves({ rpc: { limit: () => ({ limit: true }) } })
    await retry({ error: AUTH })
    expect(readMoves(sessions[SESSION_ID]!.metadata)[0]!.reason).toBe("a/x hit a limit")
  })

  test("cools for cooldown_ms when the consumer names no wait, or none above zero", async () => {
    for (const answer of [{ limit: true }, { limit: true, wait_ms: 0 }]) {
      const { retry, cooling } = await startMoves({ rpc: { limit: () => answer }, options: { cooldown_ms: 5_000 } })
      await retry({ error: AUTH })
      expect(cooling(FIRST)).toBe(START_MS + 5_000)
    }
    const { retry, cooling } = await startMoves({ rpc: { limit: () => ({ limit: true }) } })
    await retry({ error: AUTH })
    expect(cooling(FIRST)).toBe(START_MS + HOUR_MS)
  })

  test("sends no wait when OpenCode will not retry", async () => {
    const { retry, rpcCalls } = await startMoves({ rpc: limited })
    await retry({ error: AUTH })
    expect(asked(rpcCalls, "limit")[0]).not.toHaveProperty("wait_ms")
  })

  test("does nothing when the consumer says it is no limit", async () => {
    const { retry, switches, cooling, updates } = await startMoves({ rpc: { limit: () => ({ limit: false }) } })
    const event = await retry({ error: AUTH, decision: WAITING })
    expect(event.decision).toEqual(WAITING)
    expect(switches).toEqual([])
    expect(cooling(FIRST)).toBeUndefined()
    expect(updates).toEqual([])
  })

  test.each([
    ["nobody answering", undefined],
    ["a consumer that throws", { limit: () => Promise.reject(new Error("down")) }],
    ["a consumer that answers off the schema", { limit: () => ({ limit: "yes" }) }],
  ])("does nothing with %s", async (_name, rpc) => {
    const { retry, switches, cooling } = await startMoves({ rpc })
    expect((await retry({ error: AUTH, decision: WAITING })).decision).toEqual(WAITING)
    expect(switches).toEqual([])
    expect(cooling(FIRST)).toBeUndefined()
  })

  test("is not asked about a limit the package's own rule found", async () => {
    const { retry, rpcCalls, cooling } = await startMoves({ rpc: { limit: () => ({ limit: false }) } })
    await retry()
    await retry({ error: { type: "provider.rate-limit", message: "slow" }, decision: WAITING })
    expect(asked(rpcCalls, "limit")).toEqual([])
    expect(cooling(FIRST)).toBeDefined()
  })

  test.each([
    ["limits first", [LIMITS, MOVES]],
    ["moves first", [MOVES, LIMITS]],
    ["moves alone", [MOVES]],
    ["limits alone", [LIMITS]],
  ])("is asked once per event, whichever handler is first: %s", async (_name, features) => {
    const { retry, rpcCalls, cooling } = await startMoves({ features, rpc: limited })
    await retry({ error: AUTH, decision: WAITING })
    expect(asked(rpcCalls, "limit")).toHaveLength(1)
    expect(asked(rpcCalls, "limit")[0]).toMatchObject({ wait_ms: 60_000 })
    expect(cooling(FIRST)).toBe(START_MS + 30_000)
  })

  test("is asked of each event on its own", async () => {
    const { retry, rpcCalls } = await startMoves({ rpc: limited })
    await retry({ error: AUTH })
    await retry({ error: AUTH })
    expect(asked(rpcCalls, "limit")).toHaveLength(2)
  })
})
