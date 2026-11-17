import { readFileSync } from "node:fs"

/** The package's name without its scope; the plugin is named like it. */
export const PLUGIN_NAME = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).name.replace(
  /^@[^/]+\//,
  "",
)
