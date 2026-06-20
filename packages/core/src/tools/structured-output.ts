// Dual-format tool output (research review #3, contract plane): alongside the
// existing text block, attach a machine-readable `structuredContent` whenever the
// text is a JSON object. This is applied centrally at the CallTool dispatch — by
// topology, not per-handler — so every tool gains the structured channel for free
// and stays backward-compatible (the text block is unchanged). We do NOT declare a
// strict `outputSchema` (which would force conformance and break mixed clients);
// `structuredContent` is the lenient, additive channel the spec recommends.

export interface ToolResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [k: string]: unknown;
}

/**
 * If the result's first text block parses to a plain JSON object, attach it as
 * `structuredContent`. Arrays/primitives/invalid JSON are left as text only
 * (the MCP `structuredContent` field must be an object).
 */
export function attachStructuredContent(result: ToolResult): ToolResult {
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
