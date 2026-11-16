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

/** Mirrors the V2 `ctx.tool.transform` and `ctx.skill.transform` registration, reduced to `add`. */
export type V2Transform<Item> = (callback: (editor: { add(item: Item): void }) => void) => Promise<unknown>

/** Mirrors the context a V2 plugin's `setup` receives (`@opencode/plugin`, promise API). */
export type V2Context = {
  options?: PluginOptions
  session: {
    get(input: { sessionID: string }): Promise<{ location?: { directory?: string } }>
  }
  permission: {
    assert(input: V2PermissionRequest): Promise<void>
    /** The `evaluate` hook, which the plugin types may not declare yet; a host without it leaves the rules as they are. */
    hook?(name: "evaluate", fn: (event: V2PermissionEvaluation) => void | Promise<void>): Promise<unknown> | void
  }
  tool: { transform: V2Transform<V2Tool> }
  skill: { transform: V2Transform<V2Skill> }
}

/** Mirrors the V2 plugin: an `id` and a `setup`. */
export type OpenCodePlugin = {
  id: string
  setup(context: V2Context): Promise<void>
}
