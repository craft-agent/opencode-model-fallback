import type { V2Context, V2ModelRef } from "../types"
import type { RetryEvent } from "./limit"
import { selector } from "./routes"
import {
  STEPS_RPC,
  type StepsLimitInput,
  type StepsLimitOutput,
  type StepsSchema,
  type StepsUsableInput,
  type StepsUsableOutput,
} from "./rpc"

/** The questions the fallback puts to a consumer's own plugin over OpenCode's RPC (see `rpc.ts`). */

/** How long a consumer has to answer, in milliseconds; a later answer counts as none. */
export const RPC_TIMEOUT_MS = 2000

/** The longest reason of a consumer a notice carries, in characters. */
const MAX_REASON_LENGTH = 200

/** The value `schema` accepts, or `undefined` when it refuses it. */
function accept<T>(schema: StepsSchema<T>, value: unknown): T | undefined {
  const result = schema["~standard"].validate(value)
  return "value" in result ? result.value : undefined
}

/** A consumer's reason as one line of a notice: control and invisible characters and runs of space become one space, and a long reason is cut with `…`. `undefined` when nothing is left. */
function tidyReason(reason: string | undefined): string | undefined {
  const text = reason?.replace(/[\p{C}\s]+/gu, " ").trim()
  if (!text) return undefined
  const letters = [...text]
  return letters.length > MAX_REASON_LENGTH ? `${letters.slice(0, MAX_REASON_LENGTH - 1).join("")}…` : text
}

/** `answer` with its reason tidied, and without one when nothing is left of it. */
function tidyAnswer<Answer extends { reason?: string }>(answer: Answer | undefined): Answer | undefined {
  if (!answer) return undefined
  const { reason, ...rest } = answer
  const tidy = tidyReason(reason)
  return tidy === undefined ? (rest as Answer) : ({ ...rest, reason: tidy } as Answer)
}

/**
 * Asks one question of `STEPS_RPC`: the consumer's answer when it gives one that
 * fits the schema within `timeoutMs`, else `undefined`. A host without RPC, no
 * plugin registered, an input off the schema, a call that throws or rejects and
 * a late answer are all no answer, and nothing here throws.
 */
async function ask<Input, Output>(
  ctx: V2Context,
  method: keyof typeof STEPS_RPC.methods,
  schema: { input: StepsSchema<Input>; output: StepsSchema<Output> },
  input: () => Input,
  timeoutMs: number,
): Promise<Output | undefined> {
  if (typeof ctx.rpc !== "function") return undefined
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const question = accept(schema.input, input())
    const call = ctx.rpc(STEPS_RPC)[method]
    if (question === undefined || typeof call !== "function") return undefined
    const late = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => {
        controller.abort()
        resolve(undefined)
      }, timeoutMs)
    })
    return accept(schema.output, await Promise.race([call(question, { signal: controller.signal }), late]))
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/** Asks the consumer whether `agent` may run on `step` now; `undefined` is no answer, which counts as usable. */
export async function askUsable(
  ctx: V2Context,
  agent: string,
  step: V2ModelRef,
  timeoutMs = RPC_TIMEOUT_MS,
): Promise<StepsUsableOutput | undefined> {
  const input = (): StepsUsableInput => ({ agent, model: selector(step) })
  return tidyAnswer(await ask(ctx, "usable", STEPS_RPC.methods.usable, input, timeoutMs))
}

/** Asks the consumer whether `error` of `model` is a limit, with the wait OpenCode would make before it retried (`waitMs`, when it will) and the wait the provider asked for (`retryAfterMs`, when it named one); `undefined` is no answer, which counts as not a limit. */
export async function askLimit(
  ctx: V2Context,
  agent: string,
  model: V2ModelRef,
  error: RetryEvent["error"],
  waitMs: number | undefined,
  retryAfterMs: number | undefined,
  timeoutMs = RPC_TIMEOUT_MS,
): Promise<StepsLimitOutput | undefined> {
  const input = (): StepsLimitInput => ({
    agent,
    model: selector(model),
    error: {
      type: error.type,
      ...(error.status !== undefined && { status: error.status }),
      message: error.message,
      ...(error.response?.body !== undefined && { body: error.response.body }),
    },
    ...(waitMs !== undefined && { wait_ms: waitMs }),
    ...(retryAfterMs !== undefined && { retry_after_ms: retryAfterMs }),
  })
  return tidyAnswer(await ask(ctx, "limit", STEPS_RPC.methods.limit, input, timeoutMs))
}
