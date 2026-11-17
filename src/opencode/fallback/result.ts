import type { V2ExecutorResult } from "../types"

/**
 * Puts notice `lines` in front of what a built-in tool returned and merges
 * `metadata` into the result's own; `output` stays as it was. A result that
 * has nothing to add is returned as it is.
 */
export function withNotices(
  result: V2ExecutorResult,
  lines: readonly string[],
  metadata?: Record<string, unknown>,
): V2ExecutorResult {
  const addsMetadata = metadata !== undefined && Object.keys(metadata).length > 0
  if (lines.length === 0 && !addsMetadata) return result
  const text = lines.join("\n")
  const { content } = result
  return {
    ...result,
    ...(addsMetadata ? { metadata: { ...result.metadata, ...metadata } } : {}),
    ...(lines.length === 0
      ? {}
      : {
          content:
            content === undefined
              ? text
              : typeof content === "string"
                ? `${text}\n${content}`
                : [{ type: "text", text }, ...content],
        }),
  }
}
