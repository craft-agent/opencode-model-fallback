import type { V2Context } from "../types"
import { startFeatures, type Feature, type RunningFeatures } from "./feature"
import { MIN_OPENCODE_VERSION, meetsMinimum } from "./version"

/** The features of the fallback; none yet, so a plugin with nothing configured registers nothing. */
export const FEATURES: readonly Feature[] = []

/**
 * Sets up the fallback on an OpenCode that is at least `MIN_OPENCODE_VERSION`
 * (`ctx.app.version`); below it, or when the version cannot be read, nothing
 * is registered and each feature is recorded as unavailable. A call a feature
 * needs that the host lacks keeps that feature off, never the setup.
 */
export async function setupFallback(ctx: V2Context, features: readonly Feature[] = FEATURES): Promise<RunningFeatures> {
  const version = ctx.app?.version
  if (!meetsMinimum(version)) {
    const reason = `needs OpenCode ${MIN_OPENCODE_VERSION} or later, found ${typeof version === "string" ? version : "no version"}`
    return {
      running: [],
      unavailable: features.map((feature) => ({ name: feature.name, reason })),
      dispose: async () => {},
    }
  }
  return startFeatures(ctx, features)
}
