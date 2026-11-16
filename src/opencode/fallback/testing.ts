import type { CallPath } from "./feature"
import { MIN_OPENCODE_VERSION } from "./version"
import type { V2Context, V2HookName, V2ModelRef, V2Skill, V2SessionHooks, V2Tool } from "../types"

/** The shared fake of OpenCode 2's plugin context, for the tests of the fallback. */

/** The directory the fake's sessions are in. */
export const FAKE_DIRECTORY = "/work/project"

/** One `session.hook` call the fake took: whether it was disposed since. */
export type FakeHook = {
  name: string
  handler: (event: never) => void | Promise<void>
  disposed: boolean
}

export type FakeOptions = {
  /** `ctx.app.version`: the minimum when absent; `null` leaves `app` out. */
  version?: string | null
  /** Hook names for which `session.hook` rejects. */
  rejectHooks?: readonly string[]
  /** Calls the context does not have. */
  omit?: readonly CallPath[]
  options?: Record<string, unknown>
}

/** What `fakeContext` gives back: the context and what the plugin did to it. */
export type FakeContext = {
  ctx: V2Context
  /** Every hook the fake took, in order. */
  hooks: FakeHook[]
  /** The names of the hooks disposed, in the order they were. */
  disposed: string[]
  switches: { sessionID: string; model: V2ModelRef }[]
  tools: Map<string, V2Tool>
  skills: V2Skill[]
}

/** Removes the call at `path` from `ctx`, as a host without it would be. */
function omitCall(ctx: V2Context, path: CallPath): void {
  const keys = path.split(".")
  const last = keys.pop()!
  let owner: Record<string, unknown> = ctx
  for (const key of keys) owner = owner[key] as Record<string, unknown>
  delete owner[last]
}

/**
 * A V2 plugin context that records the hooks taken (and their disposal), the
 * `switchModel` calls and the tools and skills added; `options` shapes what a
 * host would lack or refuse.
 */
export function fakeContext(fake: FakeOptions = {}): FakeContext {
  const hooks: FakeHook[] = []
  const disposed: string[] = []
  const switches: FakeContext["switches"] = []
  const tools = new Map<string, V2Tool>()
  const skills: V2Skill[] = []
  const ctx: V2Context = {
    ...(fake.version === null ? {} : { app: { version: fake.version ?? MIN_OPENCODE_VERSION } }),
    options: fake.options,
    rpc: () => ({}),
    agent: { get: async () => ({ data: {} }) },
    model: { list: async () => ({ data: [] }) },
    session: {
      async get() {
        return { id: "ses_1", location: { directory: FAKE_DIRECTORY } }
      },
      async update() {},
      async switchModel(input) {
        switches.push(input)
      },
      async hook<Name extends V2HookName>(name: Name, handler: (event: V2SessionHooks[Name]) => void | Promise<void>) {
        if (fake.rejectHooks?.includes(name)) throw new Error(`no such hook: ${name}`)
        const entry: FakeHook = { name, handler: handler as FakeHook["handler"], disposed: false }
        hooks.push(entry)
        return {
          async dispose() {
            entry.disposed = true
            disposed.push(name)
          },
        }
      },
    },
    permission: { assert: async () => {} },
    tool: { transform: async (callback) => callback({ add: (tool) => tools.set(tool.name, tool) }) },
    skill: { transform: async (callback) => callback({ add: (skill) => skills.push(skill) }) },
  }
  for (const path of fake.omit ?? []) omitCall(ctx, path)
  return { ctx, hooks, disposed, switches, tools, skills }
}
