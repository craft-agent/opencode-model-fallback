import type { z } from "zod"

/** The slices of the OpenCode V2 plugin API the entry point uses; the package is not imported at runtime. */

/** The options a plugin is configured with, passed as `ctx.options`. */
export type PluginOptions = Readonly<Record<string, unknown>>

/** Mirrors the V2 `permission.assert` input of `@opencode/plugin` (promise API). */
export type V2PermissionRequest = {
  sessionID: string
  action: string
  resources: string[]
  /** The resources an "always" answer persists. */
  save?: string[]
  metadata?: Record<string, unknown>
}

/** Mirrors the context a V2 tool's `execute` receives (`@opencode/plugin`, promise API). */
export type V2ToolContext = {
  sessionID: string
  signal: AbortSignal
}

/** Mirrors `Tool.Result` of `@opencode/plugin` V2: a text `content` for the model and a structured `output`. */
export type V2ToolResult = {
  content: string
  output: unknown
}

/** Mirrors the tool a V2 `ToolEditor.add` takes; `input` and `output` are Standard Schema objects. */
export type V2Tool = {
  name: string
  description: string
  input: z.ZodObject<any>
  output: z.ZodObject<any>
  execute(input: unknown, context: V2ToolContext): Promise<V2ToolResult>
}

/** Mirrors `Skill.Info` of `@opencode/plugin` V2. */
export type V2Skill = {
  id: string
  name: string
  description?: string
  path: string
  content: string
}

/** What a permission rule gives an action: let it run, ask the person, or refuse it. */
export type PermissionEffect = "allow" | "ask" | "deny"

/** A V2 permission evaluation: the action asked about and the effect the rules gave it so far, which a hook may change. */
export type V2PermissionEvaluation = {
  action: string
  effect: PermissionEffect
}

/** Mirrors the V2 `ctx.skill.transform` registration, reduced to `add`. */
export type V2Transform<Item> = (callback: (editor: { add(item: Item): void }) => void) => Promise<unknown>

/** Mirrors the `Registration` a V2 hook or transform returns: `dispose` takes it back. */
export type Registration = { dispose(): Promise<void> }

/** Mirrors a model reference of the V2 session and hook events. */
export type V2ModelRef = {
  id: string
  providerID: string
  variant?: string
}

/** Mirrors a session as `ctx.session.get` returns it; the starter's tools read only `location.directory`. */
export type V2Session = {
  id?: string
  parentID?: string
  agent?: string
  model?: V2ModelRef
  metadata?: Record<string, unknown>
  location?: { directory?: string }
}

/** What a hook that belongs to a model request tells about it. */
export type V2HookScope = {
  sessionID: string
  model: V2ModelRef
  kind: "primary" | "title" | "compaction" | "generate"
}

/** Mirrors the event of the `context`, `compaction` and `generate` hooks. */
export type V2ContextEvent = {
  sessionID: string
  model: V2ModelRef
  system: unknown[]
  messages: unknown[]
  tools?: unknown
  options: unknown
}

/** Mirrors the events `ctx.session.hook` passes by hook name; a handler changes what an event holds in place. */
export type V2SessionHooks = {
  context: V2ContextEvent
  compaction: V2ContextEvent
  generate: V2ContextEvent
  "http.request": V2HookScope & { request: Request }
  "experimental.ws.handshake": V2HookScope & { url: string; headers: Record<string, string> }
  "experimental.ws.send": V2HookScope & { frame: string }
  retry: {
    sessionID: string
    agent?: string
    model: V2ModelRef
    attempt?: number
    error: {
      type: string
      status?: number
      message: string
      response?: { body?: string }
    }
    decision: { retry: false } | { retry: true; delay: number }
  }
}

/** The name of a hook `ctx.session.hook` takes. */
export type V2HookName = keyof V2SessionHooks

/** Mirrors the context of a built-in tool's `execute`. */
export type V2ExecutorContext = V2ToolContext & {
  id: string
  progress(update: Record<string, unknown>): Promise<void>
}

/** Mirrors what a built-in tool's `execute` resolves to. */
export type V2ExecutorResult = {
  output?: unknown
  content?: string | readonly unknown[]
  metadata?: Record<string, unknown>
}

/** Mirrors the `execute` of a built-in tool, as `ToolEditor.update` hands it over. */
export type V2Executor = (input: Record<string, unknown>, context: V2ExecutorContext) => Promise<V2ExecutorResult>

/** Mirrors the V2 tool editor: `add` is the starter's; `get` and `update` change a built-in tool and are probed. */
export type V2ToolEditor = {
  add(tool: V2Tool): void
  get?(id: string): unknown
  update?(id: string, callback: (tool: { execute: V2Executor }) => void): void
}

/** Mirrors a model of the catalog `ctx.model.list` returns. */
export type V2CatalogModel = {
  id: string
  providerID: string
  enabled: boolean
  status: string
  capabilities: { tools: boolean }
  variants: Array<{ id: string }>
  limit: { context: number; input?: number; output: number }
}

/** Mirrors the context a V2 plugin's `setup` receives (`@opencode/plugin`, promise API); what only a feature uses is optional, so it can be probed. */
export type V2Context = {
  app?: { version?: string }
  options?: PluginOptions
  /** Another plugin's RPC methods, by its definition. */
  rpc?: (definition: {
    id: string
    methods: Record<string, object>
    events: Record<string, object>
  }) => Record<string, ((input: unknown) => Promise<unknown>) | undefined>
  agent?: {
    get?(input: { agentID: string; location: { directory: string } }): Promise<{ data: { model?: V2ModelRef } }>
  }
  model?: {
    list?(input: { location: { directory: string } }): Promise<{ data: V2CatalogModel[] }>
  }
  session: {
    get(input: { sessionID: string }): Promise<V2Session>
    update?(input: { sessionID: string; metadata: Record<string, unknown> }): Promise<unknown>
    switchModel?(input: { sessionID: string; model: V2ModelRef }): Promise<void>
    hook?<Name extends V2HookName>(
      name: Name,
      callback: (event: V2SessionHooks[Name]) => void | Promise<void>,
    ): Promise<Registration>
  }
  permission: {
    assert(input: V2PermissionRequest): Promise<void>
    /** The `evaluate` hook, which the plugin types may not declare yet; a host without it leaves the rules as they are. */
    hook?(name: "evaluate", fn: (event: V2PermissionEvaluation) => void | Promise<void>): Promise<unknown> | void
  }
  tool: {
    /** A host that hands back a `Registration` lets the plugin take its transform back. */
    transform(callback: (editor: V2ToolEditor) => void): Promise<Registration | void>
  }
  skill: { transform: V2Transform<V2Skill> }
}

/** Mirrors the V2 plugin: an `id` and a `setup`, which may return a cleanup the host runs on shutdown. */
export type OpenCodePlugin = {
  id: string
  setup(context: V2Context): Promise<void | (() => Promise<void>)>
}
