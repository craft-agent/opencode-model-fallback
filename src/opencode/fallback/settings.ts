import { defaultStateDir, settingsFromOptions } from "../../entry/settings"
import type { PluginOptions } from "../types"

/** The longest wait a provider may ask of a rate limit before the model counts as having hit a limit, in milliseconds. */
export const DEFAULT_MAX_WAIT_MS = 10_000

/** How long a model that hit a limit is passed over when OpenCode gave no wait, in milliseconds: one hour. */
export const DEFAULT_COOLDOWN_MS = 3_600_000

/** The settings the fallback's own features read, with their defaults filled in. */
export type FallbackSettings = {
  maxWaitMs: number
  cooldownMs: number
  stateDir: string
}

/** The environment the settings fall back to. */
export type FallbackEnv = Record<string, string | undefined>

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback
}

/** The settings with every default and nothing read, for an environment. */
function defaultSettings(env: FallbackEnv): FallbackSettings {
  return { maxWaitMs: DEFAULT_MAX_WAIT_MS, cooldownMs: DEFAULT_COOLDOWN_MS, stateDir: defaultStateDir(env) }
}

/**
 * Reads `max_wait_ms`, `cooldown_ms` and `state_dir` as the plugin's settings
 * layer resolves them (an option wins over its variable, bounds checked), with
 * the defaults for what is unset. A setting the layer refuses, which it already
 * refuses when the plugin's tools are set up, gives every default and the
 * refusal as `problem`, never an exception.
 */
export function readFallbackSettings(
  options: PluginOptions | undefined,
  env: FallbackEnv,
): { settings: FallbackSettings; problem?: string } {
  try {
    const values = settingsFromOptions(options, env).options
    const defaults = defaultSettings(env)
    return {
      settings: {
        maxWaitMs: numberOr(values.max_wait_ms, defaults.maxWaitMs),
        cooldownMs: numberOr(values.cooldown_ms, defaults.cooldownMs),
        stateDir: typeof values.state_dir === "string" ? values.state_dir : defaults.stateDir,
      },
    }
  } catch (error) {
    return { settings: defaultSettings(env), problem: error instanceof Error ? error.message : String(error) }
  }
}
