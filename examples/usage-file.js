/**
 * Shows how to answer `usable` from a usage file you keep up to date.
 *
 * The file is JSON, one entry for each provider:
 *   { "provider-a": { "left": 0, "resets_at": "2030-01-01T00:00:00Z" } }
 * A step whose provider has nothing left (`left <= 0`) and a reset still ahead
 * is passed over, with the reset in the reason. A missing or unreadable file
 * leaves every step usable.
 *
 * Load it beside the fallback as `examples/README.md` says, with:
 *   { "package": "./plugins/usage-file", "options": { "file": "/var/lib/usage/usage.json" } }
 */
import { readFile } from "node:fs/promises"
import { STEPS_RPC } from "@craftsamo/opencode-model-fallback/rpc"

/** The usage file's content, or `undefined` when it cannot be read or parsed. */
async function readUsage(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"))
  } catch {
    return undefined
  }
}

/** The plugin: registers the step handlers and returns the cleanup that removes them. */
export default {
  id: "usage-file",
  async setup(ctx) {
    const file = ctx.options?.file
    const registration = await ctx.rpc.register(STEPS_RPC, {
      async usable({ model }) {
        const usage = file ? await readUsage(file) : undefined
        const provider = model.split("/")[0]
        const entry = usage?.[provider]
        const resetsAt = Date.parse(entry?.resets_at)
        if (typeof entry?.left === "number" && entry.left <= 0 && resetsAt > Date.now()) {
          return { usable: false, reason: `usage is spent until ${entry.resets_at}` }
        }
        return { usable: true }
      },
      async limit() {
        return { limit: false }
      },
    })
    return () => registration.dispose()
  },
}
