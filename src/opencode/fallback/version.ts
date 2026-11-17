/** The oldest OpenCode the fallback runs on; below it, or when the version cannot be read, it registers nothing. */
export const MIN_OPENCODE_VERSION = "2.1.2"

/** `x.y.z`, with an optional `-prerelease` and `+build` suffix. */
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/

type ParsedVersion = { core: readonly [number, number, number]; prerelease: boolean }

function parseVersion(version: string): ParsedVersion | undefined {
  const match = VERSION_PATTERN.exec(version)
  if (!match) return undefined
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4] !== undefined }
}

const MINIMUM = parseVersion(MIN_OPENCODE_VERSION)!

/**
 * Whether an OpenCode `version` is at least `MIN_OPENCODE_VERSION`. The
 * numeric core is compared; a prerelease is below its own release (`2.1.2-beta`
 * is below `2.1.2`) and above every lower core, and a build suffix is ignored.
 * A version that is not a string or does not read as `x.y.z` is below.
 */
export function meetsMinimum(version: unknown): boolean {
  const parsed = typeof version === "string" ? parseVersion(version) : undefined
  if (!parsed) return false
  for (const [index, part] of parsed.core.entries()) {
    if (part !== MINIMUM.core[index]) return part > MINIMUM.core[index]!
  }
  return !parsed.prerelease
}
