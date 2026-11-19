/**
 * Shows how to answer `limit` from a provider's own wording.
 *
 * An error whose message or body matches a pattern is a limit. Patterns come
 * from the option `patterns`: `[{ "match": "<regex source>", "wait_ms": 60000 }]`
 * (matched case-insensitively). A pattern without `wait_ms` takes the first
 * capture group as minutes when it is a number. With no option, a built-in
 * example turns "quota exhausted ... retry in 5 minutes" into a 5 minute wait.
 *
 * Load it beside the fallback as `examples/README.md` says, with:
 *   { "package": "./plugins/refusal-text", "options": { "patterns": [{ "match": "balance is empty", "wait_ms": 3600000 }] } }
 */
import { STEPS_RPC } from "@craftsamo/opencode-model-fallback/rpc"

const MINUTE_MS = 60_000

/** Used when the plugin gets no `patterns` option. */
const DEFAULT_PATTERNS = [{ match: String.raw`quota exhausted.*?(\d+)\s*minutes?` }]

/** The wait a pattern gives for a match: its own `wait_ms`, else the captured minutes. */
function waitOf(pattern, match) {
  if (typeof pattern.wait_ms === "number") return pattern.wait_ms
  const minutes = Number(match[1])
  return Number.isFinite(minutes) ? minutes * MINUTE_MS : undefined
}

/** The plugin: registers the step handlers and returns the cleanup that removes them. */
export default {
  id: "refusal-text",
  async setup(ctx) {
    const patterns = (ctx.options?.patterns ?? DEFAULT_PATTERNS).map((pattern) => ({
      ...pattern,
      regex: new RegExp(pattern.match, "is"),
    }))
    const registration = await ctx.rpc.register(STEPS_RPC, {
      async usable() {
        return { usable: true }
      },
      async limit({ error }) {
        for (const text of [error.message, error.body]) {
          if (!text) continue
          for (const pattern of patterns) {
            const match = pattern.regex.exec(text)
            if (!match) continue
            const wait = waitOf(pattern, match)
            return wait === undefined
              ? { limit: true, reason: "the provider refused" }
              : { limit: true, wait_ms: wait, reason: "the provider refused" }
          }
        }
        return { limit: false }
      },
    })
    return () => registration.dispose()
  },
}
