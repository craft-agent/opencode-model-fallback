import { notice, ownedKey } from "./notice"

/** The key of a session's metadata that holds the moves made on it. */
export const MOVES_KEY = ownedKey("moves")

/** One move of a session to the next step of its route, or its stop (`to` is `null`), as the session's metadata keeps it. `at` is an ISO time. */
export type MoveRecord = { from: string; to: string | null; reason: string; at: string }

function isMoveRecord(value: unknown): value is MoveRecord {
  const record = value as Partial<Record<keyof MoveRecord, unknown>> | null
  return (
    typeof record === "object" &&
    record !== null &&
    typeof record.from === "string" &&
    (record.to === null || typeof record.to === "string") &&
    typeof record.reason === "string" &&
    typeof record.at === "string"
  )
}

/** The moves a session's metadata holds, oldest first; an entry that is not a record is left out. */
export function readMoves(metadata: Record<string, unknown> | undefined): MoveRecord[] {
  const moves = metadata?.[MOVES_KEY]
  return Array.isArray(moves) ? moves.filter(isMoveRecord) : []
}

/** `metadata` with `record` appended to its moves; every other key stays as it is. */
export function withMove(metadata: Record<string, unknown> | undefined, record: MoveRecord): Record<string, unknown> {
  return { ...metadata, [MOVES_KEY]: [...readMoves(metadata), record] }
}

/** The notice of a move, `<agent> A → B; <reason>`, or of a stop, `<agent> stopped on A; <reason>`. */
export function moveNotice(agent: string, record: MoveRecord): string {
  const { from, to, reason } = record
  return notice(to === null ? `${agent} stopped on ${from}; ${reason}` : `${agent} ${from} → ${to}; ${reason}`)
}
