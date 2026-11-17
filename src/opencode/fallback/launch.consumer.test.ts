import { describe, expect, test } from "bun:test"
import { AGENT, startLaunch } from "./launch.testing"
import { ownedKey } from "./notice"
import { SUBAGENT_RESULT, catalogModel } from "./testing"

const CATALOG = [catalogModel("a/x"), catalogModel("b/y"), catalogModel("c/z")]
const OTHER = { providerID: "q", id: "m" }
const INPUT = { agent: AGENT, prompt: "do it" }
const AGENTS = { [AGENT]: { model: OTHER } }
const PREFIX = "[Model fallback: "

/** The text the launch put in front of the child's reply. */
function noticeOf(result: { content?: unknown }): string {
  return (result.content as string).replace(/\n?child said hi$/, "")
}

/** A consumer that refuses the steps named in `refused`, with the reason given for each (`true` for none). */
function refusing(refused: Record<string, string | true>) {
  return {
    usable: (input: unknown) => {
      const { model } = input as { model: string }
      const reason = refused[model]
      return reason === undefined ? { usable: true } : { usable: false, ...(reason !== true && { reason }) }
    },
  }
}

describe("launch with a consumer's say", () => {
  test("takes the next step when the consumer refuses the first, and says why", async () => {
    const { launch, subagent } = await startLaunch(undefined, {
      catalog: CATALOG,
      agents: AGENTS,
      rpc: refusing({ "a/x": "balance is empty" }),
    })
    const result = await launch(INPUT)
    expect(subagent.calls[0]!.input.model).toBe("b/y")
    expect(noticeOf(result)).toBe(`${PREFIX}${AGENT} q/m → b/y; a/x is unusable: balance is empty]`)
  })

  test("says only that the step is unusable when the consumer gives no reason", async () => {
    const { launch } = await startLaunch(undefined, {
      catalog: CATALOG,
      agents: AGENTS,
      rpc: refusing({ "a/x": true }),
    })
    expect(noticeOf(await launch(INPUT))).toBe(`${PREFIX}${AGENT} q/m → b/y; a/x is unusable]`)
  })

  test("lists the steps of both kinds in the order of the route, and records them", async () => {
    const { launch } = await startLaunch(undefined, {
      catalog: [catalogModel("a/x", { enabled: false }), catalogModel("b/y"), catalogModel("c/z")],
      agents: AGENTS,
      rpc: refusing({ "b/y": "paused" }),
    })
    const result = await launch(INPUT)
    expect(noticeOf(result)).toBe(`${PREFIX}${AGENT} q/m → c/z; a/x cannot run a subagent; b/y is unusable: paused]`)
    expect((result.metadata![ownedKey("launch")] as { skipped: unknown }).skipped).toEqual([
      { model: "a/x", reason: "cannot run a subagent" },
      { model: "b/y", reason: "is unusable: paused" },
    ])
  })

  test("launches on OpenCode's choice when the consumer refuses every step", async () => {
    const { launch, subagent } = await startLaunch(undefined, {
      catalog: CATALOG,
      agents: AGENTS,
      rpc: refusing({ "a/x": true, "b/y": true, "c/z": "gone" }),
    })
    const result = await launch(INPUT)
    expect(subagent.calls[0]!.input).toEqual(INPUT)
    expect(noticeOf(result)).toBe(`${PREFIX}${AGENT}: no step of its route is usable; launched on q/m]`)
  })

  test("asks only the steps that passed the package's own checks, in order, up to the first usable", async () => {
    const { launch, rpcCalls } = await startLaunch(undefined, {
      catalog: [catalogModel("b/y"), catalogModel("c/z")],
      agents: AGENTS,
      rpc: refusing({ "b/y": true }),
    })
    await launch(INPUT)
    expect(rpcCalls.map((call) => (call.input as { model: string }).model)).toEqual(["b/y", "c/z"])
    expect(rpcCalls.every((call) => call.method === "usable")).toBe(true)
    expect(rpcCalls.every((call) => (call.input as { agent: string }).agent === AGENT)).toBe(true)
  })

  test("asks nothing past the first usable step", async () => {
    const { launch, rpcCalls } = await startLaunch(undefined, { catalog: CATALOG, agents: AGENTS, rpc: refusing({}) })
    await launch(INPUT)
    expect(rpcCalls).toHaveLength(1)
  })

  test("asks nothing of a launch the route does not decide", async () => {
    const { launch, rpcCalls } = await startLaunch(undefined, { catalog: CATALOG, rpc: refusing({}) })
    await launch({ ...INPUT, model: "q/m" })
    await launch({ agent: "other", prompt: "x" })
    expect(rpcCalls).toEqual([])
  })

  test.each([
    ["nobody answering", undefined],
    ["a consumer that throws", { usable: () => Promise.reject(new Error("down")) }],
    ["a consumer that answers off the schema", { usable: () => ({ usable: "no" }) }],
  ])("is as it was alone with %s", async (_name, rpc) => {
    const { launch, subagent } = await startLaunch(undefined, { catalog: CATALOG, agents: AGENTS, rpc })
    const result = await launch(INPUT)
    expect(subagent.calls[0]!.input.model).toBe("a/x")
    expect(noticeOf(result)).toBe(`${PREFIX}${AGENT} q/m → a/x; the route replaces the agent's model]`)
  })

  test("is as it was alone on a host with no RPC", async () => {
    const { launch, subagent } = await startLaunch(undefined, {
      catalog: CATALOG,
      agents: AGENTS,
      omit: ["rpc"],
    })
    await launch(INPUT)
    expect(subagent.calls[0]!.input.model).toBe("a/x")
  })

  test("leaves the launch alone when the consumer refuses nothing and the step is the agent's model", async () => {
    const { launch } = await startLaunch(undefined, {
      catalog: CATALOG,
      agents: { [AGENT]: { model: { providerID: "a", id: "x" } } },
      rpc: refusing({}),
    })
    expect(await launch({ ...INPUT })).toBe(SUBAGENT_RESULT)
  })
})
