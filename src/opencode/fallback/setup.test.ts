import { describe, expect, test } from "bun:test"
import { EVENTS } from "./events"
import type { Feature } from "./feature"
import { LAUNCH } from "./launch"
import { LIMITS } from "./limits"
import { MOVES } from "./moves"
import { FEATURES, setupFallback } from "./setup"
import { fakeContext } from "./testing"

const FEATURE: Feature = {
  name: "retry-watch",
  calls: [],
  hooks: ["retry"],
  register: (_ctx, api) => api.hook("retry", () => {}),
}

describe("setupFallback", () => {
  test("has the events, launch, limits and moves features, which register nothing with nothing configured", async () => {
    expect(FEATURES).toEqual([EVENTS, LAUNCH, LIMITS, MOVES])
    const { ctx, hooks, tools, skills, transforms, registered } = fakeContext()
    const setup = await setupFallback(ctx, FEATURES, { env: { HOME: "/home/tester" }, persist: false })
    expect(setup.running).toEqual(["events", "launch", "limits", "moves"])
    expect(setup.unavailable).toEqual([])
    await setup.dispose()
    expect([hooks, [...tools], skills, transforms, registered]).toEqual([[], [], [], [], []])
  })

  test("starts its features on the minimum version and later", async () => {
    for (const version of ["2.1.2", "2.3.0"]) {
      const { ctx, hooks } = fakeContext({ version })
      expect((await setupFallback(ctx, [FEATURE])).running).toEqual(["retry-watch"])
      expect(hooks).toHaveLength(1)
    }
  })

  test.each(["2.1.1", "2.1.2-beta", "garbage", null])("registers nothing on version %p", async (version) => {
    const { ctx, hooks } = fakeContext({ version })
    const setup = await setupFallback(ctx, [FEATURE])
    expect(setup.running).toEqual([])
    expect(setup.unavailable).toHaveLength(1)
    expect(setup.unavailable[0]!.name).toBe("retry-watch")
    expect(setup.unavailable[0]!.reason).toContain("needs OpenCode 2.1.2 or later")
    await setup.dispose()
    expect(hooks).toEqual([])
  })

  test("does not throw for a missing optional API", async () => {
    const { ctx } = fakeContext({
      omit: ["session.hook", "session.switchModel", "session.update", "tool.transform", "rpc"],
    })
    const setup = await setupFallback(ctx, [FEATURE, { ...FEATURE, name: "moves", calls: ["session.switchModel"] }])
    expect(setup.running).toEqual([])
    expect(setup.unavailable.map((feature) => feature.name)).toEqual(["retry-watch", "moves"])
  })
})
