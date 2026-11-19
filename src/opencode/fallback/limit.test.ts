import { describe, expect, test } from "bun:test"
import { isRateLimit, providerWait, readLimit, type RetryEvent } from "./limit"

const MAX_WAIT_MS = 10_000
const HOUR_MS = 3_600_000

/** A retry event whose error and decision are `error` and `decision` over a plain 500 and a refusal to retry. */
function retryEvent(
  error: Partial<RetryEvent["error"]>,
  decision: RetryEvent["decision"] = { retry: false },
): RetryEvent {
  return {
    sessionID: "ses_1",
    model: { providerID: "a", id: "x" },
    error: { type: "provider.unknown", message: "failed", ...error },
    decision,
  }
}

describe("readLimit", () => {
  test.each([
    [
      "a quota error with a wait",
      { type: "provider.quota" },
      { retry: true, delay: 60_000 },
      { kind: "quota", waitMs: 60_000 },
    ],
    ["a quota error OpenCode will not retry", { type: "provider.quota" }, { retry: false }, { kind: "quota" }],
    ["a quota error with a wait of none", { type: "provider.quota" }, { retry: true, delay: 0 }, { kind: "quota" }],
    ["a quota error with a status", { type: "provider.quota", status: 402 }, { retry: false }, { kind: "quota" }],
  ] as const)("%s is a limit", (_name, error, decision, expected) => {
    expect(readLimit(retryEvent(error, decision), MAX_WAIT_MS)).toEqual(expected)
  })

  test.each([
    ["a rate limit past the longest wait", { type: "provider.rate-limit" }, 10_001],
    ["a 429 with no type of its own", { type: "provider.unknown", status: 429 }, 3_600_000],
  ] as const)("%s is a limit with OpenCode's wait", (_name, error, delay) => {
    expect(readLimit(retryEvent(error, { retry: true, delay }), MAX_WAIT_MS)).toEqual({ kind: "rate", waitMs: delay })
  })

  test.each([
    ["a rate limit at the longest wait", { type: "provider.rate-limit" }, { retry: true, delay: MAX_WAIT_MS }],
    ["a rate limit under it", { type: "provider.rate-limit" }, { retry: true, delay: 1_000 }],
    ["a rate limit OpenCode will not retry", { type: "provider.rate-limit" }, { retry: false }],
    ["a 429 OpenCode will not retry", { type: "provider.unknown", status: 429 }, { retry: false }],
    ["an overloaded provider", { type: "provider.overloaded", status: 529 }, { retry: true, delay: 60_000 }],
    ["an authentication failure", { type: "provider.auth", status: 401 }, { retry: true, delay: 60_000 }],
    ["a server error", { type: "provider.unknown", status: 500 }, { retry: false }],
  ] as const)("%s is not a limit", (_name, error, decision) => {
    expect(readLimit(retryEvent(error, decision), MAX_WAIT_MS)).toBeUndefined()
  })

  test.each([
    ["with a wait the provider asked for", { retryAfterMs: 90_000 }, { retry: true, delay: 5_000 }, 90_000],
    ["when the provider asked for none", { retryAfterMs: 0 }, { retry: true, delay: 5_000 }, 5_000],
    ["when the provider named no wait", {}, { retry: true, delay: 5_000 }, 5_000],
    ["when the provider asked for a wait and OpenCode will not retry", { retryAfterMs: 7 }, { retry: false }, 7],
  ] as const)("a quota error %s waits for the first that is there", (_name, extra, decision, waitMs) => {
    expect(readLimit(retryEvent({ type: "provider.quota", ...extra }, decision), MAX_WAIT_MS)).toEqual({
      kind: "quota",
      waitMs,
    })
  })

  test("a quota error with no wait from either side has no wait", () => {
    const event = retryEvent({ type: "provider.quota", retryAfterMs: 0 }, { retry: false })
    expect(readLimit(event, MAX_WAIT_MS)).toEqual({ kind: "quota" })
  })
})

describe("readLimit by the provider's wait", () => {
  const rateLimit = { type: "provider.rate-limit" }

  test("a short wait is not a limit, however far another plugin stretched the decision", () => {
    const stretched = { retry: true, delay: 5 * HOUR_MS } as const
    expect(readLimit(retryEvent({ ...rateLimit, retryAfterMs: 5_000 }, stretched), MAX_WAIT_MS)).toBeUndefined()
    expect(readLimit(retryEvent({ type: "x", status: 429, retryAfterMs: 0 }, stretched), MAX_WAIT_MS)).toBeUndefined()
  })

  test("a wait exactly at the longest wait is not a limit, and one past it is", () => {
    expect(readLimit(retryEvent({ ...rateLimit, retryAfterMs: MAX_WAIT_MS }), MAX_WAIT_MS)).toBeUndefined()
    expect(readLimit(retryEvent({ ...rateLimit, retryAfterMs: MAX_WAIT_MS + 1 }), MAX_WAIT_MS)).toEqual({
      kind: "rate",
      waitMs: MAX_WAIT_MS + 1,
    })
  })

  test("a long wait is a limit with that wait, whatever the decision is", () => {
    for (const decision of [{ retry: false }, { retry: true, delay: 1_000 }] as const) {
      const event = { ...retryEvent({ ...rateLimit, retryAfterMs: HOUR_MS }, decision), attempt: 2 }
      expect(readLimit(event, MAX_WAIT_MS)).toEqual({ kind: "rate", waitMs: HOUR_MS })
    }
    const status = retryEvent({ type: "provider.unknown", status: 429, retryAfterMs: HOUR_MS })
    expect(readLimit(status, MAX_WAIT_MS)).toEqual({ kind: "rate", waitMs: HOUR_MS })
  })

  test("a wait that is not a finite non-negative number counts as none", () => {
    for (const retryAfterMs of [Number.NaN, Number.POSITIVE_INFINITY, -1, "5000"]) {
      const event = retryEvent({ ...rateLimit, retryAfterMs } as never, { retry: true, delay: HOUR_MS })
      expect(providerWait(event)).toBeUndefined()
      expect(readLimit(event, MAX_WAIT_MS)).toEqual({ kind: "rate", waitMs: HOUR_MS })
    }
  })

  test("a wait the provider named none of is OpenCode's own for its first three retries", () => {
    for (const attempt of [1, 2, 3, 4]) {
      const event = { ...retryEvent(rateLimit, { retry: true, delay: HOUR_MS }), attempt }
      expect(readLimit(event, MAX_WAIT_MS)).toBeUndefined()
    }
  })

  test("after them, or with no attempt reported, the decision's wait decides", () => {
    const long = retryEvent(rateLimit, { retry: true, delay: HOUR_MS })
    expect(readLimit({ ...long, attempt: 5 }, MAX_WAIT_MS)).toEqual({ kind: "rate", waitMs: HOUR_MS })
    expect(readLimit(long, MAX_WAIT_MS)).toEqual({ kind: "rate", waitMs: HOUR_MS })
    const short = retryEvent(rateLimit, { retry: true, delay: MAX_WAIT_MS })
    expect(readLimit({ ...short, attempt: 5 }, MAX_WAIT_MS)).toBeUndefined()
    expect(readLimit({ ...retryEvent(rateLimit), attempt: 5 }, MAX_WAIT_MS)).toBeUndefined()
  })

  test("names a rate limit by its type or its status, and nothing else", () => {
    expect(isRateLimit(retryEvent(rateLimit))).toBe(true)
    expect(isRateLimit(retryEvent({ type: "provider.unknown", status: 429 }))).toBe(true)
    expect(isRateLimit(retryEvent({ type: "provider.quota" }))).toBe(false)
    expect(isRateLimit(retryEvent({ type: "provider.overloaded", status: 529 }))).toBe(false)
    expect(isRateLimit({} as never)).toBe(false)
  })
})

describe("readLimit's other rules", () => {
  test("reads the longest wait it is given", () => {
    const event = retryEvent({ type: "provider.rate-limit" }, { retry: true, delay: 1_000 })
    expect(readLimit(event, 999)).toEqual({ kind: "rate", waitMs: 1_000 })
    expect(readLimit(event, 1_000)).toBeUndefined()
    expect(readLimit(retryEvent({ type: "provider.rate-limit" }, { retry: true, delay: 1 }), 0)).toEqual({
      kind: "rate",
      waitMs: 1,
    })
  })

  test("ignores a delay that is not a positive number", () => {
    for (const delay of [Number.NaN, Number.POSITIVE_INFINITY, -5, "60000"]) {
      const event = retryEvent({ type: "provider.quota" }, { retry: true, delay } as never)
      const rateLimit = { ...event, error: { ...event.error, type: "provider.rate-limit" } }
      expect(readLimit(event, MAX_WAIT_MS)).toEqual({ kind: "quota" })
      expect(readLimit(rateLimit, MAX_WAIT_MS)).toBeUndefined()
    }
  })

  test("does not throw for an event with no error or decision", () => {
    expect(readLimit({ sessionID: "ses_1", model: { providerID: "a", id: "x" } } as never, MAX_WAIT_MS)).toBeUndefined()
  })
})
