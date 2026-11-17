import { describe, expect, test } from "bun:test"
import type { Feature } from "./feature"
import { AGENT, PARENT_ID, startLaunch } from "./launch.testing"
import { SUBAGENT_RESULT, catalogModel } from "./testing"

const CATALOG = [catalogModel("a/x"), catalogModel("b/y")]
const OTHER = { providerID: "q", id: "m" }
const INPUT = { agent: AGENT, prompt: "do it" }
const SETUP = { catalog: CATALOG, agents: { [AGENT]: { model: OTHER } } }
const LAUNCH_NOTICE = `[Model fallback: ${AGENT} q/m → a/x; the route replaces the agent's model]`
const BROKEN: Feature = {
  name: "broken",
  calls: [],
  hooks: [],
  async register() {
    throw new Error("boom")
  },
}

describe("launch result", () => {
  test("puts the notice before a text content and the record in the metadata", async () => {
    const { launch } = await startLaunch(undefined, SETUP)
    const result = await launch(INPUT)
    expect(result.content).toBe(`${LAUNCH_NOTICE}\nchild said hi`)
    expect(result.output).toBe(SUBAGENT_RESULT.output)
    expect(result.metadata).toEqual({
      sessionID: "ses_child",
      "opencode-model-fallback.launch": {
        agent: AGENT,
        from: "q/m",
        to: "a/x",
        reason: "the route replaces the agent's model",
        skipped: [],
      },
    })
  })

  test("puts the notice in a text part before an array content", async () => {
    const parts = [{ type: "text", text: "child said hi" }]
    const { launch } = await startLaunch(undefined, { ...SETUP, subagent: async () => ({ content: parts }) })
    const result = await launch(INPUT)
    expect(result.content).toEqual([{ type: "text", text: LAUNCH_NOTICE }, ...parts])
  })

  test("makes the notice the content when the tool returned none, and keeps the output", async () => {
    const output = { sessionID: "ses_child" }
    const { launch } = await startLaunch(undefined, { ...SETUP, subagent: async () => ({ output }) })
    const result = await launch(INPUT)
    expect(result.content).toBe(LAUNCH_NOTICE)
    expect(result.output).toBe(output)
    expect(result.metadata).toHaveProperty(["opencode-model-fallback.launch", "to"], "a/x")
  })

  test("keeps the steps passed over in the record, with their reasons", async () => {
    const { launch } = await startLaunch(
      { [AGENT]: ["z/none", "a/x#high", "b/y"] },
      { ...SETUP, catalog: [catalogModel("a/x"), catalogModel("b/y")] },
    )
    const record = (await launch(INPUT)).metadata!["opencode-model-fallback.launch"]
    expect(record).toEqual({
      agent: AGENT,
      from: "q/m",
      to: "b/y",
      reason: "z/none is not in OpenCode's models; a/x#high has no variant high",
      skipped: [
        { model: "z/none", reason: "is not in OpenCode's models" },
        { model: "a/x#high", reason: "has no variant high" },
      ],
    })
  })

  test("records OpenCode's own choice when no step is usable", async () => {
    const { launch } = await startLaunch(undefined, { agents: { [AGENT]: { model: OTHER } } })
    const result = await launch(INPUT)
    expect(result.metadata).toEqual({
      sessionID: "ses_child",
      "opencode-model-fallback.launch": {
        agent: AGENT,
        from: "q/m",
        to: null,
        reason: "no step of its route is usable",
        skipped: [
          { model: "a/x", reason: "is not in OpenCode's models" },
          { model: "b/y", reason: "is not in OpenCode's models" },
          { model: "c/z", reason: "is not in OpenCode's models" },
        ],
      },
    })
  })

  test("adds nothing when the route and OpenCode agree", async () => {
    const { launch } = await startLaunch(undefined, {
      ...SETUP,
      agents: { [AGENT]: { model: { providerID: "a", id: "x" } } },
    })
    expect(await launch(INPUT)).toBe(SUBAGENT_RESULT)
  })

  test("records no source model when there is none", async () => {
    const { launch } = await startLaunch(undefined, { catalog: CATALOG, sessions: { [PARENT_ID]: {} } })
    const record = (await launch(INPUT)).metadata!["opencode-model-fallback.launch"] as { from: unknown }
    expect(record.from).toBeNull()
  })
})

describe("launch once notices", () => {
  test("puts the problems with the routes in front of the first launch, once", async () => {
    const { launch } = await startLaunch({ [AGENT]: ["a/x", "nope"], broken: "x" }, SETUP)
    const first = await launch(INPUT)
    expect(first.content).toBe(
      [
        '[Model fallback: config ignored: routes.worker[1]: "nope" is not provider/model#variant]',
        "[Model fallback: config ignored: routes.broken is not a list of models]",
        LAUNCH_NOTICE,
        "child said hi",
      ].join("\n"),
    )
    expect((await launch(INPUT)).content).toBe(`${LAUNCH_NOTICE}\nchild said hi`)
  })

  test("names a route option that is not an object", async () => {
    const { launch } = await startLaunch([], SETUP)
    expect((await launch({ agent: "free" })).content).toBe(
      "[Model fallback: config ignored: routes is not an object of agent names to lists of models]\nchild said hi",
    )
  })

  test("names a feature that stayed off", async () => {
    const { launch, running } = await startLaunch(undefined, { ...SETUP, others: [BROKEN] })
    expect(running).toEqual(["launch"])
    expect((await launch(INPUT)).content).toBe(`[Model fallback: broken is off: boom]\n${LAUNCH_NOTICE}\nchild said hi`)
    expect((await launch(INPUT)).content).toBe(`${LAUNCH_NOTICE}\nchild said hi`)
  })

  test("goes with the first launch on any path, then never again", async () => {
    const { launch, subagent } = await startLaunch({ [AGENT]: ["bad"] }, SETUP)
    const input = { agent: "free", prompt: "x" }
    const first = await launch(input)
    expect(subagent.calls[0]!.input).toBe(input)
    expect(first.content).toContain("config ignored")
    expect(first.output).toBe(SUBAGENT_RESULT.output)
    expect(await launch(input)).toBe(SUBAGENT_RESULT)
  })

  test("goes with the first launch even when its model was explicit", async () => {
    const { launch } = await startLaunch({ [AGENT]: ["bad"] }, SETUP)
    expect((await launch({ ...INPUT, model: "z/z" })).content).toContain("config ignored")
    expect(await launch({ ...INPUT, model: "z/z" })).toBe(SUBAGENT_RESULT)
  })

  test("waits for the next launch when the first one fails", async () => {
    let calls = 0
    const subagent = async () => {
      calls += 1
      if (calls === 1) throw new Error("child failed")
      return SUBAGENT_RESULT
    }
    const { launch } = await startLaunch({ [AGENT]: ["bad"] }, { ...SETUP, subagent })
    const input = { agent: "free", prompt: "x" }
    await expect(launch(input)).rejects.toThrow("child failed")
    expect((await launch(input)).content).toContain("config ignored")
  })
})
