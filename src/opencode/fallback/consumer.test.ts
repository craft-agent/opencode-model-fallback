import { describe, expect, test } from "bun:test"
import { RPC_TIMEOUT_MS, askLimit, askUsable } from "./consumer"
import { fakeContext, type FakeOptions } from "./testing"

const STEP = { providerID: "a", id: "x", variant: "high" }
const ERROR = { type: "provider.auth", status: 401, message: "bad key", response: { body: "denied" } }
/** A timeout short enough to wait out in a test. */
const SHORT_MS = 20
const HOUR_MS = 3_600_000

/** Asks `usable` of a fake host with `rpc` handlers, within `SHORT_MS`. */
function usable(rpc: FakeOptions["rpc"], fake: FakeOptions = {}) {
  const host = fakeContext({ ...fake, rpc })
  return { host, answer: askUsable(host.ctx, "worker", STEP, SHORT_MS) }
}

describe("the question usable", () => {
  test("puts the agent and the step's selector, and returns a valid answer", async () => {
    const { host, answer } = usable({ usable: () => ({ usable: false, reason: "balance is empty" }) })
    expect(await answer).toEqual({ usable: false, reason: "balance is empty" })
    expect(host.rpcCalls.map(({ method, input }) => ({ method, input }))).toEqual([
      { method: "usable", input: { agent: "worker", model: "a/x#high" } },
    ])
  })

  test("takes an answer that is a promise", async () => {
    expect(await usable({ usable: async () => ({ usable: true }) }).answer).toEqual({ usable: true })
  })

  test("is no answer when the host has no RPC", async () => {
    const { host, answer } = usable({ usable: () => ({ usable: false }) }, { omit: ["rpc"] })
    expect(await answer).toBeUndefined()
    expect(host.rpcCalls).toEqual([])
  })

  test("is no answer when nobody registered, whatever the host says", async () => {
    const { host, answer } = usable(undefined)
    expect(await answer).toBeUndefined()
    expect(host.rpcCalls).toHaveLength(1)
  })

  test("is no answer when the host's client cannot be made", async () => {
    const host = fakeContext()
    host.ctx.rpc = () => {
      throw new Error("no client")
    }
    expect(await askUsable(host.ctx, "worker", STEP, SHORT_MS)).toBeUndefined()
  })

  test("is no answer when the handler rejects or throws at once", async () => {
    expect(
      await usable({
        usable: async () => {
          throw new Error("down")
        },
      }).answer,
    ).toBeUndefined()
    expect(
      await usable({
        usable: () => {
          throw new Error("down")
        },
      }).answer,
    ).toBeUndefined()
  })

  test.each([
    ["nothing", undefined],
    ["text", "yes"],
    ["no flag", { reason: "x" }],
    ["a flag that is not a boolean", { usable: "false" }],
    ["a reason that is not text", { usable: false, reason: 1 }],
  ])("is no answer when the handler gives %s", async (_name, value) => {
    expect(await usable({ usable: () => value }).answer).toBeUndefined()
  })

  test("is no answer after the timeout, and tells the handler to stop", async () => {
    let signal: AbortSignal | undefined
    const started = Date.now()
    const { answer } = usable({
      usable: (_input, options) => {
        signal = options.signal
        return new Promise(() => {})
      },
    })
    expect(await answer).toBeUndefined()
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(signal?.aborted).toBe(true)
  })

  test("takes an answer in time, and leaves its signal alone", async () => {
    let signal: AbortSignal | undefined
    const { answer } = usable({
      usable: async (_input, options) => {
        signal = options.signal
        return { usable: false }
      },
    })
    expect(await answer).toEqual({ usable: false })
    await new Promise((done) => setTimeout(done, SHORT_MS * 2))
    expect(signal?.aborted).toBe(false)
  })

  test("waits two seconds by default", () => {
    expect(RPC_TIMEOUT_MS).toBe(2000)
  })

  test("sets a reason on one line, within its length, and drops one with nothing in it", async () => {
    const long = "x".repeat(500)
    expect((await usable({ usable: () => ({ usable: false, reason: ` a\n\t b \u202e${long}` }) }).answer)?.reason).toBe(
      `a b ${"x".repeat(195)}…`,
    )
    expect(await usable({ usable: () => ({ usable: false, reason: " \n " }) }).answer).toEqual({ usable: false })
  })
})

describe("the question limit", () => {
  /** Asks `limit` of a fake host with `rpc` handlers. */
  function limit(rpc: FakeOptions["rpc"], waitMs?: number, error: unknown = ERROR, retryAfterMs?: number) {
    const host = fakeContext({ rpc })
    return { host, answer: askLimit(host.ctx, "worker", STEP, error as never, waitMs, retryAfterMs, SHORT_MS) }
  }

  test("puts the agent, the model, the error as the schema has it and the waits OpenCode and the provider gave", async () => {
    const { host, answer } = limit(
      { limit: () => ({ limit: true, wait_ms: 5_000, reason: "empty" }) },
      90_000,
      ERROR,
      HOUR_MS,
    )
    expect(await answer).toEqual({ limit: true, wait_ms: 5_000, reason: "empty" })
    expect(host.rpcCalls[0]!.input).toEqual({
      agent: "worker",
      model: "a/x#high",
      error: { type: "provider.auth", status: 401, message: "bad key", body: "denied" },
      wait_ms: 90_000,
      retry_after_ms: HOUR_MS,
    })
  })

  test("sends a provider wait of none as zero, and leaves it out when the provider named none", async () => {
    const zero = limit({ limit: () => ({ limit: false }) }, undefined, ERROR, 0)
    await zero.answer
    expect(zero.host.rpcCalls[0]!.input).toHaveProperty("retry_after_ms", 0)
    const none = limit({ limit: () => ({ limit: false }) }, 90_000)
    await none.answer
    expect(none.host.rpcCalls[0]!.input).not.toHaveProperty("retry_after_ms")
  })

  test("leaves out the status, the body and the waits that are not there", async () => {
    const { host, answer } = limit({ limit: () => ({ limit: false }) }, undefined, { type: "x", message: "m" })
    expect(await answer).toEqual({ limit: false })
    expect(host.rpcCalls[0]!.input).toEqual({ agent: "worker", model: "a/x#high", error: { type: "x", message: "m" } })
  })

  test("asks nothing of an error it cannot describe", async () => {
    for (const error of [null, { type: "x" }, { message: "m" }]) {
      const { host, answer } = limit({ limit: () => ({ limit: true }) }, undefined, error)
      expect(await answer).toBeUndefined()
      expect(host.rpcCalls).toEqual([])
    }
  })

  test("is no answer when nobody registered, the handler throws, or the answer is off the schema", async () => {
    expect(await limit(undefined).answer).toBeUndefined()
    expect(
      await limit({
        limit: () => {
          throw new Error("down")
        },
      }).answer,
    ).toBeUndefined()
    expect(await limit({ limit: () => ({ limit: true, wait_ms: -1 }) }).answer).toBeUndefined()
  })

  test("is no answer after the timeout", async () => {
    expect(await limit({ limit: () => new Promise(() => {}) }).answer).toBeUndefined()
  })
})
