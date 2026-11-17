import { describe, expect, test } from "bun:test"
import { PROJECT } from "../../project"
import { DEFAULT_COOLDOWN_MS, DEFAULT_MAX_WAIT_MS, readFallbackSettings } from "./settings"

const HOME = "/home/user"
const prefix = PROJECT.envPrefix

describe("readFallbackSettings", () => {
  test("defaults: ten seconds, an hour and the state directory under the home directory", () => {
    expect(DEFAULT_MAX_WAIT_MS).toBe(10_000)
    expect(DEFAULT_COOLDOWN_MS).toBe(3_600_000)
    expect(readFallbackSettings(undefined, { HOME })).toEqual({
      settings: { maxWaitMs: 10_000, cooldownMs: 3_600_000, stateDir: `${HOME}/.local/state/${PROJECT.name}` },
    })
  })

  test("puts the state directory under an absolute XDG_STATE_HOME", () => {
    expect(readFallbackSettings({}, { HOME, XDG_STATE_HOME: "/xdg/state" }).settings.stateDir).toBe(
      `/xdg/state/${PROJECT.name}`,
    )
    expect(readFallbackSettings({}, { HOME, XDG_STATE_HOME: "relative" }).settings.stateDir).toBe(
      `${HOME}/.local/state/${PROJECT.name}`,
    )
  })

  test("reads the variables of the three settings", () => {
    const env = {
      HOME,
      [`${prefix}_MAX_WAIT_MS`]: "0",
      [`${prefix}_COOLDOWN_MS`]: "60000",
      [`${prefix}_STATE_DIR`]: "~/cooldown-state",
    }
    expect(readFallbackSettings(undefined, env)).toEqual({
      settings: { maxWaitMs: 0, cooldownMs: 60_000, stateDir: `${HOME}/cooldown-state` },
    })
  })

  test("an option wins over its variable", () => {
    const env = {
      HOME,
      [`${prefix}_MAX_WAIT_MS`]: "1",
      [`${prefix}_COOLDOWN_MS`]: "2",
      [`${prefix}_STATE_DIR`]: "/env",
    }
    expect(
      readFallbackSettings({ max_wait_ms: 500, cooldown_ms: 900, state_dir: "/option", routes: {} }, env).settings,
    ).toEqual({ maxWaitMs: 500, cooldownMs: 900, stateDir: "/option" })
  })

  test.each([
    ["max_wait_ms", -1],
    ["max_wait_ms", "soon"],
    ["cooldown_ms", 0],
    ["state_dir", "relative/dir"],
  ])("a refused %s (%p) gives the defaults and the refusal, never an exception", (name, value) => {
    const { settings, problem } = readFallbackSettings({ [name]: value }, { HOME })
    expect(settings).toEqual({
      maxWaitMs: 10_000,
      cooldownMs: 3_600_000,
      stateDir: `${HOME}/.local/state/${PROJECT.name}`,
    })
    expect(problem).toContain(name)
  })

  test("a refused variable gives the defaults and names the variable", () => {
    const { settings, problem } = readFallbackSettings({}, { HOME, [`${prefix}_COOLDOWN_MS`]: "0" })
    expect(settings.cooldownMs).toBe(DEFAULT_COOLDOWN_MS)
    expect(problem).toContain(`${prefix}_COOLDOWN_MS`)
  })
})
