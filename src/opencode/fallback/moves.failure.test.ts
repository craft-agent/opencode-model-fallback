import { describe, expect, test } from "bun:test"
import { START_MS } from "./cooldowns.testing"
import { AGENT, PARENT_ID, ROUTES } from "./launch.testing"
import { LIMITS } from "./limits"
import { MOVES } from "./moves"
import { CATALOG, FIRST, SESSION_ID, startMoves } from "./moves.testing"
import { FEATURES, setupFallback } from "./setup"
import { executorContext, fakeContext } from "./testing"

const HOUR_MS = 3_600_000
const WAIT_MS = 90_000

/** A decision of OpenCode's to retry after a wait: a new object each time, so a test can tell it from one a handler made. */
function waiting(delay = 7_000) {
  return { retry: true as const, delay }
}

describe("a failure while moving", () => {
  test.each(["session.get", "model.list", "session.switchModel"])(
    "leaves OpenCode's decision as it was when %s fails, and the cooldown stays",
    async (call) => {
      const host = await startMoves({ sessions: { [SESSION_ID]: { parentID: PARENT_ID } } })
      const failing = async () => {
        throw new Error("host down")
      }
      if (call === "session.get") host.ctx.session.get = failing
      else if (call === "model.list") host.ctx.model!.list = failing
      else host.ctx.session.switchModel = failing
      const decision = waiting()
      expect((await host.retry({ decision })).decision).toBe(decision)
      expect(decision).toEqual({ retry: true, delay: 7_000 })
      expect(host.updates).toEqual([])
      expect(host.cooling(FIRST)).toBe(START_MS + 7_000)
    },
  )

  test("leaves the decision when the catalog cannot be read", async () => {
    const host = await startMoves()
    host.ctx.model!.list = async () => ({ data: undefined as never })
    const decision = waiting()
    expect((await host.retry({ decision })).decision).toBe(decision)
    expect(host.switches).toEqual([])
  })

  test("never throws, whatever the event holds", async () => {
    const { fire } = await startMoves()
    for (const event of [
      { sessionID: SESSION_ID, agent: AGENT },
      { sessionID: SESSION_ID, agent: AGENT, model: undefined, error: { type: "provider.quota" } },
      {},
      null,
    ]) {
      await expect(fire("retry", event as never)).resolves.toBeUndefined()
    }
  })
})

describe("the cooldown of a move", () => {
  test.each([
    ["limits before moves", [LIMITS, MOVES]],
    ["moves before limits", [MOVES, LIMITS]],
    ["moves alone", [MOVES]],
  ])("comes from OpenCode's own decision, with %s", async (_name, features) => {
    const host = await startMoves({ features })
    const event = await host.retry({ decision: waiting(WAIT_MS) })
    expect(event.decision).toEqual({ retry: true, delay: 0 })
    expect(host.cooling(FIRST)).toBe(START_MS + WAIT_MS)
  })

  test.each([
    ["limits before moves", [LIMITS, MOVES]],
    ["moves before limits", [MOVES, LIMITS]],
  ])("is the default one for a quota error OpenCode will not retry, with %s", async (_name, features) => {
    const host = await startMoves({ features })
    await host.retry()
    expect(host.cooling(FIRST)).toBe(START_MS + HOUR_MS)
  })

  test("is the one of the limit even where the session moves no further", async () => {
    const host = await startMoves({ sessions: { [SESSION_ID]: { parentID: PARENT_ID } } })
    const event = await host.retry({ model: { providerID: "c", id: "z" }, decision: waiting(WAIT_MS) })
    expect(event.decision).toEqual({ retry: false })
    expect(host.cooling({ providerID: "c", id: "z" })).toBe(START_MS + WAIT_MS)
  })
})

describe("a host without the calls of a move", () => {
  const CATALOG_ONLY = { catalog: CATALOG, options: { routes: ROUTES } }

  test.each(["session.switchModel", "session.update", "model.list"] as const)(
    "still records cooldowns when it lacks %s, and tells once that moves are off",
    async (missing) => {
      const host = fakeContext({ ...CATALOG_ONLY, omit: [missing] })
      const setup = await setupFallback(host.ctx, FEATURES, { env: { HOME: "/home/tester" }, persist: false })
      expect(setup.running).toEqual(missing === "model.list" ? ["events", "limits"] : ["events", "launch", "limits"])
      expect(setup.unavailable.find((feature) => feature.name === "moves")).toEqual({
        name: "moves",
        reason: `${missing} is not available`,
      })

      const decision = waiting()
      await host.fire("retry", {
        sessionID: SESSION_ID,
        agent: AGENT,
        model: FIRST,
        error: { type: "provider.quota", message: "out of quota" },
        decision,
      })
      expect(decision).toEqual({ retry: true, delay: 7_000 })
      expect(host.switches).toEqual([])

      if (missing === "model.list") return
      const launch = (input: Record<string, unknown>) =>
        host.subagent.execute(input, executorContext({ sessionID: PARENT_ID }))
      const first = await launch({ agent: AGENT, prompt: "do it" })
      expect(host.subagent.calls[0]!.input.model).toBe("b/y")
      expect(first.content).toContain(`[Model fallback: moves is off: ${missing} is not available]`)
      const second = await launch({ agent: AGENT, prompt: "again" })
      expect(second.content).not.toContain("moves is off")
    },
  )
})
