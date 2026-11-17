import type { V2CatalogModel, V2ModelRef } from "../types"
import { selector } from "./routes"
import type { StepsUsableOutput } from "./rpc"

/** A step of a route that cannot take the launch, and why, as a clause that follows the step's name. */
export type SkippedStep = { model: string; reason: string }

/** The first usable step of a route, if any, and the steps passed over before it. */
export type Selection = { chosen?: V2ModelRef; skipped: SkippedStep[] }

const NOT_IN_CATALOG = "is not in OpenCode's models"
const CANNOT_RUN = "cannot run a subagent"
const COOLING_DOWN = "is cooling down until"
const UNUSABLE = "is unusable"

/**
 * Why a step cannot take a launch, or `undefined` when it can. `catalog` is what
 * OpenCode lists for the directory, which holds only models of providers it can
 * use, so a model missing from it has no such model or no login. A usable model
 * is enabled, active, able to call tools and, for a step with a variant, has it.
 */
export function unusableReason(step: V2ModelRef, catalog: readonly V2CatalogModel[]): string | undefined {
  const model = catalog.find((item) => item.providerID === step.providerID && item.id === step.id)
  if (!model) return NOT_IN_CATALOG
  if (model.enabled !== true || model.status !== "active" || model.capabilities?.tools !== true) return CANNOT_RUN
  if (step.variant !== undefined && !model.variants?.some((variant) => variant.id === step.variant)) {
    return `has no variant ${step.variant}`
  }
  return undefined
}

/** When a model is usable again, or `undefined` when it is not cooling down. */
export type CoolingUntil = (model: V2ModelRef) => number | undefined

/** The clause for a step whose model is cooling down until `end` (epoch milliseconds, never past the latest date), or `undefined` when `end` is. */
function coolingReason(end: number | undefined): string | undefined {
  return end === undefined ? undefined : `${COOLING_DOWN} ${new Date(end).toISOString()}`
}

/** The first step of `steps` that can take a launch, with the steps before it that cannot. A step whose model is cooling down, as `coolingUntil` says, cannot. */
export function selectStep(
  steps: readonly V2ModelRef[],
  catalog: readonly V2CatalogModel[],
  coolingUntil: CoolingUntil = () => undefined,
): Selection {
  const skipped: SkippedStep[] = []
  for (const step of steps) {
    const reason = unusableReason(step, catalog) ?? coolingReason(coolingUntil(step))
    if (reason === undefined) return { chosen: step, skipped }
    skipped.push({ model: selector(step), reason })
  }
  return { skipped }
}

/** What a consumer's plugin says of a step: its answer, or `undefined` for no answer, which counts as usable. */
export type AskUsable = (step: V2ModelRef) => Promise<StepsUsableOutput | undefined>

/** The clause for a step a consumer's plugin passed over. */
function unusableClause(reason: string | undefined): string {
  return reason === undefined ? UNUSABLE : `${UNUSABLE}: ${reason}`
}

/**
 * `selectStep` with a consumer's say: the steps `selectStep` takes, in order,
 * are put to `ask` one at a time, until one is not refused. Only a step that
 * passed the package's own checks is asked, so the calls are at most one per
 * candidate, and none after the first usable one.
 */
export async function selectAskedStep(
  steps: readonly V2ModelRef[],
  catalog: readonly V2CatalogModel[],
  coolingUntil: CoolingUntil,
  ask: AskUsable,
): Promise<Selection> {
  const skipped: SkippedStep[] = []
  let from = 0
  while (from < steps.length) {
    const found = selectStep(steps.slice(from), catalog, coolingUntil)
    skipped.push(...found.skipped)
    if (!found.chosen) break
    const answer = await ask(found.chosen)
    if (answer?.usable !== false) return { chosen: found.chosen, skipped }
    skipped.push({ model: selector(found.chosen), reason: unusableClause(answer.reason) })
    from += found.skipped.length + 1
  }
  return { skipped }
}
