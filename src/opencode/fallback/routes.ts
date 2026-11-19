import type { V2ModelRef } from "../types"

/** The fallback steps of each agent, by agent name, in the order they are tried. */
export type RouteTable = Readonly<Record<string, readonly V2ModelRef[]>>

/** What was wrong with the `routes` option, one sentence each, in input order. */
export type RouteProblems = readonly string[]

const PROVIDER_SEPARATOR = "/"
const VARIANT_SEPARATOR = "#"
const WHITESPACE = /\s/
/** The variant OpenCode reports for a model with no variant chosen; it is no real variant. */
export const DEFAULT_VARIANT = "default"

function plain(text: string, ...forbidden: string[]): boolean {
  return text !== "" && !WHITESPACE.test(text) && !forbidden.some((char) => text.includes(char))
}

/** Reads `provider/model#variant`: the provider ends at the first `/`, the variant starts at the last `#`, and the model ID in between may hold `/` and `:`. Returns undefined when the text is not of that form. */
export function parseSelector(text: string): V2ModelRef | undefined {
  const trimmed = text.trim()
  const slash = trimmed.indexOf(PROVIDER_SEPARATOR)
  if (slash < 0) return undefined
  const providerID = trimmed.slice(0, slash)
  const rest = trimmed.slice(slash + 1)
  const hash = rest.lastIndexOf(VARIANT_SEPARATOR)
  const id = hash < 0 ? rest : rest.slice(0, hash)
  const variant = hash < 0 ? undefined : rest.slice(hash + 1)
  if (!plain(providerID, VARIANT_SEPARATOR) || !plain(id)) return undefined
  if (variant === undefined) return { providerID, id }
  if (!plain(variant, PROVIDER_SEPARATOR)) return undefined
  return variant === DEFAULT_VARIANT ? { providerID, id } : { providerID, id, variant }
}

/** `ref` without its variant when that is `default`, OpenCode's name for no variant; any other variant is kept. */
export function withoutDefaultVariant(ref: V2ModelRef): V2ModelRef {
  if (ref.variant !== DEFAULT_VARIANT) return ref
  const { variant: _variant, ...bare } = ref
  return bare
}

/** Writes a model as `provider/model#variant`, without the `#variant` when it has none; `parseSelector` reads it back. */
export function selector(ref: V2ModelRef): string {
  const base = `${ref.providerID}${PROVIDER_SEPARATOR}${ref.id}`
  return ref.variant ? `${base}${VARIANT_SEPARATOR}${ref.variant}` : base
}

/** Whether two references name the same provider, model ID and variant. */
export function modelsEqual(a: V2ModelRef, b: V2ModelRef): boolean {
  return a.providerID === b.providerID && a.id === b.id && a.variant === b.variant
}

/** Reads the `routes` option: an object of agent names to lists of `provider/model#variant` texts. What cannot be read is left out and described in the problems; the rest still routes. */
export function readRoutes(value: unknown): { table: RouteTable; problems: RouteProblems } {
  const table: Record<string, readonly V2ModelRef[]> = {}
  const problems: string[] = []
  if (value === undefined) return { table, problems }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { table, problems: ["routes is not an object of agent names to lists of models"] }
  }
  const routes = value as Record<string, unknown>
  for (const agent of Object.keys(routes)) {
    if (!Object.hasOwn(routes, agent)) continue
    const entries = routes[agent]
    if (!Array.isArray(entries)) {
      problems.push(`routes.${agent} is not a list of models`)
      continue
    }
    const steps: V2ModelRef[] = []
    entries.forEach((entry: unknown, index) => {
      const ref = typeof entry === "string" ? parseSelector(entry) : undefined
      if (!ref) {
        problems.push(`routes.${agent}[${index}]: ${JSON.stringify(entry)} is not provider/model#variant`)
      } else if (steps.some((step) => modelsEqual(step, ref))) {
        problems.push(`routes.${agent}[${index}]: ${selector(ref)} is listed twice`)
      } else {
        steps.push(ref)
      }
    })
    if (steps.length === 0) problems.push(`routes.${agent} has no model, so it routes nothing`)
    else table[agent] = steps
  }
  return { table, problems }
}
