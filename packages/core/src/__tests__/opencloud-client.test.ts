import { OpenCloudClient } from '../opencloud-client.js';

describe('OpenCloudClient', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  test('fails closed before network access when the API key is absent', async () => {
    const client = new OpenCloudClient({ apiKey: '' });
    await expect(client.searchAssets({ searchCategoryType: 'Model' })).rejects.toThrow(
      /API key not configured/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('serializes defined search parameters and authenticates the request', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ creatorStoreAssets: [], totalResults: 0 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const client = new OpenCloudClient({ apiKey: 'test-key', baseUrl: 'https://example.test' });

    await client.searchAssets({
      searchCategoryType: 'Model',
      query: 'tree house',
      includeOnlyVerifiedCreators: false,
    });

    const [input, init] = fetchMock.mock.calls[0];
    const url = new URL(String(input));
    expect(url.origin).toBe('https://example.test');
    expect(url.searchParams.get('query')).toBe('tree house');
    expect(url.searchParams.get('maxPageSize')).toBe('25');
    expect(url.searchParams.get('includeOnlyVerifiedCreators')).toBe('false');
    expect(url.searchParams.has('pageToken')).toBe(false);
    expect(init?.headers).toMatchObject({ 'x-api-key': 'test-key' });
  });

  test.each([
    [401, 'nope', /Invalid or expired API key/],
    [403, JSON.stringify({ detail: 'missing assets:read' }), /missing assets:read/],
    [429, 'slow down', /Rate limit exceeded/],
    [500, JSON.stringify({ message: 'backend down' }), /Open Cloud API error \(500\): backend down/],
  ])('maps HTTP %i to an actionable error', async (status, body, expected) => {
    fetchMock.mockResolvedValue(new Response(body, { status }));
    const client = new OpenCloudClient({ apiKey: 'test-key' });
    await expect(client.getAssetDetails(1)).rejects.toThrow(expected);
  });

  test('batches thumbnail lookups and keeps successful batches after a failure', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ targetId: 1, state: 'Completed', imageUrl: 'https://cdn.test/1.png' }],
      }), { status: 200 }))
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ targetId: 205, state: 'Completed', imageUrl: 'https://cdn.test/205.png' }],
      }), { status: 200 }));

    const result = await new OpenCloudClient().getAssetThumbnails(
      Array.from({ length: 205 }, (_, index) => index + 1),
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toEqual(new Map([
      [1, 'https://cdn.test/1.png'],
      [205, 'https://cdn.test/205.png'],
    ]));
  });

  test('rejects unsupported upload formats before network access', async () => {
    const client = new OpenCloudClient({ apiKey: 'test-key' });
    await expect(client.createAsset({
      assetType: 'Model',
      displayName: 'bad',
      description: '',
      creationContext: { creator: { userId: '1' } },
    }, Buffer.from('x'), 'payload.exe')).rejects.toThrow(/Unsupported file format/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
