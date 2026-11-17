import type { ToolError } from "../core"

/** A tool error as text: `<code>: <message>`, then `details` as JSON on a line of its own when set. */
export function errorText(error: ToolError): string {
  return `${error.code}: ${error.message}${error.details !== undefined ? `\n${JSON.stringify(error.details)}` : ""}`
}
