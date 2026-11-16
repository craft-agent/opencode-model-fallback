import type { RunningFeatures } from "./fallback/feature"
import { setupFallback } from "./fallback/setup"
import type { OpenCodePlugin, V2Context } from "./types"

/**
 * The plugin's `setup`: the starter's tools and skills first, then the
 * fallback. The fallback never breaks the tools: a setup of it that throws is
 * dropped and the tools stay. The cleanup it returns takes the fallback's
 * registrations back, then runs the starter's own cleanup if it has one.
 */
export function composeSetup(
  starter: OpenCodePlugin["setup"],
  fallback: typeof setupFallback = setupFallback,
): OpenCodePlugin["setup"] {
  return async function setup(ctx: V2Context) {
    const starterCleanup = await starter(ctx)
    let running: RunningFeatures | undefined
    try {
      running = await fallback(ctx)
    } catch {
      // The fallback is optional; the tools above are already registered.
    }
    return async () => {
      try {
        await running?.dispose()
      } finally {
        await starterCleanup?.()
      }
    }
  }
}
