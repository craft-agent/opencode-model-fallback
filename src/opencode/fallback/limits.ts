import type { V2Context } from "../types"
import { askLimit } from "./consumer"
import type { Feature } from "./feature"
import { readLimit, reportedDelay, type Limit, type RetryEvent } from "./limit"
import type { FallbackState } from "./state"

/** The limit each retry event showed when it was first read, `undefined` for an event that showed none; held as the promise, so every caller shares one answer and one call to a consumer. */
const read = new WeakMap<object, Promise<Limit | undefined>>()

/** The limit a consumer's plugin names in an error the package's own rule does not take for one; no answer, and an answer of no limit, are `undefined`. */
async function consumerLimit(ctx: V2Context, event: RetryEvent): Promise<Limit | undefined> {
  const agent = typeof event.agent === "string" ? event.agent : ""
  const answer = await askLimit(ctx, agent, event.model, event.error, reportedDelay(event))
  if (answer?.limit !== true) return undefined
  return {
    kind: "consumer",
    ...(answer.wait_ms && { waitMs: answer.wait_ms }),
    ...(answer.reason !== undefined && { reason: answer.reason }),
  }
}

/** Reads the limit of `event` and cools its model down. */
async function findLimit(ctx: V2Context, state: FallbackState, event: RetryEvent): Promise<Limit | undefined> {
  const { cooldowns, now, settings } = state
  const limit = readLimit(event, settings.maxWaitMs) ?? (await consumerLimit(ctx, event))
  if (limit) cooldowns.cool(event.model, now() + (limit.waitMs ?? settings.cooldownMs))
  return limit
}

/**
 * Reads the limit of a retry event and cools its model down, once per event: a
 * later call for the same event answers what the first read, so the cooldown
 * comes from OpenCode's own decision whichever handler sees the event first,
 * even after another has changed the decision. Where the package's own rule
 * sees no limit, a consumer's plugin is asked whether the error is one (see
 * `rpc.ts`), with the wait of OpenCode's decision as it stood then; its
 * answer is the limit, and the package's own limits never ask it.
 */
export function coolOnLimit(ctx: V2Context, state: FallbackState, event: RetryEvent): Promise<Limit | undefined> {
  // Only an object can be a key; anything else is not a retry event, and the read fails on it.
  if (typeof event !== "object" || event === null) return findLimit(ctx, state, event)
  let reading = read.get(event)
  if (!reading) {
    reading = findLimit(ctx, state, event)
    read.set(event, reading)
  }
  return reading
}

/** Cools down each model that hits a limit, so launches pass over it. It leaves OpenCode's decision on the retry as it is. */
export const LIMITS: Feature = {
  name: "limits",
  calls: ["session.hook"],
  hooks: ["retry"],
  async register(ctx, api) {
    if (ctx.options?.routes === undefined) return
    await api.hook("retry", async (event) => {
      try {
        await coolOnLimit(ctx, api.state, event)
      } catch {
        // The fallback never breaks a retry: OpenCode decides as it would have.
      }
    })
  },
}
