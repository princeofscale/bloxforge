import { attachStructuredContent } from '../tools/structured-output.js';

describe('attachStructuredContent', () => {
  it('attaches structuredContent when the text block is a JSON object', () => {
    const r = attachStructuredContent({ content: [{ type: 'text', text: '{"a":1,"b":[2,3]}' }] });
    expect(r.structuredContent).toEqual({ a: 1, b: [2, 3] });
    expect(r.content![0].text).toBe('{"a":1,"b":[2,3]}'); // text channel unchanged
  });

  it('leaves array / primitive / non-JSON text as text-only (structuredContent must be an object)', () => {
    expect(attachStructuredContent({ content: [{ type: 'text', text: '[1,2,3]' }] }).structuredContent).toBeUndefined();
    expect(attachStructuredContent({ content: [{ type: 'text', text: 'plain message' }] }).structuredContent).toBeUndefined();
    expect(attachStructuredContent({ content: [{ type: 'text', text: 'not json {' }] }).structuredContent).toBeUndefined();
  });

  it('is a no-op when structuredContent is already set or there is no text block', () => {
    const pre = { content: [{ type: 'text', text: '{"x":1}' }], structuredContent: { y: 2 } };
    expect(attachStructuredContent(pre).structuredContent).toEqual({ y: 2 });
    expect(attachStructuredContent({ content: [{ type: 'image', text: undefined } as never] }).structuredContent).toBeUndefined();
  });

  it('attaches for error envelopes too (they are objects)', () => {
    const r = attachStructuredContent({ content: [{ type: 'text', text: '{"ok":false,"error":{"code":"AUTH"}}' }], isError: true });
    expect(r.structuredContent).toEqual({ ok: false, error: { code: 'AUTH' } });
  });
});
