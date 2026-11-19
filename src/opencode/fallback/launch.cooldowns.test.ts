import { describe, expect, test } from "bun:test"
import { fakeClock, START_MS } from "./cooldowns.testing"
import { AGENT, startLaunch } from "./launch.testing"
import type { RetryEvent } from "./limit"
import { LIMITS } from "./limits"
import { catalogModel } from "./testing"

const HOUR_MS = 3_600_000
const CATALOG = [catalogModel("a/x"), catalogModel("b/y"), catalogModel("c/z")]
const INPUT = { agent: AGENT, prompt: "do it" }
const OTHER = { providerID: "q", id: "m" }

/** A retry event for the model `provider/id` (`variant` when given) that hit its quota. */
function quotaEvent(providerID: string, id: string, variant?: string, delay?: number): RetryEvent {
  return {
    sessionID: "ses_1",
    model: variant === undefined ? { providerID, id } : { providerID, id, variant },
    error: { type: "provider.quota", message: "out of quota" },
    decision: delay === undefined ? { retry: false } : { retry: true, delay },
  }
}

/** The text of the first line of a launch's result. */
function firstLine(result: { content?: unknown }): string {
  return (result.content as string).split("\n")[0]!
}

describe("launch and cooldowns", () => {
  test("passes over a step that is cooling down, and says until when", async () => {
    const clock = fakeClock()
    const { launch, fire, subagent } = await startLaunch(undefined, {
      catalog: CATALOG,
      agents: { [AGENT]: { model: OTHER } },
      others: [LIMITS],
      now: clock.now,
    })
    await fire("retry", quotaEvent("a", "x"))
    const result = await launch(INPUT)
    const until = new Date(START_MS + HOUR_MS).toISOString()
    expect(subagent.calls[0]!.input.model).toBe("b/y")
    expect(firstLine(result)).toBe(`[Model fallback: ${AGENT} q/m → b/y; a/x is cooling down until ${until}]`)
  })

  test("passes over a bare step whose model hit a limit on OpenCode's default variant", async () => {
    const clock = fakeClock()
    const { launch, fire, subagent } = await startLaunch(undefined, {
      catalog: CATALOG,
      agents: { [AGENT]: { model: OTHER } },
      others: [LIMITS],
      now: clock.now,
    })
    await fire("retry", quotaEvent("a", "x", "default"))
    await launch(INPUT)
    expect(subagent.calls[0]!.input.model).toBe("b/y")
  })

  test("takes the step again once its cooldown has ended", async () => {
    const clock = fakeClock()
    const { launch, fire, subagent } = await startLaunch(undefined, {
      catalog: CATALOG,
      others: [LIMITS],
      now: clock.now,
    })
    await fire("retry", quotaEvent("a", "x", undefined, 60_000))
    await launch(INPUT)
    expect(subagent.calls[0]!.input.model).toBe("b/y")
    clock.advance(59_999)
    await launch(INPUT)
    expect(subagent.calls[1]!.input.model).toBe("b/y")
    clock.advance(1)
    await launch(INPUT)
    expect(subagent.calls[2]!.input.model).toBe("a/x")
  })

  test("lists every step passed over, a cooling one among them", async () => {
    const clock = fakeClock()
    const { launch, fire, subagent } = await startLaunch(undefined, {
      catalog: [catalogModel("b/y", { enabled: false }), catalogModel("a/x"), catalogModel("c/z")],
      agents: { [AGENT]: { model: OTHER } },
      others: [LIMITS],
      now: clock.now,
    })
    await fire("retry", quotaEvent("a", "x"))
    const result = await launch(INPUT)
    const until = new Date(START_MS + HOUR_MS).toISOString()
    expect(subagent.calls[0]!.input.model).toBe("c/z")
    expect(firstLine(result)).toBe(
      `[Model fallback: ${AGENT} q/m → c/z; a/x is cooling down until ${until}; b/y cannot run a subagent]`,
    )
  })

  test("launches as OpenCode would when every step is cooling down", async () => {
    const { launch, fire, subagent } = await startLaunch(undefined, {
      catalog: CATALOG,
      agents: { [AGENT]: { model: OTHER } },
      others: [LIMITS],
      now: fakeClock().now,
    })
    for (const [provider, id] of [
      ["a", "x"],
      ["b", "y"],
      ["c", "z"],
    ] as const)
      await fire("retry", quotaEvent(provider, id))
    const result = await launch(INPUT)
    expect(subagent.calls[0]!.input).toEqual(INPUT)
    expect(firstLine(result)).toBe(`[Model fallback: ${AGENT}: no step of its route is usable; launched on q/m]`)
  })

  test("a cooldown of a variant covers that step only, and one without a variant covers every variant", async () => {
    const routes = { [AGENT]: ["a/x#high", "a/x#low", "b/y"] }
    const catalog = [catalogModel("a/x", { variants: [{ id: "high" }, { id: "low" }] }), catalogModel("b/y")]
    const high = await startLaunch(routes, { catalog, others: [LIMITS], now: fakeClock().now })
    await high.fire("retry", quotaEvent("a", "x", "high"))
    await high.launch(INPUT)
    expect(high.subagent.calls[0]!.input.model).toBe("a/x#low")

    const whole = await startLaunch(routes, { catalog, others: [LIMITS], now: fakeClock().now })
    await whole.fire("retry", quotaEvent("a", "x"))
    await whole.launch(INPUT)
    expect(whole.subagent.calls[0]!.input.model).toBe("b/y")
  })

  test("a model outside the route cools nothing in it", async () => {
    const { launch, fire, subagent } = await startLaunch(undefined, {
      catalog: CATALOG,
      others: [LIMITS],
      now: fakeClock().now,
    })
    await fire("retry", quotaEvent("z", "a"))
    await launch(INPUT)
    expect(subagent.calls[0]!.input.model).toBe("a/x")
  })
})
