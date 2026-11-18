import { describe, expect, test } from "bun:test"
import { ownedKey } from "./notice"
import { STEPS_RPC, STEPS_RPC_ID, type StepsSchema } from "./rpc"

const STEP = { agent: "worker", model: "a/x#high" }
const ERROR = { type: "provider.auth", message: "bad key" }

/** Whether `schema` accepts `value`, and the value it hands back. */
function check<T>(schema: StepsSchema<T>, value: unknown) {
  const result = schema["~standard"].validate(value)
  return "value" in result ? { ok: true as const, value: result.value } : { ok: false as const, issues: result.issues }
}

describe("STEPS_RPC", () => {
  test("is registered under the plugin's own key, with no events", () => {
    expect<string>(STEPS_RPC.id).toBe(ownedKey("steps"))
    expect(STEPS_RPC_ID).toBe(STEPS_RPC.id)
    expect(Object.keys(STEPS_RPC.methods)).toEqual(["usable", "limit"])
    expect(STEPS_RPC.events).toEqual({})
  })

  test("every schema is a Standard Schema V1 that names the package", () => {
    for (const { input, output } of Object.values(STEPS_RPC.methods)) {
      for (const schema of [input, output]) {
        expect(schema["~standard"].version).toBe(1)
        expect(schema["~standard"].vendor).toBe("opencode-model-fallback")
      }
    }
  })
})

describe("usable", () => {
  const { input, output } = STEPS_RPC.methods.usable

  test("takes an agent and a model, and hands the value back as it is", () => {
    expect(check(input, STEP)).toEqual({ ok: true, value: STEP })
  })

  test.each([
    ["no object", "a/x"],
    ["null", null],
    ["a list", []],
    ["no agent", { model: "a/x" }],
    ["an agent that is not text", { ...STEP, agent: 1 }],
    ["no model", { agent: "worker" }],
    ["a model that is not text", { ...STEP, model: {} }],
  ])("refuses an input of %s", (_name, value) => {
    expect(check(input, value).ok).toBe(false)
  })

  test("takes a usable flag with or without a reason", () => {
    expect(check(output, { usable: true }).ok).toBe(true)
    expect(check(output, { usable: false, reason: "balance is empty" }).ok).toBe(true)
  })

  test.each([
    ["no object", true],
    ["no flag", { reason: "x" }],
    ["a flag that is not a boolean", { usable: "no" }],
    ["a reason that is not text", { usable: false, reason: 1 }],
  ])("refuses an output of %s", (_name, value) => {
    expect(check(output, value).ok).toBe(false)
  })
})

describe("limit", () => {
  const { input, output } = STEPS_RPC.methods.limit

  test("takes the error with its optional status and body, and an optional wait", () => {
    expect(check(input, { ...STEP, error: ERROR }).ok).toBe(true)
    expect(check(input, { ...STEP, error: { ...ERROR, status: 429, body: "{}" }, wait_ms: 0 }).ok).toBe(true)
    expect(check(input, { ...STEP, error: ERROR, wait_ms: 1, retry_after_ms: 0 }).ok).toBe(true)
    expect(check(input, { ...STEP, error: ERROR, retry_after_ms: 3_600_000 }).ok).toBe(true)
  })

  test.each([
    ["no error", STEP],
    ["an error that is not an object", { ...STEP, error: "bad" }],
    ["an error with no type", { ...STEP, error: { message: "x" } }],
    ["an error with no message", { ...STEP, error: { type: "x" } }],
    ["a status that is not a number", { ...STEP, error: { ...ERROR, status: "429" } }],
    ["a status that is not finite", { ...STEP, error: { ...ERROR, status: Infinity } }],
    ["a body that is not text", { ...STEP, error: { ...ERROR, body: {} } }],
    ["a negative wait", { ...STEP, error: ERROR, wait_ms: -1 }],
    ["a wait that is not finite", { ...STEP, error: ERROR, wait_ms: NaN }],
    ["a wait that is not a number", { ...STEP, error: ERROR, wait_ms: "1" }],
    ["a negative provider wait", { ...STEP, error: ERROR, retry_after_ms: -1 }],
    ["a provider wait that is not finite", { ...STEP, error: ERROR, retry_after_ms: Infinity }],
    ["a provider wait that is not a number", { ...STEP, error: ERROR, retry_after_ms: "1" }],
    ["no agent", { model: "a/x", error: ERROR }],
    ["no model", { agent: "worker", error: ERROR }],
  ])("refuses an input of %s", (_name, value) => {
    expect(check(input, value).ok).toBe(false)
  })

  test("takes a limit flag with an optional wait and reason", () => {
    expect(check(output, { limit: false }).ok).toBe(true)
    expect(check(output, { limit: true, wait_ms: 60_000, reason: "balance is empty" }).ok).toBe(true)
  })

  test.each([
    ["no flag", { wait_ms: 1 }],
    ["a flag that is not a boolean", { limit: 1 }],
    ["a negative wait", { limit: true, wait_ms: -1 }],
    ["a wait that is not finite", { limit: true, wait_ms: Infinity }],
    ["a reason that is not text", { limit: true, reason: [] }],
    ["no object", undefined],
  ])("refuses an output of %s", (_name, value) => {
    expect(check(output, value).ok).toBe(false)
  })
})
