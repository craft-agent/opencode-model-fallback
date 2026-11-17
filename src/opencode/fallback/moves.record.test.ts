import { describe, expect, test } from "bun:test"
import { START_MS } from "./cooldowns.testing"
import { MOVES_KEY, moveNotice, readMoves, withMove, type MoveRecord } from "./moves.record"
import { CHILD, SESSION_ID, startMoves } from "./moves.testing"

const AT = new Date(START_MS).toISOString()
const FIRST_MOVE: MoveRecord = { from: "a/x", to: "b/y", reason: "a/x hit a quota limit", at: AT }
const RATE = { type: "provider.rate-limit", message: "slow down" }

describe("the record of a move", () => {
  test("is appended to the session's metadata, whose other keys stay", async () => {
    const { retry, updates } = await startMoves({ sessions: { [SESSION_ID]: { metadata: { owner: "me", n: 1 } } } })
    await retry()
    expect(updates).toEqual([
      {
        sessionID: SESSION_ID,
        metadata: { owner: "me", n: 1, "opencode-model-fallback.moves": [FIRST_MOVE] },
      },
    ])
  })

  test("goes after the moves the session already made", async () => {
    const { retry, sessions } = await startMoves()
    await retry()
    await retry({ model: { providerID: "b", id: "y" }, error: RATE, decision: { retry: true, delay: 60_000 } })
    expect(readMoves(sessions[SESSION_ID]!.metadata)).toEqual([
      FIRST_MOVE,
      { from: "b/y", to: "c/z", reason: "b/y hit a rate limit", at: AT },
    ])
  })

  test("takes its time from the clock", async () => {
    const { retry, clock, sessions } = await startMoves()
    clock.advance(90_000)
    await retry()
    expect(readMoves(sessions[SESSION_ID]!.metadata)[0]!.at).toBe(new Date(START_MS + 90_000).toISOString())
  })

  test("names the model with its variant", async () => {
    const { retry, sessions } = await startMoves({ routes: { worker: ["a/x#high", "b/y"] } })
    await retry({ model: { providerID: "a", id: "x", variant: "high" } })
    expect(readMoves(sessions[SESSION_ID]!.metadata)[0]).toMatchObject({ from: "a/x#high", to: "b/y" })
  })

  test("a stop has no step to move to, and says none is left", async () => {
    const { retry, sessions } = await startMoves({ sessions: { [SESSION_ID]: CHILD } })
    await retry({ model: { providerID: "c", id: "z" }, error: RATE, decision: { retry: true, delay: 60_000 } })
    expect(sessions[SESSION_ID]!.metadata).toEqual({
      [MOVES_KEY]: [{ from: "c/z", to: null, reason: "c/z hit a rate limit; no usable step left", at: AT }],
    })
  })

  test("is not written for a primary agent with nowhere to go", async () => {
    const { retry, updates } = await startMoves()
    await retry({ model: { providerID: "c", id: "z" } })
    expect(updates).toEqual([])
  })

  test("a failure to write it is ignored, and the move stands", async () => {
    const host = await startMoves()
    host.ctx.session.update = async () => {
      throw new Error("host down")
    }
    expect((await host.retry()).decision).toEqual({ retry: true, delay: 0 })
    expect(host.switches).toHaveLength(1)
  })
})

describe("moves in metadata", () => {
  test("reads the records of a session, oldest first, and no other entry", () => {
    const other = { from: "b/y", to: null, reason: "stopped", at: AT }
    const metadata = { [MOVES_KEY]: [FIRST_MOVE, "junk", { from: 1 }, null, other] }
    expect(readMoves(metadata)).toEqual([FIRST_MOVE, other])
  })

  test.each([[undefined], [{}], [{ [MOVES_KEY]: "nope" }], [{ [MOVES_KEY]: { from: "a/x" } }]])(
    "reads no moves from %p",
    (metadata) => {
      expect(readMoves(metadata)).toEqual([])
    },
  )

  test("appends a record and leaves the other keys and the given metadata as they were", () => {
    const metadata = { owner: "me", [MOVES_KEY]: [FIRST_MOVE] }
    const second = { ...FIRST_MOVE, from: "b/y", to: "c/z" }
    expect(withMove(metadata, second)).toEqual({ owner: "me", [MOVES_KEY]: [FIRST_MOVE, second] })
    expect(metadata[MOVES_KEY]).toEqual([FIRST_MOVE])
    expect(withMove(undefined, FIRST_MOVE)).toEqual({ [MOVES_KEY]: [FIRST_MOVE] })
  })
})

describe("the notice of a move", () => {
  test("tells a move as `<agent> A → B; <reason>`", () => {
    expect(moveNotice("worker", FIRST_MOVE)).toBe("[Model fallback: worker a/x → b/y; a/x hit a quota limit]")
  })

  test("tells a stop as `<agent> stopped on A; <reason>`", () => {
    const stop = { from: "c/z", to: null, reason: "c/z hit a quota limit; no usable step left", at: AT }
    expect(moveNotice("worker", stop)).toBe(
      "[Model fallback: worker stopped on c/z; c/z hit a quota limit; no usable step left]",
    )
  })
})
