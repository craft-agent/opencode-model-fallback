import { describe, expect, test } from "bun:test"
import type { Feature } from "./feature"
import { AGENT, NO_ROUTES, PARENT_ID, startLaunch, type LaunchSetup } from "./launch.testing"
import { SUBAGENT_RESULT, catalogModel } from "./testing"

const CATALOG = [catalogModel("a/x"), catalogModel("b/y"), catalogModel("c/z")]
const OTHER = { providerID: "q", id: "m" }
const INPUT = { agent: AGENT, prompt: "do it" }
const OTHER_FEATURE: Feature = { name: "other", calls: [], hooks: [], register: async () => {} }

describe("launch registration", () => {
  test("registers nothing without the routes option", async () => {
    const { running, unavailable, transforms, subagent, launch } = await startLaunch(NO_ROUTES, { catalog: CATALOG })
    expect(running).toEqual(["launch"])
    expect(unavailable).toEqual([])
    expect(transforms).toEqual([])
    expect(await launch(INPUT)).toBe(SUBAGENT_RESULT)
    expect(subagent.calls[0]!.input).toEqual(INPUT)
  })

  test("wraps the built-in subagent tool when routes are given, and takes the wrapper back on dispose", async () => {
    const { running, unavailable, transforms } = await startLaunch()
    expect(running).toEqual(["launch"])
    expect(unavailable).toEqual([])
    expect(transforms).toEqual([{ disposed: false }])
  })

  test("wraps even when no route could be read, so the problem reaches the reader", async () => {
    const { running, transforms } = await startLaunch("nope")
    expect(running).toEqual(["launch"])
    expect(transforms).toHaveLength(1)
  })

  test.each(["get", "update"] as const)("stays off when the editor has no %s, and the others run", async (member) => {
    const { running, unavailable, subagent, launch } = await startLaunch(undefined, {
      omitEditor: [member],
      catalog: CATALOG,
      others: [OTHER_FEATURE],
    })
    expect(running).toEqual(["other"])
    expect(unavailable).toEqual([{ name: "launch", reason: "the built-in subagent tool cannot be wrapped" }])
    expect(await launch(INPUT)).toBe(SUBAGENT_RESULT)
    expect(subagent.calls[0]!.input).toEqual(INPUT)
  })

  test("stays off when a call it needs is missing", async () => {
    const { running, unavailable } = await startLaunch(undefined, { omit: ["model.list"] })
    expect(running).toEqual([])
    expect(unavailable).toEqual([{ name: "launch", reason: "model.list is not available" }])
  })
})

describe("launch pass-through", () => {
  const WITH_STEPS = { catalog: CATALOG, agents: { [AGENT]: { model: OTHER } } }

  /** Launches `input` and expects the built-in tool to get it as it is and answer through unchanged. */
  async function expectUntouched(input: Record<string, unknown>, setup: LaunchSetup = WITH_STEPS, routes?: unknown) {
    const { launch, subagent } = await startLaunch(routes, setup)
    expect(await launch(input)).toBe(SUBAGENT_RESULT)
    expect(subagent.calls).toHaveLength(1)
    expect(subagent.calls[0]!.input).toBe(input)
  }

  test("a continuation goes through, even with problems and a route", async () => {
    await expectUntouched({ ...INPUT, sessionID: "ses_child" }, WITH_STEPS, { [AGENT]: ["a/x", "bad"], oops: 1 })
  })

  test("a continuation is no launch: the once notices wait for the next one", async () => {
    const { launch } = await startLaunch({ [AGENT]: ["bad"] }, WITH_STEPS)
    await launch({ ...INPUT, sessionID: "ses_child" })
    const result = await launch({ agent: "free", prompt: "x" })
    expect(result.content).toContain("[Model fallback: config ignored: ")
  })

  test("an empty sessionID is a launch", async () => {
    const { launch, subagent } = await startLaunch(undefined, WITH_STEPS)
    await launch({ ...INPUT, sessionID: "" })
    expect(subagent.calls[0]!.input.model).toBe("a/x")
  })

  test("an explicit model goes through", async () => {
    await expectUntouched({ ...INPUT, model: "z/z" })
  })

  test("an empty model does not count as explicit", async () => {
    const { launch, subagent } = await startLaunch(undefined, WITH_STEPS)
    await launch({ ...INPUT, model: "" })
    expect(subagent.calls[0]!.input.model).toBe("a/x")
  })

  test.each([[undefined], [3], [null], [{ name: AGENT }]])("an agent of %p goes through", async (agent) => {
    await expectUntouched({ agent, prompt: "x" })
  })

  test.each(["free", "constructor", "__proto__", "toString"])("the agent %p has no route of its own", async (agent) => {
    await expectUntouched({ agent, prompt: "x" })
  })

  test("a parent session with no directory goes through", async () => {
    await expectUntouched(INPUT, { ...WITH_STEPS, sessions: { [PARENT_ID]: { location: {} } } })
  })

  test("a parent session with no location goes through", async () => {
    await expectUntouched(INPUT, { ...WITH_STEPS, sessions: { [PARENT_ID]: { location: undefined } } })
  })

  test.each(["session.get", "agent.get", "model.list"])("a failure of %s goes through", async (call) => {
    const host = await startLaunch(undefined, WITH_STEPS)
    const failing = async () => {
      throw new Error("host down")
    }
    if (call === "session.get") host.ctx.session.get = failing
    else if (call === "agent.get") host.ctx.agent!.get = failing
    else host.ctx.model!.list = failing
    expect(await host.launch(INPUT)).toBe(SUBAGENT_RESULT)
    expect(host.subagent.calls[0]!.input).toBe(INPUT)
  })

  test("a catalog that cannot be read goes through", async () => {
    const host = await startLaunch(undefined, WITH_STEPS)
    host.ctx.model!.list = async () => ({ data: undefined as never })
    expect(await host.launch(INPUT)).toBe(SUBAGENT_RESULT)
    expect(host.subagent.calls[0]!.input).toEqual(INPUT)
  })

  test("an aborted call does not reach the built-in tool", async () => {
    const { launch, subagent } = await startLaunch(undefined, WITH_STEPS)
    const abort = new AbortController()
    abort.abort(new Error("stopped"))
    await expect(launch(INPUT, { signal: abort.signal })).rejects.toThrow("stopped")
    expect(subagent.calls).toEqual([])
  })

  test("a call aborted while the host answers does not reach the built-in tool", async () => {
    const host = await startLaunch(undefined, WITH_STEPS)
    const abort = new AbortController()
    host.ctx.model!.list = async () => {
      abort.abort(new Error("stopped"))
      throw new Error("host down")
    }
    await expect(host.launch(INPUT, { signal: abort.signal })).rejects.toThrow("stopped")
    expect(host.subagent.calls).toEqual([])
  })

  test("a failure of the built-in tool is its own", async () => {
    const { launch } = await startLaunch(undefined, {
      ...WITH_STEPS,
      subagent: async () => {
        throw new Error("child failed")
      },
    })
    await expect(launch(INPUT)).rejects.toThrow("child failed")
  })
})
