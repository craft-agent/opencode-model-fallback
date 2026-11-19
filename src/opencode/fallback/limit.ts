import type { V2ModelRef, V2SessionHooks } from "../types"
import { withoutDefaultVariant } from "./routes"

/** The event of the `retry` hook: OpenCode's error for a failed model request and its own decision on retrying it. */
export type RetryEvent = V2SessionHooks["retry"]

/** The model of a retry event with OpenCode's `default` variant read as none; the event itself is left as it is. */
export function eventModel(event: RetryEvent): V2ModelRef {
  return withoutDefaultVariant(event.model)
}

/**
 * A limit a retry event shows: a `quota` or a `rate` limit by the package's own
 * rule, or one a `consumer`'s plugin named, with its `reason`. `waitMs` is the
 * wait it is judged and cooled by (for a rate limit, the provider's, else the
 * decision's; for a quota error, the provider's when positive, else the
 * decision's; for a consumer's, the wait it asked for), when there is one.
 */
export type Limit = { kind: "quota" | "rate" | "consumer"; waitMs?: number; reason?: string }

const QUOTA_ERROR = "provider.quota"
const RATE_LIMIT_ERROR = "provider.rate-limit"
const TOO_MANY_REQUESTS = 429

/**
 * The last `attempt` of a retry event whose wait is still OpenCode's to sit out
 * when the provider named none. The event's `attempt` is the one about to run,
 * so the first retry is attempt 2, and the first three retries end at attempt 4.
 */
const LAST_OWN_WAIT_ATTEMPT = 4

/** The wait OpenCode's decision reports: a finite positive delay of a decision to retry, else `undefined`. */
export function reportedDelay(event: RetryEvent): number | undefined {
  const decision = event.decision as Partial<{ retry: boolean; delay: unknown }> | undefined
  const delay = decision?.retry === true ? decision.delay : undefined
  return typeof delay === "number" && Number.isFinite(delay) && delay > 0 ? delay : undefined
}

/** The wait the provider asked for: a finite, non-negative `retryAfterMs` of the error, else `undefined`. No hook changes it. */
export function providerWait(event: RetryEvent): number | undefined {
  const wait = event.error?.retryAfterMs
  return typeof wait === "number" && Number.isFinite(wait) && wait >= 0 ? wait : undefined
}

/** Whether a retry event's error is a rate limit: its type, or status 429. */
export function isRateLimit(event: RetryEvent): boolean {
  return event.error?.type === RATE_LIMIT_ERROR || event.error?.status === TOO_MANY_REQUESTS
}

/** The limit of a rate limit that names no wait, from the decision as it stands: its delay when that is over `maxWaitMs`. */
function rateLimitByDecision(event: RetryEvent, maxWaitMs: number): Limit | undefined {
  const attempt = event.attempt
  if (typeof attempt === "number" && attempt <= LAST_OWN_WAIT_ATTEMPT) return undefined
  const delay = reportedDelay(event)
  return delay !== undefined && delay > maxWaitMs ? { kind: "rate", waitMs: delay } : undefined
}

/**
 * Whether a retry event is a limit, a refusal that waiting or another model
 * would avoid. A quota error always is; its wait is the one the provider asked
 * for when that is positive, else the decision's. A rate limit (its type, or
 * status 429) is judged by the provider's own wait, which no hook changes: it
 * is a limit exactly when that wait is longer than `maxWaitMs`, whatever the
 * decision says. A rate limit that names no wait is OpenCode's to sit out for
 * its first three retries (see `LAST_OWN_WAIT_ATTEMPT`); after them, or with
 * no attempt reported, it is a limit when the decision retries after a wait
 * longer than `maxWaitMs`. Any other error, authentication failures included,
 * is not.
 */
export function readLimit(event: RetryEvent, maxWaitMs: number): Limit | undefined {
  const retryAfter = providerWait(event)
  if (event.error?.type === QUOTA_ERROR) {
    const waitMs = retryAfter !== undefined && retryAfter > 0 ? retryAfter : reportedDelay(event)
    return waitMs === undefined ? { kind: "quota" } : { kind: "quota", waitMs }
  }
  if (!isRateLimit(event)) return undefined
  if (retryAfter === undefined) return rateLimitByDecision(event, maxWaitMs)
  return retryAfter > maxWaitMs ? { kind: "rate", waitMs: retryAfter } : undefined
}
