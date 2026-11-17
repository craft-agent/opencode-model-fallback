import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** The shared setup of the tests that need a clock or a state directory. */

/** A moment of the fake clocks: far enough from zero that a cooldown is never confused with a missing time. */
export const START_MS = 1_800_000_000_000

/** A clock the test moves by hand. */
export type FakeClock = {
  now(): number
  /** Moves the clock `ms` forward. */
  advance(ms: number): void
}

/** A clock that stands still at `start` until it is advanced. */
export function fakeClock(start = START_MS): FakeClock {
  let current = start
  return {
    now: () => current,
    advance(ms) {
      current += ms
    },
  }
}

/** The temporary directories of a test file: `make` creates one, `cleanup` removes every one made. */
export type TempDirs = { make(): string; cleanup(): void }

/** Temporary directories under the system's temporary directory, so no test writes into the repository or reads a user's files. */
export function tempDirs(): TempDirs {
  const made: string[] = []
  return {
    make() {
      const dir = mkdtempSync(join(tmpdir(), "model-fallback-"))
      made.push(dir)
      return dir
    },
    cleanup() {
      for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
    },
  }
}
