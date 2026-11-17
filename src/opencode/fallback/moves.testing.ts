import { fakeClock, type FakeClock } from "./cooldowns.testing"
import { startFeatures, type Feature, type RunningFeatures } from "./feature"
import { AGENT, NO_ROUTES, PARENT_ID, ROUTES } from "./launch.testing"
import type { RetryEvent } from "./limit"
import { LIMITS } from "./limits"
import { MOVES } from "./moves"
import { catalogModel, fakeContext, type FakeContext, type FakeOptions } from "./testing"
import type { V2ModelRef } from "../types"

/** The shared setup of the tests of moves: a fake host with the limits and moves features started on it. */

/** The session whose retries the moves tests fire. */
export const SESSION_ID = "ses_1"

/** The model of `AGENT`'s first step, the one a retry event is for unless a test says otherwise. */
export const FIRST: V2ModelRef = { providerID: "a", id: "x" }

/** The usable models of the tests, one for each step of `ROUTES`. */
export const CATALOG = [catalogModel("a/x"), catalogModel("b/y"), catalogModel("c/z")]

/** A session that is a child of `PARENT_ID`. */
export const CHILD = { parentID: PARENT_ID }

/** A retry event for `FIRST` on `AGENT`, a quota error OpenCode will not retry; `overrides` replace any part of it. */
export function retryEvent(overrides: Partial<RetryEvent> = {}): RetryEvent {
  return {
    sessionID: SESSION_ID,
    agent: AGENT,
    model: FIRST,
    error: { type: "provider.quota", message: "out of quota" },
    decision: { retry: false },
    ...overrides,
  }
}

/** What `startMoves` takes: the fake's options, whose `options` are added to the routes, and the features to start (limits, then moves, by default). */
export type MovesSetup = FakeOptions & { routes?: unknown; features?: readonly Feature[] }

/** What `startMoves` gives back. */
export type MovesHarness = FakeContext &
  RunningFeatures & {
    clock: FakeClock
    /** Fires `retryEvent(overrides)` and gives it back as the handlers left it. */
    retry(overrides?: Partial<RetryEvent>): Promise<RetryEvent>
    /** When the cooldown of `model` ends, or `undefined` when it is not cooling down. */
    cooling(model: V2ModelRef): number | undefined
  }

/** Starts `features` on a fake host whose routes are `ROUTES` and whose catalog is `CATALOG` unless a test gives others, over a fake clock and no state file. */
export async function startMoves({
  routes = ROUTES,
  features = [LIMITS, MOVES],
  ...fake
}: MovesSetup = {}): Promise<MovesHarness> {
  const clock = fakeClock()
  const options = routes === NO_ROUTES ? fake.options : { routes, ...fake.options }
  const host = fakeContext({ catalog: CATALOG, ...fake, options })
  let cooling: MovesHarness["cooling"] = () => undefined
  const reader: Feature = {
    name: "reader",
    calls: [],
    hooks: [],
    async register(_ctx, api) {
      cooling = (model) => api.state.cooldowns.until(model)
    },
  }
  const started = await startFeatures(host.ctx, [...features, reader], {
    now: clock.now,
    env: { HOME: "/home/tester" },
    persist: false,
  })
  return {
    ...host,
    ...started,
    running: started.running.filter((name) => name !== reader.name),
    clock,
    cooling: (model) => cooling(model),
    async retry(overrides) {
      const event = retryEvent(overrides)
      await host.fire("retry", event)
      return event
    },
  }
}
