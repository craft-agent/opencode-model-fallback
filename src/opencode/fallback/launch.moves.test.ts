import { describe, expect, test } from "bun:test"
import { fakeClock, START_MS } from "./cooldowns.testing"
import { AGENT, startLaunch, type LaunchHarness, type LaunchSetup } from "./launch.testing"
import { MOVES_KEY, type MoveRecord } from "./moves.record"
import { SUBAGENT_RESULT, catalogModel } from "./testing"
import type { V2ExecutorResult } from "../types"

const CHILD_ID = "ses_child"
const AT = new Date(START_MS).toISOString()
const MOVE: MoveRecord = { from: "a/x", to: "b/y", reason: "a/x hit a quota limit", at: AT }
const SECOND: MoveRecord = { from: "b/y", to: "c/z", reason: "b/y hit a rate limit", at: AT }
const STOP: MoveRecord = { from: "c/z", to: null, reason: "c/z hit a quota limit; no usable step left", at: AT }
const MOVE_NOTICE = `[Model fallback: ${AGENT} a/x → b/y; a/x hit a quota limit]`
const SECOND_NOTICE = `[Model fallback: ${AGENT} b/y → c/z; b/y hit a rate limit]`
const STOP_NOTICE = `[Model fallback: ${AGENT} stopped on c/z; c/z hit a quota limit; no usable step left]`
const INPUT = { agent: AGENT, prompt: "do it", model: "z/z" }

/** The session of the child of the tests, with the moves it holds. */
function child(...moves: MoveRecord[]) {
  return { agent: AGENT, metadata: { owner: "me", [MOVES_KEY]: moves } }
}

/** Starts the launch feature over a fake clock, with `setup` on top. */
function start(setup: LaunchSetup = {}) {
  return startLaunch(undefined, { now: fakeClock().now, ...setup })
}

describe("moves told to the parent", () => {
  test("a move of the child goes before the child's reply, and into the result's metadata", async () => {
    const { launch } = await start({ sessions: { [CHILD_ID]: child(MOVE) } })
    const result = await launch(INPUT)
    expect(result.content).toBe(`${MOVE_NOTICE}\nchild said hi`)
    expect(result.output).toBe(SUBAGENT_RESULT.output)
    expect(result.metadata).toEqual({ sessionID: CHILD_ID, [MOVES_KEY]: [MOVE] })
  })

  test("a stop of the child is told as a stop", async () => {
    const { launch } = await start({ sessions: { [CHILD_ID]: child(MOVE, SECOND, STOP) } })
    const result = await launch(INPUT)
    expect(result.content).toBe(`${MOVE_NOTICE}\n${SECOND_NOTICE}\n${STOP_NOTICE}\nchild said hi`)
    expect(result.metadata![MOVES_KEY]).toEqual([MOVE, SECOND, STOP])
  })

  test("follows the launch's own notice", async () => {
    const other = { providerID: "q", id: "m" }
    const { launch } = await start({
      catalog: [catalogModel("a/x")],
      agents: { [AGENT]: { model: other } },
      sessions: { [CHILD_ID]: child(MOVE) },
    })
    const result = await launch({ agent: AGENT, prompt: "do it" })
    expect(result.content).toBe(
      `[Model fallback: ${AGENT} q/m → a/x; the route replaces the agent's model]\n${MOVE_NOTICE}\nchild said hi`,
    )
    expect(Object.keys(result.metadata!).sort()).toEqual([
      "opencode-model-fallback.launch",
      "opencode-model-fallback.moves",
      "sessionID",
    ])
  })

  test("tells a move the child made while the call ran, and not one it inherited from before", async () => {
    const clock = fakeClock()
    const inherited = { ...MOVE, at: new Date(START_MS - 1).toISOString() }
    let host!: LaunchHarness
    host = await start({
      now: clock.now,
      sessions: { [CHILD_ID]: child(inherited) },
      subagent: async () => {
        host.sessions[CHILD_ID] = child(inherited, SECOND)
        return SUBAGENT_RESULT
      },
    })
    const result = await host.launch(INPUT)
    expect(result.content).toBe(`${SECOND_NOTICE}\nchild said hi`)
    expect(result.metadata![MOVES_KEY]).toEqual([SECOND])
  })

  test("names the agent from the call when the child's session has none", async () => {
    const { launch } = await start({ sessions: { [CHILD_ID]: { metadata: { [MOVES_KEY]: [MOVE] } } } })
    expect((await launch(INPUT)).content).toContain(MOVE_NOTICE)
    expect((await launch({ prompt: "x" })).content).toContain(`[Model fallback: subagent a/x → b/y;`)
  })

  test("adds nothing when the child made no move", async () => {
    for (const session of [child(), { agent: AGENT }, {}]) {
      const { launch } = await start({ sessions: { [CHILD_ID]: session } })
      expect(await launch(INPUT)).toBe(SUBAGENT_RESULT)
    }
  })

  test("leaves out an entry that is not a move", async () => {
    const { launch } = await start({
      sessions: { [CHILD_ID]: { agent: AGENT, metadata: { [MOVES_KEY]: ["junk", MOVE, { from: "a/x" }] } } },
    })
    expect((await launch(INPUT)).metadata![MOVES_KEY]).toEqual([MOVE])
  })
})

describe("moves of a continued child", () => {
  const CONTINUED = { ...INPUT, sessionID: CHILD_ID }

  test("tells only the moves made after the call began", async () => {
    let host!: LaunchHarness
    host = await start({
      sessions: { [CHILD_ID]: child(MOVE) },
      subagent: async () => {
        host.sessions[CHILD_ID] = child(MOVE, SECOND, STOP)
        return SUBAGENT_RESULT
      },
    })
    const result = await host.launch(CONTINUED)
    expect(result.content).toBe(`${SECOND_NOTICE}\n${STOP_NOTICE}\nchild said hi`)
    expect(result.metadata).toEqual({ sessionID: CHILD_ID, [MOVES_KEY]: [SECOND, STOP] })
    expect(host.subagent.calls[0]!.input).toBe(CONTINUED)
  })

  test("tells a move even when its time is not after the call began", async () => {
    const early = { ...SECOND, at: new Date(START_MS - 60_000).toISOString() }
    let host!: LaunchHarness
    host = await start({
      sessions: { [CHILD_ID]: child(MOVE) },
      subagent: async () => {
        host.sessions[CHILD_ID] = child(MOVE, early)
        return SUBAGENT_RESULT
      },
    })
    expect((await host.launch(CONTINUED)).content).toBe(`${SECOND_NOTICE}\nchild said hi`)
  })

  test("leaves the result as it is when the child made no move", async () => {
    const { launch, subagent } = await start({ sessions: { [CHILD_ID]: child(MOVE) } })
    expect(await launch(CONTINUED)).toBe(SUBAGENT_RESULT)
    expect(subagent.calls[0]!.input).toBe(CONTINUED)
  })

  test("is no launch: the once notices still wait for the next one", async () => {
    const { launch } = await startLaunch({ [AGENT]: ["bad"] }, { sessions: { [CHILD_ID]: child(MOVE) } })
    expect((await launch(CONTINUED)).content).toBe(`child said hi`)
    expect((await launch({ agent: "free", prompt: "x" })).content).toContain("config ignored")
  })

  test("tells nothing when the child could not be counted before the call", async () => {
    let host!: LaunchHarness
    let reads = 0
    host = await start({
      sessions: { [CHILD_ID]: child(MOVE) },
      subagent: async () => {
        host.sessions[CHILD_ID] = child(MOVE, SECOND)
        return SUBAGENT_RESULT
      },
    })
    const get = host.ctx.session.get
    host.ctx.session.get = async (input) => {
      reads += 1
      if (reads === 1) throw new Error("host down")
      return get(input)
    }
    expect(await host.launch(CONTINUED)).toBe(SUBAGENT_RESULT)
  })

  test("a failure of the built-in tool is its own", async () => {
    const { launch } = await start({
      sessions: { [CHILD_ID]: child(MOVE) },
      subagent: async () => {
        throw new Error("child failed")
      },
    })
    await expect(launch(CONTINUED)).rejects.toThrow("child failed")
  })
})

describe("the child of a call", () => {
  const WITHOUT_ID = async (_input: unknown, context: { progress(update: Record<string, unknown>): Promise<void> }) => {
    await context.progress({ sessionID: "ses_kid", status: "started" })
    return { content: "hi" } satisfies V2ExecutorResult
  }

  test("is the one the progress updates name when the result's metadata does not", async () => {
    const { launch } = await start({ sessions: { ses_kid: child(MOVE) }, subagent: WITHOUT_ID })
    expect((await launch(INPUT)).content).toBe(`${MOVE_NOTICE}\nhi`)
  })

  test("passes every progress update on, as it is", async () => {
    const updates: Record<string, unknown>[] = []
    const { launch } = await start({ subagent: WITHOUT_ID })
    await launch(INPUT, {
      progress: async (update) => {
        updates.push(update)
      },
    })
    expect(updates).toEqual([{ sessionID: "ses_kid", status: "started" }])
  })

  test("is the one the result's metadata names before one a progress update named", async () => {
    const { launch } = await start({
      sessions: { ses_kid: child(SECOND), [CHILD_ID]: child(MOVE) },
      subagent: async (_input, context) => {
        await WITHOUT_ID(_input, context)
        return SUBAGENT_RESULT
      },
    })
    expect((await launch(INPUT)).content).toBe(`${MOVE_NOTICE}\nchild said hi`)
  })

  test("is unknown when no update names a session, so nothing is told", async () => {
    const { launch } = await start({
      sessions: { [CHILD_ID]: child(MOVE) },
      subagent: async (_input, context) => {
        await context.progress({ sessionID: "not-a-session" })
        await context.progress({ status: "running" })
        return { content: "hi" }
      },
    })
    expect((await launch(INPUT)).content).toBe("hi")
  })

  test("tells nothing when the child cannot be read", async () => {
    const host = await start({ sessions: { [CHILD_ID]: child(MOVE) } })
    host.ctx.session.get = async () => {
      throw new Error("host down")
    }
    expect(await host.launch(INPUT)).toBe(SUBAGENT_RESULT)
  })

  test("tells nothing for a child whose session holds no readable metadata", async () => {
    const host = await start()
    host.ctx.session.get = async () => undefined as never
    expect(await host.launch(INPUT)).toBe(SUBAGENT_RESULT)
  })

  test("a failure of the built-in tool is its own", async () => {
    const { launch } = await start({
      sessions: { [CHILD_ID]: child(MOVE) },
      subagent: async () => {
        throw new Error("child failed")
      },
    })
    await expect(launch(INPUT)).rejects.toThrow("child failed")
  })
})
