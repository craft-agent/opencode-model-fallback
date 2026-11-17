import { describe, expect, test } from "bun:test"
import { FAKE_DIRECTORY, SUBAGENT_RESULT, catalogModel, executorContext, fakeContext } from "./testing"

describe("fakeContext", () => {
  test("keeps its defaults: a session in the fake directory, no agent model, an empty catalog", async () => {
    const { ctx } = fakeContext()
    expect(await ctx.session.get({ sessionID: "ses_9" })).toEqual({
      id: "ses_9",
      location: { directory: FAKE_DIRECTORY },
    })
    expect(await ctx.agent!.get!({ agentID: "any", location: { directory: FAKE_DIRECTORY } })).toEqual({ data: {} })
    expect(await ctx.model!.list!({ location: { directory: FAKE_DIRECTORY } })).toEqual({ data: [] })
  })

  test("gives the sessions, agents and catalog it was given", async () => {
    const model = { providerID: "a", id: "x" }
    const catalog = [catalogModel("a/x")]
    const { ctx } = fakeContext({
      sessions: { ses_1: { model }, ses_2: { location: {} } },
      agents: { build: { model } },
      catalog,
    })
    expect(await ctx.session.get({ sessionID: "ses_1" })).toEqual({
      id: "ses_1",
      location: { directory: FAKE_DIRECTORY },
      model,
    })
    expect((await ctx.session.get({ sessionID: "ses_2" })).location).toEqual({})
    expect((await ctx.agent!.get!({ agentID: "build", location: { directory: "/x" } })).data).toEqual({ model })
    expect((await ctx.model!.list!({ location: { directory: "/x" } })).data).toBe(catalog)
  })

  test("hands a transform an editor that can wrap the built-in subagent tool, and records the call", async () => {
    const { ctx, subagent, transforms } = fakeContext()
    const registration = await ctx.tool.transform((editor) => {
      expect(editor.get?.("subagent")).toBeDefined()
      expect(editor.get?.("other")).toBeUndefined()
      editor.update?.("subagent", (tool) => {
        const inner = tool.execute
        tool.execute = async (input, context) => ({ ...(await inner(input, context)), content: "wrapped" })
      })
    })
    const context = executorContext()
    expect(await subagent.execute({ agent: "a" }, context)).toEqual({ ...SUBAGENT_RESULT, content: "wrapped" })
    expect(subagent.calls).toEqual([{ input: { agent: "a" }, context }])
    expect(transforms).toEqual([{ disposed: false }])
    await registration!.dispose()
    expect(transforms).toEqual([{ disposed: true }])
  })

  test("leaves the editor's get or update out, and lets a test replace what the subagent tool returns", async () => {
    const { ctx, subagent } = fakeContext({
      omitEditor: ["get", "update"],
      subagent: async () => ({ content: "custom" }),
    })
    await ctx.tool.transform((editor) => {
      expect(editor.get).toBeUndefined()
      expect(editor.update).toBeUndefined()
    })
    expect(await subagent.execute({}, executorContext())).toEqual({ content: "custom" })
    expect(subagent.calls).toHaveLength(1)
  })
})

describe("catalogModel", () => {
  test("is a model that can run a subagent, by reference or by text", () => {
    const model = catalogModel("a/x:y")
    expect(model).toMatchObject({
      providerID: "a",
      id: "x:y",
      enabled: true,
      status: "active",
      capabilities: { tools: true },
      variants: [],
    })
    expect(catalogModel({ providerID: "a", id: "x:y" })).toEqual(model)
  })

  test("takes overrides", () => {
    expect(catalogModel("a/x", { enabled: false, variants: [{ id: "high" }] })).toMatchObject({
      enabled: false,
      variants: [{ id: "high" }],
    })
  })
})
