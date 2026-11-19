/**
 * The questions the model fallback asks over OpenCode's plugin RPC, for a
 * plugin that answers them. Import it from
 * `@craftsamo/opencode-model-fallback/rpc` and register handlers against
 * `STEPS_RPC`, so both sides use the same schemas. The module imports nothing.
 */

/** A Standard Schema V1 object, the form OpenCode validates an RPC's input and output with. `types` only carries `T` for TypeScript. */
export type StepsSchema<T> = {
  readonly "~standard": {
    readonly version: 1
    readonly vendor: string
    validate(value: unknown): { value: T } | { issues: { message: string }[] }
    readonly types?: { input: T; output: T }
  }
}

/** What the fallback asks before it uses a step: may this agent run on this model now? */
export type StepsUsableInput = {
  /** The agent the step belongs to. */
  agent: string
  /** The step, `provider/model#variant` (no `#variant` for a step without one). */
  model: string
}

/** The answer to `usable`. */
export type StepsUsableOutput = {
  /** `false` passes the step over, for this launch or move only. */
  usable: boolean
  /** Why, in a few words: it ends up in the notice, after `is unusable:`. */
  reason?: string
}

/** What the fallback asks about an error its own rule does not take for a limit: is it one? */
export type StepsLimitInput = {
  /** The agent whose model failed; empty when OpenCode names none for the event. */
  agent: string
  /** The model that failed, `provider/model#variant`. */
  model: string
  /** The error OpenCode reported. */
  error: {
    type: string
    status?: number
    message: string
    body?: string
  }
  /** The wait before OpenCode would retry, in milliseconds; absent when it will not retry or will retry at once. */
  wait_ms?: number
  /** The wait the provider asked for, in milliseconds; absent when it named none. */
  retry_after_ms?: number
}

/** The answer to `limit`. */
export type StepsLimitOutput = {
  /** `true` makes the error a limit: the model is cooled down and a routed session moves on. */
  limit: boolean
  /** How long the model is passed over, in milliseconds; the `cooldown_ms` setting when absent or zero. */
  wait_ms?: number
  /** Why, in a few words: it ends up in the notice, after `hit a limit:`. */
  reason?: string
}

/** What the fallback announces when a retry event shows a limit: the model has been cooled down. */
export type LimitedEvent = {
  /** The session whose model hit the limit. */
  session_id: string
  /** The agent whose model failed; empty when OpenCode names none for the event. */
  agent: string
  /** The model that hit the limit, `provider/model#variant`. */
  model: string
  /** `quota` or `rate` by the fallback's own rule, `consumer` when a plugin named the limit. */
  kind: "quota" | "rate" | "consumer"
  /** When the model's cooldown ends, as an ISO time. */
  until: string
  /** The wait the limit carried, in milliseconds; absent when it carried none. */
  wait_ms?: number
  /** The reason a consumer gave for a `consumer` limit. */
  reason?: string
}

/** The handlers a plugin registers for `STEPS_RPC`, one for each question. */
export type StepsHandlers = {
  usable(input: StepsUsableInput, context: { signal: AbortSignal }): Promise<StepsUsableOutput> | StepsUsableOutput
  limit(input: StepsLimitInput, context: { signal: AbortSignal }): Promise<StepsLimitOutput> | StepsLimitOutput
}

/** The RPC id the fallback asks under: `opencode-model-fallback.steps`. */
export const STEPS_RPC_ID = "opencode-model-fallback.steps"

/** The RPC id the fallback announces limits under: `opencode-model-fallback.limits`. */
export const LIMITS_RPC_ID = "opencode-model-fallback.limits"

/** The name of the event `LIMITS_RPC` emits for each limit. */
export const LIMITED_EVENT = "limited"

const VENDOR = "opencode-model-fallback"
const LIMIT_KINDS: readonly LimitedEvent["kind"][] = ["quota", "rate", "consumer"]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** A Standard Schema that runs `check` (the first problem as text, or `undefined`) and passes the value through unchanged. */
function schema<T>(check: (value: unknown) => string | undefined): StepsSchema<T> {
  return {
    "~standard": {
      version: 1,
      vendor: VENDOR,
      validate: (value) => {
        const issue = check(value)
        return issue === undefined ? { value: value as T } : { issues: [{ message: issue }] }
      },
    },
  }
}

function checkString(record: Record<string, unknown>, field: string): string | undefined {
  return typeof record[field] === "string" ? undefined : `${field} must be a string`
}

function checkOptionalString(record: Record<string, unknown>, field: string): string | undefined {
  return record[field] === undefined || typeof record[field] === "string" ? undefined : `${field} must be a string`
}

function checkOptionalNumber(record: Record<string, unknown>, field: string, nonNegative: boolean): string | undefined {
  const value = record[field]
  if (value === undefined) return undefined
  const ok = typeof value === "number" && Number.isFinite(value) && (!nonNegative || value >= 0)
  return ok ? undefined : `${field} must be a ${nonNegative ? "finite non-negative" : "finite"} number`
}

function checkUsableInput(value: unknown): string | undefined {
  if (!isRecord(value)) return "input must be an object"
  return checkString(value, "agent") ?? checkString(value, "model")
}

function checkUsableOutput(value: unknown): string | undefined {
  if (!isRecord(value)) return "output must be an object"
  if (typeof value.usable !== "boolean") return "usable must be a boolean"
  return checkOptionalString(value, "reason")
}

function checkLimitInput(value: unknown): string | undefined {
  if (!isRecord(value)) return "input must be an object"
  const { error } = value
  if (!isRecord(error)) return "error must be an object"
  return (
    checkString(value, "agent") ??
    checkString(value, "model") ??
    checkString(error, "type") ??
    checkString(error, "message") ??
    checkOptionalNumber(error, "status", false) ??
    checkOptionalString(error, "body") ??
    checkOptionalNumber(value, "wait_ms", true) ??
    checkOptionalNumber(value, "retry_after_ms", true)
  )
}

function checkLimitOutput(value: unknown): string | undefined {
  if (!isRecord(value)) return "output must be an object"
  if (typeof value.limit !== "boolean") return "limit must be a boolean"
  return checkOptionalNumber(value, "wait_ms", true) ?? checkOptionalString(value, "reason")
}

function checkLimitedEvent(value: unknown): string | undefined {
  if (!isRecord(value)) return "event must be an object"
  if (!LIMIT_KINDS.includes(value.kind as LimitedEvent["kind"])) return `kind must be one of ${LIMIT_KINDS.join(", ")}`
  return (
    checkString(value, "session_id") ??
    checkString(value, "agent") ??
    checkString(value, "model") ??
    checkString(value, "until") ??
    checkOptionalNumber(value, "wait_ms", true) ??
    checkOptionalString(value, "reason")
  )
}

/**
 * The definition of the RPC a plugin registers against to answer the fallback:
 *
 * - `usable`: may this agent run on this step now? `{ usable: false }` passes
 *   the step over when a launch or a move picks one. It is asked of a step
 *   only after the fallback's own checks (the model is in OpenCode's list, it
 *   is not cooling down) have passed it, in route order, until one is usable.
 * - `limit`: is this error a limit? Asked of an error the fallback's own rule
 *   does not take for one. `{ limit: true }` cools the model down and moves a
 *   routed session on.
 *
 * Handlers get the input as the fallback sends it, and a promise or a value
 * back. No answer in two seconds, an error, an answer off the schema and no
 * plugin registered all count as no answer: the fallback decides as it would
 * alone.
 */
export const STEPS_RPC = {
  id: STEPS_RPC_ID,
  methods: {
    usable: {
      input: schema<StepsUsableInput>(checkUsableInput),
      output: schema<StepsUsableOutput>(checkUsableOutput),
    },
    limit: {
      input: schema<StepsLimitInput>(checkLimitInput),
      output: schema<StepsLimitOutput>(checkLimitOutput),
    },
  },
  events: {},
} as const

/**
 * The definition of the RPC the fallback registers to announce limits. It
 * emits `limited` once for each retry event it takes for a limit, after the
 * model has been cooled down. A consumer listens with
 * `ctx.rpc(LIMITS_RPC).events.on("limited", handler)`, whose handler gets
 * OpenCode's event envelope with the `LimitedEvent` under `data`; events are
 * live only, so one emitted before the listener is attached is not replayed.
 *
 * It is a definition apart from `STEPS_RPC` because only the plugin that
 * registers a definition can emit its events, and registering `STEPS_RPC` here
 * would replace the handlers a consumer registered for it.
 */
export const LIMITS_RPC = {
  id: LIMITS_RPC_ID,
  methods: {},
  events: {
    [LIMITED_EVENT]: { schema: schema<LimitedEvent>(checkLimitedEvent) },
  },
} as const
