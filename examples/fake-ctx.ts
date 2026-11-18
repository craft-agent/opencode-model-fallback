import { mock } from "bun:test"
import { STEPS_RPC } from "../src/opencode/fallback/rpc"

type Handler = (envelope: unknown) => void

const HOUR_MS = 3_600_000

/** The abort signal every handler call receives. */
export const signal = new AbortController().signal

/** A timestamp an hour ahead, for resets that have not happened yet. */
export const future = new Date(Date.now() + HOUR_MS).toISOString()

/** A timestamp an hour ago, for resets that have already happened. */
export const past = new Date(Date.now() - HOUR_MS).toISOString()

/** Maps the package's `/rpc` subpath to the source, so the examples run without a build. */
export function mockRpcModule() {
  mock.module("@craftsamo/opencode-model-fallback/rpc", () => import("../src/opencode/fallback/rpc"))
}

/** A minimal stand-in for the plugin context an example's `setup` gets. */
export function fakeCtx(options: Record<string, unknown> = {}) {
  const listeners = new Map<string, Set<Handler>>()
  const state = { handlers: undefined as any, disposed: false }
  const ctx = {
    options,
    rpc: Object.assign(
      (_def: unknown) => ({
        events: {
          on(name: string, handler: Handler) {
            const set = listeners.get(name) ?? new Set()
            listeners.set(name, set.add(handler))
            return () => set.delete(handler)
          },
        },
      }),
      {
        async register(_def: unknown, handlers: unknown) {
          state.handlers = handlers
          return {
            dispose: async () => {
              state.disposed = true
            },
          }
        },
      },
    ),
  }
  return {
    ctx,
    state,
    listenerCount: (name: string) => listeners.get(name)?.size ?? 0,
    /** Calls the registered `limit` handler with an error that is not special. */
    askLimit: (error: Record<string, unknown> = { type: "x", message: "m" }) =>
      state.handlers.limit({ agent: "a", model: "provider-a/m", error }, { signal }),
    /** Emits an envelope the way OpenCode wraps a payload. */
    emit(name: string, data: unknown) {
      const envelope = { id: "evt", created: 0, type: `rpc.opencode-model-fallback.limits.${name}`, location: {}, data }
      for (const handler of [...(listeners.get(name) ?? [])]) handler(envelope)
    },
  }
}

/** Runs a handler's answer through the schema of the method it answers. */
export function validates(method: "usable" | "limit", answer: unknown): boolean {
  return "value" in STEPS_RPC.methods[method].output["~standard"].validate(answer)
}
