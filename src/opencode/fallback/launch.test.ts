import { describe, expect, test } from "bun:test"
import { AGENT, PARENT_ID, startLaunch } from "./launch.testing"
import { SUBAGENT_RESULT, catalogModel } from "./testing"

const CATALOG = [catalogModel("a/x"), catalogModel("b/y"), catalogModel("c/z")]
const OTHER = { providerID: "q", id: "m" }
const INPUT = { agent: AGENT, prompt: "do it" }
const PREFIX = "[Model fallback: "

/** The text the launch put in front of the child's reply, with the reply's own text taken off. */
function noticeOf(result: { content?: unknown }): string {
  return (result.content as string).replace(/\n?child said hi$/, "")
}

describe("launch selection", () => {
  test("takes the first step, and says it replaced the agent's model", async () => {
    const { launch, subagent } = await startLaunch(undefined, {
      catalog: CATALOG,
      agents: { [AGENT]: { model: OTHER } },
    })
    const result = await launch(INPUT)
    expect(subagent.calls[0]!.input).toEqual({ ...INPUT, model: "a/x" })
    expect(noticeOf(result)).toBe(`${PREFIX}${AGENT} q/m → a/x; the route replaces the agent's model]`)
  })

  test("says it replaced the inherited model when the agent has none", async () => {
    const { launch, subagent } = await startLaunch(undefined, {
      catalog: CATALOG,
      sessions: { [PARENT_ID]: { model: OTHER } },
    })
    const result = await launch(INPUT)
    expect(subagent.calls[0]!.input.model).toBe("a/x")
    expect(noticeOf(result)).toBe(`${PREFIX}${AGENT} q/m → a/x; the route replaces the inherited model]`)
  })

  test("says there was no model when neither the agent nor the parent has one", async () => {
    const { launch } = await startLaunch(undefined, { catalog: CATALOG })
    expect(noticeOf(await launch(INPUT))).toBe(
      `${PREFIX}${AGENT} (no model) → a/x; the route replaces the inherited model]`,
    )
  })

  test("passes over a step that is not in OpenCode's models, and says why", async () => {
    const { launch, subagent } = await startLaunch(undefined, {
      catalog: [catalogModel("b/y"), catalogModel("c/z")],
      agents: { [AGENT]: { model: OTHER } },
    })
    const result = await launch(INPUT)
    expect(subagent.calls[0]!.input.model).toBe("b/y")
    expect(noticeOf(result)).toBe(`${PREFIX}${AGENT} q/m → b/y; a/x is not in OpenCode's models]`)
  })

  test.each([
    ["disabled", { enabled: false }],
    ["not active", { status: "deprecated" }],
    ["without tools", { capabilities: { tools: false } }],
  ])("passes over a step whose model is %s", async (_name, overrides) => {
    const { launch, subagent } = await startLaunch(undefined, {
      catalog: [catalogModel("a/x", overrides), catalogModel("b/y"), catalogModel("c/z")],
      agents: { [AGENT]: { model: OTHER } },
    })
    const result = await launch(INPUT)
    expect(subagent.calls[0]!.input.model).toBe("b/y")
    expect(noticeOf(result)).toBe(`${PREFIX}${AGENT} q/m → b/y; a/x cannot run a subagent]`)
  })

  test("lists every step passed over, in the order of the route", async () => {
    const { launch, subagent } = await startLaunch(undefined, {
      catalog: [catalogModel("b/y", { enabled: false }), catalogModel("c/z")],
      agents: { [AGENT]: { model: OTHER } },
    })
    const result = await launch(INPUT)
    expect(subagent.calls[0]!.input.model).toBe("c/z")
    expect(noticeOf(result)).toBe(
      `${PREFIX}${AGENT} q/m → c/z; a/x is not in OpenCode's models; b/y cannot run a subagent]`,
    )
  })

  test("passes over a step whose variant the model lacks, and takes one that has it", async () => {
    const routes = { [AGENT]: ["a/x#high", "b/y#high"] }
    const { launch, subagent } = await startLaunch(routes, {
      catalog: [
        catalogModel("a/x", { variants: [{ id: "low" }] }),
        catalogModel("b/y", { variants: [{ id: "high" }] }),
      ],
      agents: { [AGENT]: { model: OTHER } },
    })
    const result = await launch(INPUT)
    expect(subagent.calls[0]!.input.model).toBe("b/y#high")
    expect(noticeOf(result)).toBe(`${PREFIX}${AGENT} q/m → b/y#high; a/x#high has no variant high]`)
  })

  test("launches on the step's variant when the model has it", async () => {
    const { launch, subagent } = await startLaunch(
      { [AGENT]: ["a/x#high"] },
      { catalog: [catalogModel("a/x", { variants: [{ id: "high" }] })] },
    )
    await launch(INPUT)
    expect(subagent.calls[0]!.input.model).toBe("a/x#high")
  })

  test("leaves the launch alone when the chosen step is the agent's model", async () => {
    const { launch, subagent } = await startLaunch(undefined, {
      catalog: CATALOG,
      agents: { [AGENT]: { model: { providerID: "a", id: "x" } } },
    })
    const input = { ...INPUT }
    expect(await launch(input)).toBe(SUBAGENT_RESULT)
    expect(subagent.calls[0]!.input).toBe(input)
  })

  test("leaves the launch alone when the chosen step is the inherited model and the agent has none", async () => {
    const { launch, subagent } = await startLaunch(undefined, {
      catalog: CATALOG,
      sessions: { [PARENT_ID]: { model: { providerID: "a", id: "x" } } },
    })
    const input = { ...INPUT }
    expect(await launch(input)).toBe(SUBAGENT_RESULT)
    expect(subagent.calls[0]!.input).toBe(input)
  })

  test("reads the parent's default variant as no variant", async () => {
    const { launch, subagent } = await startLaunch(undefined, {
      catalog: CATALOG,
      sessions: { [PARENT_ID]: { model: { providerID: "a", id: "x", variant: "default" } } },
    })
    const input = { ...INPUT }
    expect(await launch(input)).toBe(SUBAGENT_RESULT)
    expect(subagent.calls[0]!.input).toBe(input)
  })

  test("compares with the agent's model, not the parent's, when the agent has one", async () => {
    const { launch, subagent } = await startLaunch(undefined, {
      catalog: CATALOG,
      agents: { [AGENT]: { model: { providerID: "a", id: "x" } } },
      sessions: { [PARENT_ID]: { model: OTHER } },
    })
    expect(await launch(INPUT)).toBe(SUBAGENT_RESULT)
    expect(subagent.calls[0]!.input.model).toBeUndefined()
  })

  test("leaves the launch alone when the chosen step is the model even after steps were passed over", async () => {
    const { launch, subagent } = await startLaunch(undefined, {
      catalog: [catalogModel("b/y"), catalogModel("c/z")],
      agents: { [AGENT]: { model: { providerID: "b", id: "y" } } },
    })
    expect(await launch(INPUT)).toBe(SUBAGENT_RESULT)
    expect(subagent.calls[0]!.input.model).toBeUndefined()
  })

  test("a step with a variant is not the agent's model without it", async () => {
    const { launch, subagent } = await startLaunch(
      { [AGENT]: ["a/x#high"] },
      {
        catalog: [catalogModel("a/x", { variants: [{ id: "high" }] })],
        agents: { [AGENT]: { model: { providerID: "a", id: "x" } } },
      },
    )
    await launch(INPUT)
    expect(subagent.calls[0]!.input.model).toBe("a/x#high")
  })

  test("launches as OpenCode would, and says so, when no step is usable", async () => {
    const { launch, subagent } = await startLaunch(undefined, { agents: { [AGENT]: { model: OTHER } } })
    const input = { ...INPUT }
    const result = await launch(input)
    expect(subagent.calls[0]!.input).toBe(input)
    expect(noticeOf(result)).toBe(`${PREFIX}${AGENT}: no step of its route is usable; launched on q/m]`)
  })

  test("names OpenCode's choice when no step is usable and no model is known", async () => {
    const { launch } = await startLaunch()
    expect(noticeOf(await launch(INPUT))).toBe(
      `${PREFIX}${AGENT}: no step of its route is usable; launched on OpenCode's choice]`,
    )
  })
})
