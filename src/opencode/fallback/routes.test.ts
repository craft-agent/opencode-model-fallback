import { describe, expect, test } from "bun:test"
import { modelsEqual, parseSelector, readRoutes, selector, withoutDefaultVariant } from "./routes"

describe("parseSelector", () => {
  test.each([
    ["a/b", { providerID: "a", id: "b" }],
    ["a/b#high", { providerID: "a", id: "b", variant: "high" }],
    ["openrouter/meta/llama-3:free", { providerID: "openrouter", id: "meta/llama-3:free" }],
    ["openrouter/meta/llama-3:free#x", { providerID: "openrouter", id: "meta/llama-3:free", variant: "x" }],
    [" a/b ", { providerID: "a", id: "b" }],
    ["a/b#default", { providerID: "a", id: "b" }],
  ])("reads %p", (text, expected) => {
    expect(parseSelector(text)).toEqual(expected)
  })

  test("omits the variant key for the default variant", () => {
    expect(Object.keys(parseSelector("a/b#default")!)).not.toContain("variant")
  })

  test.each([[""], ["a"], ["/b"], ["a/"], ["a/b#"], ["a b/c"], ["a/b#x/y"], ["a/#x"], ["a#b/c"], ["a/b c"]])(
    "rejects %p",
    (text) => {
      expect(parseSelector(text)).toBeUndefined()
    },
  )

  test("omits the variant key when there is none", () => {
    expect(Object.keys(parseSelector("a/b")!)).not.toContain("variant")
  })
})

describe("selector", () => {
  test.each([["a/b"], ["a/b#high"], ["openrouter/meta/llama-3:free#max"]])("round-trips %p", (text) => {
    expect(selector(parseSelector(text)!)).toBe(text)
  })
})

describe("withoutDefaultVariant", () => {
  test("drops the default variant, key and all", () => {
    const ref = withoutDefaultVariant({ providerID: "a", id: "b", variant: "default" })
    expect(ref).toEqual({ providerID: "a", id: "b" })
    expect(Object.keys(ref)).not.toContain("variant")
  })

  test.each([[{ providerID: "a", id: "b" }], [{ providerID: "a", id: "b", variant: "high" }]])("keeps %p", (ref) => {
    expect(withoutDefaultVariant(ref)).toEqual(ref)
  })
})

describe("modelsEqual", () => {
  test("compares provider, ID and variant", () => {
    expect(modelsEqual({ providerID: "a", id: "b" }, { providerID: "a", id: "b" })).toBe(true)
    expect(modelsEqual({ providerID: "a", id: "b", variant: "x" }, { providerID: "a", id: "b", variant: "x" })).toBe(
      true,
    )
    expect(modelsEqual({ providerID: "a", id: "b" }, { providerID: "a", id: "b", variant: "x" })).toBe(false)
    expect(modelsEqual({ providerID: "a", id: "b" }, { providerID: "c", id: "b" })).toBe(false)
    expect(modelsEqual({ providerID: "a", id: "b" }, { providerID: "a", id: "c" })).toBe(false)
  })
})

describe("readRoutes", () => {
  test("reads nothing from undefined", () => {
    expect(readRoutes(undefined)).toEqual({ table: {}, problems: [] })
  })

  test.each([[[]], [null], ["a/b"], [3]])("rejects %p as a whole", (value) => {
    expect(readRoutes(value)).toEqual({
      table: {},
      problems: ["routes is not an object of agent names to lists of models"],
    })
  })

  test("reads each agent's steps in order", () => {
    expect(readRoutes({ build: ["a/b", "c/d#high"], plan: ["e/f"] })).toEqual({
      table: {
        build: [
          { providerID: "a", id: "b" },
          { providerID: "c", id: "d", variant: "high" },
        ],
        plan: [{ providerID: "e", id: "f" }],
      },
      problems: [],
    })
  })

  test("leaves out an agent whose value is not a list", () => {
    expect(readRoutes({ build: "a/b" })).toEqual({ table: {}, problems: ["routes.build is not a list of models"] })
  })

  test("skips unreadable entries and keeps the rest", () => {
    expect(readRoutes({ build: ["a/b", "nope", 5, null] })).toEqual({
      table: { build: [{ providerID: "a", id: "b" }] },
      problems: [
        'routes.build[1]: "nope" is not provider/model#variant',
        "routes.build[2]: 5 is not provider/model#variant",
        "routes.build[3]: null is not provider/model#variant",
      ],
    })
  })

  test("skips a step listed twice", () => {
    expect(readRoutes({ build: ["a/b", "c/d", " a/b ", "a/b#x"] })).toEqual({
      table: {
        build: [
          { providerID: "a", id: "b" },
          { providerID: "c", id: "d" },
          { providerID: "a", id: "b", variant: "x" },
        ],
      },
      problems: ["routes.build[2]: a/b is listed twice"],
    })
  })

  test("leaves out an agent with no readable step", () => {
    expect(readRoutes({ build: [], plan: ["bad"] })).toEqual({
      table: {},
      problems: [
        "routes.build has no model, so it routes nothing",
        'routes.plan[0]: "bad" is not provider/model#variant',
        "routes.plan has no model, so it routes nothing",
      ],
    })
  })

  test("keeps agent names as given", () => {
    expect(Object.keys(readRoutes({ " Build ": ["a/b"] }).table)).toEqual([" Build "])
  })
})
