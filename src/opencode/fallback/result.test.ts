import { describe, expect, test } from "bun:test"
import { withNotices } from "./result"

const OUTPUT = { sessionID: "ses_child" }

describe("withNotices", () => {
  test("returns the result itself when there is nothing to add", () => {
    const result = { output: OUTPUT, content: "hi", metadata: { a: 1 } }
    expect(withNotices(result, [])).toBe(result)
    expect(withNotices(result, [], undefined)).toBe(result)
    expect(withNotices(result, [], {})).toBe(result)
  })

  test("puts the lines before a text content, one per line", () => {
    const result = withNotices({ output: OUTPUT, content: "hi" }, ["[a]", "[b]"])
    expect(result).toEqual({ output: OUTPUT, content: "[a]\n[b]\nhi" })
  })

  test("puts the lines in a text part before the parts of an array content", () => {
    const parts = [{ type: "text", text: "hi" }, { type: "image" }]
    const result = withNotices({ output: OUTPUT, content: parts }, ["[a]", "[b]"])
    expect(result.content).toEqual([{ type: "text", text: "[a]\n[b]" }, ...parts])
    expect(parts).toHaveLength(2)
  })

  test("makes the lines the content when there was none", () => {
    expect(withNotices({ output: OUTPUT }, ["[a]", "[b]"])).toEqual({ output: OUTPUT, content: "[a]\n[b]" })
  })

  test("merges the metadata into the result's own and leaves the output alone", () => {
    const result = withNotices({ output: OUTPUT, content: "hi", metadata: { a: 1, b: 2 } }, ["[a]"], { b: 3, c: 4 })
    expect(result.metadata).toEqual({ a: 1, b: 3, c: 4 })
    expect(result.output).toBe(OUTPUT)
  })

  test("adds metadata without touching the content, and sets it on a result with none", () => {
    expect(withNotices({ output: OUTPUT, content: "hi" }, [], { c: 4 })).toEqual({
      output: OUTPUT,
      content: "hi",
      metadata: { c: 4 },
    })
  })
})
