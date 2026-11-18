import { afterEach, describe, expect, test } from "bun:test"
import { fakeClock, START_MS, tempDirs } from "./cooldowns.testing"
import { AGENT, PARENT_ID } from "./launch.testing"
import { retryEvent } from "./moves.testing"
import { FEATURES, setupFallback } from "./setup"
import { catalogModel, executorContext, fakeContext } from "./testing"

const HOUR_MS = 3_600_000
const ROUTE = ["a/x", "a/y", "b/z"]
const CATALOG = ROUTE.map((id) => catalogModel(id))
const INPUT = { agent: AGENT, prompt: "do it" }
const dirs = tempDirs()
afterEach(() => dirs.cleanup())

/** Sets the fallback up on a fake host whose plugin options are `options` and whose route is `ROUTE`, with a state directory of its own. */
async function setUp(options: Record<string, unknown>) {
  const host = fakeContext({ options: { routes: { [AGENT]: ROUTE }, ...options }, catalog: CATALOG })
  await setupFallback(host.ctx, FEATURES, { now: fakeClock().now, env: { HOME: dirs.make() } })
  const launch = (input: Record<string, unknown>) =>
    host.subagent.execute(input, executorContext({ sessionID: PARENT_ID }))
  return { ...host, launch }
}

/** The first line of a launch's result. */
function firstLine(result: { content?: unknown }): string {
  return (result.content as string).split("\n")[0]!
}

describe("launch and the cooldown scope", () => {
  test("under the provider scope a limit on a/x passes a/y over too, and says until when", async () => {
    const { fire, launch, subagent } = await setUp({ cooldown_scope: "provider" })
    await fire("retry", retryEvent())
    const result = await launch(INPUT)
    const until = new Date(START_MS + HOUR_MS).toISOString()
    expect(subagent.calls[0]!.input.model).toBe("b/z")
    expect(result.content as string).toContain(`a/x is cooling down until ${until}; a/y is cooling down until ${until}`)
  })

  test("under the model scope a limit on a/x leaves a/y", async () => {
    const { fire, launch, subagent } = await setUp({ cooldown_scope: "model" })
    await fire("retry", retryEvent())
    await launch(INPUT)
    expect(subagent.calls[0]!.input.model).toBe("a/y")
  })

  test("a scope that is not one is told once on the first launch, and the model scope stands", async () => {
    const { fire, launch, subagent } = await setUp({ cooldown_scope: "account", max_wait_ms: 500 })
    await fire("retry", retryEvent())
    const first = await launch(INPUT)
    expect(subagent.calls[0]!.input.model).toBe("a/y")
    expect(firstLine(first)).toBe(
      '[Model fallback: config ignored: cooldown_scope must be "model" or "provider", got "account"]',
    )
    expect((first.content as string).split("\n").filter((line) => line.includes("config ignored"))).toHaveLength(1)
    expect((await launch(INPUT)).content as string).not.toContain("config ignored")
  })
})
