// ═══ The source readers of proposal 0059: every key of the five sources, with its location ═══
//
// WHAT THEY READ. Rule 11.15 of proposal 0059 holds the rows of `docs/capability-coverage.md` to
// these keys: a key that no row covers is a defect, and so is a row that covers no key. The
// sources are named in `changes/0059-capability-coverage.md` ("The sources") and in Appendix C of
// `docs/language-design.md`:
//   A  WebGPU host API   node_modules/@webgpu/types/dist/index.d.ts, at the pinned version
//   B  WGSL              src/core/spec-conformance/fixtures/wgsl-names.json
//   C  GLSL ES 3.00      src/core/spec-conformance/fixtures/glsl-es300-names.json
//   D  WebGL2 host API   node_modules/typescript/lib/lib.dom.d.ts, and the extensions of
//                        src/core/spec-conformance/fixtures/webgl-extensions.json
//
// WHAT A KEY IS. Table A: `Interface.member` for a method or a descriptor field, the interface name
// for an interface with no member, and the enum type's name for a type alias whose body is a union
// of string literals (one key for all its values; a one-literal alias such as `GPUAutoLayoutMode`
// counts). Table B: `wgsl:<list>:<name>`. Table C:
// `glsl:<list>:<section>:<name>`, so the two `in` qualifiers stay apart. Table D:
// `webgl:<Interface>.<member>`, and `webgl:<NAME>` for an extension with no member. A WebGL
// constant (`readonly COLOR_BUFFER_BIT: GLenum`) is a key only when `CAPABILITY_CONSTANTS` names it,
// and then it is the key of the core interface that declares it: one row per capability, not per
// GLenum.
// A WebGPU flag constant (`GPUBufferUsage.COPY_SRC`, 26 of them) is a key: the WebGL constants are
// the GLenum values, and the WebGPU flags are capabilities a row can name.
//
// HOW THEY READ. A member is `^(readonly )?(\w+)\??\s*[:(]` (table A after the indent `^  `), a method
// `^  \w+\??\s*\(` (table A), a string literal `"([^"]+)"`. The patterns follow how the pinned files
// write their declarations: a WebGPU member is indented two spaces, a lib.dom member four. Four rules
// decide the keys, and the test holds each one.
//   1. The declarations of one interface name are merged, as TypeScript merges them. A member that
//      only one declaration names is kept. `GPUDevice.addEventListener` is one such member.
//   2. `readonly __brand` is dropped. It is a nominal-typing workaround, not a capability.
//   3. One member per name. An overload is one member, and its location is its first matched line.
//   4. Table D reads a member at brace depth one and parenthesis depth zero, and a constant is a
//      `readonly` member whose name starts with an uppercase letter. The depth rule keeps a parameter
//      of a method written over several lines from becoming a member. The uppercase rule keeps
//      `FLOAT_MAT2x3` a constant: a pattern such as `readonly [A-Z0-9_]+:` rejects its lowercase `x`.
//      At the pinned `lib.dom.d.ts` the depth rule changes no key (measured 2026-10-12; no test scans
//      the pinned file for it). The parser test on a doctored text, a method whose parameters span
//      several lines, holds the rule.
// Table A reads `name(` but not `name<`: a generic overload is not a line of the pattern. Each
// generic name in `@webgpu/types` also has a plain overload, so no key is lost, and the test
// checks every depth-one member line.
// Table D reads four interfaces, and only those: `WebGL2RenderingContextBase`,
// `WebGL2RenderingContextOverloads`, `WebGLRenderingContextBase` and `WebGLContextAttributes`.
// `WebGLRenderingContextOverloads` is left out, because WebGL2 replaces it. The extension
// interfaces are read by name from the fixture, not by pattern.
//
// CHECKS. A parser refuses what it cannot hold, and asserts no floor: a duplicate key, a list whose
// `count` is missing or differs from its entries, a list that is missing or empty (each list table B
// reads, and the four required lists of table C), a top-level list of the WGSL fixture that has a
// `count` and that table B does not read (except `reservedWords`), one of the four core WebGL
// interfaces that `lib.dom.d.ts` does not declare or that holds no member key, and a name of
// `CAPABILITY_CONSTANTS` that is not declared by exactly one core WebGL interface. The readers refuse
// a missing file by its name. Keys are unique across all tables.
//
// FLOORS. Each reader of a table's content asserts a floor on what it read (`FLOORS`), except
// `readWebGlInterfaces`, whose guards are the throws of `coreWebGlKeys`. A truncated read would
// otherwise leave `readSources` with fewer keys and every check in the test green. Only the readers
// assert a floor. The parsers (`parseWebGpuHost`, `webGpuMembers`, `parseWgsl`, `parseGlsl`,
// `parseWebGlInterfaces`, `parseWebGlExtensions`, `parseWebGl2Host`) do not, so a test of one property
// reads its source through them. A truncated source fails the floor test, which names the floor.
//
// DISPLAY. `display` is the name the table shows. A method, and a built-in function of B or C,
// ends in `()`.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');

/** The four tables of the coverage table (proposal 0059, "The statuses" and Appendix C). */
export type TableId = 'A' | 'B' | 'C' | 'D';

/** One key of a source, with the place it was read from. */
export interface SourceMember {
  table: TableId;
  /** Unique across all tables, e.g. `GPUDevice.createBuffer`, `GPUTextureFormat`,
   *  `wgsl:builtinFunctions:textureSample`, `glsl:builtinFunctions:8.1:radians`,
   *  `webgl:WebGLContextAttributes.alpha`, `webgl:OES_texture_float`. */
  key: string;
  /** `node_modules/…:123` (the line of the declaration) or `src/…/fixtures/….json §8.1` (the
   *  section of the fixture the entry is in). */
  location: string;
  /** The name as the table shows it. */
  display: string;
}

/** The files, repository-relative. */
const WEBGPU_PACKAGE = 'node_modules/@webgpu/types/package.json';
const WEBGPU_FILE = 'node_modules/@webgpu/types/dist/index.d.ts';
const TYPESCRIPT_PACKAGE = 'node_modules/typescript/package.json';
const DOM_FILE = 'node_modules/typescript/lib/lib.dom.d.ts';
const FIXTURES = 'src/core/spec-conformance/fixtures';
const WGSL_FILE = `${FIXTURES}/wgsl-names.json`;
const GLSL_FILE = `${FIXTURES}/glsl-es300-names.json`;
const WEBGL_FILE = `${FIXTURES}/webgl-extensions.json`;

/** The floors each reader asserts. A reader must read at least this many: a floor below the real
 *  count hides a truncated read. */
export const FLOORS = {
  /** Interfaces of `@webgpu/types` (113 distinct names at 0.1.74). */
  webgpuInterfaces: 100,
  /** Enum types of `@webgpu/types`: type aliases whose body is a union of string literals, a
   *  one-literal alias included (`GPUAutoLayoutMode`). */
  webgpuEnumTypes: 30,
  /** Built-in functions of the WGSL fixture. */
  wgslBuiltinFunctions: 169,
  /** Built-in functions of the GLSL ES 3.00 fixture. */
  glslBuiltinFunctions: 89,
  /** Extensions that apply to WebGL2 (proposal 0059, The sources): the fixture's `webgl2` label is
   *  `applies` or `inherits`, and the status is ratified, community-approved or draft. The fixture
   *  read on 2026-10-12 yields 41. */
  webglExtensions: 40,
} as const;

/** The WebGL interfaces table D reads, and only those (proposal 0059, The sources). */
const WEBGL_INTERFACES = [
  'WebGL2RenderingContextBase',
  'WebGL2RenderingContextOverloads',
  'WebGLRenderingContextBase',
  'WebGLContextAttributes',
] as const;

/** The extension statuses that count as a capability: the `status` field of
 *  `scripts/bake-webgl-extensions.ts`. */
const WEBGL_EXTENSION_STATUSES: readonly string[] = ['ratified', 'community-approved', 'draft'];

/** The WebGL2 labels of an extension that count as a capability, as `scripts/bake-webgl-extensions.ts`
 *  defines them: `applies` is written against WebGL 2.0, and `inherits` is written against WebGL 1.0
 *  only and is available on WebGL 2 by the registry's convention. */
const WEBGL2_LABELS: readonly string[] = ['applies', 'inherits'];

/** The WebGL constants that are keys, one row per capability (proposal 0059, "What the inventory
 *  found", item 4). Each is a key of the core interface that declares it. Eight names are declared
 *  by `WebGLRenderingContextBase`, the WebGL 1.0 interface. WebGL2 inherits the WebGL 1.0
 *  constants. They are `LINE_LOOP`, `TRIANGLE_FAN`, `LUMINANCE`, `ALPHA`, `LUMINANCE_ALPHA`, `RGB`,
 *  `RGB565` and `UNPACK_COLORSPACE_CONVERSION_WEBGL`. The proposal counts them as WebGL2-only in the
 *  sense that WebGPU has no such capability. Every other GLenum stays out: one row per capability,
 *  not per GLenum. */
export const CAPABILITY_CONSTANTS = [
  // Topologies.
  'LINE_LOOP',
  'TRIANGLE_FAN',
  // Formats.
  'LUMINANCE',
  'ALPHA',
  'LUMINANCE_ALPHA',
  // The 3-component formats.
  'RGB',
  'RGB8',
  'SRGB8',
  'RGB565',
  'RGB8_SNORM',
  'RGB16F',
  'RGB32F',
  'RGB8I',
  'RGB8UI',
  'RGB16I',
  'RGB16UI',
  'RGB32I',
  'RGB32UI',
  // Unpack state.
  'UNPACK_COLORSPACE_CONVERSION_WEBGL',
] as const;

/** The lists of the GLSL fixture table C must find. The built-in functions have a floor; the other
 *  three have none, so a fixture that lost one would otherwise read as a short table. */
const GLSL_REQUIRED_LISTS = [
  'builtinFunctions',
  'builtinVariables',
  'types',
  'qualifiers',
] as const;

/** The top-level lists of the WGSL fixture table B reads. `reservedWords` is not a capability. */
const WGSL_LISTS = [
  'builtinFunctions',
  'predeclaredTypes',
  'typeGenerators',
  'builtinValues',
  'attributes',
  'keywords',
  'enableExtensions',
  'languageExtensions',
] as const;

// ─── Files ───

function readRequired(root: string, file: string): string {
  const path = join(root, file);
  if (!existsSync(path)) {
    throw new Error(`capability-sources: ${file} is missing under ${root}`);
  }
  return readFileSync(path, 'utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`capability-sources: ${what} is not an object`);
  return value;
}

function asArray(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`capability-sources: ${what} is not an array`);
  return value;
}

function asString(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Error(`capability-sources: ${what} is not a string`);
  return value;
}

/** A JSON text whose top level is an object. */
function parseJsonRecord(text: string, file: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  return asRecord(parsed, file);
}

function readJson(root: string, file: string): Record<string, unknown> {
  return parseJsonRecord(readRequired(root, file), file);
}

/** Throws when a list's `count` is missing or differs from the entries it holds: a fixture that was
 *  edited by hand, or one written by a bake that failed half way. */
function checkCount(file: string, list: string, count: unknown, entries: number): void {
  if (typeof count !== 'number' || count !== entries) {
    throw new Error(
      `capability-sources: ${file} list ${list} says count ${String(count)} and holds ${String(entries)}`,
    );
  }
}

/** Throws when a required list holds no entry. A list the fixture lost or emptied is a truncated
 *  fixture, and a list without a floor would otherwise pass as a short one. */
function requireEntries(file: string, list: string, entries: number): void {
  if (entries === 0) {
    throw new Error(`capability-sources: ${file} list ${list} is missing or holds no entries`);
  }
}

// ─── Checks shared by the readers ───

/** Throws on the first key that two members share, and names both places. A key is one capability:
 *  two members with one key would make one row cover two things. */
export function assertUniqueKeys(members: readonly SourceMember[]): void {
  const seen = new Map<string, SourceMember>();
  for (const member of members) {
    const first = seen.get(member.key);
    if (first !== undefined) {
      throw new Error(
        `capability-sources: duplicate key "${member.key}" at ${first.location} and ${member.location}`,
      );
    }
    seen.set(member.key, member);
  }
}

function assertFloor(what: string, actual: number, floor: number): void {
  if (actual < floor) {
    throw new Error(
      `capability-sources: ${what}: read ${String(actual)}, below the floor ${String(floor)}`,
    );
  }
}

function checked(members: SourceMember[]): SourceMember[] {
  assertUniqueKeys(members);
  return members;
}

// ─── Table A: @webgpu/types ───

/** A member of a WebGPU interface, as its declaration names it. */
export interface WebGpuMember {
  name: string;
  /** The line of the first declaration that names it (an overload's first line). */
  line: number;
  method: boolean;
}

/** A declaration of table A. An interface holds its members merged over every declaration of its
 *  name. An enum type holds the number of its string literals; the literals are not keys. */
export type WebGpuDecl =
  | { kind: 'interface'; name: string; line: number; members: WebGpuMember[] }
  | { kind: 'enum'; name: string; line: number; values: number };

const WEBGPU_DECL = /^(?:declare )?(interface|type|class|var|function) (\w+)/;
const WEBGPU_MEMBER = /^  (readonly )?(\w+)\??\s*[:(]/;
const WEBGPU_METHOD = /^  \w+\??\s*\(/;

/** The count of `{` less the count of `}` on a line. */
function braceDelta(line: string): number {
  return line.split('{').length - line.split('}').length;
}

/** True when a type alias body is a union of string literals, once comments are removed. */
function isStringUnion(declaration: string): boolean {
  const body = declaration
    .slice(declaration.indexOf('=') + 1)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  return /^\s*\|?\s*"[^"]+"(?:\s*\|\s*"[^"]+")*\s*;?\s*$/.test(body);
}

function addWebGpuMember(
  decl: WebGpuDecl & { kind: 'interface' },
  name: string,
  line: number,
  method: boolean,
): void {
  // A nominal-typing workaround, not a capability.
  if (name === '__brand') return;
  // One member per name: the first declaration and the first line of an overload stay.
  if (decl.members.some((member) => member.name === name)) return;
  decl.members.push({ name, line, method });
}

/** Parses the declarations of `@webgpu/types` into interfaces and enum types, in the order of their
 *  first declaration. Pure: a test runs it on a doctored text. */
export function parseWebGpuHost(text: string): WebGpuDecl[] {
  const lines = text.split('\n');
  const out: WebGpuDecl[] = [];
  const interfaces = new Map<string, WebGpuDecl & { kind: 'interface' }>();
  let i = 0;
  while (i < lines.length) {
    const head = WEBGPU_DECL.exec(lines[i] ?? '');
    if (head === null) {
      i += 1;
      continue;
    }
    const kind = head[1];
    const name = head[2] ?? '';
    if (kind === 'type') {
      let j = i;
      let body = lines[i] ?? '';
      while (!body.trimEnd().endsWith(';') && j + 1 < lines.length) {
        j += 1;
        body += `\n${lines[j] ?? ''}`;
      }
      const literals = [...body.matchAll(/"([^"]+)"/g)].length;
      if (literals > 0) {
        if (!isStringUnion(body)) {
          throw new Error(
            `capability-sources: type ${name} (${WEBGPU_FILE}:${String(i + 1)}) holds string literals but is not a union of them`,
          );
        }
        out.push({ kind: 'enum', name, line: i + 1, values: literals });
      }
      i = j + 1;
      continue;
    }
    if (kind === 'var' || kind === 'function') {
      i += 1;
      continue;
    }
    // `interface` and `class`: the members at brace depth one of the body, merged by name.
    let j = i;
    while (j < lines.length && !(lines[j] ?? '').includes('{')) j += 1;
    if (j >= lines.length) {
      throw new Error(`capability-sources: ${name} (line ${String(i + 1)}) has no body`);
    }
    let decl = interfaces.get(name);
    if (decl === undefined) {
      decl = { kind: 'interface', name, line: i + 1, members: [] };
      interfaces.set(name, decl);
      out.push(decl);
    }
    let depth = braceDelta(lines[j] ?? '');
    let k = j + 1;
    while (k < lines.length && depth > 0) {
      const line = lines[k] ?? '';
      const member = WEBGPU_MEMBER.exec(line);
      if (member !== null && depth === 1) {
        addWebGpuMember(decl, member[2] ?? '', k + 1, WEBGPU_METHOD.test(line));
      }
      depth += braceDelta(line);
      k += 1;
    }
    i = k;
  }
  return out;
}

/** Table A's keys of the declarations `parseWebGpuHost` returns: one per member of each interface, one
 *  per member-less interface, one per enum type. Asserts no floor. */
export function webGpuMembers(decls: readonly WebGpuDecl[]): SourceMember[] {
  const members: SourceMember[] = [];
  for (const decl of decls) {
    const location = `${WEBGPU_FILE}:${String(decl.line)}`;
    if (decl.kind === 'enum' || decl.members.length === 0) {
      members.push({ table: 'A', key: decl.name, location, display: decl.name });
      continue;
    }
    for (const member of decl.members) {
      const key = `${decl.name}.${member.name}`;
      members.push({
        table: 'A',
        key,
        location: `${WEBGPU_FILE}:${String(member.line)}`,
        display: member.method ? `${key}()` : key,
      });
    }
  }
  return checked(members);
}

/** Table A: one key per member of each interface, one per member-less interface, one per enum. */
export function readWebGpuHost(root: string = REPO_ROOT): SourceMember[] {
  const decls = parseWebGpuHost(readRequired(root, WEBGPU_FILE));
  const interfaces = decls.filter((decl) => decl.kind === 'interface').length;
  const enumTypes = decls.length - interfaces;
  assertFloor('WebGPU interfaces', interfaces, FLOORS.webgpuInterfaces);
  assertFloor('WebGPU enum types', enumTypes, FLOORS.webgpuEnumTypes);
  return webGpuMembers(decls);
}

// ─── Table B: the WGSL fixture ───

/** Table B's keys from the text of the WGSL fixture: one key per name of each list the table reads.
 *  Refuses a top-level list that has a `count` and that the table does not read, except
 *  `reservedWords`, which is not a capability. Asserts no floor. */
export function parseWgsl(text: string): SourceMember[] {
  const fixture = parseJsonRecord(text, WGSL_FILE);
  for (const [list, value] of Object.entries(fixture)) {
    if (!isRecord(value) || !('count' in value)) continue;
    if (list !== 'reservedWords' && !(WGSL_LISTS as readonly string[]).includes(list)) {
      throw new Error(
        `capability-sources: ${WGSL_FILE} list ${list} has a count and is not read by table B`,
      );
    }
  }
  const members: SourceMember[] = [];
  for (const list of WGSL_LISTS) {
    const value = asRecord(fixture[list], `${WGSL_FILE} list ${list}`);
    const section = asString(value.section, `${WGSL_FILE} list ${list} section`);
    const entries = asArray(
      list === 'builtinValues' ? value.values : value.names,
      `${WGSL_FILE} list ${list}`,
    );
    checkCount(WGSL_FILE, list, value.count, entries.length);
    requireEntries(WGSL_FILE, list, entries.length);
    for (const entry of entries) {
      const name =
        list === 'builtinValues'
          ? asString(asRecord(entry, `${WGSL_FILE} builtinValues entry`).name, 'builtinValues name')
          : asString(entry, `${WGSL_FILE} list ${list} name`);
      members.push({
        table: 'B',
        key: `wgsl:${list}:${name}`,
        location: `${WGSL_FILE} §${section}`,
        display: list === 'builtinFunctions' ? `${name}()` : name,
      });
    }
  }
  return checked(members);
}

/** Table B: one key per name of each list of the WGSL fixture (`reservedWords` excluded). */
export function readWgsl(root: string = REPO_ROOT): SourceMember[] {
  const members = parseWgsl(readRequired(root, WGSL_FILE));
  const functions = members.filter((m) => m.key.startsWith('wgsl:builtinFunctions:')).length;
  assertFloor('WGSL built-in functions', functions, FLOORS.wgslBuiltinFunctions);
  return members;
}

// ─── Table C: the GLSL ES 3.00 fixture ───

/** Table C's keys from the text of the GLSL fixture: one key per entry of each list, whatever the lists
 *  are called, so a list added by the fixture needs no code. A list is a top-level property with an
 *  `entries` array. The lists of `GLSL_REQUIRED_LISTS` must be present and non-empty. Asserts no
 *  floor. */
export function parseGlsl(text: string): SourceMember[] {
  const fixture = parseJsonRecord(text, GLSL_FILE);
  const members: SourceMember[] = [];
  const sizes = new Map<string, number>();
  for (const [list, value] of Object.entries(fixture)) {
    if (!isRecord(value) || !Array.isArray(value.entries)) continue;
    const entries = asArray(value.entries, `${GLSL_FILE} list ${list}`);
    checkCount(GLSL_FILE, list, value.count, entries.length);
    sizes.set(list, entries.length);
    for (const raw of entries) {
      const entry = asRecord(raw, `${GLSL_FILE} list ${list} entry`);
      const name = asString(entry.name, `${GLSL_FILE} list ${list} name`);
      const section = asString(entry.section, `${GLSL_FILE} list ${list} section of ${name}`);
      members.push({
        table: 'C',
        key: `glsl:${list}:${section}:${name}`,
        location: `${GLSL_FILE} §${section}`,
        display: list === 'builtinFunctions' ? `${name}()` : name,
      });
    }
  }
  for (const list of GLSL_REQUIRED_LISTS) requireEntries(GLSL_FILE, list, sizes.get(list) ?? 0);
  return checked(members);
}

/** Table C: one key per entry of each list of the GLSL fixture (see `parseGlsl`). */
export function readGlsl(root: string = REPO_ROOT): SourceMember[] {
  const members = parseGlsl(readRequired(root, GLSL_FILE));
  const functions = members.filter((m) => m.key.startsWith('glsl:builtinFunctions:')).length;
  assertFloor('GLSL ES 3.00 built-in functions', functions, FLOORS.glslBuiltinFunctions);
  return members;
}

// ─── Table D: lib.dom.d.ts and the extension fixture ───

/** A member of a WebGL interface. A constant is read, so a key can refuse it. Only the names of
 *  `CAPABILITY_CONSTANTS` are keys among the constants. */
export interface WebGlMember {
  name: string;
  line: number;
  kind: 'method' | 'field' | 'const';
}

/** An interface of `lib.dom.d.ts` that the caller asked for, with the members at depth one. */
export interface WebGlDecl {
  name: string;
  line: number;
  members: WebGlMember[];
}

const WEBGL_MEMBER = /^(readonly )?(\w+)\??\s*[:(]/;

/** Parses the named interfaces of `lib.dom.d.ts`. A member is a line that starts at brace depth one
 *  and parenthesis depth zero, so a parameter of a method written over several lines is not one.
 *  A constant is a `readonly` member whose name starts with an uppercase letter: every WebGL
 *  constant is named so, and no other member is. A pattern such as `readonly [A-Z0-9_]+:` would read
 *  `FLOAT_MAT2x3` as a field, because of its lowercase `x`. Comment lines are skipped. Pure: a test
 *  runs it on a doctored text. */
export function parseWebGlInterfaces(
  text: string,
  wanted: ReadonlySet<string>,
): Map<string, WebGlDecl> {
  const lines = text.split('\n');
  const found = new Map<string, WebGlDecl>();
  for (let i = 0; i < lines.length; i++) {
    const name = /^interface (\w+)/.exec(lines[i] ?? '')?.[1];
    if (name === undefined || !wanted.has(name)) continue;
    let decl = found.get(name);
    if (decl === undefined) {
      decl = { name, line: i + 1, members: [] };
      found.set(name, decl);
    }
    let braces = 0;
    let parens = 0;
    let opened = false;
    let k = i;
    for (; k < lines.length; k++) {
      const code = (lines[k] ?? '').trim();
      if (code.startsWith('/') || code.startsWith('*')) continue;
      const member = WEBGL_MEMBER.exec(code);
      if (member !== null && opened && braces === 1 && parens === 0) {
        const memberName = member[2] ?? '';
        if (!decl.members.some((m) => m.name === memberName)) {
          const kind: WebGlMember['kind'] = /^readonly [A-Z]/.test(code)
            ? 'const'
            : /^\w+\(/.test(code)
              ? 'method'
              : 'field';
          decl.members.push({ name: memberName, line: k + 1, kind });
        }
      }
      braces += code.split('{').length - code.split('}').length;
      parens += code.split('(').length - code.split(')').length;
      // A one-line body (`interface X {}`) opens and closes on the header line.
      if (code.includes('{')) opened = true;
      if (opened && braces <= 0) break;
    }
    i = k;
  }
  return found;
}

/** One extension of the fixture that applies to WebGL2 with a status table D reads. */
export interface WebGlExtension {
  name: string;
  status: string;
}

/** The extensions table D reads, from the fixture text: the `webgl2` label is `applies` or `inherits`,
 *  and the status is one of the three statuses. The fixture is `{ count, extensions: [{ name, status,
 *  webgl, webgl2, interface, path }] }`. Pure, and without the floor: a test holds the rule to the
 *  fixture with it. */
export function parseWebGlExtensions(text: string): WebGlExtension[] {
  const fixture = parseJsonRecord(text, WEBGL_FILE);
  const entries = asArray(fixture.extensions, `${WEBGL_FILE} extensions`);
  checkCount(WEBGL_FILE, 'extensions', fixture.count, entries.length);
  const extensions: WebGlExtension[] = [];
  for (const raw of entries) {
    const entry = asRecord(raw, `${WEBGL_FILE} extension`);
    const name = asString(entry.name, `${WEBGL_FILE} extension name`);
    const status = asString(entry.status, `${WEBGL_FILE} extension ${name} status`);
    const label = asString(entry.webgl2, `${WEBGL_FILE} extension ${name} webgl2`);
    if (!WEBGL2_LABELS.includes(label) || !WEBGL_EXTENSION_STATUSES.includes(status)) continue;
    extensions.push({ name, status });
  }
  return extensions;
}

/** Table D's extensions, read from the fixture under `root`, with the floor asserted. */
export function readWebGlExtensions(root: string = REPO_ROOT): WebGlExtension[] {
  const extensions = parseWebGlExtensions(readRequired(root, WEBGL_FILE));
  assertFloor('WebGL extensions that apply to WebGL2', extensions.length, FLOORS.webglExtensions);
  return extensions;
}

/** The keys of one declared interface: one per non-constant member, or the interface's own name
 *  when it has none. A WebGL constant is not among them: `capabilityConstantKeys` keys the listed
 *  constants. */
function webGlKeys(decl: WebGlDecl): SourceMember[] {
  const capabilities = decl.members.filter((member) => member.kind !== 'const');
  if (capabilities.length === 0) {
    return [
      {
        table: 'D',
        key: `webgl:${decl.name}`,
        location: `${DOM_FILE}:${String(decl.line)}`,
        display: decl.name,
      },
    ];
  }
  return capabilities.map((member) => {
    const name = `${decl.name}.${member.name}`;
    return {
      table: 'D',
      key: `webgl:${name}`,
      location: `${DOM_FILE}:${String(member.line)}`,
      display: member.kind === 'method' ? `${name}()` : name,
    };
  });
}

/** The keys of `CAPABILITY_CONSTANTS`: each name is keyed by the one core interface that declares it.
 *  A name that no core interface declares throws, so a typo or a change of `lib.dom.d.ts` fails here.
 *  A name that two of them declare throws too: its key would not name one interface. */
function capabilityConstantKeys(declared: ReadonlyMap<string, WebGlDecl>): SourceMember[] {
  return CAPABILITY_CONSTANTS.map((name) => {
    const owners = WEBGL_INTERFACES.flatMap((iface) => {
      const member = declared
        .get(iface)
        ?.members.find((m) => m.kind === 'const' && m.name === name);
      return member === undefined ? [] : [{ iface, member }];
    });
    const owner = owners.length === 1 ? owners[0] : undefined;
    if (owner === undefined) {
      throw new Error(
        `capability-sources: constant ${name} is declared by ${String(owners.length)} of the four core WebGL interfaces in ${DOM_FILE}; expected one`,
      );
    }
    return {
      table: 'D',
      key: `webgl:${owner.iface}.${name}`,
      location: `${DOM_FILE}:${String(owner.member.line)}`,
      display: `${owner.iface}.${name}`,
    };
  });
}

/** The keys of the four WebGL interfaces, in their order, then the keys of `CAPABILITY_CONSTANTS`.
 *  Two defects throw: an interface that `lib.dom.d.ts` does not declare, since table D reads these four
 *  and no other interface of the core API; and an interface with no member key, whose body was not
 *  read, so its keys fell back to its own name. `capabilityConstantKeys` throws on a constant defect. */
function coreWebGlKeys(declared: ReadonlyMap<string, WebGlDecl>): SourceMember[] {
  const interfaceKeys = WEBGL_INTERFACES.flatMap((name) => {
    const decl = declared.get(name);
    if (decl === undefined) {
      throw new Error(`capability-sources: interface ${name} is not declared in ${DOM_FILE}`);
    }
    const keys = webGlKeys(decl);
    if (!keys.some((member) => member.key.startsWith(`webgl:${name}.`))) {
      throw new Error(`capability-sources: interface ${name} in ${DOM_FILE} holds no member key`);
    }
    return keys;
  });
  return [...interfaceKeys, ...capabilityConstantKeys(declared)];
}

/** Table D, the four WebGL interfaces of `lib.dom.d.ts`: one key per method and non-constant field,
 *  and one per name of `CAPABILITY_CONSTANTS`. Needs no extension fixture. */
export function readWebGlInterfaces(root: string = REPO_ROOT): SourceMember[] {
  const declared = parseWebGlInterfaces(readRequired(root, DOM_FILE), new Set(WEBGL_INTERFACES));
  return checked(coreWebGlKeys(declared));
}

/** Table D: the keys of the four WebGL interfaces and of `CAPABILITY_CONSTANTS`, then of each extension
 *  of `extensions`: its members when `lib.dom.d.ts` declares it, else one key for the extension, at its
 *  fixture entry. Pure, and without the extension floor: a test runs it on the real fixture and on
 *  doctored text. Given no extension, it returns the keys of the four interfaces and of the constants. */
export function parseWebGl2Host(
  domText: string,
  extensions: readonly WebGlExtension[],
): SourceMember[] {
  const declared = parseWebGlInterfaces(
    domText,
    new Set<string>([...WEBGL_INTERFACES, ...extensions.map((e) => e.name)]),
  );
  const members = coreWebGlKeys(declared);
  for (const extension of extensions) {
    const decl = declared.get(extension.name);
    if (decl === undefined) {
      members.push({
        table: 'D',
        key: `webgl:${extension.name}`,
        location: `${WEBGL_FILE} §${extension.name}`,
        display: extension.name,
      });
      continue;
    }
    members.push(...webGlKeys(decl));
  }
  return checked(members);
}

/** Table D: the four WebGL interfaces, then each extension of the fixture (see `parseWebGl2Host`). */
export function readWebGl2Host(root: string = REPO_ROOT): SourceMember[] {
  const extensions = readWebGlExtensions(root);
  return parseWebGl2Host(readRequired(root, DOM_FILE), extensions);
}

// ─── The five sources, read together ───

/** Every key of the five sources, in table order A, B, C, D, with keys unique across all tables. */
export function readSources(root: string = REPO_ROOT): SourceMember[] {
  return checked([
    ...readWebGpuHost(root),
    ...readWgsl(root),
    ...readGlsl(root),
    ...readWebGl2Host(root),
  ]);
}

// ─── The configuration the table was read at ───

function readPackageVersion(file: string): { package: string; version: string; file: string } {
  const pkg = readJson(REPO_ROOT, file);
  return {
    package: asString(pkg.name, `${file} name`),
    version: asString(pkg.version, `${file} version`),
    file,
  };
}

function readFixturePin(file: string, keys: readonly string[]): Record<string, string | number> {
  const fixture = readJson(REPO_ROOT, file);
  const pin: Record<string, string | number> = { file };
  for (const key of keys) {
    const value = fixture[key];
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new Error(`capability-sources: ${file} has no ${key}`);
    }
    pin[key] = value;
  }
  return pin;
}

/** The versions and commits the five sources are read at. Each is read on access, so a missing
 *  fixture fails the reader that needs it and not every import of this module. */
export const PINNED = {
  /** Pinned exactly in `devDependencies` (proposal 0059, Unresolved decisions, item 3). */
  get webgpuTypes() {
    return readPackageVersion(WEBGPU_PACKAGE);
  },
  get typescript() {
    return readPackageVersion(TYPESCRIPT_PACKAGE);
  },
  get wgsl() {
    return readFixturePin(WGSL_FILE, ['specRepository', 'specCommit']);
  },
  get glsl() {
    return readFixturePin(GLSL_FILE, [
      'specRepository',
      'specCommit',
      'specFile',
      'documentRevision',
      'read',
    ]);
  },
  /** The registry commit and its date, and the day the extension list was read (proposal 0059,
   *  Unresolved decisions, item 3: the registry is baked into a fixture with the fetch date recorded). */
  get webgl() {
    return readFixturePin(WEBGL_FILE, [
      'registryRepository',
      'registryCommit',
      'registryCommitDate',
      'read',
    ]);
  },
};
