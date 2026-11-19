import { join } from "node:path"
import type { V2Context } from "../types"
import { createCooldowns, type Cooldowns } from "./cooldowns"
import { notice, type OnceNotices } from "./notice"
import type { LimitedEvent } from "./rpc"
import { readFallbackSettings, type FallbackEnv, type FallbackSettings } from "./settings"

const COOLDOWNS_FILE = "cooldowns.json"

/** What a setup supplies instead of the process's own, so a test can fix the clock and the environment and keep state off the disk. */
export type FallbackDeps = {
  /** The clock, in epoch milliseconds; defaults to `Date.now`. */
  now?: () => number
  /** Where the settings' variables are read; defaults to `process.env`. */
  env?: FallbackEnv
  /** Whether cooldowns are saved in the state directory; `false` keeps them in memory only. Defaults to `true`. */
  persist?: boolean
}

/** What the features of one setup share: the settings they read, the clock and the cooldowns. Each is made on first use, once, so a plugin with nothing configured reads and writes nothing. */
export type FallbackState = {
  readonly now: () => number
  readonly settings: FallbackSettings
  readonly cooldowns: Cooldowns
  /** Told each limit as it is cooled down; a feature installs it, and until one does nothing is told. It must not throw. */
  onLimit?: (event: LimitedEvent) => void
}

/** The state of a setup. A refused setting is told once in `notices` and the defaults stand; a cooldown file that cannot be saved is told there too. */
export function createFallbackState(ctx: V2Context, notices: OnceNotices, deps: FallbackDeps = {}): FallbackState {
  const now = deps.now ?? Date.now
  let settings: FallbackSettings | undefined
  let cooldowns: Cooldowns | undefined

  function settingsOnce(): FallbackSettings {
    if (!settings) {
      const read = readFallbackSettings(ctx.options, deps.env ?? process.env)
      if (read.problem !== undefined) notices.add(notice(`config ignored: ${read.problem}`))
      settings = read.settings
    }
    return settings
  }

  return {
    now,
    get settings() {
      return settingsOnce()
    },
    get cooldowns() {
      cooldowns ??= createCooldowns({
        file: deps.persist === false ? undefined : join(settingsOnce().stateDir, COOLDOWNS_FILE),
        scope: settingsOnce().cooldownScope,
        now,
        onProblem: (text) => notices.add(notice(text)),
      })
      return cooldowns
    },
  }
}
