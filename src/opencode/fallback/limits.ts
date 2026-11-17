import type { Feature } from "./feature"
import { readLimit } from "./limit"

/** Cools down each model that hits a limit, so launches pass over it. It leaves OpenCode's decision on the retry as it is. */
export const LIMITS: Feature = {
  name: "limits",
  calls: ["session.hook"],
  hooks: ["retry"],
  async register(ctx, api) {
    if (ctx.options?.routes === undefined) return
    const { cooldowns, now, settings } = api.state
    await api.hook("retry", (event) => {
      try {
        const limit = readLimit(event, settings.maxWaitMs)
        if (limit) cooldowns.cool(event.model, now() + (limit.waitMs ?? settings.cooldownMs))
      } catch {
        // The fallback never breaks a retry: OpenCode decides as it would have.
      }
    })
  },
}
