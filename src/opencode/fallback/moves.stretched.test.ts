import { describe, expect, test } from "bun:test"
import { startMoves } from "./moves.testing"

const HOUR_MS = 3_600_000
const SHORT_ERROR = { type: "provider.rate-limit", message: "slow down", retryAfterMs: 5_000 }
const STRETCHED = 5 * HOUR_MS

/** A decision of another plugin's to retry after a long wait: a new object each time. */
function stretched(delay = STRETCHED) {
  return { retry: true as const, delay }
}

describe("a short rate limit whose wait another plugin stretched", () => {
  test("retries after max_wait_ms on a routed step, with no move and no cooldown", async () => {
    const { retry, switches, updates, cooling } = await startMoves()
    const event = await retry({ error: { ...SHORT_ERROR, status: 429 }, decision: stretched() })
    expect(event.decision).toEqual({ retry: true, delay: 10_000 })
    expect(switches).toEqual([])
    expect(updates).toEqual([])
    expect(cooling(event.model)).toBeUndefined()
  })

  test("retries after the configured max_wait_ms", async () => {
    const { retry } = await startMoves({ options: { max_wait_ms: 2_000 } })
    const error = { ...SHORT_ERROR, retryAfterMs: 1_000 }
    expect((await retry({ error, decision: stretched() })).decision).toEqual({ retry: true, delay: 2_000 })
  })

  test("is left alone for an agent with no route", async () => {
    const { retry, switches } = await startMoves()
    const event = await retry({ agent: "other", error: SHORT_ERROR, decision: stretched() })
    expect(event.decision).toEqual(stretched())
    expect(switches).toEqual([])
  })

  test("is left alone for a model off the route", async () => {
    const { retry } = await startMoves()
    const model = { providerID: "z", id: "q" }
    expect((await retry({ model, error: SHORT_ERROR, decision: stretched() })).decision).toEqual(stretched())
  })

  test("is left alone when the decision's wait is within max_wait_ms", async () => {
    const { retry } = await startMoves()
    expect((await retry({ error: SHORT_ERROR, decision: stretched(10_000) })).decision).toEqual(stretched(10_000))
  })

  test("is left alone for an error that is no rate limit", async () => {
    const { retry } = await startMoves()
    const error = { type: "provider.unknown", message: "boom" }
    expect((await retry({ error, decision: stretched() })).decision).toEqual(stretched())
  })

  test("still moves a real limit", async () => {
    const { retry, switches } = await startMoves()
    const error = { ...SHORT_ERROR, retryAfterMs: HOUR_MS }
    expect((await retry({ error, decision: stretched() })).decision).toEqual({ retry: true, delay: 0 })
    expect(switches).toHaveLength(1)
  })
})
