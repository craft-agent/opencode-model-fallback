import { fileURLToPath, pathToFileURL } from "node:url"
import { PLUGIN_NAME } from "./package-name.mjs"

const PLUGIN = fileURLToPath(new URL("../dist/opencode.js", import.meta.url))

/** The tools `setup` registers with default settings; none while the package has no toolset on. */
const EXPECTED_TOOLS = []

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

try {
  const { default: plugin } = await import(pathToFileURL(PLUGIN).href)
  expect(
    typeof plugin?.id === "string" && typeof plugin.setup === "function",
    `Expected a default export with id and setup, got ${JSON.stringify(Object.keys(plugin ?? {}))}.`,
  )
  expect(plugin.id === PLUGIN_NAME, `Expected the plugin to be named ${PLUGIN_NAME}, got ${plugin.id}.`)
  console.log(`The OpenCode plugin ${plugin.id} exports setup.`)

  const added = []
  const skills = []
  const hooks = []
  const cleanup = await plugin.setup({
    app: { version: "2.1.2" },
    options: {},
    tool: { transform: async (callback) => callback({ add: (tool) => added.push(tool.name) }) },
    skill: { transform: async (callback) => callback({ add: (skill) => skills.push(skill.id) }) },
    session: {
      get: async () => ({}),
      hook: async (name) => {
        hooks.push(name)
        return { dispose: async () => {} }
      },
    },
    permission: { assert: async () => {} },
  })
  expect(
    JSON.stringify(added.sort()) === JSON.stringify(EXPECTED_TOOLS),
    `Expected setup to register ${JSON.stringify(EXPECTED_TOOLS)}, got ${JSON.stringify(added)}.`,
  )
  expect(
    hooks.length === 0,
    `Expected setup to register no hook with nothing configured, got ${JSON.stringify(hooks)}.`,
  )
  expect(
    cleanup === undefined || typeof cleanup === "function",
    `Expected setup to return a cleanup or nothing, got ${typeof cleanup}.`,
  )
  await cleanup?.()
  console.log(`setup registers ${added.length} tools, ${skills.length} skills and ${hooks.length} hooks.`)
} catch (error) {
  console.error(error)
  process.exit(1)
}
