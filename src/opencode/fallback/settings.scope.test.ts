import { describe, expect, test } from "bun:test"
import { PROJECT } from "../../project"
import { DEFAULT_COOLDOWN_SCOPE, readFallbackSettings } from "./settings"

const HOME = "/home/user"
const VARIABLE = `${PROJECT.envPrefix}_COOLDOWN_SCOPE`

describe("the cooldown_scope setting", () => {
  test("is the model unless set", () => {
    expect(DEFAULT_COOLDOWN_SCOPE).toBe("model")
    const read = readFallbackSettings(undefined, { HOME })
    expect(read.settings.cooldownScope).toBe("model")
    expect(read.problem).toBeUndefined()
  })

  test.each(["model", "provider"])("reads %s from the option", (scope) => {
    const read = readFallbackSettings({ cooldown_scope: scope }, { HOME })
    expect(read.settings.cooldownScope).toBe(scope)
    expect(read.problem).toBeUndefined()
  })

  test("reads the variable", () => {
    const read = readFallbackSettings(undefined, { HOME, [VARIABLE]: "provider" })
    expect(read.settings.cooldownScope).toBe("provider")
    expect(read.problem).toBeUndefined()
  })

  test("an option wins over its variable", () => {
    expect(
      readFallbackSettings({ cooldown_scope: "model" }, { HOME, [VARIABLE]: "provider" }).settings.cooldownScope,
    ).toBe("model")
    expect(
      readFallbackSettings({ cooldown_scope: "provider" }, { HOME, [VARIABLE]: "model" }).settings.cooldownScope,
    ).toBe("provider")
  })

  test("a blank variable counts as unset", () => {
    const read = readFallbackSettings(undefined, { HOME, [VARIABLE]: " " })
    expect(read.settings.cooldownScope).toBe("model")
    expect(read.problem).toBeUndefined()
  })

  test.each([
    ["option", { cooldown_scope: "account" }, {}, "account"],
    ["option of another case", { cooldown_scope: "Provider" }, {}, "Provider"],
    ["variable", undefined, { [VARIABLE]: "nope" }, "nope"],
  ])(
    "a %s that is not a scope gives the model, says what it must be and keeps the other settings",
    (_, options, env, got) => {
      const read = readFallbackSettings({ ...options, max_wait_ms: 500, cooldown_ms: 900 }, { HOME, ...env })
      expect(read.settings).toEqual({
        maxWaitMs: 500,
        cooldownMs: 900,
        cooldownScope: "model",
        stateDir: `${HOME}/.local/state/${PROJECT.name}`,
      })
      expect(read.problem).toBe(`cooldown_scope must be "model" or "provider", got "${got}"`)
    },
  )

  test("an option that is not text is refused by the settings layer, naming it", () => {
    const { settings, problem } = readFallbackSettings({ cooldown_scope: 1 }, { HOME })
    expect(settings.cooldownScope).toBe("model")
    expect(problem).toContain("cooldown_scope")
  })
})
