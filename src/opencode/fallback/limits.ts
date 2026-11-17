import type { Feature } from "./feature"
import { readLimit, type Limit, type RetryEvent } from "./limit"
import type { FallbackState } from "./state"

/** The limit each retry event showed when it was first read, `undefined` for an event that showed none. */
const read = new WeakMap<object, Limit | undefined>()

/**
 * Reads the limit of a retry event and cools its model down, once per event: a
 * later call for the same event answers what the first read, so the cooldown
 * comes from OpenCode's own decision whichever handler sees the event first,
 * even after another has changed the decision.
 */
export function coolOnLimit(state: FallbackState, event: RetryEvent): Limit | undefined {
  if (read.has(event)) return read.get(event)
  const { cooldowns, now, settings } = state
  const limit = readLimit(event, settings.maxWaitMs)
  if (limit) cooldowns.cool(event.model, now() + (limit.waitMs ?? settings.cooldownMs))
  read.set(event, limit)
  return limit
}

/** Cools down each model that hits a limit, so launches pass over it. It leaves OpenCode's decision on the retry as it is. */
export const LIMITS: Feature = {
  name: "limits",
  calls: ["session.hook"],
  hooks: ["retry"],
  async register(ctx, api) {
    if (ctx.options?.routes === undefined) return
    await api.hook("retry", (event) => {
      try {
        coolOnLimit(api.state, event)
      } catch {
        // The fallback never breaks a retry: OpenCode decides as it would have.
      }
    })
  },
}
