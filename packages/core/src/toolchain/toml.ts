// A fail-closed TOML reader for the manifests BloxForge actually reads:
// rokit.toml, aftman.toml, wally.toml and wally.lock.
//
// ponytail: hand-written subset parser instead of a dependency — packages/core
// ships with zero runtime dependencies and these four files use a small, stable
// slice of TOML. It covers tables, arrays of tables, dotted keys, inline tables,
// arrays, all four string forms, integers, floats and booleans; anything else
// throws rather than being guessed at. Swap in `smol-toml` if a manifest ever
// needs real date-times or the rest of the grammar.

const BARE_KEY = /[A-Za-z0-9_-]/;

export type TomlValue = string | number | boolean | TomlValue[] | TomlTable;
export interface TomlTable { [key: string]: TomlValue }

// Null-prototype tables: manifest data controls every key, so a key named
// `__proto__`, `constructor` or `toString` must not reach Object.prototype or
// register as a duplicate of an inherited member.
const emptyTable = (): TomlTable => Object.create(null) as TomlTable;
const hasOwn = (table: TomlTable, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(table, key);

class Reader {
  index = 0;
  constructor(readonly text: string) {}

  get done(): boolean {
    return this.index >= this.text.length;
  }

  peek(offset = 0): string {
    return this.text[this.index + offset] ?? '';
  }

  startsWith(value: string): boolean {
    return this.text.startsWith(value, this.index);
  }

  fail(message: string): never {
    const line = this.text.slice(0, this.index).split('\n').length;
    throw new Error(`Invalid TOML at line ${line}: ${message}`);
  }

  /** Skips spaces, tabs and comments; newlines only when `newlines` is set. */
  skip(newlines: boolean): void {
    for (;;) {
      const char = this.peek();
      if (char === ' ' || char === '\t' || char === '\r') this.index++;
      else if (char === '\n' && newlines) this.index++;
      else if (char === '#') {
        while (!this.done && this.peek() !== '\n') this.index++;
      } else return;
    }
  }

  expect(char: string): void {
    if (this.peek() !== char) this.fail(`expected "${char}"`);
    this.index++;
  }
}

const ESCAPES: Record<string, string> = {
  b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\',
};

function readBasicString(reader: Reader, multiline: boolean): string {
  let out = '';
  for (;;) {
    if (reader.done) reader.fail('unterminated string');
    if (multiline && reader.startsWith('"""')) {
      reader.index += 3;
      return out;
    }
    const char = reader.peek();
    if (!multiline && char === '"') {
      reader.index++;
      return out;
    }
    if (!multiline && char === '\n') reader.fail('unterminated string');
    if (char === '\\') {
      reader.index++;
      const code = reader.peek();
      if (multiline && (code === '\n' || code === '\r' || code === ' ' || code === '\t')) {
        // Line-ending backslash trims the following whitespace run.
        while (!reader.done && /[\s]/.test(reader.peek())) reader.index++;
        continue;
      }
      if (code === 'u' || code === 'U') {
        const width = code === 'u' ? 4 : 8;
        const hex = reader.text.slice(reader.index + 1, reader.index + 1 + width);
        if (!/^[0-9A-Fa-f]+$/.test(hex) || hex.length !== width) reader.fail('invalid unicode escape');
        out += String.fromCodePoint(Number.parseInt(hex, 16));
        reader.index += 1 + width;
        continue;
      }
      if (!(code in ESCAPES)) reader.fail(`unsupported escape "\\${code}"`);
      out += ESCAPES[code];
      reader.index++;
      continue;
    }
    out += char;
    reader.index++;
  }
}

function readLiteralString(reader: Reader, multiline: boolean): string {
  const terminator = multiline ? "'''" : "'";
  const end = reader.text.indexOf(terminator, reader.index);
  if (end < 0) reader.fail('unterminated literal string');
  const value = reader.text.slice(reader.index, end);
  if (!multiline && value.includes('\n')) reader.fail('unterminated literal string');
  reader.index = end + terminator.length;
  return value;
}

function readString(reader: Reader): string {
  if (reader.startsWith('"""')) {
    reader.index += 3;
    if (reader.peek() === '\n') reader.index++;
    return readBasicString(reader, true);
  }
  if (reader.startsWith("'''")) {
    reader.index += 3;
    if (reader.peek() === '\n') reader.index++;
    return readLiteralString(reader, true);
  }
  if (reader.peek() === '"') {
    reader.index++;
    return readBasicString(reader, false);
  }
  reader.index++;
  return readLiteralString(reader, false);
}

function readKeyPart(reader: Reader): string {
  const char = reader.peek();
  if (char === '"' || char === "'") return readString(reader);
  let key = '';
  while (!reader.done && BARE_KEY.test(reader.peek())) {
    key += reader.peek();
    reader.index++;
  }
  if (!key) reader.fail('expected a key');
  return key;
}

function readKey(reader: Reader): string[] {
  const parts = [readKeyPart(reader)];
  for (;;) {
    reader.skip(false);
    if (reader.peek() !== '.') return parts;
    reader.index++;
    reader.skip(false);
    parts.push(readKeyPart(reader));
  }
}

function readValue(reader: Reader): TomlValue {
  reader.skip(false);
  const char = reader.peek();
  if (char === '"' || char === "'") return readString(reader);
  if (char === '[') {
    reader.index++;
    const items: TomlValue[] = [];
    for (;;) {
      reader.skip(true);
      if (reader.peek() === ']') {
        reader.index++;
        return items;
      }
      items.push(readValue(reader));
      reader.skip(true);
      if (reader.peek() === ',') {
        reader.index++;
        continue;
      }
      if (reader.peek() === ']') {
        reader.index++;
        return items;
      }
      reader.fail('expected "," or "]" in array');
    }
  }
  if (char === '{') {
    reader.index++;
    const table: TomlTable = emptyTable();
    reader.skip(false);
    if (reader.peek() === '}') {
      reader.index++;
      return table;
    }
    for (;;) {
      reader.skip(false);
      const key = readKey(reader);
      reader.skip(false);
      reader.expect('=');
      assign(table, key, readValue(reader), reader);
      reader.skip(false);
      if (reader.peek() === ',') {
        reader.index++;
        continue;
      }
      if (reader.peek() === '}') {
        reader.index++;
        return table;
      }
      reader.fail('expected "," or "}" in inline table');
    }
  }

  let raw = '';
  while (!reader.done && !',]}\n#'.includes(reader.peek())) {
    raw += reader.peek();
    reader.index++;
  }
  raw = raw.trim();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^[+-]?(?:\d[\d_]*)$/.test(raw)) return Number.parseInt(raw.replace(/_/g, ''), 10);
  if (/^[+-]?(?:\d[\d_]*)\.(?:\d[\d_]*)(?:[eE][+-]?\d+)?$/.test(raw)) return Number.parseFloat(raw.replace(/_/g, ''));
  if (/^[+-]?(?:\d[\d_]*)[eE][+-]?\d+$/.test(raw)) return Number.parseFloat(raw.replace(/_/g, ''));
  if (!raw) reader.fail('expected a value');
  reader.fail(`unsupported value ${JSON.stringify(raw)}`);
}

function assign(root: TomlTable, key: string[], value: TomlValue, reader: Reader): void {
  let table = root;
  for (const part of key.slice(0, -1)) {
    const next = hasOwn(table, part) ? table[part] : undefined;
    if (next === undefined) {
      const created = emptyTable();
      table[part] = created;
      table = created;
    } else if (typeof next === 'object' && !Array.isArray(next)) {
      table = next;
    } else {
      reader.fail(`cannot redefine ${key.join('.')}`);
    }
  }
  const leaf = key[key.length - 1];
  if (hasOwn(table, leaf)) reader.fail(`duplicate key ${key.join('.')}`);
  table[leaf] = value;
}

function tableAt(root: TomlTable, key: string[], arrayOfTables: boolean, reader: Reader): TomlTable {
  let table = root;
  for (const part of key.slice(0, -1)) {
    let next = hasOwn(table, part) ? table[part] : undefined;
    if (Array.isArray(next)) next = next[next.length - 1];
    if (next === undefined) {
      const created = emptyTable();
      table[part] = created;
      table = created;
    } else if (typeof next === 'object' && !Array.isArray(next)) {
      table = next as TomlTable;
    } else {
      reader.fail(`cannot redefine ${key.join('.')}`);
    }
  }

  const leaf = key[key.length - 1];
  const existing = hasOwn(table, leaf) ? table[leaf] : undefined;
  if (arrayOfTables) {
    const created = emptyTable();
    if (existing === undefined) table[leaf] = [created];
    else if (Array.isArray(existing)) existing.push(created);
    else reader.fail(`${key.join('.')} is not an array of tables`);
    return created;
  }
  if (existing === undefined) {
    const created = emptyTable();
    table[leaf] = created;
    return created;
  }
  if (typeof existing === 'object' && !Array.isArray(existing)) return existing;
  reader.fail(`cannot redefine ${key.join('.')}`);
}

export function parseToml(input: string): TomlTable {
  const bom = input.charCodeAt(0) === 0xFEFF ? 1 : 0;
  const reader = new Reader(bom ? input.slice(1) : input);
  const root = emptyTable();
  let current = root;

  for (;;) {
    reader.skip(true);
    if (reader.done) return root;

    if (reader.peek() === '[') {
      const arrayOfTables = reader.peek(1) === '[';
      reader.index += arrayOfTables ? 2 : 1;
      reader.skip(false);
      const key = readKey(reader);
      reader.skip(false);
      reader.expect(']');
      if (arrayOfTables) reader.expect(']');
      current = tableAt(root, key, arrayOfTables, reader);
      continue;
    }

    const key = readKey(reader);
    reader.skip(false);
    reader.expect('=');
    assign(current, key, readValue(reader), reader);
  }
}
