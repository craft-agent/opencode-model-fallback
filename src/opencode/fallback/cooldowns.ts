import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { basename, dirname } from "node:path"
import type { V2ModelRef } from "../types"
import { parseSelector, selector } from "./routes"
import { DEFAULT_COOLDOWN_SCOPE, type CooldownScope } from "./settings"

const FILE_VERSION = 1
/** The model ID a provider's cooldown is saved under, so an older version reads it as a model that is never asked for. */
const PROVIDER_WILDCARD = "*"
const UNREADABLE_SUFFIX = ".unreadable"
const TEMP_SUFFIX = ".tmp"
/** The errors of reading a file that is not there, or whose directory is not: no file, not an unreadable one. */
const MISSING_CODES: readonly string[] = ["ENOENT", "ENOTDIR"]
const UNREADABLE_TEXT = "cooldowns file unreadable"
/** The latest time a `Date` can hold; a cooldown never ends after it, so every end can be written as an ISO time. */
export const MAX_COOLDOWN_END_MS = 8.64e15

/** The models and providers that hit a limit and when each is usable again, in epoch milliseconds, kept in memory and in a file. */
export type Cooldowns = {
  /** Passes over `model` until `untilMs`, or over its whole provider under the `provider` scope; an end that is not after now, or not a time, is ignored, and an earlier end never shortens a later one. Saves when it changed anything. */
  cool(model: V2ModelRef, untilMs: number): void
  /** When `model` is usable again, or `undefined` when it is not cooling down. A cooldown of a model without a variant covers every variant of it, and one of its provider covers every model, whatever the scope. */
  until(model: V2ModelRef): number | undefined
}

/** What `createCooldowns` takes. */
export type CooldownsOptions = {
  /** The file the cooldowns are kept in; without one they live in memory only. */
  file?: string
  /** What a limit cools; the model by default. Cooldowns already held for a provider count under either scope. */
  scope?: CooldownScope
  /** The clock, in epoch milliseconds. */
  now?: () => number
  /** Told a problem that never reaches a caller, a failed save or an unreadable file: the first of each kind only. */
  onProblem?: (text: string) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The key a provider's cooldown is kept and saved under: `provider/*`. */
function providerKey(providerID: string): string {
  return selector({ providerID, id: PROVIDER_WILDCARD })
}

function isLiveEnd(value: unknown, now: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > now && value <= MAX_COOLDOWN_END_MS
}

/** Renames an unreadable file aside, over an older one, and says what it came to; a rename that fails leaves the file for the next save to replace. */
function setAside(file: string): string {
  const aside = `${file}${UNREADABLE_SUFFIX}`
  try {
    renameSync(file, aside)
    return `${UNREADABLE_TEXT}, set aside as ${basename(aside)}`
  } catch {
    return `${UNREADABLE_TEXT}, ignored`
  }
}

/**
 * The cooldowns `file` holds that have not ended: none when it is missing, and
 * none when it is unreadable or not a cooldowns file, which is set aside and
 * reported to `onUnreadable`.
 */
function loadFile(file: string, now: number, onUnreadable: (text: string) => void): Map<string, number> {
  const entries = new Map<string, number>()
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === undefined || !MISSING_CODES.includes(code)) onUnreadable(setAside(file))
    return entries
  }
  if (!isRecord(parsed) || parsed.version !== FILE_VERSION || !isRecord(parsed.cooldowns)) {
    onUnreadable(setAside(file))
    return entries
  }
  for (const [key, end] of Object.entries(parsed.cooldowns)) {
    if (parseSelector(key) !== undefined && isLiveEnd(end, now)) entries.set(key, end)
  }
  return entries
}

/**
 * The cooldowns of the models that hit a limit, or of their providers under
 * the `provider` scope (saved as `provider/*`). They are read from `file`
 * here: an end already past is dropped, and a file that is unreadable or not a
 * cooldowns file is renamed to `<file>.unreadable` (over an older one) and
 * counts as empty. Every change is saved, atomically (a temporary file in the
 * same directory, renamed over `file`, the directory created when missing),
 * after the file is read again and merged into memory, since another process
 * may share it: per model the later end wins, and memory takes the result. A
 * file read at a save is treated as at load. A save that fails keeps the
 * cooldowns in memory. A failed save and an unreadable file are each told once
 * to `onProblem`; nothing here throws.
 */
export function createCooldowns({
  file,
  scope = DEFAULT_COOLDOWN_SCOPE,
  now = Date.now,
  onProblem,
}: CooldownsOptions = {}): Cooldowns {
  const told = new Set<string>()

  function tell(kind: string, text: string): void {
    if (told.has(kind)) return
    told.add(kind)
    try {
      onProblem?.(text)
    } catch {
      // A notice that cannot be told is not worth a failure.
    }
  }

  const tellUnreadable = (text: string) => tell("unreadable", text)
  const ends = file === undefined ? new Map<string, number>() : loadFile(file, now(), tellUnreadable)

  function save(): void {
    if (file === undefined) return
    const current = now()
    for (const [key, end] of loadFile(file, current, tellUnreadable)) {
      if (end > (ends.get(key) ?? 0)) ends.set(key, end)
    }
    for (const [key, end] of ends) if (end <= current) ends.delete(key)
    const temp = `${file}.${process.pid}${TEMP_SUFFIX}`
    try {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(temp, `${JSON.stringify({ version: FILE_VERSION, cooldowns: Object.fromEntries(ends) })}\n`)
      renameSync(temp, file)
    } catch (error) {
      try {
        rmSync(temp, { force: true })
      } catch {
        // Nothing more can be done about a stray temporary file.
      }
      tell("save", `cooldowns not saved: ${reasonOf(error)}`)
    }
  }

  return {
    cool(model, untilMs) {
      if (!Number.isFinite(untilMs) || untilMs <= now()) return
      const key = scope === "provider" ? providerKey(model.providerID) : selector(model)
      const end = Math.min(untilMs, MAX_COOLDOWN_END_MS)
      if (end <= (ends.get(key) ?? 0)) return
      ends.set(key, end)
      save()
    },
    until(model) {
      const current = now()
      const found = [
        selector(model),
        selector({ providerID: model.providerID, id: model.id }),
        providerKey(model.providerID),
      ]
        .map((key) => ends.get(key))
        .filter((end): end is number => end !== undefined && end > current)
      return found.length > 0 ? Math.max(...found) : undefined
    },
  }
}
