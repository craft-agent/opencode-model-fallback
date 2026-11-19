/**
 * The questions the model fallback asks over OpenCode's plugin RPC, for a
 * plugin that answers them. Import it from
 * `@craftsamo/opencode-model-fallback/rpc` and register handlers against
 * `STEPS_RPC`, so both sides use the same schemas. The module imports nothing.
 */
/** A Standard Schema V1 object, the form OpenCode validates an RPC's input and output with. `types` only carries `T` for TypeScript. */
export type StepsSchema<T> = {
    readonly "~standard": {
        readonly version: 1;
        readonly vendor: string;
        validate(value: unknown): {
            value: T;
        } | {
            issues: {
                message: string;
            }[];
        };
        readonly types?: {
            input: T;
            output: T;
        };
    };
};
/** What the fallback asks before it uses a step: may this agent run on this model now? */
export type StepsUsableInput = {
    /** The agent the step belongs to. */
    agent: string;
    /** The step, `provider/model#variant` (no `#variant` for a step without one). */
    model: string;
};
/** The answer to `usable`. */
export type StepsUsableOutput = {
    /** `false` passes the step over, for this launch or move only. */
    usable: boolean;
    /** Why, in a few words: it ends up in the notice, after `is unusable:`. */
    reason?: string;
};
/** What the fallback asks about an error its own rule does not take for a limit: is it one? */
export type StepsLimitInput = {
    /** The agent whose model failed; empty when OpenCode names none for the event. */
    agent: string;
    /** The model that failed, `provider/model#variant`. */
    model: string;
    /** The error OpenCode reported. */
    error: {
        type: string;
        status?: number;
        message: string;
        body?: string;
    };
    /** The wait before OpenCode would retry, in milliseconds; absent when it will not retry or will retry at once. */
    wait_ms?: number;
    /** The wait the provider asked for, in milliseconds; absent when it named none. */
    retry_after_ms?: number;
};
/** The answer to `limit`. */
export type StepsLimitOutput = {
    /** `true` makes the error a limit: the model is cooled down and a routed session moves on. */
    limit: boolean;
    /** How long the model is passed over, in milliseconds; the `cooldown_ms` setting when absent or zero. */
    wait_ms?: number;
    /** Why, in a few words: it ends up in the notice, after `hit a limit:`. */
    reason?: string;
};
/** What the fallback announces when a retry event shows a limit: the model has been cooled down. */
export type LimitedEvent = {
    /** The session whose model hit the limit. */
    session_id: string;
    /** The agent whose model failed; empty when OpenCode names none for the event. */
    agent: string;
    /** The model that hit the limit, `provider/model#variant`. */
    model: string;
    /** `quota` or `rate` by the fallback's own rule, `consumer` when a plugin named the limit. */
    kind: "quota" | "rate" | "consumer";
    /** When the model's cooldown ends, as an ISO time. */
    until: string;
    /** The wait the limit carried, in milliseconds; absent when it carried none. */
    wait_ms?: number;
    /** The reason a consumer gave for a `consumer` limit. */
    reason?: string;
};
/** The handlers a plugin registers for `STEPS_RPC`, one for each question. */
export type StepsHandlers = {
    usable(input: StepsUsableInput, context: {
        signal: AbortSignal;
    }): Promise<StepsUsableOutput> | StepsUsableOutput;
    limit(input: StepsLimitInput, context: {
        signal: AbortSignal;
    }): Promise<StepsLimitOutput> | StepsLimitOutput;
};
/** The RPC id the fallback asks under: `opencode-model-fallback.steps`. */
export declare const STEPS_RPC_ID = "opencode-model-fallback.steps";
/** The RPC id the fallback announces limits under: `opencode-model-fallback.limits`. */
export declare const LIMITS_RPC_ID = "opencode-model-fallback.limits";
/** The name of the event `LIMITS_RPC` emits for each limit. */
export declare const LIMITED_EVENT = "limited";
/**
 * The definition of the RPC a plugin registers against to answer the fallback:
 *
 * - `usable`: may this agent run on this step now? `{ usable: false }` passes
 *   the step over when a launch or a move picks one. It is asked of a step
 *   only after the fallback's own checks (the model is in OpenCode's list, it
 *   is not cooling down) have passed it, in route order, until one is usable.
 * - `limit`: is this error a limit? Asked of an error the fallback's own rule
 *   does not take for one. `{ limit: true }` cools the model down and moves a
 *   routed session on.
 *
 * Handlers get the input as the fallback sends it, and a promise or a value
 * back. No answer in two seconds, an error, an answer off the schema and no
 * plugin registered all count as no answer: the fallback decides as it would
 * alone.
 */
export declare const STEPS_RPC: {
    readonly id: "opencode-model-fallback.steps";
    readonly methods: {
        readonly usable: {
            readonly input: StepsSchema<StepsUsableInput>;
            readonly output: StepsSchema<StepsUsableOutput>;
        };
        readonly limit: {
            readonly input: StepsSchema<StepsLimitInput>;
            readonly output: StepsSchema<StepsLimitOutput>;
        };
    };
    readonly events: {};
};
/**
 * The definition of the RPC the fallback registers to announce limits. It
 * emits `limited` once for each retry event it takes for a limit, after the
 * model has been cooled down. A consumer listens with
 * `ctx.rpc(LIMITS_RPC).events.on("limited", handler)`, whose handler gets
 * OpenCode's event envelope with the `LimitedEvent` under `data`; events are
 * live only, so one emitted before the listener is attached is not replayed.
 *
 * It is a definition apart from `STEPS_RPC` because only the plugin that
 * registers a definition can emit its events, and registering `STEPS_RPC` here
 * would replace the handlers a consumer registered for it.
 */
export declare const LIMITS_RPC: {
    readonly id: "opencode-model-fallback.limits";
    readonly methods: {};
    readonly events: {
        readonly limited: {
            readonly schema: StepsSchema<LimitedEvent>;
        };
    };
};
