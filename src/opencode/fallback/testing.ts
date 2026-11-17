import type { CallPath } from "./feature"
import { parseSelector } from "./routes"
import { MIN_OPENCODE_VERSION } from "./version"
import type {
  Registration,
  V2CatalogModel,
  V2Context,
  V2Executor,
  V2ExecutorContext,
  V2ExecutorResult,
  V2HookName,
  V2ModelRef,
  V2Session,
  V2SessionHooks,
  V2Skill,
  V2Tool,
  V2ToolEditor,
} from "../types"

/** The shared fake of OpenCode 2's plugin context, for the tests of the fallback. */

/** The directory the fake's sessions are in. */
export const FAKE_DIRECTORY = "/work/project"

/** The ID of the built-in tool the fake lets a transform wrap. */
export const SUBAGENT_ID = "subagent"

/** What the fake built-in `subagent` tool returns unless a test says otherwise. */
export const SUBAGENT_RESULT: V2ExecutorResult = {
  output: { sessionID: "ses_child" },
  content: "child said hi",
  metadata: { sessionID: "ses_child" },
}

/** One `session.hook` call the fake took: whether it was disposed since. */
export type FakeHook = {
  name: string
  handler: (event: never) => void | Promise<void>
  disposed: boolean
}

/** One call of the fake built-in `subagent` tool, as it reached the original executor. */
export type SubagentCall = { input: Record<string, unknown>; context: V2ExecutorContext }

/** One `tool.transform` call the fake took: whether it was disposed since. */
export type FakeTransform = { disposed: boolean }

export type FakeOptions = {
  /** `ctx.app.version`: the minimum when absent; `null` leaves `app` out. */
  version?: string | null
  /** Hook names for which `session.hook` rejects. */
  rejectHooks?: readonly string[]
  /** Calls the context does not have. */
  omit?: readonly CallPath[]
  options?: Record<string, unknown>
  /** What `session.get` gives for a session ID; any other ID is in `FAKE_DIRECTORY` with no model. */
  sessions?: Record<string, Pick<V2Session, "model" | "location">>
  /** What `agent.get` gives for an agent ID; any other agent has no model. */
  agents?: Record<string, { model?: V2ModelRef }>
  /** What `model.list` returns. */
  catalog?: V2CatalogModel[]
  /** What the fake built-in `subagent` tool does once called; the call is recorded first. */
  subagent?: V2Executor
  /** The tool editor members a host lacks. */
  omitEditor?: readonly ("get" | "update")[]
}

/** What `fakeContext` gives back: the context and what the plugin did to it. */
export type FakeContext = {
  ctx: V2Context
  /** Every hook the fake took, in order. */
  hooks: FakeHook[]
  /** Passes `event` to the handlers taken for `name` and not disposed, in the order they were taken, as OpenCode does. */
  fire<Name extends V2HookName>(name: Name, event: V2SessionHooks[Name]): Promise<void>
  /** The names of the hooks disposed, in the order they were. */
  disposed: string[]
  switches: { sessionID: string; model: V2ModelRef }[]
  tools: Map<string, V2Tool>
  skills: V2Skill[]
  /** Every `tool.transform` call, in order. */
  transforms: FakeTransform[]
  subagent: {
    /** The calls that reached the original executor. */
    calls: SubagentCall[]
    /** The executor as the transforms left it: the original, or what wraps it. */
    execute: V2Executor
  }
}

/** A catalog model that can run a subagent; `overrides` change any of it. `model` is a reference or a `provider/model` text (a `#variant` in it is dropped: variants are an override). */
export function catalogModel(model: V2ModelRef | string, overrides: Partial<V2CatalogModel> = {}): V2CatalogModel {
  const ref = typeof model === "string" ? parseSelector(model)! : model
  return {
    providerID: ref.providerID,
    id: ref.id,
    enabled: true,
    status: "active",
    capabilities: { tools: true },
    variants: [],
    limit: { context: 200_000, output: 8_000 },
    ...overrides,
  }
}

/** The context of a tool that runs under the fake, for calling an executor. */
export function executorContext(overrides: Partial<V2ExecutorContext> = {}): V2ExecutorContext {
  return {
    sessionID: "ses_parent",
    signal: new AbortController().signal,
    id: "call_1",
    progress: async () => {},
    ...overrides,
  }
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
 * `switchModel` calls, the tools and skills added and the calls of a built-in
 * `subagent` tool a transform may wrap; `options` shapes what a host would
 * lack or refuse.
 */
export function fakeContext(fake: FakeOptions = {}): FakeContext {
  const hooks: FakeHook[] = []
  const disposed: string[] = []
  const switches: FakeContext["switches"] = []
  const tools = new Map<string, V2Tool>()
  const skills: V2Skill[] = []
  const transforms: FakeTransform[] = []
  const calls: SubagentCall[] = []
  const original: V2Executor = async (input, context) => {
    calls.push({ input, context })
    return fake.subagent ? fake.subagent(input, context) : SUBAGENT_RESULT
  }
  let current = original
  const editor: V2ToolEditor = {
    add: (tool) => tools.set(tool.name, tool),
    ...(fake.omitEditor?.includes("get") ? {} : { get: (id: string) => (id === SUBAGENT_ID ? {} : undefined) }),
    ...(fake.omitEditor?.includes("update")
      ? {}
      : {
          update(id: string, callback: (tool: { execute: V2Executor }) => void) {
            if (id !== SUBAGENT_ID) return
            const tool = { execute: current }
            callback(tool)
            current = tool.execute
          },
        }),
  }
  const ctx: V2Context = {
    ...(fake.version === null ? {} : { app: { version: fake.version ?? MIN_OPENCODE_VERSION } }),
    options: fake.options,
    rpc: () => ({}),
    agent: { get: async ({ agentID }) => ({ data: fake.agents?.[agentID] ?? {} }) },
    model: { list: async () => ({ data: fake.catalog ?? [] }) },
    session: {
      async get({ sessionID }) {
        return { id: sessionID, location: { directory: FAKE_DIRECTORY }, ...fake.sessions?.[sessionID] }
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
    tool: {
      async transform(callback): Promise<Registration> {
        callback(editor)
        const transform: FakeTransform = { disposed: false }
        transforms.push(transform)
        return {
          async dispose() {
            transform.disposed = true
          },
        }
      },
    },
    skill: { transform: async (callback) => callback({ add: (skill) => skills.push(skill) }) },
  }
  for (const path of fake.omit ?? []) omitCall(ctx, path)
  return {
    ctx,
    hooks,
    async fire(name, event) {
      for (const hook of hooks) {
        if (hook.name === name && !hook.disposed) {
          await (hook.handler as (event: unknown) => void | Promise<void>)(event)
        }
      }
    },
    disposed,
    switches,
    tools,
    skills,
    transforms,
    subagent: { calls, execute: (input, context) => current(input, context) },
  }
}
