import type { Registration, V2Context, V2HookName, V2SessionHooks } from "../types"
import { createOnceNotices, notice, type OnceNotices } from "./notice"
import { createFallbackState, type FallbackDeps, type FallbackState } from "./state"

/** A call of the context a feature may need; the runner checks that each is a function before the feature starts. */
export type CallPath =
  "session.hook" | "session.switchModel" | "session.update" | "tool.transform" | "agent.get" | "model.list" | "rpc"

/** What a feature registers through: the one way to take a hook, so a failure is caught and every registration collected. */
export type FeatureApi = {
  /** Registers `handler` for a hook the feature declared; a rejection or an undeclared name fails the feature. */
  hook<Name extends V2HookName>(
    name: Name,
    handler: (event: V2SessionHooks[Name]) => void | Promise<void>,
  ): Promise<void>
  /** Keeps another registration (a tool transform) to be taken back with the feature's hooks; a host that returns none is ignored. */
  track(registration: Registration | void): void
  /** The notices owed once, shared by every feature of a setup: a feature adds its own and takes them all when it first speaks to the reader. The features that stayed off are added after all have started. */
  readonly notices: OnceNotices
  /** The settings, the clock and the cooldowns shared by every feature of a setup, made on first use. */
  readonly state: FallbackState
}

/** One part of the fallback, with the calls and hooks it needs; it stays off when it cannot have them, the others run. */
export type Feature = {
  name: string
  calls: readonly CallPath[]
  hooks: readonly V2HookName[]
  register(ctx: V2Context, api: FeatureApi): Promise<void>
}

/** A feature that stays off, and why. */
export type UnavailableFeature = { name: string; reason: string }

/** The result of starting the features: which run, which stay off and why, and how to take every registration back. */
export type RunningFeatures = {
  running: string[]
  unavailable: UnavailableFeature[]
  /** Disposes every registration, newest first; one that throws does not stop the others. */
  dispose(): Promise<void>
}

/** The function behind a call path, or `undefined` when the host has none. */
function callOf(ctx: V2Context, path: CallPath): unknown {
  let value: unknown = ctx
  for (const key of path.split(".")) {
    if (typeof value !== "object" && typeof value !== "function") return undefined
    value = (value as Record<string, unknown> | null)?.[key]
  }
  return typeof value === "function" ? value : undefined
}

/** The first call the feature needs that the host lacks; a feature with hooks needs `session.hook` too. */
function missingCall(ctx: V2Context, feature: Feature): CallPath | undefined {
  const needed = feature.hooks.length > 0 ? [...feature.calls, "session.hook" as const] : feature.calls
  return needed.find((path) => callOf(ctx, path) === undefined)
}

function isRegistration(value: unknown): value is Registration {
  return typeof (value as Registration | undefined)?.dispose === "function"
}

/** Disposes `registrations` newest first and empties the list; a dispose that throws does not stop the others. */
async function disposeAll(registrations: Registration[]): Promise<void> {
  for (const registration of registrations.splice(0).reverse()) {
    try {
      await registration.dispose()
    } catch {
      // The registration is gone or never took; the others still go.
    }
  }
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Starts each feature whose calls the host has, registering through a wrapper
 * that collects its registrations. A feature that lacks a call, whose hook
 * registration fails (even when it catches the failure) or whose `register`
 * throws is recorded as unavailable and has what it registered taken back;
 * the others run. OpenCode accepts any hook name, so a failed registration
 * only catches a host that throws, not a hook that does not exist. Each
 * feature left off is named in the once-only notices (`FeatureApi.notices`).
 * The features share one `FeatureApi.state`, made from `deps`.
 */
export async function startFeatures(
  ctx: V2Context,
  features: readonly Feature[],
  deps: FallbackDeps = {},
): Promise<RunningFeatures> {
  const registrations: Registration[] = []
  const running: string[] = []
  const unavailable: UnavailableFeature[] = []
  const notices = createOnceNotices()
  const state = createFallbackState(ctx, notices, deps)

  for (const feature of features) {
    const missing = missingCall(ctx, feature)
    if (missing !== undefined) {
      unavailable.push({ name: feature.name, reason: `${missing} is not available` })
      continue
    }

    const own: Registration[] = []
    const hookFailures: unknown[] = []
    const api: FeatureApi = {
      async hook(name, handler) {
        try {
          if (!feature.hooks.includes(name)) throw new Error(`the hook ${name} is not declared`)
          const registration = await ctx.session.hook!(name, handler)
          if (!isRegistration(registration)) throw new Error(`the hook ${name} returned no registration`)
          own.push(registration)
        } catch (error) {
          hookFailures.push(error)
          throw error
        }
      },
      track(registration) {
        if (isRegistration(registration)) own.push(registration)
      },
      notices,
      state,
    }

    try {
      await feature.register(ctx, api)
      if (hookFailures.length > 0) throw hookFailures[0]
      registrations.push(...own)
      running.push(feature.name)
    } catch (error) {
      await disposeAll(own)
      unavailable.push({ name: feature.name, reason: reasonOf(error) })
    }
  }

  for (const { name, reason } of unavailable) notices.add(notice(`${name} is off: ${reason}`))
  return { running, unavailable, dispose: () => disposeAll(registrations) }
}
