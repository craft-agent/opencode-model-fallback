import { describe, expect, test } from "bun:test"
import { readLimit, type RetryEvent } from "./limit"

const MAX_WAIT_MS = 10_000

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
