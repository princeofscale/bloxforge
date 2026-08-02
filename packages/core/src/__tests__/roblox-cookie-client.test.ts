import { RobloxCookieClient } from '../roblox-cookie-client.js';

describe('RobloxCookieClient', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  test('fails closed without a cookie', async () => {
    const client = new RobloxCookieClient('');
    await expect(client.getAssetDetails([1])).rejects.toThrow(/cookie is not set/);
    await expect(client.uploadImage({
      fileContent: Buffer.from('x'),
      fileName: 'image.png',
      displayName: 'image',
      description: '',
      userId: '1',
    })).rejects.toThrow(/cookie is not set/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('retries once with the CSRF token and preserves cookie authentication', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('', {
        status: 403,
        headers: { 'x-csrf-token': 'csrf-token' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ response: { assetId: '42' }, done: true }), {
        status: 200,
      }));

    const result = await new RobloxCookieClient('secret-cookie').uploadImage({
      fileContent: Buffer.from('png'),
      fileName: 'image.png',
      displayName: 'image',
      description: '',
      userId: '7',
    });

    expect(result).toEqual({ assetId: 42 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondHeaders = fetchMock.mock.calls[1][1]?.headers as Record<string, string>;
    expect(secondHeaders.Cookie).toBe('.ROBLOSECURITY=secret-cookie');
    expect(secondHeaders['X-CSRF-TOKEN']).toBe('csrf-token');
  });

  test('resolves and validates the authenticated creator when ids are omitted', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 123 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ response: { assetId: 456 }, done: true }), { status: 200 }));

    await expect(new RobloxCookieClient('cookie').uploadImage({
      fileContent: Buffer.from('png'),
      fileName: 'image.png',
      displayName: 'image',
      description: '',
    })).resolves.toEqual({ assetId: 456 });

    expect(String(fetchMock.mock.calls[0][0])).toContain('/users/authenticated');
  });

  test('rejects an invalid authenticated user response', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 0 }), { status: 200 }));
    await expect(new RobloxCookieClient('cookie').uploadImage({
      fileContent: Buffer.from('png'),
      fileName: 'image.png',
      displayName: 'image',
      description: '',
    })).rejects.toThrow(/valid user ID/);
  });

  test('rejects malformed upload responses and invalid asset ids', async () => {
    fetchMock.mockResolvedValueOnce(new Response('not-json', { status: 200 }));
    const options = {
      fileContent: Buffer.from('png'),
      fileName: 'image.png',
      displayName: 'image',
      description: '',
      userId: '1',
    };
    await expect(new RobloxCookieClient('cookie').uploadImage(options)).rejects.toThrow(/malformed JSON/);

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ response: { assetId: '-5' }, done: true }), { status: 200 }));
    await expect(new RobloxCookieClient('cookie').uploadImage(options)).rejects.toThrow(/invalid asset ID/);
  });

  test('rejects unsupported image formats before network access', async () => {
    await expect(new RobloxCookieClient('cookie').uploadImage({
      fileContent: Buffer.from('x'),
      fileName: 'image.gif',
      displayName: 'image',
      description: '',
      userId: '1',
    })).rejects.toThrow(/Unsupported image format/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
