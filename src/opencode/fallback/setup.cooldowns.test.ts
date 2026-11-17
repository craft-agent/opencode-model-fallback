import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fakeClock, START_MS, tempDirs } from "./cooldowns.testing"
import { AGENT, PARENT_ID, ROUTES } from "./launch.testing"
import { FEATURES, setupFallback } from "./setup"
import { catalogModel, executorContext, fakeContext } from "./testing"

const HOUR_MS = 3_600_000
const CATALOG = [catalogModel("a/x"), catalogModel("b/y"), catalogModel("c/z")]
const INPUT = { agent: AGENT, prompt: "do it" }
const dirs = tempDirs()
afterEach(() => dirs.cleanup())

/** Sets the fallback up on a fake host whose plugin options are `options`, over a fake clock and a home directory of its own, so the default state directory is a temporary one. */
async function setUp(options: Record<string, unknown>, clock = fakeClock()) {
  const host = fakeContext({ options: { routes: ROUTES, ...options }, catalog: CATALOG })
  const setup = await setupFallback(host.ctx, FEATURES, { now: clock.now, env: { HOME: dirs.make() } })
  const launch = (input: Record<string, unknown>) =>
    host.subagent.execute(input, executorContext({ sessionID: PARENT_ID }))
  return { ...host, setup, launch, clock }
}

const quota = {
  sessionID: "ses_1",
  model: { providerID: "a", id: "x" },
  error: { type: "provider.quota", message: "" },
}
const NO_RETRY = { retry: false } as const

describe("cooldowns across setups", () => {
  test("a cooldown saved by one setup passes the model over in the next", async () => {
    const stateDir = dirs.make()
    const first = await setUp({ state_dir: stateDir })
    await first.fire("retry", { ...quota, decision: NO_RETRY })
    await first.setup.dispose()
    expect(JSON.parse(readFileSync(join(stateDir, "cooldowns.json"), "utf8"))).toEqual({
      version: 1,
      cooldowns: { "a/x": START_MS + HOUR_MS },
    })

    const second = await setUp({ state_dir: stateDir })
    await second.launch(INPUT)
    expect(second.subagent.calls[0]!.input.model).toBe("b/y")
  })

  test("a cooldown that ended while the plugin was off is gone", async () => {
    const stateDir = dirs.make()
    writeFileSync(join(stateDir, "cooldowns.json"), JSON.stringify({ version: 1, cooldowns: { "a/x": START_MS + 1 } }))
    const clock = fakeClock(START_MS + 1)
    const { launch, subagent } = await setUp({ state_dir: stateDir }, clock)
    await launch(INPUT)
    expect(subagent.calls[0]!.input.model).toBe("a/x")
  })

  test("a state directory that cannot be written is told once, on the first launch", async () => {
    const dir = dirs.make()
    const blocker = join(dir, "blocker")
    writeFileSync(blocker, "")
    const { fire, launch, subagent } = await setUp({ state_dir: join(blocker, "state") })
    await fire("retry", { ...quota, decision: NO_RETRY })
    await fire("retry", { ...quota, model: { providerID: "b", id: "y" }, decision: NO_RETRY })
    const first = await launch(INPUT)
    expect(subagent.calls[0]!.input.model).toBe("c/z")
    expect((first.content as string).split("\n").filter((line) => line.includes("cooldowns not saved: "))).toHaveLength(
      1,
    )
    const second = await launch(INPUT)
    expect(second.content as string).not.toContain("cooldowns not saved")
  })

  test("a refused setting is told once and the defaults stand", async () => {
    const { launch } = await setUp({ cooldown_ms: 0 })
    const result = await launch(INPUT)
    expect((result.content as string).split("\n")[0]).toContain("config ignored:")
    expect((result.content as string).split("\n")[0]).toContain("cooldown_ms")
  })
})
