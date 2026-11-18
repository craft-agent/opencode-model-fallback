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
  "rpc.register",
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

/** How long the probe emits its event before it gives up on a handler being attached. */
const EVENT_WAIT_MS = 2000
/** The pause between two emits of the probe event. */
const EVENT_RETRY_MS = 100

/** A hand-written Standard Schema that accepts any object. */
const OBJECT_SCHEMA = {
  "~standard": {
    version: 1,
    vendor: "ci.load-probe",
    validate: (value) =>
      typeof value === "object" && value !== null ? { value } : { issues: [{ message: "expected an object" }] },
  },
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
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
    report.events = await probeEvents(ctx, ctx.options?.rpc)
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

/**
 * Proves the event side of RPC on this OpenCode: subscribes to the package's
 * `limited` event (only that subscribing does not throw), then registers a
 * definition of its own, subscribes to its `ping` event and emits until the
 * handler has received one. Every step is recorded as it went, or as its error.
 */
async function probeEvents(ctx, path) {
  const events = {}
  let registration
  let unsubscribeLimits
  let unsubscribePing
  try {
    const { LIMITS_RPC } = await import(pathToFileURL(path).href)
    try {
      unsubscribeLimits = ctx.rpc(LIMITS_RPC).events.on("limited", () => {})
      events.limits_subscribe = { ok: true }
    } catch (error) {
      events.limits_subscribe = { ok: false, error: message(error) }
    }
    const definition = {
      id: "ci.load-probe.events",
      methods: {},
      events: { ping: { schema: OBJECT_SCHEMA } },
    }
    registration = await within(ctx.rpc.register(definition, {}), CALL_TIMEOUT_MS)
    const received = []
    unsubscribePing = ctx.rpc(definition).events.on("ping", (data) => received.push(data))
    const until = Date.now() + EVENT_WAIT_MS
    while (received.length === 0 && Date.now() < until) {
      await within(Promise.resolve(registration.events.emit("ping", { n: 1 })), CALL_TIMEOUT_MS)
      await sleep(EVENT_RETRY_MS)
    }
    events.round_trip =
      received.length > 0 ? { received: received[0] } : { error: `no event arrived within ${EVENT_WAIT_MS}ms` }
  } catch (error) {
    events.round_trip = { error: message(error) }
  }
  for (const stop of [unsubscribeLimits, unsubscribePing]) {
    try {
      await stop?.()
    } catch {}
  }
  try {
    await registration?.dispose?.()
  } catch (error) {
    events.disposeError = message(error)
  }
  return events
}

/** What `call` resolves to as `{ value }`, or the error it rejects with as `{ type, error }`. */
async function attempt(call) {
  try {
    return { value: await within(call(), CALL_TIMEOUT_MS) }
  } catch (error) {
    return { type: error?.type, error: message(error) }
  }
}
