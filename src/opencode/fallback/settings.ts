import { defaultStateDir, settingsFromOptions } from "../../entry/settings"
import type { PluginOptions } from "../types"

/** The longest wait a provider may ask of a rate limit before the model counts as having hit a limit, in milliseconds. */
export const DEFAULT_MAX_WAIT_MS = 10_000

/** How long a model that hit a limit is passed over when OpenCode gave no wait, in milliseconds: one hour. */
export const DEFAULT_COOLDOWN_MS = 3_600_000

/** What a limit cools, as `cooldown_scope` names it: the model that hit it, or that model's whole provider. */
export const COOLDOWN_SCOPES = ["model", "provider"] as const

/** One of the `cooldown_scope` values. */
export type CooldownScope = (typeof COOLDOWN_SCOPES)[number]

/** What a limit cools unless `cooldown_scope` says otherwise. */
export const DEFAULT_COOLDOWN_SCOPE: CooldownScope = "model"

/** The settings the fallback's own features read, with their defaults filled in. */
export type FallbackSettings = {
  maxWaitMs: number
  cooldownMs: number
  cooldownScope: CooldownScope
  stateDir: string
}

/** The environment the settings fall back to. */
export type FallbackEnv = Record<string, string | undefined>

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback
}

function isCooldownScope(value: unknown): value is CooldownScope {
  return COOLDOWN_SCOPES.some((scope) => scope === value)
}

/** What `cooldown_scope` must be, as the notice for a value that is not. */
function scopeProblem(value: unknown): string {
  return `cooldown_scope must be ${COOLDOWN_SCOPES.map((scope) => `"${scope}"`).join(" or ")}, got "${String(value)}"`
}

/** The settings with every default and nothing read, for an environment. */
function defaultSettings(env: FallbackEnv): FallbackSettings {
  return {
    maxWaitMs: DEFAULT_MAX_WAIT_MS,
    cooldownMs: DEFAULT_COOLDOWN_MS,
    cooldownScope: DEFAULT_COOLDOWN_SCOPE,
    stateDir: defaultStateDir(env),
  }
}

/**
 * Reads `max_wait_ms`, `cooldown_ms`, `cooldown_scope` and `state_dir` as the
 * plugin's settings layer resolves them (an option wins over its variable,
 * bounds checked), with the defaults for what is unset. A setting the layer
 * refuses, which it already refuses when the plugin's tools are set up, gives
 * every default and the refusal as `problem`, never an exception. A
 * `cooldown_scope` that is not a scope gives the default scope and the
 * refusal as `problem`, and the other settings stand.
 */
export function readFallbackSettings(
  options: PluginOptions | undefined,
  env: FallbackEnv,
): { settings: FallbackSettings; problem?: string } {
  try {
    const values = settingsFromOptions(options, env).options
    const defaults = defaultSettings(env)
    const scope = values.cooldown_scope
    const refusedScope = scope !== undefined && !isCooldownScope(scope)
    return {
      settings: {
        maxWaitMs: numberOr(values.max_wait_ms, defaults.maxWaitMs),
        cooldownMs: numberOr(values.cooldown_ms, defaults.cooldownMs),
        cooldownScope: isCooldownScope(scope) ? scope : defaults.cooldownScope,
        stateDir: typeof values.state_dir === "string" ? values.state_dir : defaults.stateDir,
      },
      ...(refusedScope && { problem: scopeProblem(scope) }),
    }
  } catch (error) {
    return { settings: defaultSettings(env), problem: error instanceof Error ? error.message : String(error) }
  }
}
