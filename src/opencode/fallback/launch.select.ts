import type { V2CatalogModel, V2ModelRef } from "../types"
import { selector } from "./routes"

/** A step of a route that cannot take the launch, and why, as a clause that follows the step's name. */
export type SkippedStep = { model: string; reason: string }

/** The first usable step of a route, if any, and the steps passed over before it. */
export type Selection = { chosen?: V2ModelRef; skipped: SkippedStep[] }

const NOT_IN_CATALOG = "is not in OpenCode's models"
const CANNOT_RUN = "cannot run a subagent"

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

/** The first step of `steps` that can take a launch, with the steps before it that cannot. */
export function selectStep(steps: readonly V2ModelRef[], catalog: readonly V2CatalogModel[]): Selection {
  const skipped: SkippedStep[] = []
  for (const step of steps) {
    const reason = unusableReason(step, catalog)
    if (reason === undefined) return { chosen: step, skipped }
    skipped.push({ model: selector(step), reason })
  }
  return { skipped }
}
