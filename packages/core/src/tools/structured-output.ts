// Dual-format tool output (research review #3, contract plane): alongside the
// existing text block, attach a machine-readable `structuredContent`. Applied
// centrally at the CallTool dispatch — by topology, not per-handler — so the
// text block is unchanged and mixed clients keep working.
//
// Attached only for tools that declare an `outputSchema`. This started as a
// blanket "every tool gains the structured channel for free", but it is not
// free: the field is a byte-for-byte copy of the text block, so every response
// carried its payload twice. Measured over a live session it was 45% of the
// bytes on the wire, and 157 of 213 tools declare no `outputSchema` at all —
// for those, no client has anything to validate the copy against, which is the
// only thing structuredContent is for. The spec's compatibility guidance runs
// the other way: it asks a server returning structured content to also send the
// serialized text, and that text is exactly what we already send. Tools that do
// declare an outputSchema MUST return conforming structuredContent, and still do.

export interface ToolResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [k: string]: unknown;
}

/**
 * If the tool declares an `outputSchema` and the result's first text block
 * parses to a plain JSON object, attach it as `structuredContent`.
 * Arrays/primitives/invalid JSON are left as text only (the MCP
 * `structuredContent` field must be an object).
 *
 * `declaresOutputSchema` defaults to false: a caller that cannot say whether
 * the tool has a contract gets the cheap shape, not a duplicate nobody can
 * check.
 */
export function attachStructuredContent(result: ToolResult, declaresOutputSchema = false): ToolResult {
  if (!declaresOutputSchema) return result;
  if (!result || typeof result !== 'object' || result.structuredContent) return result;
  const content = Array.isArray(result.content) ? result.content : undefined;
  if (!content) return result;
  const firstText = content.find((c) => c && c.type === 'text' && typeof c.text === 'string');
  if (!firstText || typeof firstText.text !== 'string') return result;
  const text = firstText.text.trim();
  if (text.length === 0 || text[0] !== '{') return result; // only object payloads
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...result, structuredContent: parsed as Record<string, unknown> };
    }
  } catch { /* not JSON — leave text-only */ }
  return result;
}
