import { describe, expect, test } from "bun:test"
import { AGENT, NO_ROUTES } from "./launch.testing"
import { MOVES } from "./moves"
import { readMoves } from "./moves.record"
import { CATALOG, CHILD, FIRST, SESSION_ID, retryEvent, startMoves } from "./moves.testing"
import { catalogModel } from "./testing"

const B = { providerID: "b", id: "y" }
const C = { providerID: "c", id: "z" }
const MOVED = { retry: true, delay: 0 }
const STOPPED = { retry: false } as const

/** A decision of OpenCode's to retry after a wait: a new object each time, so a test can tell it from one a handler made. */
function waiting(delay = 7_000) {
  return { retry: true as const, delay }
}

describe("moves registration", () => {
  test("registers nothing with no routes configured", async () => {
    const { hooks, running } = await startMoves({ routes: NO_ROUTES })
    expect(running).toEqual(["limits", "moves"])
    expect(hooks).toEqual([])
  })

  test("takes the retry hook when routes are configured", async () => {
    const { hooks, running } = await startMoves({ features: [MOVES] })
    expect(running).toEqual(["moves"])
    expect(hooks.map((hook) => hook.name)).toEqual(["retry"])
  })
})

describe("moves to the next step", () => {
  test("moves a session from the first step to the second, retrying at once", async () => {
    const { retry, switches } = await startMoves()
    expect((await retry()).decision).toEqual(MOVED)
    expect(switches).toEqual([{ sessionID: SESSION_ID, model: B }])
  })

  test("replaces a decision to retry after a wait", async () => {
    const { retry, switches } = await startMoves()
    expect((await retry({ decision: waiting(90_000) })).decision).toEqual(MOVED)
    expect(switches).toHaveLength(1)
  })

  test("moves on from the second step to the third", async () => {
    const { retry, switches } = await startMoves()
    expect((await retry({ model: B })).decision).toEqual(MOVED)
    expect(switches).toEqual([{ sessionID: SESSION_ID, model: C }])
  })

  test("passes over a step whose model is cooling down", async () => {
    const { retry, switches } = await startMoves()
    await retry({ agent: "free", model: B })
    expect((await retry()).decision).toEqual(MOVED)
    expect(switches).toEqual([{ sessionID: SESSION_ID, model: C }])
  })

  test("passes over a step that is not in OpenCode's models", async () => {
    const { retry, switches } = await startMoves({ catalog: [CATALOG[0]!, CATALOG[2]!] })
    expect((await retry()).decision).toEqual(MOVED)
    expect(switches).toEqual([{ sessionID: SESSION_ID, model: C }])
  })

  test("asks the catalog of the session's directory", async () => {
    const asked: unknown[] = []
    const host = await startMoves({ sessions: { [SESSION_ID]: { location: { directory: "/other" } } } })
    const list = host.ctx.model!.list!
    host.ctx.model!.list = async (input) => {
      asked.push(input)
      return list(input)
    }
    await host.retry()
    expect(asked).toEqual([{ location: { directory: "/other" } }])
  })

  test("takes the step's variant along", async () => {
    const { retry, switches } = await startMoves({
      routes: { [AGENT]: ["a/x", "b/y#high"] },
      catalog: [catalogModel("a/x"), catalogModel("b/y", { variants: [{ id: "high" }] })],
    })
    await retry()
    expect(switches).toEqual([{ sessionID: SESSION_ID, model: { ...B, variant: "high" } }])
  })

  test("passes over a step whose model lacks its variant", async () => {
    const { retry, switches } = await startMoves({ routes: { [AGENT]: ["a/x", "b/y#high", "c/z"] } })
    await retry()
    expect(switches).toEqual([{ sessionID: SESSION_ID, model: C }])
  })
})

describe("the session's variant", () => {
  const HIGH = { ...FIRST, variant: "high" }
  const B_HIGH = { ...B, variant: "high" }
  const B_LOW = { ...B, variant: "low" }
  const withHigh = [catalogModel("a/x"), catalogModel("b/y", { variants: [{ id: "high" }, { id: "low" }] })]

  test("carries onto a next step with no variant whose model has it, and records it", async () => {
    const { retry, switches, updates } = await startMoves({ catalog: [...withHigh, CATALOG[2]!] })
    expect((await retry({ model: HIGH })).decision).toEqual(MOVED)
    expect(switches).toEqual([{ sessionID: SESSION_ID, model: B_HIGH }])
    const [update] = updates
    expect(readMoves(update?.metadata).map((move) => move.to)).toEqual(["b/y#high"])
  })

  test("is left off a next step whose model lacks it", async () => {
    const { retry, switches } = await startMoves()
    await retry({ model: HIGH })
    expect(switches).toEqual([{ sessionID: SESSION_ID, model: B }])
  })

  test("never replaces the variant of a next step", async () => {
    const routes = { [AGENT]: ["a/x", "b/y#low"] }
    const { retry, switches } = await startMoves({ routes, catalog: withHigh })
    await retry({ model: HIGH })
    expect(switches).toEqual([{ sessionID: SESSION_ID, model: B_LOW }])
  })

  test("is the variant a cooldown is checked for", async () => {
    const { retry, switches } = await startMoves({ catalog: [...withHigh, CATALOG[2]!] })
    await retry({ agent: "free", model: B_HIGH })
    await retry({ model: HIGH })
    await retry({ model: { ...FIRST, variant: "low" } })
    expect(switches).toEqual([
      { sessionID: SESSION_ID, model: C },
      { sessionID: SESSION_ID, model: B_LOW },
    ])
  })

  test("is the variant the consumer is asked about", async () => {
    const asked: unknown[] = []
    const rpc = {
      usable: (input: unknown) => {
        asked.push(input)
        return { usable: true }
      },
    }
    const { retry } = await startMoves({ catalog: withHigh, rpc })
    await retry({ model: HIGH })
    expect(asked).toEqual([{ agent: AGENT, model: "b/y#high" }])
  })
})

describe("who moves", () => {
  test("finds the place by variant, and the next step after it", async () => {
    const routes = { [AGENT]: ["a/x#low", "a/x#high", "b/y"] }
    const catalog = [catalogModel("a/x", { variants: [{ id: "low" }, { id: "high" }] }), catalogModel("b/y")]
    const { retry, switches } = await startMoves({ routes, catalog })
    await retry({ model: { providerID: "a", id: "x", variant: "high" } })
    expect(switches).toEqual([{ sessionID: SESSION_ID, model: B }])
  })

  test("takes an event with no variant for the first step of its provider and model", async () => {
    const routes = { [AGENT]: ["a/x#high", "b/y"] }
    const { retry, switches } = await startMoves({ routes, catalog: [catalogModel("a/x"), catalogModel("b/y")] })
    expect((await retry()).decision).toEqual(MOVED)
    expect(switches).toEqual([{ sessionID: SESSION_ID, model: B }])
  })

  test("prefers an exact step to the first of the same model", async () => {
    const routes = { [AGENT]: ["a/x#low", "a/x", "b/y"] }
    const catalog = [catalogModel("a/x", { variants: [{ id: "low" }] }), catalogModel("b/y")]
    const { retry, switches } = await startMoves({ routes, catalog })
    await retry()
    expect(switches).toEqual([{ sessionID: SESSION_ID, model: B }])
  })

  test("places a model with a variant on the step of its model with no variant", async () => {
    const { retry, switches } = await startMoves()
    expect((await retry({ model: { ...FIRST, variant: "max" } })).decision).toEqual(MOVED)
    expect(switches).toEqual([{ sessionID: SESSION_ID, model: B }])
  })

  test("prefers an exact step to a step of its model with no variant", async () => {
    const routes = { [AGENT]: ["a/x", "a/x#high", "b/y"] }
    const catalog = [catalogModel("a/x", { variants: [{ id: "high" }] }), catalogModel("b/y")]
    const { retry, switches } = await startMoves({ routes, catalog })
    await retry({ model: { ...FIRST, variant: "high" } })
    expect(switches).toEqual([{ sessionID: SESSION_ID, model: B }])
  })

  test("leaves a model off the route to OpenCode", async () => {
    const routes = { [AGENT]: ["a/x#low", "b/y"] }
    const { retry, switches, updates } = await startMoves({ routes })
    const offRoute = [
      { providerID: "q", id: "m" },
      { providerID: "a", id: "x", variant: "max" },
    ]
    for (const model of offRoute) {
      const decision = waiting()
      expect((await retry({ model, decision })).decision).toBe(decision)
    }
    expect([switches, updates]).toEqual([[], []])
  })

  test("leaves an agent with no route to OpenCode", async () => {
    const { retry, switches } = await startMoves()
    const decision = waiting()
    expect((await retry({ agent: "free", decision })).decision).toBe(decision)
    expect(switches).toEqual([])
  })

  test("takes the agent from the session when the event names none", async () => {
    const { retry, switches } = await startMoves({ sessions: { [SESSION_ID]: { agent: AGENT } } })
    expect((await retry({ agent: undefined })).decision).toEqual(MOVED)
    expect(switches).toHaveLength(1)
  })

  test.each([
    ["an agent with no route", { agent: "free" }],
    ["no agent", {}],
  ])("leaves a session of %s to OpenCode", async (_name, session) => {
    const { retry, switches } = await startMoves({ sessions: { [SESSION_ID]: session } })
    const decision = waiting()
    expect((await retry({ agent: undefined, decision })).decision).toBe(decision)
    expect(switches).toEqual([])
  })

  test("leaves a session with no directory to OpenCode", async () => {
    const { retry, switches } = await startMoves({ sessions: { [SESSION_ID]: { location: {} } } })
    const decision = waiting()
    expect((await retry({ decision })).decision).toBe(decision)
    expect(switches).toEqual([])
  })

  test("leaves an error that is not a limit to OpenCode", async () => {
    const { retry, switches, updates } = await startMoves()
    const auth = { type: "provider.auth", status: 401, message: "bad key" }
    const slow = { type: "provider.rate-limit", message: "slow down" }
    for (const [error, decision] of [
      [auth, waiting(60_000)],
      [slow, waiting(1_000)],
    ] as const) {
      expect((await retry({ error, decision })).decision).toBe(decision)
    }
    expect([switches, updates]).toEqual([[], []])
  })
})

describe("nowhere to move", () => {
  test("leaves a primary agent on its last step to OpenCode", async () => {
    const { retry, switches, updates } = await startMoves()
    const decision = waiting()
    expect((await retry({ model: C, decision })).decision).toBe(decision)
    expect([switches, updates]).toEqual([[], []])
  })

  test("stops a child on its last step", async () => {
    const { retry, switches } = await startMoves({ sessions: { [SESSION_ID]: CHILD } })
    expect((await retry({ model: C, decision: waiting() })).decision).toEqual(STOPPED)
    expect(switches).toEqual([])
  })

  test("stops a child when no step after its place is usable", async () => {
    const { retry, switches } = await startMoves({ sessions: { [SESSION_ID]: CHILD }, catalog: [CATALOG[0]!] })
    expect((await retry({ decision: waiting() })).decision).toEqual(STOPPED)
    expect(switches).toEqual([])
  })

  test("leaves a primary agent with no usable step to OpenCode", async () => {
    const { retry } = await startMoves({ catalog: [CATALOG[0]!] })
    const decision = waiting()
    expect((await retry({ decision })).decision).toBe(decision)
  })
})
