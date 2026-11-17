import type { V2Context, V2ModelRef } from "../types"
import type { Feature, FeatureApi } from "./feature"
import type { Limit, RetryEvent } from "./limit"
import { coolOnLimit } from "./limits"
import { selectStep } from "./launch.select"
import { withMove, type MoveRecord } from "./moves.record"
import { modelsEqual, readRoutes, selector, type RouteTable } from "./routes"

const NO_STEP_LEFT = "no usable step left"

/** Whether `agent` is a name the route table has a route for. */
function hasRoute(table: RouteTable, agent: unknown): agent is string {
  return typeof agent === "string" && Object.hasOwn(table, agent)
}

/** The index of `model` in `steps`: the step equal to it, else, for a model with no variant, the first step of the same provider and ID. `-1` when the model is not a step. */
function placeOf(steps: readonly V2ModelRef[], model: V2ModelRef): number {
  const exact = steps.findIndex((step) => modelsEqual(step, model))
  if (exact >= 0 || model.variant) return exact
  return steps.findIndex((step) => step.providerID === model.providerID && step.id === model.id)
}

/** Why a session leaves the model it was on, as the record and the notice tell it. */
function reasonOf(model: V2ModelRef, limit: Limit): string {
  return `${selector(model)} hit a ${limit.kind} limit`
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
  const { sessionID, model } = event
  const named = typeof event.agent === "string" && event.agent !== "" ? event.agent : undefined
  if (named !== undefined && !hasRoute(table, named)) return
  const session = await ctx.session.get({ sessionID })
  const agent = named ?? session.agent
  if (!hasRoute(table, agent)) return
  const steps = table[agent]!
  const place = placeOf(steps, model)
  const directory = session.location?.directory
  if (place < 0 || !directory) return
  const catalog = (await ctx.model!.list!({ location: { directory } })).data
  const { cooldowns, now } = api.state
  const { chosen } = selectStep(steps.slice(place + 1), catalog, (step) => cooldowns.until(step))
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
 * whichever of the two handlers sees the event first.
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
        const limit = coolOnLimit(api.state, event)
        if (limit) await moveOnLimit(ctx, api, table, event, limit)
      } catch {
        // The fallback never breaks a retry: OpenCode decides as it would have.
      }
    })
  },
}
