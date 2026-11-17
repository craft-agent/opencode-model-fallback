/**
 * Loads the built plugin package into a real OpenCode 2 server, headless and
 * without model credentials, and fails unless OpenCode ran the plugin's setup
 * and its context has the calls the fallback uses, and that plugins start in
 * the order they are listed. A probe plugin (`scripts/opencode-load-probe`)
 * reports what the context offers; a second one, listed first
 * (`scripts/opencode-load-probe-first`), and a shim around the package mark
 * when each setup starts and ends.
 *
 * usage: node scripts/opencode-load.mjs <opencode-binary> <package-dir> <scratch-dir>
 */
import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const [binary, packageArg, scratchArg] = process.argv.slice(2)
if (!binary || !packageArg || !scratchArg) {
  console.error("usage: node scripts/opencode-load.mjs <opencode-binary> <package-dir> <scratch-dir>")
  process.exit(2)
}
const PACKAGE = resolve(packageArg)
const SCRATCH = resolve(scratchArg)
const SCRIPTS = dirname(fileURLToPath(import.meta.url))
const PROBE = join(SCRIPTS, "opencode-load-probe")
/** The probe listed before the package, which marks its setup first. */
const PROBE_FIRST = join(SCRIPTS, "opencode-load-probe-first")
/** The shared array, under `Symbol.for(...)`, where the plugins mark their setups. */
const ORDER_KEY = "opencode-model-fallback.ci.load-order"
/** The order the plugins must start in, each setup ending before the next starts. */
const EXPECTED_ORDER = ["first:start", "first:end", "package:start", "package:end", "probe:start"]
const SHIM = join(SCRATCH, "plugin")
const WORK = join(SCRATCH, "work")
const HOME = join(SCRATCH, "home")
const OUT = join(SCRATCH, "probe.json")
const DEADLINE_MS = Number(process.env.LOAD_TIMEOUT_MS ?? 60_000)
/** How long the server gets to exit after SIGTERM before SIGKILL. */
const STOP_GRACE_MS = 5000
/** The options the plugin under test gets: a route, so the launch feature wraps the subagent tool. */
const PLUGIN_OPTIONS = { routes: { "load-check": ["load-check/model"] } }
/** The plugin states OpenCode leaves once a setup has run. */
const SETTLED = new Set(["active", "failed"])

/** Context members the plugin calls, with the type each must have. */
const REQUIRED_MEMBERS = {
  "app.version": "string",
  "session.hook": "function",
  "session.switchModel": "function",
  "session.update": "function",
  "tool.transform": "function",
  "agent.get": "function",
  "model.list": "function",
}
/** What the probe's handlers answer, as a client reads it back through the host. */
const RPC_ANSWERS = {
  usable: { usable: false, reason: "probe" },
  limit: { limit: true, wait_ms: 1 },
}
/** Session hooks the plugin registers. OpenCode resolves a registration even for an unknown name. */
const REQUIRED_HOOKS = ["retry", "http.request", "context"]

const manifest = JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8"))
const entry = pathToFileURL(join(PACKAGE, manifest.exports?.["."] ?? manifest.main)).href
const { default: plugin } = await import(entry)
/** The built `rpc.js` the probe registers handlers from, as the package exports it. */
const RPC_ENTRY = join(PACKAGE, manifest.exports["./rpc"])

rmSync(SCRATCH, { recursive: true, force: true })
for (const dir of [SHIM, WORK, join(HOME, "tmp")]) mkdirSync(dir, { recursive: true })
// OpenCode 2.1 loads a local plugin directory from its root server or index
// file and ignores package.json exports, so the package loads through a shim.
// The shim also marks when the package's setup starts and ends.
writeFileSync(
  join(SHIM, "index.js"),
  `import real from ${JSON.stringify(entry)}
const order = (globalThis[Symbol.for(${JSON.stringify(ORDER_KEY)})] ??= [])
export default {
  ...real,
  async setup(...args) {
    order.push("package:start")
    try {
      return await real.setup(...args)
    } finally {
      order.push("package:end")
    }
  },
}
`,
)
writeFileSync(
  join(WORK, "opencode.json"),
  JSON.stringify(
    {
      plugins: [
        { package: PROBE_FIRST },
        { package: SHIM, options: PLUGIN_OPTIONS },
        { package: PROBE, options: { out: OUT, rpc: RPC_ENTRY } },
      ],
    },
    null,
    2,
  ),
)

const password = randomBytes(24).toString("hex")
const server = spawn(
  binary.includes("/") ? resolve(binary) : binary,
  ["serve", "--hostname", "127.0.0.1", "--port", "0", "--print-logs"],
  {
    cwd: WORK,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    // Only what OpenCode needs: no provider keys from the caller, and every
    // directory it writes inside the scratch directory.
    env: {
      PATH: process.env.PATH,
      HOME,
      XDG_CONFIG_HOME: join(HOME, ".config"),
      XDG_DATA_HOME: join(HOME, ".local/share"),
      XDG_STATE_HOME: join(HOME, ".local/state"),
      XDG_CACHE_HOME: join(HOME, ".cache"),
      TMPDIR: join(HOME, "tmp"),
      OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_DISABLE_MODELS_FETCH: "1",
      OPENCODE_DISABLE_FREE_MODELS: "1",
    },
  },
)
let serverLog = ""
server.stderr.on("data", (chunk) => (serverLog = (serverLog + chunk).slice(-20_000)))
const exited = new Promise((done) => {
  server.on("exit", (code, signal) => done({ code, signal }))
  server.on("error", (error) => done({ code: error.code }))
})
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const deadline = Date.now() + DEADLINE_MS

async function stop() {
  if (server.exitCode !== null || server.signalCode !== null) return
  const kill = (signal) => {
    try {
      process.kill(-server.pid, signal)
    } catch {}
  }
  kill("SIGTERM")
  if (!(await Promise.race([exited, sleep(STOP_GRACE_MS)]))) {
    kill("SIGKILL")
    await exited
  }
}

async function load() {
  const url = await new Promise((done, fail) => {
    let stdout = ""
    server.stdout.on("data", (chunk) => {
      stdout += chunk
      const match = stdout.match(/server listening on (http:\/\/\S+)/)
      if (match) done(match[1])
    })
    exited.then(({ code, signal }) => fail(new Error(`opencode serve exited early (${code ?? signal})`)))
    setTimeout(() => fail(new Error("opencode serve did not report its address")), DEADLINE_MS).unref()
  })
  const headers = {
    authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
  }
  const api = async (path) => {
    const response = await fetch(`${url}${path}?directory=${encodeURIComponent(WORK)}`, { headers })
    if (!response.ok) throw new Error(`GET ${path}: HTTP ${response.status}`)
    return (await response.json()).data
  }

  // A request for the location boots it; its plugins load shortly after.
  await api("/api/agent")
  let report
  while (Date.now() < deadline && !report?.done) {
    await sleep(250)
    if (!existsSync(OUT)) continue
    try {
      report = JSON.parse(readFileSync(OUT, "utf8"))
    } catch {}
  }
  // The plugin list can lag behind the probe's report, so it is read until it
  // shows the plugin settled (active or failed) or the deadline passes.
  let plugins = await api("/api/plugin")
  while (Date.now() < deadline && !SETTLED.has(plugins.find((item) => item.id === plugin.id)?.state?.status)) {
    await sleep(250)
    plugins = await api("/api/plugin")
  }
  return { report, plugins }
}

const failures = []
try {
  const { report, plugins } = await load()
  const configured = plugins.filter((item) => item.source?.type !== "builtin")
  console.log(JSON.stringify({ configured, report }, null, 2))
  if (!report?.done) failures.push("the load probe did not finish: OpenCode did not run plugin setup in time")
  for (const [name, type] of Object.entries(REQUIRED_MEMBERS)) {
    if (report?.members?.[name] !== type) failures.push(`ctx.${name} is ${report?.members?.[name]}, not ${type}`)
  }
  for (const name of REQUIRED_HOOKS) {
    if (!report?.hooks?.[name]?.resolved) failures.push(`ctx.session.hook("${name}") did not resolve`)
  }
  if (report?.tools?.subagentInTransform !== "object")
    failures.push("ctx.tool.transform does not see the subagent tool")
  for (const [name, expected] of Object.entries(RPC_ANSWERS)) {
    const answer = report?.rpc?.[name]
    if (JSON.stringify(answer?.value) !== JSON.stringify(expected))
      failures.push(
        `the RPC ${name} answered ${JSON.stringify(answer ?? report?.rpc)}, not ${JSON.stringify(expected)}`,
      )
  }
  const none = report?.rpc?.unavailable
  if (none?.value !== undefined || none?.error === undefined)
    failures.push(`a call to an unregistered RPC did not reject: ${JSON.stringify(none)}`)
  else console.log(`RPC: a call with no plugin registered rejects with type ${none.type}.`)
  if (report?.rpc?.error !== undefined) failures.push(`the RPC probe failed: ${report.rpc.error}`)
  if (JSON.stringify(report?.order) !== JSON.stringify(EXPECTED_ORDER))
    failures.push(`the plugins started in the order ${JSON.stringify(report?.order)}, not ${EXPECTED_ORDER.join(", ")}`)
  else console.log(`Plugins started in list order: ${report.order.join(", ")}.`)
  const loaded = plugins.find((item) => item.id === plugin.id)
  if (!loaded) failures.push(`OpenCode does not list the plugin ${plugin.id}`)
  else if (loaded.state?.status !== "active")
    failures.push(`the plugin ${plugin.id} is ${loaded.state?.status}: ${loaded.state?.error ?? ""}`)
} catch (error) {
  failures.push(String(error?.message ?? error))
} finally {
  await stop()
}
if (failures.length) {
  console.error(serverLog)
  for (const failure of failures) console.error(`FAIL: ${failure}`)
  process.exit(1)
}
console.log(`OK: OpenCode ran the setup of ${plugin.id}, and its context has every call it needs.`)
process.exit(0)
