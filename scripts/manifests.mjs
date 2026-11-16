import { readFileSync, writeFileSync } from "node:fs"
import { CODEX_MANIFEST, loadForwardedVariables, renderCodexEnv } from "./codex-env.mjs"
import { VERSION_FILES } from "./version-files.mjs"

/**
 * Keeps the generated fields of the manifests in step with package.json and the
 * variables the server reads: the top-level `version` of every file in
 * `VERSION_FILES`, and the server's `env_vars` (the settings' variables, then
 * `toolVariables`) and `default_tools_approval_mode` in `.codex-plugin/plugin.json`.
 * The rest of each file is written by hand.
 * `--check` writes nothing and fails when a file is out of date.
 */

const ROOT = new URL("../", import.meta.url)
const PACKAGE = new URL("../package.json", import.meta.url)
const JSON_VERSION_LINE = /^ {2}"version": "[^"]*"/m

function replaceField(text, pattern, replacement, name, file) {
  if (!pattern.test(text)) throw new Error(`${file} has no \`${name}\` field to update.`)
  return text.replace(pattern, () => replacement)
}

/** Only the version line changes, so the file keeps the formatting it was written with. */
function renderJson(file, text, version) {
  const updated = replaceField(text, JSON_VERSION_LINE, `  "version": ${JSON.stringify(version)}`, "version", file)
  if (JSON.parse(updated).version !== version) throw new Error(`${file} has its \`version\` field below the top level.`)
  return updated
}

async function render(file, text, version, variables) {
  const withVersion = renderJson(file, text, version)
  return file === CODEX_MANIFEST ? renderCodexEnv(withVersion, variables) : withVersion
}

try {
  const check = process.argv.includes("--check")
  const { version } = JSON.parse(readFileSync(PACKAGE, "utf8"))
  const variables = await loadForwardedVariables()

  const outOfDate = []
  for (const file of VERSION_FILES) {
    const url = new URL(file, ROOT)
    const current = readFileSync(url, "utf8")
    const updated = await render(file, current, version, variables)
    if (updated === current) continue
    outOfDate.push(file)
    if (!check) writeFileSync(url, updated)
  }

  if (check && outOfDate.length > 0) {
    console.error(
      `${outOfDate.join(", ")} out of date; run \`pnpm run build && pnpm run manifests\` and commit the result.`,
    )
    process.exit(1)
  }
  if (check) console.log("The manifests are up to date.")
  else if (outOfDate.length > 0) console.log(`Updated ${outOfDate.join(", ")}.`)
  else console.log("The manifests are already up to date.")
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
