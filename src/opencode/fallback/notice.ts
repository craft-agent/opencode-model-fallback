import { PROJECT } from "../../project"

/** What the fallback puts in front of a reader or in a shared space: its notices and its keys. */

/** A notice of the fallback: English, and always `[Model fallback: …]`, so a reader knows whose it is. */
export function notice(text: string): string {
  return `[Model fallback: ${text}]`
}

/** Lines the fallback owes the reader once, such as a setting it ignored: whoever speaks to the reader first takes them all. */
export type OnceNotices = {
  add(text: string): void
  /** Hands back the lines added so far, oldest first, and forgets them. */
  take(): string[]
}

/** An empty queue of once-only notices. */
export function createOnceNotices(): OnceNotices {
  const lines: string[] = []
  return {
    add: (text) => void lines.push(text),
    take: () => lines.splice(0),
  }
}

/** A key the plugin owns in a shared space (session metadata, a `Symbol.for` name): `opencode-model-fallback.<name>`. */
export function ownedKey(name: string): string {
  return `${PROJECT.name}.${name}`
}
