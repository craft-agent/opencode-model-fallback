import type { V2CatalogModel, V2Context, V2ModelRef, V2Session } from "../types"
import { askUsable } from "./consumer"
import type { Feature, FeatureApi } from "./feature"
import { eventModel, isRateLimit, reportedDelay, type Limit, type RetryEvent } from "./limit"
import { coolOnLimit } from "./limits"
import { selectAskedStep } from "./launch.select"
import { withMove, type MoveRecord } from "./moves.record"
import { modelsEqual, readRoutes, selector, type RouteTable } from "./routes"

const NO_STEP_LEFT = "no usable step left"

/** Whether `agent` is a name the route table has a route for. */
function hasRoute(table: RouteTable, agent: unknown): agent is string {
  return typeof agent === "string" && Object.hasOwn(table, agent)
}

/**
 * The index of `model` in `steps`: the step equal to it, else the first step of
 * the same provider and ID that stands for it. A step with no variant stands
 * for the model in every variant, and a model with no variant is stood for by
 * a step of any variant. `-1` when the model is not a step.
 */
function placeOf(steps: readonly V2ModelRef[], model: V2ModelRef): number {
  const exact = steps.findIndex((step) => modelsEqual(step, model))
  if (exact >= 0) return exact
  return steps.findIndex(
    (step) =>
      step.providerID === model.providerID && step.id === model.id && (!model.variant || step.variant === undefined),
  )
}

/**
 * `step` with `variant` when the step names none and its model in `catalog`
 * has that variant; otherwise `step` as written.
 */
function carryVariant(step: V2ModelRef, variant: string | undefined, catalog: readonly V2CatalogModel[]): V2ModelRef {
  if (step.variant !== undefined || variant === undefined) return step
  const model = catalog.find((item) => item.providerID === step.providerID && item.id === step.id)
  return model?.variants?.some((item) => item.id === variant) ? { ...step, variant } : step
}

/** Why a session leaves the model it was on, as the record and the notice tell it. */
function reasonOf(model: V2ModelRef, limit: Limit): string {
  if (limit.kind !== "consumer") return `${selector(model)} hit a ${limit.kind} limit`
  return `${selector(model)} hit a limit${limit.reason === undefined ? "" : `: ${limit.reason}`}`
}

/** Appends `record` to the moves in `metadata`, the session's own; a failure is ignored, since the move stands without its record. */
async function recordMove(
  ctx: V2Context,
  sessionID: string,
  metadata: Record<string, unknown> | undefined,
  record: MoveRecord,
): Promise<void> {
  try {
    await ctx.session.update!({ sessionID, metadata: withMove(metadata, record) })
  } catch {
    // The record is a courtesy to the reader; the retry goes on without it.
  }
}

/** A session with its agent, that agent's route (`steps`) and the index of its model on it (`place`). */
type PlacedSession = { session: V2Session; agent: string; steps: readonly V2ModelRef[]; place: number }

/** The session of a retry event, placed on its agent's route; `undefined` when the agent has no route or the model is off it. */
async function placeSession(ctx: V2Context, table: RouteTable, event: RetryEvent): Promise<PlacedSession | undefined> {
  const named = typeof event.agent === "string" && event.agent !== "" ? event.agent : undefined
  if (named !== undefined && !hasRoute(table, named)) return undefined
  const session = await ctx.session.get({ sessionID: event.sessionID })
  const agent = named ?? session.agent
  if (!hasRoute(table, agent)) return undefined
  const steps = table[agent]!
  const place = placeOf(steps, eventModel(event))
  return place < 0 ? undefined : { session, agent, steps, place }
}

/**
 * Cuts the wait of a rate limit that is no limit by `max_wait_ms` but that
 * another plugin stretched past it, for a session the fallback would move:
 * it retries after `max_wait_ms`. Nothing else is touched, and nothing is
 * recorded.
 */
async function shortenStretchedWait(
  ctx: V2Context,
  api: FeatureApi,
  table: RouteTable,
  event: RetryEvent,
): Promise<void> {
  const { maxWaitMs } = api.state.settings
  const delay = reportedDelay(event)
  if (!isRateLimit(event) || delay === undefined || delay <= maxWaitMs) return
  if (!(await placeSession(ctx, table, event))) return
  event.decision = { retry: true, delay: maxWaitMs }
}

/**
 * Moves the session of a retry event that shows a limit to the next usable
 * step of its agent's route, or stops a child that has none. Anything that
 * does not call for either (an agent with no route, a model off the route, a
 * primary agent with nowhere to go) leaves OpenCode's decision as it is, and
 * so does any failure before the decision is changed.
 */
async function moveOnLimit(
  ctx: V2Context,
  api: FeatureApi,
  table: RouteTable,
  event: RetryEvent,
  limit: Limit,
): Promise<void> {
  const { sessionID } = event
  const model = eventModel(event)
  const placed = await placeSession(ctx, table, event)
  if (!placed) return
  const { session, agent, steps, place } = placed
  const directory = session.location?.directory
  if (!directory) return
  const catalog = (await ctx.model!.list!({ location: { directory } })).data
  const { cooldowns, now } = api.state
  const { chosen } = await selectAskedStep(
    steps.slice(place + 1).map((step) => carryVariant(step, model.variant, catalog)),
    catalog,
    (step) => cooldowns.until(step),
    (step) => askUsable(ctx, agent, step),
  )
  const reason = reasonOf(model, limit)
  const at = new Date(now()).toISOString()
  if (chosen) {
    await ctx.session.switchModel!({ sessionID, model: { ...chosen } })
    event.decision = { retry: true, delay: 0 }
  } else if (session.parentID) {
    event.decision = { retry: false }
  } else {
    return
  }
  await recordMove(ctx, sessionID, session.metadata, {
    from: selector(model),
    to: chosen ? selector(chosen) : null,
    reason: chosen ? reason : `${reason}; ${NO_STEP_LEFT}`,
    at,
  })
}

/**
 * Moves a session to the next usable step of its route when its model hits a
 * limit: the retry goes on at once on that step. A child with no step left
 * stops retrying. The limited model is cooled down first, from OpenCode's own
 * decision, as the `limits` feature does, so the cooldown is the same
 * whichever of the two handlers sees the event first. A rate limit that is no
 * limit but whose wait another plugin stretched past `max_wait_ms`, on a
 * session that would move, retries after `max_wait_ms` instead.
 */
export const MOVES: Feature = {
  name: "moves",
  calls: ["session.switchModel", "session.update", "model.list"],
  hooks: ["retry"],
  async register(ctx, api) {
    const routes = ctx.options?.routes
    if (routes === undefined) return
    const { table } = readRoutes(routes)
    await api.hook("retry", async (event) => {
      try {
        const limit = await coolOnLimit(ctx, api.state, event)
        if (limit) await moveOnLimit(ctx, api, table, event, limit)
        else await shortenStretchedWait(ctx, api, table, event)
      } catch {
        // The fallback never breaks a retry: OpenCode decides as it would have.
      }
    })
  },
}
