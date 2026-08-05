import { downscaleRgba, encodeImageFromRgbaResponse, DEFAULT_SCREENSHOT_MAX_WIDTH } from '../tools/runtime-support.js';

// A Retina Studio window captures 3130x1760 for a 1365x768 logical viewport:
// 5.2x the pixels, carried across the bridge as raw RGBA and paid for by the
// model, for content that renders at logical resolution. The risk in fixing it
// is simulate_mouse_input, whose coordinates are read off this image — so the
// reported size must always describe the image actually sent.

const solidRgba = (w: number, h: number, rgb: [number, number, number]) => {
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    buf[i * 4] = rgb[0];
    buf[i * 4 + 1] = rgb[1];
    buf[i * 4 + 2] = rgb[2];
    buf[i * 4 + 3] = 255;
  }
  return buf;
};

describe('downscaleRgba', () => {
  it('returns the input untouched when already within maxWidth', () => {
    const src = solidRgba(100, 50, [10, 20, 30]);
    const out = downscaleRgba(src, 100, 50, 200);
    expect(out.width).toBe(100);
    expect(out.height).toBe(50);
    expect(out.data).toBe(src); // same buffer, no copy on the common path
  });

  it('treats maxWidth 0 as "native, do not touch"', () => {
    const src = solidRgba(3130, 8, [1, 2, 3]);
    expect(downscaleRgba(src, 3130, 8, 0).width).toBe(3130);
  });

  it('preserves aspect ratio', () => {
    const out = downscaleRgba(solidRgba(3130, 1760, [0, 0, 0]), 3130, 1760, 1568);
    expect(out.width).toBe(1568);
    expect(out.height).toBe(Math.round((1760 * 1568) / 3130)); // 881
    expect(out.data.length).toBe(out.width * out.height * 4);
  });

  it('preserves a uniform colour exactly (box filter of equal samples)', () => {
    const out = downscaleRgba(solidRgba(400, 200, [200, 100, 50]), 400, 200, 100);
    expect(out.width).toBe(100);
    for (let i = 0; i < 20; i++) {
      const o = i * 4;
      expect([out.data[o], out.data[o + 1], out.data[o + 2], out.data[o + 3]]).toEqual([200, 100, 50, 255]);
    }
  });

  it('averages rather than dropping pixels, so a two-tone image lands between', () => {
    // Left half black, right half white; downscaling 2x1 to 1x1 must give grey,
    // which nearest-neighbour sampling would not.
    const src = Buffer.from([0, 0, 0, 255, 255, 255, 255, 255]);
    const out = downscaleRgba(src, 2, 1, 1);
    expect(out.width).toBe(1);
    expect(out.data[0]).toBe(128);
  });
});

describe('encodeImageFromRgbaResponse', () => {
  const response = { data: solidRgba(3130, 1760, [120, 130, 140]).toString('base64'), width: 3130, height: 1760 };

  it('reports the dimensions of the image it actually encoded', () => {
    const encoded = encodeImageFromRgbaResponse(response, 'jpeg', 92, DEFAULT_SCREENSHOT_MAX_WIDTH);
    expect(encoded.width).toBe(1568);
    expect(encoded.height).toBe(882); // round(1760 * 1568 / 3130)
    expect(encoded.mimeType).toBe('image/jpeg');
  });

  it('leaves the capture native when maxWidth is 0', () => {
    const encoded = encodeImageFromRgbaResponse(response, 'jpeg', 92, 0);
    expect(encoded.width).toBe(3130);
    expect(encoded.height).toBe(1760);
  });

  it('produces a materially smaller payload at the default cap', () => {
    const native = encodeImageFromRgbaResponse(response, 'jpeg', 92, 0).buffer.length;
    const capped = encodeImageFromRgbaResponse(response, 'jpeg', 92, DEFAULT_SCREENSHOT_MAX_WIDTH).buffer.length;
    expect(capped).toBeLessThan(native);
  });

  it('downscales png too, without losing the lossless format', () => {
    const encoded = encodeImageFromRgbaResponse(response, 'png', 92, 1000);
    expect(encoded.width).toBe(1000);
    expect(encoded.mimeType).toBe('image/png');
  });
});
