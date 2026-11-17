import type { V2Context, V2ExecutorContext, V2ExecutorResult } from "../types"
import { MOVES_KEY, moveNotice, readMoves, type MoveRecord } from "./moves.record"

const SESSION_PREFIX = "ses_"
const UNNAMED_AGENT = "subagent"

/** What the moves a child made during a call tell its parent: notice lines, and the records for the result's metadata. */
export type MoveReport = { lines: string[]; metadata?: Record<string, unknown> }

/** The child's moves of one call of the built-in subagent tool, followed from before it to after it. */
export type ChildWatch = {
  /** The context to hand the built-in tool: it notes the child's ID from the progress updates. */
  context: V2ExecutorContext
  /** What the child moved during the call, told for the `result` the tool returned; empty when the child cannot be read or made no move. */
  report(result: V2ExecutorResult): Promise<MoveReport>
}

/** The session a call continues, or `undefined` for a new launch. */
export function continuedSession(input: Record<string, unknown>): string | undefined {
  return typeof input.sessionID === "string" && input.sessionID !== "" ? input.sessionID : undefined
}

async function readChild(ctx: V2Context, sessionID: string): Promise<{ agent?: string; moves: MoveRecord[] }> {
  const session = await ctx.session.get({ sessionID })
  return { agent: typeof session.agent === "string" ? session.agent : undefined, moves: readMoves(session.metadata) }
}

/**
 * Starts following the child of a call of the built-in `subagent` tool. A
 * continuation counts the moves its child already has, and the report holds
 * those after them. A new launch has no earlier moves of its own, but a child
 * may inherit its parent's metadata, so its report holds the moves recorded
 * since the call began (`now`, in epoch milliseconds). The child is the
 * continued session, else the `sessionID` of the result's metadata, else the
 * first `ses_…` ID a progress update named.
 */
export async function watchChild(
  ctx: V2Context,
  input: Record<string, unknown>,
  context: V2ExecutorContext,
  now: () => number,
): Promise<ChildWatch> {
  const continued = continuedSession(input)
  const startedAt = now()
  let seen: string | undefined
  let before: number | undefined
  if (continued !== undefined) {
    try {
      before = (await readChild(ctx, continued)).moves.length
    } catch {
      // Without a count, the moves of a continuation cannot be told from the earlier ones.
    }
  }
  return {
    context:
      continued !== undefined
        ? context
        : {
            ...context,
            progress(update) {
              const id = update?.sessionID
              if (seen === undefined && typeof id === "string" && id.startsWith(SESSION_PREFIX)) seen = id
              return context.progress(update)
            },
          },
    async report(result) {
      const reported = result.metadata?.sessionID
      const childID = continued ?? (typeof reported === "string" && reported !== "" ? reported : seen)
      if (childID === undefined || (continued !== undefined && before === undefined)) return { lines: [] }
      try {
        const child = await readChild(ctx, childID)
        const moves =
          continued === undefined
            ? child.moves.filter((move) => Date.parse(move.at) >= startedAt)
            : child.moves.slice(before)
        if (moves.length === 0) return { lines: [] }
        const agent = child.agent ?? (typeof input.agent === "string" ? input.agent : UNNAMED_AGENT)
        return { lines: moves.map((move) => moveNotice(agent, move)), metadata: { [MOVES_KEY]: moves } }
      } catch {
        return { lines: [] }
      }
    },
  }
}
