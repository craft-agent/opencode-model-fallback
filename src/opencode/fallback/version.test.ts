import { describe, expect, test } from "bun:test"
import { MIN_OPENCODE_VERSION, meetsMinimum } from "./version"

describe("meetsMinimum", () => {
  test("the minimum is 2.1.2", () => {
    expect(MIN_OPENCODE_VERSION).toBe("2.1.2")
  })

  test.each([
    ["2.1.2", true],
    ["2.1.3", true],
    ["2.2.0", true],
    ["2.3.0", true],
    ["3.0.0", true],
    ["10.0.0", true],
    ["2.10.0", true],
    ["2.1.10", true],
    ["2.1.2+build.5", true],
    ["2.3.0-beta.1", true],
    ["2.1.1", false],
    ["2.0.9", false],
    ["1.99.99", false],
    ["2.1.2-beta", false],
    ["2.1.2-rc.1+build", false],
  ])("%s -> %p", (version, expected) => {
    expect(meetsMinimum(version)).toBe(expected)
  })

  test.each([undefined, null, 2, {}, "", "garbage", "2.1", "2.1.x", "v2.1.2", " 2.1.2", "2.1.2 ", "2.1.2-"])(
    "%p is below",
    (version) => {
      expect(meetsMinimum(version)).toBe(false)
    },
  )
})
