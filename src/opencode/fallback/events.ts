import type { Feature } from "./feature"
import { LIMITED_EVENT, LIMITS_RPC, type LimitedEvent } from "./rpc"

/** Announces each limit the fallback takes, over `LIMITS_RPC`, to the plugins that listen. It never waits for an emit and never lets one fail the retry. */
export const EVENTS: Feature = {
  name: "events",
  calls: ["rpc.register"],
  hooks: [],
  async register(ctx, api) {
    if (ctx.options?.routes === undefined) return
    const registration = await ctx.rpc!.register!(LIMITS_RPC, {})
    api.track(registration)
    api.state.onLimit = (event: LimitedEvent) => {
      try {
        registration.events.emit(LIMITED_EVENT, event).catch(() => {})
      } catch {
        // Nobody listening, or a host that throws: the limit is cooled all the same.
      }
    }
  },
}
