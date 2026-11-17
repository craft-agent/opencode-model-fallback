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
  options: {} as Readonly<Record<string, OptionSpec>>,
  /** Options only the plugin's own features read, from its configuration: they have no flag or environment variable, and the settings accept them without reading their values. */
  pluginOptions: ["routes"] as readonly string[],
  /** The environment variables the tools read besides the settings. */
  toolVariables: [] as readonly string[],
} as const
