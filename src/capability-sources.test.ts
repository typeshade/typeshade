// ═══ The source readers of proposal 0059 hold their floors, their sentinels and their locations ═══
//
// `scripts/capability-sources.ts` reads the keys the coverage table is held to (Rule 11.15 of
// proposal 0059). A reader that reads too little, names one key twice, or points a location at a
// line that does not declare its key would let the table pass on less than its sources hold. This
// file holds the readers to the pinned sources. It sits beside the other tests of scripts, as
// `src/downstream-impact.test.ts` does.
//
// Two kinds of test read the sources.
//   - The floor tests run the readers, which assert the floors. The pin test holds `FLOORS` to its
//     literal values. The missing-file test runs the readers too, because a reader reads the file.
//     A truncated source fails the floor test that names it.
//   - Every other test runs a parser on the text of a source, or on a doctored copy of it. A parser
//     asserts no floor, so a doctored defect fails the one refusal test that names it. The table D
//     refusals that run `readWebGlInterfaces` assert no floor either.
// The extension rule is held to the fixture through `parseWebGlExtensions`.

import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAPABILITY_CONSTANTS,
  FLOORS,
  PINNED,
  assertUniqueKeys,
  parseGlsl,
  parseWebGl2Host,
  parseWebGlExtensions,
  parseWebGlInterfaces,
  parseWebGpuHost,
  parseWgsl,
  readGlsl,
  readSources,
  readWebGlExtensions,
  readWebGlInterfaces,
  readWebGpuHost,
  readWgsl,
  webGpuMembers,
  type SourceMember,
} from '../scripts/capability-sources.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEBGPU_FILE = 'node_modules/@webgpu/types/dist/index.d.ts';
const DOM_FILE = 'node_modules/typescript/lib/lib.dom.d.ts';
const WEBGL_FILE = 'src/core/spec-conformance/fixtures/webgl-extensions.json';
const WGSL_FILE = 'src/core/spec-conformance/fixtures/wgsl-names.json';
const GLSL_FILE = 'src/core/spec-conformance/fixtures/glsl-es300-names.json';
const CORE_INTERFACES = [
  'WebGL2RenderingContextBase',
  'WebGL2RenderingContextOverloads',
  'WebGLRenderingContextBase',
  'WebGLContextAttributes',
];

const read = (file: string): string => readFileSync(join(ROOT, file), 'utf8');

const byKey = (members: readonly SourceMember[]): Map<string, SourceMember> =>
  new Map(members.map((member) => [member.key, member]));

/** The name a key ends in: the member, or the interface, enum or extension it is keyed by. */
const declaredName = (key: string): string =>
  key
    .replace(/^webgl:/, '')
    .split('.')
    .pop() ?? '';

/** True when a line declares the key's name: a member (`name(`, `name:`, `readonly name:`) or an
 *  interface or type alias of that name. The line must start with the declaration. */
function declaresKey(line: string, key: string): boolean {
  const name = declaredName(key);
  const code = line.trim();
  return (
    new RegExp(`^(readonly )?${name}\\??\\s*[:(]`).test(code) ||
    new RegExp(`^(declare )?(interface|type) ${name}\\b`).test(code)
  );
}

/** Splits `file:123` into its file and line. */
function fileAndLine(location: string): { file: string; line: number } | undefined {
  const m = /^(.+):(\d+)$/.exec(location);
  return m === null ? undefined : { file: m[1] ?? '', line: Number(m[2]) };
}

/** The members a scanner sees at brace depth one and parenthesis depth zero of each interface body,
 *  in any indentation, and the generic form `name<` included. It is independent of the readers'
 *  pattern, so a member the pattern misses shows here. */
function depthOneNames(text: string): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  let owner: string | undefined;
  let braces = 0;
  let parens = 0;
  let opened = false;
  for (const raw of text.split('\n')) {
    const code = raw.trim();
    const comment = code.startsWith('/') || code.startsWith('*');
    if (owner === undefined) {
      const head = /^(?:declare )?(?:interface|class) (\w+)/.exec(code);
      if (head === null) continue;
      owner = head[1] ?? '';
      if (!found.has(owner)) found.set(owner, new Set());
      braces = 0;
      parens = 0;
      opened = false;
    } else if (!comment && opened && braces === 1 && parens === 0) {
      const name = /^(?:readonly )?([A-Za-z_]\w*)\??\s*[<:(]/.exec(code)?.[1];
      if (name !== undefined) found.get(owner)?.add(name);
    }
    if (!comment) {
      braces += code.split('{').length - code.split('}').length;
      parens += code.split('(').length - code.split(')').length;
      // A one-line body (`interface X {}`) opens and closes on the header line.
      if (code.includes('{')) opened = true;
    }
    if (opened && braces <= 0) owner = undefined;
  }
  return found;
}

/** The owner of a member key: `GPUDevice` for `GPUDevice.createBuffer`, `OES_x` for `webgl:OES_x.y`.
 *  Undefined for a key that names no member (an enum, a member-less interface, an extension). */
function ownerOf(key: string): string | undefined {
  const bare = key.replace(/^webgl:/, '');
  const dot = bare.indexOf('.');
  return dot < 0 ? undefined : bare.slice(0, dot);
}

/** The first and last line of every declaration of each interface in `text`; merged declarations
 *  each get one range. Brace depth counts the body, and a comment line is skipped. It is a scanner of
 *  its own, so a location the readers get wrong shows here. */
function interfaceRanges(text: string): Map<string, [number, number][]> {
  const ranges = new Map<string, [number, number][]>();
  const lines = text.split('\n');
  let owner: string | undefined;
  let start = 0;
  let braces = 0;
  let opened = false;
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index] ?? '';
    if (owner === undefined) {
      const head = /^(?:declare )?interface (\w+)/.exec(raw)?.[1];
      if (head === undefined) continue;
      owner = head;
      start = index + 1;
      braces = 0;
      opened = false;
    }
    const code = raw.trim();
    if (!code.startsWith('/') && !code.startsWith('*')) {
      braces += code.split('{').length - code.split('}').length;
      // A one-line body (`interface X {}`) opens and closes on the header line.
      if (code.includes('{')) opened = true;
    }
    if (opened && braces <= 0) {
      const list = ranges.get(owner) ?? [];
      list.push([start, index + 1]);
      ranges.set(owner, list);
      owner = undefined;
    }
  }
  return ranges;
}

/** True when `line` lies in one of the declarations of `owner`, merged declarations included. */
function inOwner(line: number, owner: string, ranges: Map<string, [number, number][]>): boolean {
  return (ranges.get(owner) ?? []).some(([first, last]) => line >= first && line <= last);
}

/** Runs `body` on a temporary root that holds `files` (repository-relative paths and their text),
 *  and removes the root afterwards. */
function withRoot(files: Record<string, string>, body: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'capability-sources-'));
  try {
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), text);
    }
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** A fixture as a plain object, for a test that doctors one of its lists and writes the copy out. */
const realJson = (file: string): Record<string, unknown> =>
  JSON.parse(read(file)) as Record<string, unknown>;

// The five sources read through the parsers, which assert no floor. A test of one property takes its
// keys from here, so a truncated source fails the floor test and not every test that reads the source.
const webGpuKeys = (): SourceMember[] => webGpuMembers(parseWebGpuHost(read(WEBGPU_FILE)));
const wgslKeys = (): SourceMember[] => parseWgsl(read(WGSL_FILE));
const glslKeys = (): SourceMember[] => parseGlsl(read(GLSL_FILE));
/** Table D's four core interfaces. */
const webGlCoreKeys = (): SourceMember[] => parseWebGl2Host(read(DOM_FILE), []);
/** Table D: the four core interfaces, then the extensions the fixture selects. */
const webGlTableKeys = (): SourceMember[] =>
  parseWebGl2Host(read(DOM_FILE), parseWebGlExtensions(read(WEBGL_FILE)));

describe('the readers hold their floors', () => {
  it('the floors are the pinned numbers, so a change of one is a reviewed diff of this test', () => {
    expect(FLOORS).toEqual({
      webgpuInterfaces: 100,
      webgpuEnumTypes: 30,
      wgslBuiltinFunctions: 169,
      glslBuiltinFunctions: 89,
      webglExtensions: 40,
    });
  });

  it('table A reads at least its floors of interfaces and enum types', () => {
    const decls = parseWebGpuHost(read(WEBGPU_FILE));
    const interfaces = decls.filter((decl) => decl.kind === 'interface').length;
    const enums = decls.filter((decl) => decl.kind === 'enum').length;
    expect(interfaces).toBeGreaterThanOrEqual(FLOORS.webgpuInterfaces);
    expect(enums).toBeGreaterThanOrEqual(FLOORS.webgpuEnumTypes);
    expect(readWebGpuHost().length).toBeGreaterThanOrEqual(interfaces + enums);
  });

  it('table B reads at least its floor of built-in functions', () => {
    const functions = readWgsl().filter((m) => m.key.startsWith('wgsl:builtinFunctions:'));
    expect(functions.length).toBeGreaterThanOrEqual(FLOORS.wgslBuiltinFunctions);
  });

  it('table C reads at least its floor of built-in functions', () => {
    const functions = readGlsl().filter((m) => m.key.startsWith('glsl:builtinFunctions:'));
    expect(functions.length).toBeGreaterThanOrEqual(FLOORS.glslBuiltinFunctions);
  });

  it('table D holds a member key in each of the four interfaces, and reads at least its floor of extensions', () => {
    const declared = parseWebGlInterfaces(read(DOM_FILE), new Set(CORE_INTERFACES));
    const keyless = CORE_INTERFACES.filter(
      (name) => !(declared.get(name)?.members ?? []).some((member) => member.kind !== 'const'),
    );
    expect(keyless).toEqual([]);
    expect(readWebGlExtensions().length).toBeGreaterThanOrEqual(FLOORS.webglExtensions);
  });

  it('readSources reads all four tables, each under its floor', () => {
    expect(new Set(readSources().map((member) => member.table))).toEqual(
      new Set(['A', 'B', 'C', 'D']),
    );
  });

  it('a truncated source makes its reader throw below the floor, and returns no short list', () => {
    const root = mkdtempSync(join(tmpdir(), 'capability-sources-'));
    try {
      // The first 2000 lines of index.d.ts declare 71 interfaces, under FLOORS.webgpuInterfaces (100).
      mkdirSync(join(root, 'node_modules/@webgpu/types/dist'), { recursive: true });
      writeFileSync(
        join(root, WEBGPU_FILE),
        read(WEBGPU_FILE).split('\n').slice(0, 2000).join('\n'),
      );
      expect(() => readWebGpuHost(root)).toThrow(
        new RegExp(`WebGPU interfaces: read \\d+, below the floor ${FLOORS.webgpuInterfaces}`),
      );
      // A fixture with two applying extensions is under FLOORS.webglExtensions (40) as well.
      mkdirSync(join(root, 'src/core/spec-conformance/fixtures'), { recursive: true });
      writeFileSync(
        join(root, WEBGL_FILE),
        JSON.stringify({
          count: 2,
          extensions: [
            { name: 'OVR_multiview2', status: 'community-approved', webgl2: 'applies' },
            { name: 'OES_draw_buffers_indexed', status: 'community-approved', webgl2: 'applies' },
          ],
        }),
      );
      expect(() => readWebGlExtensions(root)).toThrow(
        new RegExp(`below the floor ${FLOORS.webglExtensions}`),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('a truncated WGSL or GLSL fixture makes its reader throw below the floor', () => {
    const wgsl = realJson(WGSL_FILE);
    const wgslFunctions = wgsl.builtinFunctions as { count: number; names: string[] };
    wgslFunctions.names = wgslFunctions.names.slice(0, 10);
    wgslFunctions.count = 10;
    withRoot({ [WGSL_FILE]: JSON.stringify(wgsl) }, (root) => {
      expect(() => readWgsl(root)).toThrow(
        `WGSL built-in functions: read 10, below the floor ${FLOORS.wgslBuiltinFunctions}`,
      );
    });
    const glsl = realJson(GLSL_FILE);
    const glslFunctions = glsl.builtinFunctions as { count: number; entries: unknown[] };
    glslFunctions.entries = glslFunctions.entries.slice(0, 10);
    glslFunctions.count = 10;
    withRoot({ [GLSL_FILE]: JSON.stringify(glsl) }, (root) => {
      expect(() => readGlsl(root)).toThrow(
        `GLSL ES 3.00 built-in functions: read 10, below the floor ${FLOORS.glslBuiltinFunctions}`,
      );
    });
  });

  it('an index.d.ts with fewer enum types than its floor makes readWebGpuHost throw', () => {
    // The interfaces clear their floor; the two aliases of string literals are the only enum types.
    const interfaces = Array.from(
      { length: FLOORS.webgpuInterfaces },
      (_, i) => `interface I${i} {\n  x: number;\n}`,
    );
    const text = [...interfaces, 'type E1 =\n  | "a"\n  | "b";', 'type E2 = "c";'].join('\n');
    withRoot({ [WEBGPU_FILE]: text }, (root) => {
      expect(() => readWebGpuHost(root)).toThrow(
        `WebGPU enum types: read 2, below the floor ${FLOORS.webgpuEnumTypes}`,
      );
    });
  });
});

describe('each table holds its sentinels', () => {
  it('table A: a method, a descriptor field, a merged member, an enum and a member-less interface', () => {
    const keys = byKey(webGpuKeys());
    expect(keys.get('GPUDevice.createBuffer')?.display).toBe('GPUDevice.createBuffer()');
    expect(keys.get('GPURenderPassEncoder.setScissorRect')?.display).toBe(
      'GPURenderPassEncoder.setScissorRect()',
    );
    expect(keys.get('GPUDepthStencilState.stencilFront')?.display).toBe(
      'GPUDepthStencilState.stencilFront',
    );
    // The first declaration of GPUDevice carries these two; the second does not.
    expect(keys.has('GPUDevice.addEventListener')).toBe(true);
    expect(keys.has('GPUDevice.removeEventListener')).toBe(true);
    expect(keys.get('GPUTextureFormat')?.display).toBe('GPUTextureFormat');
    expect(keys.get('GPUCommandsMixin')?.display).toBe('GPUCommandsMixin');
    // A one-literal alias is an enum type too.
    expect(keys.get('GPUAutoLayoutMode')?.display).toBe('GPUAutoLayoutMode');
    expect([...keys.keys()].filter((key) => key.endsWith('.__brand'))).toEqual([]);
  });

  it('table B: a built-in function, a built-in value, a language extension; no reserved word', () => {
    const keys = byKey(wgslKeys());
    expect(keys.get('wgsl:builtinFunctions:textureSample')?.display).toBe('textureSample()');
    expect(keys.has('wgsl:builtinValues:sample_mask')).toBe(true);
    expect(keys.has('wgsl:languageExtensions:swizzle_assignment')).toBe(true);
    expect([...keys.keys()].filter((key) => key.startsWith('wgsl:reservedWords:'))).toEqual([]);
  });

  it('table C: a function, a variable, and the two `in` qualifiers kept apart by section', () => {
    const keys = byKey(glslKeys());
    expect(keys.has('glsl:builtinFunctions:8.8:texture')).toBe(true);
    expect(keys.has('glsl:builtinFunctions:8.1:radians')).toBe(true);
    expect(keys.has('glsl:builtinVariables:7.2:gl_FragCoord')).toBe(true);
    expect(keys.has('glsl:qualifiers:4.3.4:in')).toBe(true);
    expect(keys.has('glsl:qualifiers:4.4:in')).toBe(true);
  });

  it('table D: a method and a field are keys, and a constant that the list does not name is not', () => {
    const keys = byKey(webGlCoreKeys());
    expect(keys.get('webgl:WebGL2RenderingContextBase.beginTransformFeedback')?.display).toBe(
      'WebGL2RenderingContextBase.beginTransformFeedback()',
    );
    expect(keys.get('webgl:WebGLContextAttributes.preserveDrawingBuffer')?.display).toBe(
      'WebGLContextAttributes.preserveDrawingBuffer',
    );
    expect(keys.has('webgl:WebGL2RenderingContextBase.FLOAT_MAT2x3')).toBe(false);
    expect(keys.has('webgl:WebGLRenderingContextOverloads.bufferData')).toBe(false);
  });
});

describe('the capability constants are keys, and no other constant is', () => {
  it('the listed set is pinned, so a change to it is a reviewed diff of this test', () => {
    expect([...CAPABILITY_CONSTANTS].sort()).toEqual(
      [
        'LINE_LOOP',
        'TRIANGLE_FAN',
        'LUMINANCE',
        'ALPHA',
        'LUMINANCE_ALPHA',
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
        'UNPACK_COLORSPACE_CONVERSION_WEBGL',
      ].sort(),
    );
  });

  it('each listed constant is a key of the one core interface that declares it', () => {
    const keys = webGlCoreKeys().map((member) => member.key);
    for (const name of CAPABILITY_CONSTANTS) {
      const owned = keys.filter((key) => key.endsWith(`.${name}`));
      expect(owned, name).toHaveLength(1);
      expect(owned[0], name).toMatch(
        /^webgl:(WebGL2RenderingContextBase|WebGLRenderingContextBase)\.[A-Z0-9_]+$/,
      );
    }
  });

  it('the constant keys are exactly the listed names, and no other constant of the core interfaces is one', () => {
    const keys = new Set(webGlCoreKeys().map((member) => member.key));
    // The parser reads every constant as `kind: 'const'`, FLOAT_MAT3x2 included, so no name pattern
    // is needed to find them. COLOR_BUFFER_BIT and TRIANGLES are two constants the list does not name.
    const declared = parseWebGlInterfaces(read(DOM_FILE), new Set(CORE_INTERFACES));
    const constants = CORE_INTERFACES.flatMap((name) =>
      (declared.get(name)?.members ?? [])
        .filter((member) => member.kind === 'const')
        .map((member) => ({ key: `webgl:${name}.${member.name}`, name: member.name })),
    );
    const listed = new Set<string>(CAPABILITY_CONSTANTS);
    const constantKeys = constants.filter((c) => keys.has(c.key)).map((c) => c.name);
    expect(constantKeys.sort()).toEqual([...CAPABILITY_CONSTANTS].sort());
    const unlisted = constants.filter((c) => !listed.has(c.name));
    expect(unlisted.map((c) => c.name)).toEqual(
      expect.arrayContaining(['COLOR_BUFFER_BIT', 'TRIANGLES', 'FLOAT_MAT3x2']),
    );
    expect(unlisted.filter((c) => keys.has(c.key))).toEqual([]);
  });
});

describe('the keys are unique and every location holds its key', () => {
  it('the keys of the four tables are unique together, and each table is present', () => {
    const members = [...webGpuKeys(), ...wgslKeys(), ...glslKeys(), ...webGlTableKeys()];
    expect(new Set(members.map((member) => member.table))).toEqual(new Set(['A', 'B', 'C', 'D']));
    expect(() => assertUniqueKeys(members)).not.toThrow();
  });

  it('the line check refuses a line that does not declare its key', () => {
    // The check is the instrument for the location test below: it must say no as well as yes.
    expect(
      declaresKey(
        '  createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer;',
        'GPUDevice.createBuffer',
      ),
    ).toBe(true);
    expect(declaresKey('  readonly __brand: "GPUDevice";', 'GPUDevice.createBuffer')).toBe(false);
    expect(declaresKey('  readonly label: string;', 'GPUDevice.label')).toBe(true);
    expect(declaresKey('type GPUTextureFormat =', 'GPUTextureFormat')).toBe(true);
    expect(declaresKey('interface GPUCommandsMixin {}', 'GPUCommandsMixin')).toBe(true);
  });

  it('every table A location names a line of @webgpu/types that declares its key, in its owner', () => {
    const text = read(WEBGPU_FILE);
    const lines = text.split('\n');
    const ranges = interfaceRanges(text);
    const bad: string[] = [];
    for (const member of webGpuKeys()) {
      const at = fileAndLine(member.location);
      if (at === undefined || at.file !== WEBGPU_FILE) {
        bad.push(`${member.key}: location ${member.location} is not a line of ${WEBGPU_FILE}`);
        continue;
      }
      const owner = ownerOf(member.key);
      const inside = owner === undefined || inOwner(at.line, owner, ranges);
      if (!declaresKey(lines[at.line - 1] ?? '', member.key) || !inside) {
        bad.push(`${member.key} at ${member.location}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('every table D core location names a line of lib.dom.d.ts that declares its key, in its owner', () => {
    const text = read(DOM_FILE);
    const lines = text.split('\n');
    const ranges = interfaceRanges(text);
    const bad: string[] = [];
    for (const member of webGlCoreKeys()) {
      const at = fileAndLine(member.location);
      const owner = ownerOf(member.key);
      if (
        at === undefined ||
        at.file !== DOM_FILE ||
        !declaresKey(lines[at.line - 1] ?? '', member.key) ||
        (owner !== undefined && !inOwner(at.line, owner, ranges))
      ) {
        bad.push(`${member.key} at ${member.location}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('every table B and C location names a section that the fixture holds', () => {
    const bad: string[] = [];
    const sources = new Map<string, string>([
      [WGSL_FILE, read(WGSL_FILE)],
      [GLSL_FILE, read(GLSL_FILE)],
    ]);
    for (const member of [...wgslKeys(), ...glslKeys()]) {
      const m = /^(.+) §(.+)$/.exec(member.location);
      const text = sources.get(m?.[1] ?? '');
      const section = (m?.[2] ?? '').replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
      if (text === undefined || !new RegExp(`"section":\\s*"${section}"`).test(text)) {
        bad.push(`${member.key} at ${member.location}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('the duplicate-key check is an instrument', () => {
  it('a list that names one key twice throws, and names both places', () => {
    const doctored: SourceMember[] = [
      {
        table: 'A',
        key: 'GPUDevice.createBuffer',
        location: `${WEBGPU_FILE}:2664`,
        display: 'GPUDevice.createBuffer()',
      },
      {
        table: 'A',
        key: 'GPUDevice.createBuffer',
        location: `${WEBGPU_FILE}:9999`,
        display: 'GPUDevice.createBuffer()',
      },
    ];
    expect(() => assertUniqueKeys(doctored)).toThrow(
      /duplicate key "GPUDevice\.createBuffer" at .*:2664 and .*:9999/,
    );
  });

  it('a key that two tables share throws as well', () => {
    const doctored: SourceMember[] = [
      { table: 'B', key: 'wgsl:keywords:fn', location: 'x §a', display: 'fn' },
      { table: 'C', key: 'wgsl:keywords:fn', location: 'y §b', display: 'fn' },
    ];
    expect(() => assertUniqueKeys(doctored)).toThrow(/duplicate key "wgsl:keywords:fn"/);
  });

  it('the lists the parsers return pass the same check', () => {
    expect(() => assertUniqueKeys(webGpuKeys())).not.toThrow();
    expect(() => assertUniqueKeys(wgslKeys())).not.toThrow();
    expect(() => assertUniqueKeys(glslKeys())).not.toThrow();
    expect(() => assertUniqueKeys(webGlTableKeys())).not.toThrow();
  });
});

describe('the parsers read the declaration shapes the table relies on', () => {
  it('merges the declarations of one interface, drops __brand and keeps the first line of a name', () => {
    const text = [
      'interface A {',
      '  readonly __brand: "A";',
      '  x(): void;',
      '}',
      'interface A {',
      '  y: number;',
      '  x(): void;',
      '}',
    ].join('\n');
    expect(parseWebGpuHost(text)).toEqual([
      {
        kind: 'interface',
        name: 'A',
        line: 1,
        members: [
          { name: 'x', line: 3, method: true },
          { name: 'y', line: 6, method: false },
        ],
      },
    ]);
  });

  it('an enum type is a union of string literals, one literal counts, and a string literal in another type is refused', () => {
    expect(
      parseWebGpuHost('type E =\n  | "a"\n  | "b";\ntype N = number;\ntype One =\n  "auto";\n'),
    ).toEqual([
      { kind: 'enum', name: 'E', line: 1, values: 2 },
      { kind: 'enum', name: 'One', line: 5, values: 1 },
    ]);
    expect(() => parseWebGpuHost('type S = Record<"a", number>;\n')).toThrow(
      /type S .*not a union/,
    );
  });

  it('a WebGL parameter over several lines is not a member, and a constant is read as a constant', () => {
    const text = [
      'interface W {',
      '    foo(',
      '        target: GLenum,',
      '    ): void;',
      '    readonly FLOAT_MAT2x3: GLenum;',
      '    readonly canvas: number;',
      '    bar: number;',
      '}',
    ].join('\n');
    const decl = parseWebGlInterfaces(text, new Set(['W'])).get('W');
    expect(decl?.members.map((m) => [m.name, m.kind])).toEqual([
      ['foo', 'method'],
      ['FLOAT_MAT2x3', 'const'],
      ['canvas', 'field'],
      ['bar', 'field'],
    ]);
  });

  it('a one-line empty interface keeps no member of the next one, and the next one is read', () => {
    // `interface W {}` opens and closes on its header line, so the body of the next interface is not
    // W's. lib.dom.d.ts writes no such line at the pinned version, so this holds the parser for a
    // later TypeScript.
    const text = ['interface W {}', 'interface Z {', '    a: number;', '}'].join('\n');
    const declared = parseWebGlInterfaces(text, new Set(['W', 'Z']));
    expect(declared.get('W')?.members).toEqual([]);
    expect(declared.get('Z')?.members.map((m) => m.name)).toEqual(['a']);
  });

  it('merges the declarations of one WebGL interface, and keeps the first line of a member', () => {
    const text = [
      'interface W {',
      '    foo(): void;',
      '}',
      'interface W {',
      '    bar: number;',
      '    foo(): void;',
      '}',
    ].join('\n');
    expect(parseWebGlInterfaces(text, new Set(['W'])).get('W')).toEqual({
      name: 'W',
      line: 1,
      members: [
        { name: 'foo', line: 2, kind: 'method' },
        { name: 'bar', line: 5, kind: 'field' },
      ],
    });
  });
});

describe('no member line of the pinned declarations is left unread', () => {
  it('the scanner sees a generic member the reader does not read, so the check below would fail on it', () => {
    const text = ['interface X {', '  only<T>(value: T): void;', '}'].join('\n');
    expect(depthOneNames(text).get('X')).toEqual(new Set(['only']));
    expect(parseWebGpuHost(text)).toEqual([{ kind: 'interface', name: 'X', line: 1, members: [] }]);
  });

  it('table A reads every depth-one member line of @webgpu/types, generic overloads included', () => {
    const text = read(WEBGPU_FILE);
    const seen = depthOneNames(text);
    const missed: string[] = [];
    for (const decl of parseWebGpuHost(text)) {
      if (decl.kind !== 'interface') continue;
      const readNames = new Set(decl.members.map((m) => m.name));
      for (const name of seen.get(decl.name) ?? []) {
        if (name !== '__brand' && !readNames.has(name)) missed.push(`${decl.name}.${name}`);
      }
    }
    expect(missed).toEqual([]);
  });

  it('table D reads every depth-one member line of the four interfaces', () => {
    const text = read(DOM_FILE);
    const seen = depthOneNames(text);
    const declared = parseWebGlInterfaces(text, new Set(CORE_INTERFACES));
    const missed: string[] = [];
    for (const name of CORE_INTERFACES) {
      const readNames = new Set(declared.get(name)?.members.map((m) => m.name) ?? []);
      for (const seenName of seen.get(name) ?? []) {
        if (!readNames.has(seenName)) missed.push(`${name}.${seenName}`);
      }
    }
    expect(missed).toEqual([]);
  });
});

describe('the table D extensions', () => {
  it('every extension location names a line of lib.dom.d.ts that declares its key, in its owner, or its fixture entry', () => {
    const text = read(DOM_FILE);
    const lines = text.split('\n');
    const ranges = interfaceRanges(text);
    const bad: string[] = [];
    for (const member of webGlTableKeys()) {
      const at = fileAndLine(member.location);
      if (at === undefined) {
        if (member.location !== `${WEBGL_FILE} §${declaredName(member.key)}`) bad.push(member.key);
        continue;
      }
      const owner = ownerOf(member.key);
      if (
        at.file !== DOM_FILE ||
        !declaresKey(lines[at.line - 1] ?? '', member.key) ||
        (owner !== undefined && !inOwner(at.line, owner, ranges))
      ) {
        bad.push(`${member.key} at ${member.location}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('each extension that applies is keyed by its members, or by its own name', () => {
    const keys = webGlTableKeys().map((member) => member.key);
    const missing = parseWebGlExtensions(read(WEBGL_FILE))
      .filter(
        (extension) =>
          !keys.includes(`webgl:${extension.name}`) &&
          !keys.some((key) => key.startsWith(`webgl:${extension.name}.`)),
      )
      .map((extension) => extension.name);
    expect(missing).toEqual([]);
  });

  it('every depth-one member line of each extension interface is read', () => {
    const text = read(DOM_FILE);
    const seen = depthOneNames(text);
    const names = parseWebGlExtensions(read(WEBGL_FILE)).map((extension) => extension.name);
    const declared = parseWebGlInterfaces(text, new Set(names));
    const missed: string[] = [];
    for (const name of names) {
      const readNames = new Set(declared.get(name)?.members.map((m) => m.name) ?? []);
      for (const seenName of seen.get(name) ?? []) {
        if (!readNames.has(seenName)) missed.push(`${name}.${seenName}`);
      }
    }
    expect(missed).toEqual([]);
  });
});

describe('the extension rule is held to the fixture, without the floor', () => {
  // The rule for table D's extensions, written again here from the fixture's own fields, so a change
  // to the reader's filter cannot also change the expectation.
  const RULE_LABELS = ['applies', 'inherits'];
  const RULE_STATUSES = ['ratified', 'community-approved', 'draft'];
  const fixtureEntries = () =>
    (
      JSON.parse(read(WEBGL_FILE)) as {
        extensions: { name: string; status: string; webgl2: string }[];
      }
    ).extensions;
  const selectedNames = () => parseWebGlExtensions(read(WEBGL_FILE)).map((e) => e.name);
  const keysFor = () => byKey(webGlTableKeys());
  const keysOf = (name: string, keys: Map<string, SourceMember>) =>
    [...keys.keys()].filter((key) => key === `webgl:${name}` || key.startsWith(`webgl:${name}.`));

  it('selects the fixture entries whose label is applies or inherits, with one of the three statuses, and no others', () => {
    const expected = fixtureEntries()
      .filter((e) => RULE_LABELS.includes(e.webgl2) && RULE_STATUSES.includes(e.status))
      .map((e) => e.name);
    expect(expected.length).toBeGreaterThan(0);
    expect(selectedNames()).toEqual(expected);
    expect(selectedNames().length).toBe(expected.length);
  });

  it('selects an applying extension by name, and drops a core, a removed, a proposal and a rejected one', () => {
    const selected = selectedNames();
    expect(selected).toContain('OVR_multiview2');
    expect(selected).toContain('OES_draw_buffers_indexed');
    expect(selected).not.toContain('ANGLE_instanced_arrays'); // core in WebGL 2
    expect(selected).not.toContain('WEBGL_depth_texture'); // removed in WebGL 2
    expect(selected).not.toContain('EXT_texture_norm16_dom_source'); // a proposal that applies
    expect(selected).not.toContain('WEBGL_texture_multisample'); // a rejected extension that applies
  });

  it('selects an extension that inherits its WebGL 2 status, and drops one the registry does not expose', () => {
    const selected = selectedNames();
    expect(selected).toContain('EXT_texture_filter_anisotropic'); // inherits, ratified
    expect(selected).toContain('WEBGL_lose_context'); // inherits, ratified
    expect(selected).not.toContain('EXT_disjoint_timer_query'); // no: WebGL 1.0 contexts only
    expect(selected).not.toContain('WEBGL_color_buffer_float'); // subsumed
  });

  it('refuses a fixture whose count differs from the entries it holds', () => {
    const text = JSON.stringify({
      count: 3,
      extensions: [{ name: 'OVR_multiview2', status: 'community-approved', webgl2: 'applies' }],
    });
    expect(() => parseWebGlExtensions(text)).toThrow(/says count 3 and holds 1/);
  });

  it('keys an applying extension by its members, and keys none of the dropped ones', () => {
    const keys = keysFor();
    expect(keys.has('webgl:OVR_multiview2.framebufferTextureMultiviewOVR')).toBe(true);
    expect(keys.has('webgl:OES_draw_buffers_indexed.blendFunciOES')).toBe(true);
    expect(keysOf('EXT_texture_filter_anisotropic', keys)).not.toEqual([]);
    for (const name of [
      'ANGLE_instanced_arrays',
      'WEBGL_depth_texture',
      'EXT_texture_norm16_dom_source',
      'WEBGL_texture_multisample',
    ]) {
      expect(keysOf(name, keys)).toEqual([]);
    }
  });
});

describe('the refusals hold on doctored text, and the instruments see it', () => {
  // Each refusal runs a parser, or `readWebGlInterfaces` on a doctored root. Neither asserts a floor,
  // so a check removed from one of them fails its own refusal test and no other.
  it('a WGSL fixture that names one key twice makes parseWgsl throw', () => {
    const fixture = realJson(WGSL_FILE);
    const functions = fixture.builtinFunctions as { count: number; names: string[] };
    const first = functions.names[0] ?? '';
    functions.names.push(first);
    functions.count += 1;
    expect(() => parseWgsl(JSON.stringify(fixture))).toThrow(
      `duplicate key "wgsl:builtinFunctions:${first}"`,
    );
  });

  it('a GLSL fixture that names one key twice makes parseGlsl throw', () => {
    const fixture = realJson(GLSL_FILE);
    const functions = fixture.builtinFunctions as {
      count: number;
      entries: { name: string; section: string }[];
    };
    const first = functions.entries[0];
    if (first === undefined) throw new Error('the GLSL fixture holds no built-in function');
    functions.entries.push({ ...first });
    functions.count += 1;
    expect(() => parseGlsl(JSON.stringify(fixture))).toThrow(
      `duplicate key "glsl:builtinFunctions:${first.section}:${first.name}"`,
    );
  });

  it('a WGSL fixture with a counted list that table B does not read makes parseWgsl throw', () => {
    // `reservedWords` has a count too, and is the one counted list table B may skip.
    expect(() => parseWgsl(read(WGSL_FILE))).not.toThrow();
    const fixture = realJson(WGSL_FILE);
    fixture.extraList = { section: '9.9', count: 1, names: ['extra'] };
    expect(() => parseWgsl(JSON.stringify(fixture))).toThrow(
      'list extraList has a count and is not read by table B',
    );
  });

  it('a list whose count is missing or differs from its entries, or that is empty, throws', () => {
    const wgsl = realJson(WGSL_FILE);
    (wgsl.keywords as { count: number }).count = 999;
    expect(() => parseWgsl(JSON.stringify(wgsl))).toThrow(
      /list keywords says count 999 and holds \d+/,
    );
    const glsl = realJson(GLSL_FILE);
    delete (glsl.types as { count?: number }).count;
    expect(() => parseGlsl(JSON.stringify(glsl))).toThrow('list types says count undefined');
    const emptied = realJson(WGSL_FILE);
    const keywords = emptied.keywords as { count: number; names: string[] };
    keywords.names = [];
    keywords.count = 0;
    expect(() => parseWgsl(JSON.stringify(emptied))).toThrow(
      'list keywords is missing or holds no entries',
    );
  });

  it('a GLSL fixture that lost one of its four required lists, or emptied one, makes parseGlsl throw', () => {
    for (const list of ['builtinFunctions', 'builtinVariables', 'types', 'qualifiers']) {
      const lost = realJson(GLSL_FILE);
      delete lost[list];
      expect(() => parseGlsl(JSON.stringify(lost))).toThrow(
        `list ${list} is missing or holds no entries`,
      );
      const emptied = realJson(GLSL_FILE);
      emptied[list] = { section: '0', count: 0, entries: [] };
      expect(() => parseGlsl(JSON.stringify(emptied))).toThrow(
        `list ${list} is missing or holds no entries`,
      );
    }
  });

  it('a lib.dom.d.ts without one of the four WebGL interfaces makes readWebGlInterfaces throw', () => {
    const text = read(DOM_FILE);
    const renamed = text.replace(
      'interface WebGLContextAttributes {',
      'interface WebGLContextAttributesRenamed {',
    );
    expect(renamed).not.toBe(text);
    withRoot({ [DOM_FILE]: renamed }, (root) => {
      expect(() => readWebGlInterfaces(root)).toThrow(
        'interface WebGLContextAttributes is not declared',
      );
    });
  });

  it('a lib.dom.d.ts whose WebGLContextAttributes holds no member makes readWebGlInterfaces throw', () => {
    // The header and the closing brace stay; the members between them go. The interface's keys would
    // fall back to its own name, which is the defect the check names.
    const lines = read(DOM_FILE).split('\n');
    const start = lines.indexOf('interface WebGLContextAttributes {');
    const end = lines.indexOf('}', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start + 1);
    const emptied = [...lines.slice(0, start + 1), ...lines.slice(end)].join('\n');
    withRoot({ [DOM_FILE]: emptied }, (root) => {
      expect(() => readWebGlInterfaces(root)).toThrow(
        `interface WebGLContextAttributes in ${DOM_FILE} holds no member key`,
      );
    });
  });

  it('a lib.dom.d.ts without LINE_LOOP makes readWebGlInterfaces throw, and the pinned text does not', () => {
    const text = read(DOM_FILE);
    const kept = text.split('\n').filter((line) => !/^\s*readonly LINE_LOOP:/.test(line));
    // Three lines declare LINE_LOOP: one in WebGLRenderingContextBase and two in `declare var` objects.
    expect(text.split('\n').length - kept.length).toBe(3);
    expect(() => readWebGlInterfaces()).not.toThrow();
    withRoot({ [DOM_FILE]: kept.join('\n') }, (root) => {
      expect(() => readWebGlInterfaces(root)).toThrow(
        'constant LINE_LOOP is declared by 0 of the four core WebGL interfaces',
      );
    });
  });

  it('a constant that two core interfaces declare makes parseWebGl2Host throw', () => {
    const text = read(DOM_FILE);
    const doubled = text.replace(
      'interface WebGL2RenderingContextBase {',
      'interface WebGL2RenderingContextBase {\n    readonly LINE_LOOP: 0x0002;',
    );
    expect(doubled).not.toBe(text);
    expect(() => parseWebGl2Host(doubled, [])).toThrow(
      'constant LINE_LOOP is declared by 2 of the four core WebGL interfaces',
    );
  });

  it('the owner-range check sees a line of another interface that declares the same name', () => {
    const text = [
      'interface A {',
      '  label: string;',
      '}',
      'interface B {',
      '  label: string;',
      '}',
    ].join('\n');
    const ranges = interfaceRanges(text);
    expect(ranges.get('A')).toEqual([[1, 3]]);
    expect(ranges.get('B')).toEqual([[4, 6]]);
    expect(inOwner(2, 'A', ranges)).toBe(true);
    // Line 5 declares `label` too, but in B: a location there is wrong for `A.label`.
    expect(inOwner(5, 'A', ranges)).toBe(false);
  });

  it('a merged interface has one range per declaration, and a one-line body is a range of its own', () => {
    const text = [
      'interface A {',
      '  x: number;',
      '}',
      'interface A {',
      '  y: number;',
      '}',
      'interface W {}',
    ].join('\n');
    const ranges = interfaceRanges(text);
    expect(ranges.get('A')).toEqual([
      [1, 3],
      [4, 6],
    ]);
    expect(ranges.get('W')).toEqual([[7, 7]]);
    expect(ownerOf('GPUDevice.createBuffer')).toBe('GPUDevice');
    expect(ownerOf('webgl:OES_x.blend')).toBe('OES_x');
    expect(ownerOf('GPUTextureFormat')).toBeUndefined();
  });
});

describe('the configuration is pinned, and a missing fixture is refused by name', () => {
  it('pins typescript and @webgpu/types to their exact devDependencies, and the fixtures to a commit', () => {
    const pkg = JSON.parse(read('package.json')) as { devDependencies: Record<string, string> };
    expect(PINNED.typescript.version).toBe(pkg.devDependencies['typescript']);
    expect(PINNED.webgpuTypes.version).toBe(pkg.devDependencies['@webgpu/types']);
    expect(PINNED.wgsl.specCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(PINNED.glsl.specCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(PINNED.webgl.registryCommit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('a missing file is refused with its name', () => {
    const nowhere = join(ROOT, 'no-such-root');
    expect(() => readWebGpuHost(nowhere)).toThrow(/index\.d\.ts/);
    expect(() => readWgsl(nowhere)).toThrow(/wgsl-names\.json/);
    expect(() => readGlsl(nowhere)).toThrow(/glsl-es300-names\.json/);
    expect(() => readWebGlExtensions(nowhere)).toThrow(/webgl-extensions\.json/);
  });
});
