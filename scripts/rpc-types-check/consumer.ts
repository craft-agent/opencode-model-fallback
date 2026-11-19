import {
  LIMITED_EVENT,
  LIMITS_RPC,
  STEPS_RPC,
  type LimitedEvent,
  type StepsHandlers,
} from "@craftsamo/opencode-model-fallback/rpc"

const handlers: StepsHandlers = {
  usable: (input) => ({ usable: input.agent !== "", reason: input.model }),
  limit: async (input) => ({ limit: input.error.status === 429, wait_ms: input.retry_after_ms }),
}

const onLimited = (event: LimitedEvent): string => `${event.session_id} ${event.kind} ${event.until}`

export const consumer = {
  steps: STEPS_RPC.id,
  methods: Object.keys(STEPS_RPC.methods),
  limits: LIMITS_RPC.id,
  event: LIMITED_EVENT,
  handlers,
  onLimited,
}
