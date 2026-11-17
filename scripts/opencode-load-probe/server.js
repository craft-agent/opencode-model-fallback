/**
 * A plugin that a real OpenCode loads next to the plugin under test, for
 * `scripts/opencode-load.mjs`. It writes what the plugin context offers to the
 * file named by the `out` option. It must stay named `server.js` at this
 * folder's root: OpenCode 2.1.2 loads a local plugin folder only from a root
 * `server.*` or `index.*` file and ignores `exports`.
 */
import { writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

const MEMBERS = [
  "app.version",
  "session.hook",
  "session.switchModel",
  "session.update",
  "tool.transform",
  "rpc",
  "agent.get",
  "model.list",
]
const HOOKS = [
  "retry",
  "http.request",
  "context",
  "experimental.ws.handshake",
  "experimental.ws.send",
  // Not a hook: documents that OpenCode resolves a registration for any name.
  "no.such.hook",
]

/** The array the load check's plugins mark their setups in; they share one process. */
const ORDER_KEY = Symbol.for("opencode-model-fallback.ci.load-order")

/** How long one call into the host may take before the probe records it as failed. */
const CALL_TIMEOUT_MS = 5000

const kind = (value) => (value === null ? "null" : typeof value)
const message = (error) => String(error?.message ?? error).slice(0, 300)
const within = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)),
  ])

function at(root, dotted) {
  let current = root
  for (const key of dotted.split(".")) current = current?.[key]
  return current
}

export default {
  id: "ci.load-probe",
  async setup(ctx) {
    const out = ctx.options?.out
    if (typeof out !== "string") throw new Error("load probe: the out option is missing")
    const order = (globalThis[ORDER_KEY] ??= [])
    order.push("probe:start")
    const report = {
      setup: true,
      order,
      version: ctx.app?.version,
      members: {},
      hooks: {},
      tools: {},
      done: false,
    }
    const save = () => writeFileSync(out, JSON.stringify(report, null, 2))
    for (const name of MEMBERS) report.members[name] = kind(at(ctx, name))
    save()

    for (const name of HOOKS) {
      try {
        const registration = await within(
          ctx.session.hook(name, () => {}),
          CALL_TIMEOUT_MS,
        )
        report.hooks[name] = {
          resolved: true,
          dispose: kind(registration?.dispose),
        }
        await registration?.dispose?.()
      } catch (error) {
        report.hooks[name] = { resolved: false, error: message(error) }
      }
    }

    try {
      let seen = "callback did not run"
      const registration = await within(
        ctx.tool.transform((editor) => {
          seen = kind(editor.get?.("subagent"))
        }),
        CALL_TIMEOUT_MS,
      )
      // A read replays the registered transforms, so the callback has run by now.
      const tools = await within(ctx.tool.list(), CALL_TIMEOUT_MS)
      report.tools = {
        subagentInTransform: seen,
        ids: tools.map((tool) => tool.id).sort(),
      }
      await registration?.dispose?.()
    } catch (error) {
      report.tools = { error: message(error) }
    }

    report.rpc = await probeRpc(ctx, ctx.options?.rpc)
    report.done = true
    save()
  },
}

/**
 * Proves an RPC round trip on this OpenCode: registers handlers for the
 * built `rpc.js` the `rpc` option names, asks them through `ctx.rpc`, and asks
 * a definition nobody registered, which must reject. Each answer is recorded as
 * the host returned it, or as the error that took its place.
 */
async function probeRpc(ctx, path) {
  const rpc = {}
  let registration
  try {
    const { STEPS_RPC } = await import(pathToFileURL(path).href)
    registration = await within(
      ctx.rpc.register(STEPS_RPC, {
        usable: async () => ({ usable: false, reason: "probe" }),
        limit: async () => ({ limit: true, wait_ms: 1 }),
      }),
      CALL_TIMEOUT_MS,
    )
    // The calls are made as the plugin under test makes them: with an abort signal.
    const { signal } = new AbortController()
    const client = ctx.rpc(STEPS_RPC)
    const step = { agent: "probe", model: "a/x#high" }
    const error = { type: "ci.probe", message: "probe" }
    rpc.usable = await attempt(() => client.usable(step, { signal }))
    rpc.limit = await attempt(() => client.limit({ ...step, error, wait_ms: 5 }, { signal }))
    const none = ctx.rpc({ ...STEPS_RPC, id: "ci.load-probe.none" })
    rpc.unavailable = await attempt(() => none.usable(step, { signal }))
  } catch (error) {
    rpc.error = message(error)
  }
  try {
    await registration?.dispose?.()
  } catch (error) {
    rpc.disposeError = message(error)
  }
  return rpc
}

/** What `call` resolves to as `{ value }`, or the error it rejects with as `{ type, error }`. */
async function attempt(call) {
  try {
    return { value: await within(call(), CALL_TIMEOUT_MS) }
  } catch (error) {
    return { type: error?.type, error: message(error) }
  }
}
