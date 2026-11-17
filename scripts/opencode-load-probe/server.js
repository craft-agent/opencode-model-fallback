/**
 * A plugin that a real OpenCode loads next to the plugin under test, for
 * `scripts/opencode-load.mjs`. It writes what the plugin context offers to the
 * file named by the `out` option. It must stay named `server.js` at this
 * folder's root: OpenCode 2.1.2 loads a local plugin folder only from a root
 * `server.*` or `index.*` file and ignores `exports`.
 */
import { writeFileSync } from "node:fs"

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
    const report = {
      setup: true,
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

    report.done = true
    save()
  },
}
