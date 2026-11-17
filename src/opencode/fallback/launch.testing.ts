import { startFeatures, type Feature } from "./feature"
import { LAUNCH } from "./launch"
import { executorContext, fakeContext, type FakeContext, type FakeOptions } from "./testing"
import type { V2ExecutorContext, V2ExecutorResult } from "../types"

/** The shared setup of the launch tests: a fake host with the launch feature started on it. */

/** The session the launch tests' subagent calls come from. */
export const PARENT_ID = "ses_parent"

/** The home directory the launch tests' settings resolve against, so nothing reads the real one. */
const FAKE_HOME = "/home/tester"

/** The routed agent of the tests. */
export const AGENT = "worker"

/** The route of `AGENT` unless a test gives another. */
export const ROUTES = { [AGENT]: ["a/x", "b/y", "c/z"] }

/** What `startLaunch` takes: the fake's options (but its plugin options) and the other features to start with launch. */
export type LaunchSetup = Omit<FakeOptions, "options"> & {
  others?: readonly Feature[]
  /** The clock the cooldowns run on; the real one when absent. */
  now?: () => number
}

/** What `startLaunch` gives back. */
export type LaunchHarness = FakeContext & {
  /** Calls the built-in tool as the host would now, wrapped or not. */
  launch(input: Record<string, unknown>, context?: Partial<V2ExecutorContext>): Promise<V2ExecutorResult>
  running: string[]
  unavailable: { name: string; reason: string }[]
}

/** Stands for a plugin without the `routes` option, where `undefined` would take the default route. */
export const NO_ROUTES = Symbol("no routes")

/** Starts the launch feature on a fake host whose `routes` option is `routes` (`ROUTES` when `undefined`, absent for `NO_ROUTES`). */
export async function startLaunch(
  routes: unknown = ROUTES,
  { others = [], now, ...fake }: LaunchSetup = {},
): Promise<LaunchHarness> {
  const host = fakeContext({ ...fake, options: routes === NO_ROUTES ? {} : { routes } })
  const { running, unavailable } = await startFeatures(host.ctx, [LAUNCH, ...others], {
    now,
    env: { HOME: FAKE_HOME },
    persist: false,
  })
  return {
    ...host,
    running,
    unavailable,
    launch: (input, context) => host.subagent.execute(input, executorContext({ sessionID: PARENT_ID, ...context })),
  }
}
