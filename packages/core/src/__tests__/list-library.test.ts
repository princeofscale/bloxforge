import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { RobloxStudioTools } from '../tools/index.js';

const payload = (result: { content: Array<{ type: string; text?: string }> }) =>
  JSON.parse(result.content[0].text!);

describe('list_library', () => {
  let library: string;
  let tools: RobloxStudioTools;

  const save = (relative: string, contents: unknown) => {
    const file = path.join(library, `${relative}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents));
  };

  beforeEach(() => {
    library = fs.mkdtempSync(path.join(os.tmpdir(), 'bloxforge-library-'));
    process.env.BLOXFORGE_BUILD_LIBRARY = library;
    (RobloxStudioTools as unknown as { _cachedLibraryPath?: string })._cachedLibraryPath = undefined;
    tools = new RobloxStudioTools({} as never);
  });

  afterEach(() => {
    delete process.env.BLOXFORGE_BUILD_LIBRARY;
    (RobloxStudioTools as unknown as { _cachedLibraryPath?: string })._cachedLibraryPath = undefined;
    fs.rmSync(library, { recursive: true, force: true });
  });

  // `export_build` takes the style from its caller and writes to
  // <library>/<style>/<id>.json. The listing scanned five hard-coded style
  // directories, so a build saved under any other name was stored successfully
  // and then never appeared again — the tool reported an empty library.
  it('lists a build saved under a style nobody hard-coded', async () => {
    save('cyberpunk/neon-alley', { id: 'cyberpunk/neon-alley', style: 'cyberpunk', bounds: [4, 4, 4], parts: [{}, {}] });
    save('medieval/keep', { id: 'medieval/keep', style: 'medieval', bounds: [8, 8, 8], parts: [{}] });

    const all = payload(await tools.listLibrary());
    expect(all.total).toBe(2);
    expect(all.builds.map((b: { id: string }) => b.id).sort()).toEqual(['cyberpunk/neon-alley', 'medieval/keep']);
    expect(all.builds.find((b: { id: string }) => b.id === 'cyberpunk/neon-alley').partCount).toBe(2);
  });

  it('treats style as a filter over what is there, not as where to look', async () => {
    save('cyberpunk/neon-alley', { id: 'cyberpunk/neon-alley', style: 'cyberpunk' });
    save('medieval/keep', { id: 'medieval/keep', style: 'medieval' });

    const filtered = payload(await tools.listLibrary('cyberpunk'));
    expect(filtered.total).toBe(1);
    expect(filtered.builds[0].id).toBe('cyberpunk/neon-alley');
  });

  // One unparseable file should not hide a library, and it should not be
  // subtracted from the total in silence either: "not in the library" and
  // "could not be read" are different answers to "where is my build".
  it('names the files it could not read instead of shrinking the total quietly', async () => {
    save('medieval/keep', { id: 'medieval/keep', style: 'medieval' });
    save('medieval/broken', '{ not json');

    const listed = payload(await tools.listLibrary());
    expect(listed.total).toBe(1);
    expect(listed.unreadableCount).toBe(1);
    expect(listed.unreadable).toEqual(['medieval/broken.json']);
  });

  it('says nothing about unreadable files when every one of them parsed', async () => {
    save('medieval/keep', { id: 'medieval/keep', style: 'medieval' });
    const listed = payload(await tools.listLibrary());
    expect(listed.unreadable).toBeUndefined();
    expect(listed.unreadableCount).toBeUndefined();
  });
});
