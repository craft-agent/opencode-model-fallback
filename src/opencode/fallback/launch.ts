import type { V2Context, V2Executor, V2ExecutorContext, V2ExecutorResult } from "../types"
import type { Cooldowns } from "./cooldowns"
import type { Feature, FeatureApi } from "./feature"
import { selectStep, type SkippedStep } from "./launch.select"
import { notice, ownedKey } from "./notice"
import { withNotices } from "./result"
import { modelsEqual, readRoutes, selector, type RouteTable } from "./routes"

const SUBAGENT_ID = "subagent"
const NO_MODEL = "(no model)"
const OPENCODE_CHOICE = "OpenCode's choice"
const NO_STEP_USABLE = "no step of its route is usable"
const REPLACES_AGENT_MODEL = "the route replaces the agent's model"
const REPLACES_INHERITED_MODEL = "the route replaces the inherited model"

/** What a launch did to the model, as the notice tells it and the result's metadata keeps it. `to` is `null` when OpenCode's own choice launched. */
type LaunchRecord = {
  agent: string
  from: string | null
  to: string | null
  reason: string
  skipped: SkippedStep[]
}

/** What a launch comes to: the input the built-in tool gets and, when the route had a say, the record of it. */
type LaunchPlan = { input: Record<string, unknown>; record?: LaunchRecord }

/** The notice of a record: the same fields the metadata carries, so the two cannot drift. */
function noticeOf(record: LaunchRecord): string {
  const { agent, from, to, reason } = record
  return notice(
    to === null
      ? `${agent}: ${reason}; launched on ${from ?? OPENCODE_CHOICE}`
      : `${agent} ${from ?? NO_MODEL} → ${to}; ${reason}`,
  )
}

/** Plans the launch of a routed agent on the first usable step of its route; any input the route does not decide, or any failure to decide it, leaves the input as it came. */
async function planLaunch(
  ctx: V2Context,
  table: RouteTable,
  cooldowns: Cooldowns,
  input: Record<string, unknown>,
  context: V2ExecutorContext,
): Promise<LaunchPlan> {
  const { agent } = input
  if (typeof input.model === "string" && input.model !== "") return { input }
  if (typeof agent !== "string" || !Object.hasOwn(table, agent)) return { input }
  try {
    const parent = await ctx.session.get({ sessionID: context.sessionID })
    const directory = parent.location?.directory
    if (!directory) return { input }
    const location = { directory }
    const agentModel = (await ctx.agent!.get!({ agentID: agent, location })).data?.model
    const catalog = (await ctx.model!.list!({ location })).data
    // The model OpenCode would launch on: the agent's own, else the parent's.
    const current = agentModel ?? parent.model
    const from = current ? selector(current) : null
    const { chosen, skipped } = selectStep(table[agent]!, catalog, (step) => cooldowns.until(step))
    if (!chosen) return { input, record: { agent, from, to: null, reason: NO_STEP_USABLE, skipped } }
    if (current && modelsEqual(chosen, current)) return { input }
    const to = selector(chosen)
    const reason =
      skipped.length > 0
        ? skipped.map((step) => `${step.model} ${step.reason}`).join("; ")
        : agentModel
          ? REPLACES_AGENT_MODEL
          : REPLACES_INHERITED_MODEL
    return { input: { ...input, model: to }, record: { agent, from, to, reason, skipped } }
  } catch {
    // The fallback never breaks a launch: the built-in tool decides as it would have.
    return { input }
  }
}

/** The `subagent` executor of the built-in tool, launching a routed agent on its route. */
function launchOnRoute(
  ctx: V2Context,
  api: FeatureApi,
  table: RouteTable,
  cooldowns: Cooldowns,
  original: V2Executor,
): V2Executor {
  return async (input, context) => {
    if (typeof input.sessionID === "string" && input.sessionID !== "") return original(input, context)
    const plan = await planLaunch(ctx, table, cooldowns, input, context)
    context.signal.throwIfAborted?.()
    const lines = api.notices.take()
    const { record } = plan
    let result: V2ExecutorResult
    try {
      result = await original(plan.input, context)
    } catch (error) {
      // A launch that fails shows no result, so its once-notices wait for the next one.
      for (const line of lines) api.notices.add(line)
      throw error
    }
    if (record) lines.push(noticeOf(record))
    return withNotices(result, lines, record && { [ownedKey("launch")]: record })
  }
}

/** Launches each subagent of a routed agent on the first usable step of its route. */
export const LAUNCH: Feature = {
  name: "launch",
  calls: ["tool.transform", "agent.get", "model.list"],
  hooks: [],
  async register(ctx, api) {
    const routes = ctx.options?.routes
    if (routes === undefined) return
    const { table, problems } = readRoutes(routes)
    const { cooldowns } = api.state
    api.track(
      await ctx.tool.transform((editor) => {
        if (!editor.get?.(SUBAGENT_ID) || typeof editor.update !== "function") {
          throw new Error("the built-in subagent tool cannot be wrapped")
        }
        editor.update(SUBAGENT_ID, (tool) => {
          tool.execute = launchOnRoute(ctx, api, table, cooldowns, tool.execute)
        })
      }),
    )
    for (const problem of problems) api.notices.add(notice(`config ignored: ${problem}`))
  },
}
