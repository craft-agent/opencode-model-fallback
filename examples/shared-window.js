/**
 * Shows how to hear each limit and pass over every step that shares the spent
 * window.
 *
 * The option `windows` names which steps share one usage window:
 *   { "windows": { "window-1": ["provider-a/model-x", "provider-a/model-y", "provider-a/*"] } }
 * A `*` model matches every model of the provider, and a step's `#variant` is
 * ignored. When a step of a window hits a limit, every step of it is unusable
 * until the cooldown's end.
 *
 * Load it beside the fallback as `examples/README.md` says, with:
 *   { "package": "./plugins/shared-window", "options": { "windows": { "window-1": ["provider-a/*"] } } }
 */
import { LIMITED_EVENT, LIMITS_RPC, STEPS_RPC } from "@craftsamo/opencode-model-fallback/rpc"

/** The step without its `#variant`. */
function withoutVariant(model) {
  return model.split("#")[0]
}

/** Whether a step matches an entry of a window: exactly, or by `provider/*`. */
function matches(entry, model) {
  const step = withoutVariant(model)
  const entryModel = withoutVariant(entry)
  if (entryModel.endsWith("/*")) return step.startsWith(entryModel.slice(0, -1))
  return step === entryModel
}

/** The names of the windows a step belongs to. */
function windowsOf(windows, model) {
  return Object.keys(windows).filter((name) => windows[name].some((entry) => matches(entry, model)))
}

/** The plugin: registers the step handlers and returns the cleanup that removes them. */
export default {
  id: "shared-window",
  async setup(ctx) {
    const windows = ctx.options?.windows ?? {}
    const spentUntil = new Map()
    const unsubscribe = ctx.rpc(LIMITS_RPC).events.on(LIMITED_EVENT, ({ data }) => {
      try {
        const until = Date.parse(data.until)
        if (Number.isNaN(until)) return
        for (const name of windowsOf(windows, data.model)) {
          spentUntil.set(name, Math.max(until, spentUntil.get(name) ?? 0))
        }
      } catch {
        // A handler that throws ends its subscription, so nothing escapes.
      }
    })
    const registration = await ctx.rpc.register(STEPS_RPC, {
      async usable({ model }) {
        const spent = windowsOf(windows, model).find((name) => (spentUntil.get(name) ?? 0) > Date.now())
        return spent === undefined ? { usable: true } : { usable: false, reason: `window ${spent} is spent` }
      },
      async limit() {
        return { limit: false }
      },
    })
    return async () => {
      unsubscribe()
      await registration.dispose()
    }
  },
}
