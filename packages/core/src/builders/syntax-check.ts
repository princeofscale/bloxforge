// Compile-check Luau using the Studio that is going to run it.
//
// validate_script_source shells out to luau-analyze / selene / stylua, and on a
// machine without them it answers with three "is not installed" lines — so the
// only way to find a typo was to write the script into the place and burn a full
// playtest cycle on it. The plugin context has `loadstring`, which compiles
// without running and returns the parser's own message, so the authoritative
// checker for the target runtime was available the whole time.

import { luaString } from './luau-emit.js';

// Name the chunk instead of letting it default to the source text. Otherwise the
// script under test appears inside its own error prefix, and a source containing
// `"]:9:` gives the location parser a second, earlier thing to match.
const CHUNK_NAME = 'bloxforge_syntax_check';

/** `loadstring` compiles only; nothing in `source` is executed. */
export function buildSyntaxCheckLuau(source: string): string {
  return `local fn, err = loadstring(${luaString(source)}, ${luaString(CHUNK_NAME)})
if fn then return { ok = true } end
return { ok = false, error = tostring(err) }`;
}

export interface SyntaxCheck {
  checkedBy: 'roblox-studio';
  ok: boolean;
  error?: string;
  /** 1-indexed line the parser blamed, when its message carries one. */
  line?: number;
}

// Luau reports `[string "bloxforge_syntax_check"]:2: Expected identifier ...`.
// The chunk name is ours, so it is noise to the caller — keep the line and the
// message, drop the prefix. Anchored on the fixed name, so nothing in the source
// can pose as a location; both the decorated and bare spellings are accepted
// because that decoration is the host's choice, not ours.
const LOCATION_RE = new RegExp(`^(?:\\[string "${CHUNK_NAME}"\\]|${CHUNK_NAME}):(\\d+):\\s*`);

export function parseSyntaxError(raw: string): { message: string; line?: number } {
  const match = LOCATION_RE.exec(raw);
  if (!match) return { message: raw };
  return { message: raw.slice(match[0].length), line: Number(match[1]) };
}
