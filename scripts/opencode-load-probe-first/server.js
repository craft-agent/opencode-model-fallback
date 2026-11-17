/**
 * A plugin that `scripts/opencode-load.mjs` lists before the plugin under test.
 * It marks when its setup starts and ends in the load order shared by the
 * plugins of one process. It must stay named `server.js` at this folder's
 * root: OpenCode 2.1.2 loads a local plugin folder only from a root `server.*`
 * or `index.*` file and ignores `exports`.
 */
const ORDER_KEY = Symbol.for("opencode-model-fallback.ci.load-order")

export default {
  id: "ci.load-probe-first",
  async setup() {
    const order = (globalThis[ORDER_KEY] ??= [])
    order.push("first:start")
    await new Promise((done) => setTimeout(done, 50))
    order.push("first:end")
  },
}
