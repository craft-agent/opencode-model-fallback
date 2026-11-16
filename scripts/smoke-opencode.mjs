import { fileURLToPath, pathToFileURL } from "node:url"
import { PLUGIN_NAME } from "./package-name.mjs"

const PLUGIN = fileURLToPath(new URL("../dist/opencode.js", import.meta.url))

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

try {
  const { default: plugin } = await import(pathToFileURL(PLUGIN).href)
  expect(
    typeof plugin?.id === "string" && typeof plugin.setup === "function" && typeof plugin.server === "function",
    `Expected a default export with id, setup and server, got ${JSON.stringify(Object.keys(plugin ?? {}))}.`,
  )
  expect(plugin.id === PLUGIN_NAME, `Expected the plugin to be named ${PLUGIN_NAME}, got ${plugin.id}.`)
  console.log(`The OpenCode plugin ${plugin.id} exports setup and server.`)

  const { tool } = await plugin.server({}, {})
  const served = Object.keys(tool).sort()
  console.log(`server returns ${served.length} tools.`)

  const added = []
  const skills = []
  await plugin.setup({
    options: {},
    tool: { transform: async (callback) => callback({ add: (tool) => added.push(tool.name) }) },
    skill: { transform: async (callback) => callback({ add: (skill) => skills.push(skill.id) }) },
    session: { get: async () => ({}) },
    permission: { assert: async () => {} },
  })
  expect(
    JSON.stringify(added.sort()) === JSON.stringify(served),
    `Expected setup to register ${JSON.stringify(served)}, as server returns, got ${JSON.stringify(added)}.`,
  )
  console.log(`setup registers ${added.length} tools (as many as server returns) and ${skills.length} skills.`)
} catch (error) {
  console.error(error)
  process.exit(1)
}
