import { PROJECT } from "../../project"

/** What the fallback puts in front of a reader or in a shared space: its notices and its keys. */

/** A notice of the fallback: English, and always `[Model fallback: …]`, so a reader knows whose it is. */
export function notice(text: string): string {
  return `[Model fallback: ${text}]`
}

/** A key the plugin owns in a shared space (session metadata, a `Symbol.for` name): `opencode-model-fallback.<name>`. */
export function ownedKey(name: string): string {
  return `${PROJECT.name}.${name}`
}
