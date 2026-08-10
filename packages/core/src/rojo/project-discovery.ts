import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveProjectPath, resolveProjectRoot } from './source-mapper.js';
import type { RojoProject } from './types.js';

/**
 * String-aware JSONC: comments and trailing commas removed without touching a
 * `//` that lives inside a string. Exported because `tsconfig.json` is JSONC
 * too and the roblox-ts pack has to read one — a second copy of this is a
 * second place to get the string handling wrong.
 */
export function parseJsonc(raw: string): unknown {
  let output = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    const next = raw[i + 1];
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
    } else if (char === '/' && next === '/') {
      while (i < raw.length && raw[i] !== '\n') i++;
      output += '\n';
    } else if (char === '/' && next === '*') {
      i += 2;
      while (i < raw.length - 1 && !(raw[i] === '*' && raw[i + 1] === '/')) i++;
      i++;
    } else {
      output += char;
    }
  }

  let normalized = '';
  inString = false;
  escaped = false;
  for (let i = 0; i < output.length; i++) {
    const char = output[i];
    if (inString) {
      normalized += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      normalized += char;
      continue;
    }
    if (char === ',') {
      let next = i + 1;
      while (/\s/.test(output[next] ?? '')) next++;
      if (output[next] === '}' || output[next] === ']') continue;
    }
    normalized += char;
  }
  return JSON.parse(normalized);
}

const PROJECT_SUFFIXES = ['.project.json', '.project.jsonc'] as const;

export function isRojoProjectFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return PROJECT_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

/**
 * Rojo made `name` optional in 7.4.1: `default.project.json` takes the parent
 * directory name and `foo.project.json` takes `foo`.
 */
function deriveProjectName(projectFile: string): string {
  const base = path.basename(projectFile).replace(/\.project\.jsonc?$/i, '');
  return base.toLowerCase() === 'default' ? path.basename(path.dirname(projectFile)) : base;
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : undefined;
}

function readProject(projectFile: string): RojoProject {
  const parsed = parseJsonc(fs.readFileSync(projectFile, 'utf8')) as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object' || !parsed.tree || typeof parsed.tree !== 'object') {
    throw new Error(`Invalid Rojo project ${projectFile}: expected object "tree"`);
  }
  return {
    name: typeof parsed.name === 'string' ? parsed.name : deriveProjectName(projectFile),
    root: path.dirname(projectFile),
    projectFile,
    servePort: typeof parsed.servePort === 'number' ? parsed.servePort : undefined,
    serveAddress: typeof parsed.serveAddress === 'string' ? parsed.serveAddress : undefined,
    servePlaceIds: Array.isArray(parsed.servePlaceIds)
      ? parsed.servePlaceIds.filter((value): value is number => Number.isInteger(value))
      : undefined,
    emitLegacyScripts: typeof parsed.emitLegacyScripts === 'boolean' ? parsed.emitLegacyScripts : undefined,
    globIgnorePaths: Array.isArray(parsed.globIgnorePaths)
      ? parsed.globIgnorePaths.filter((value): value is string => typeof value === 'string')
      : undefined,
    syncbackIgnorePaths: stringList((parsed.syncbackRules as Record<string, unknown> | undefined)?.ignorePaths),
    tree: parsed.tree as Record<string, unknown>,
  };
}

const MAX_DISCOVERED_PROJECTS = 200;
const MAX_DISCOVERY_DEPTH = 24;

/**
 * Directories whose contents belong to something else. Wally installs vendored
 * packages that ship their own `*.project.json`; walking into them made
 * discovery ambiguous after any `wally install`, or hit the project ceiling.
 */
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.bloxforge',
  'node_modules',
  'Packages',
  'ServerPackages',
  'DevPackages',
]);

export function discoverRojoProjects(root = process.cwd()): RojoProject[] {
  const canonicalRoot = resolveProjectRoot(root);
  const found: string[] = [];
  const walk = (directory: string, depth: number) => {
    if (depth > MAX_DISCOVERY_DEPTH) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute, depth + 1);
      else if (entry.isFile() && isRojoProjectFile(entry.name)) {
        found.push(absolute);
        if (found.length > MAX_DISCOVERED_PROJECTS) {
          throw new Error(`More than ${MAX_DISCOVERED_PROJECTS} Rojo project files found under ${canonicalRoot}; narrow the search root`);
        }
      }
    }
  };
  walk(canonicalRoot, 0);
  return found.sort().map(readProject);
}

export function selectRojoProject(root = process.cwd(), projectFile?: string): RojoProject {
  if (projectFile) {
    const selected = resolveProjectPath(root, projectFile);
    if (!isRojoProjectFile(selected)) throw new Error('Rojo project file must end with .project.json or .project.jsonc');
    return readProject(selected);
  }
  const projects = discoverRojoProjects(root);
  if (projects.length === 0) throw new Error(`No Rojo project files found under ${resolveProjectRoot(root)}`);
  if (projects.length > 1) {
    throw new Error(`Multiple Rojo project files found; select one explicitly: ${projects.map((project) => path.relative(root, project.projectFile)).join(', ')}`);
  }
  return projects[0];
}
