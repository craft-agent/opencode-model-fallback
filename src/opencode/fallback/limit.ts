import type { V2SessionHooks } from "../types"

/** The event of the `retry` hook: OpenCode's error for a failed model request and its own decision on retrying it. */
export type RetryEvent = V2SessionHooks["retry"]

/** A limit a retry event shows; `waitMs` is the wait OpenCode reported, when it reported one. */
export type Limit = { waitMs?: number }

const QUOTA_ERROR = "provider.quota"
const RATE_LIMIT_ERROR = "provider.rate-limit"
const TOO_MANY_REQUESTS = 429

/** The wait OpenCode's decision reports: a finite positive delay of a decision to retry, else `undefined`. */
function reportedDelay(event: RetryEvent): number | undefined {
  const decision = event.decision as Partial<{ retry: boolean; delay: unknown }> | undefined
  const delay = decision?.retry === true ? decision.delay : undefined
  return typeof delay === "number" && Number.isFinite(delay) && delay > 0 ? delay : undefined
}

/**
 * Whether a retry event is a limit, a refusal that waiting or another model
 * would avoid. A quota error always is. A rate limit (its type, or status 429)
 * is one only when OpenCode will retry it after a wait longer than
 * `maxWaitMs`: a shorter wait is OpenCode's to sit out. Any other error,
 * authentication failures included, is not. The limit carries the wait
 * OpenCode reported when it decided to retry.
 */
export function readLimit(event: RetryEvent, maxWaitMs: number): Limit | undefined {
  const type = event.error?.type
  const delay = reportedDelay(event)
  if (type === QUOTA_ERROR) return delay === undefined ? {} : { waitMs: delay }
  const rateLimited = type === RATE_LIMIT_ERROR || event.error?.status === TOO_MANY_REQUESTS
  return rateLimited && delay !== undefined && delay > maxWaitMs ? { waitMs: delay } : undefined
}
