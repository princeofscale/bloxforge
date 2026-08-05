import { attachStructuredContent } from '../tools/structured-output.js';

// structuredContent is a byte-for-byte copy of the text block, so attaching it
// blanket-style doubled every response — 45% of the bytes measured over a live
// session. It is attached only where a client has an outputSchema to validate
// the copy against; without one the copy is unverifiable and pure cost.
describe('attachStructuredContent', () => {
  it('attaches structuredContent when the tool declares an outputSchema', () => {
    const r = attachStructuredContent({ content: [{ type: 'text', text: '{"a":1,"b":[2,3]}' }] }, true);
    expect(r.structuredContent).toEqual({ a: 1, b: [2, 3] });
    expect(r.content![0].text).toBe('{"a":1,"b":[2,3]}'); // text channel unchanged
  });

  it('does not attach when the tool declares no outputSchema', () => {
    const result = { content: [{ type: 'text', text: '{"a":1}' }] };
    expect(attachStructuredContent(result, false).structuredContent).toBeUndefined();
    // Defaulting to "no schema" keeps a caller that cannot say from paying for
    // a duplicate nobody can check.
    expect(attachStructuredContent(result).structuredContent).toBeUndefined();
  });

  it('leaves the text channel intact either way', () => {
    const text = '{"a":1}';
    expect(attachStructuredContent({ content: [{ type: 'text', text }] }, false).content![0].text).toBe(text);
    expect(attachStructuredContent({ content: [{ type: 'text', text }] }, true).content![0].text).toBe(text);
  });

  it('leaves array / primitive / non-JSON text as text-only (structuredContent must be an object)', () => {
    expect(attachStructuredContent({ content: [{ type: 'text', text: '[1,2,3]' }] }, true).structuredContent).toBeUndefined();
    expect(attachStructuredContent({ content: [{ type: 'text', text: 'plain message' }] }, true).structuredContent).toBeUndefined();
    expect(attachStructuredContent({ content: [{ type: 'text', text: 'not json {' }] }, true).structuredContent).toBeUndefined();
  });

  it('is a no-op when structuredContent is already set or there is no text block', () => {
    const pre = { content: [{ type: 'text', text: '{"x":1}' }], structuredContent: { y: 2 } };
    expect(attachStructuredContent(pre, true).structuredContent).toEqual({ y: 2 });
    expect(attachStructuredContent({ content: [{ type: 'image', text: undefined } as never] }, true).structuredContent).toBeUndefined();
  });

  it('attaches for error envelopes too (they are objects)', () => {
    const r = attachStructuredContent({ content: [{ type: 'text', text: '{"ok":false,"error":{"code":"AUTH"}}' }], isError: true }, true);
    expect(r.structuredContent).toEqual({ ok: false, error: { code: 'AUTH' } });
  });
});
