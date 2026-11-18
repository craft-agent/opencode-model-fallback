import type { OptionSpec } from "./core"

/** What makes this package itself; a project made from the starter sets these once (the setup script does). */
export const PROJECT = {
  /** The plugin name. */
  name: "opencode-model-fallback",
  /** Every tool ID starts with `<toolPrefix>_`. */
  toolPrefix: "fallback",
  /** Every setting's environment variable is `<envPrefix>_<SETTING>`. */
  envPrefix: "OPENCODE_MODEL_FALLBACK",
  /** The toolsets, in the order `all` lists them. */
  toolsets: [] as readonly string[],
  /** The toolsets on when a setting names none. */
  defaultToolsets: [] as readonly string[],
  /** The package's own settings, which the tools themselves read: each snake_case name and its type, with bounds when it needs them. */
  options: {
    /** The longest wait, in milliseconds, that a provider may ask of a rate limit before the model counts as having hit a limit. */
    max_wait_ms: { type: "number", min: 0 },
    /** How long, in milliseconds, a model that hit a limit is passed over when OpenCode gave no wait. */
    cooldown_ms: { type: "number", min: 1 },
    /** The directory where the plugin keeps its state, the cooldowns included. */
    state_dir: "path",
    /** What a limit cools: `model` (the default) the model that hit it, `provider` that model's whole provider. */
    cooldown_scope: "text",
  } as Readonly<Record<string, OptionSpec>>,
  /** Options only the plugin's own features read, from its configuration: they have no flag or environment variable, and the settings accept them without reading their values. */
  pluginOptions: ["routes"] as readonly string[],
  /** The environment variables the tools read besides the settings. */
  toolVariables: [] as readonly string[],
} as const
