// Verifies: Rule 8.21 (docs/language-design.md; traced in reqs/).

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { hostFace } from './host-face.js';
import { compile } from './compile.js';
import { buildManifest } from '../../core/manifest.js';
import { layoutFromPack } from '../../core/manifest-types.js';
import { Misfit, pack as packBytes } from '../../core/host-entry.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { tscDiagnostics } from '../../core/testing/tsc-diagnostics.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');

const FAMILY = resolve(__dirname, '../../runtime/host-types.ts');

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function face(source: string, name = 'm') {
  const f = hostFace(source, { fileName: `/app/${name}.shade.ts`, runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return f as Required<typeof f>;
}

async function load(source: string): Promise<Record<string, unknown>> {
  const f = face(source);
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-host-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, f.code);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>;
}

async function hostErrors(source: string, host: string): Promise<string[]> {
  const f = face(source, 'terrain');
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-view-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'terrain.shade.ts'), source);
  writeFileSync(join(dir, 'terrain.shade.typeshade.ts'), f.view);
  writeFileSync(join(dir, 'app.ts'), host);
  const diagnostics = await tscDiagnostics([join(dir, 'app.ts')], {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    moduleSuffixes: ['.typeshade', ''],
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    types: [],
  });
  return diagnostics.map(
    (d) => `${d.fileName ? d.fileName.slice(dir.length + 1) : ''} TS${d.code}`,
  );
}

function hover(
  view: string,
  host: string,
  at: string,
): { documentation: string; errors: string[] } {
  const files = new Map([
    ['/app/m.shade.typeshade.ts', view],
    [
      '/app/runtime.ts',
      `export interface Buffer<T> { readonly element?: T }\nexport type Pack<T> = T;\nexport type * from ${JSON.stringify(FAMILY)};\n`,
    ],
    ['/app/app.ts', host],
  ]);
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    moduleSuffixes: ['.typeshade', ''],
    lib: ['lib.es2022.d.ts'],
    types: [],
  };
  const service = ts.createLanguageService({
    getScriptFileNames: () => ['/app/app.ts'],
    getScriptVersion: () => '1',
    getScriptSnapshot: (name) => {
      const text = files.get(name) ?? ts.sys.readFile(name);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => '/app',
    getCompilationSettings: () => options,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: (name) => files.has(name) || ts.sys.fileExists(name),
    readFile: (name) => files.get(name) ?? ts.sys.readFile(name),
    directoryExists: (name) => name === '/app' || ts.sys.directoryExists(name),
  });
  const errors = ['/app/app.ts', '/app/m.shade.typeshade.ts'].flatMap((name) => [
    ...service.getSyntacticDiagnostics(name),
    ...service.getSemanticDiagnostics(name),
  ]);
  const position = host.indexOf(at);
  expect(position, `the host program has ${at}`).toBeGreaterThan(-1);
  const info = service.getQuickInfoAtPosition('/app/app.ts', position);
  service.dispose();
  return {
    documentation: ts.displayPartsToString(info?.documentation ?? []),
    errors: errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')),
  };
}

describe('a private name beside a public member of its name (change 0109, Amendment 2, #971)', () => {
  const COUNTER = `"use typeshade";

export class Counter {
  /** The count so far. */
  #n: u32 = 0;
  /** The count, read through the accessor. */
  get n(): u32 {
    return this.#n;
  }
  /** Counts once. */
  tick(): u32 {
    this.#n = this.#n + 1;
    return this.#n;
  }
}

export function level(c: Counter): u32 {
  return c.n;
}
`;

  const GAUGE = `"use typeshade";

export class Gauge {
  /** The level. */
  #level: f32 = 0.;
  /** Reads the level. */
  level(): f32 {
    return this.#level;
  }
  /** The id, which nothing changes. */
  readonly #id: u32 = 7;
  /** The scale, public. */
  scale: f32 = 1.;
  /** Sets the level. */
  set(v: f32): void {
    this.#level = v;
  }
}
`;

  const HIDDEN = `"use typeshade";

class Hidden {
  #x: f32 = 0.;
  y: f32 = 1.;
  get x(): f32 {
    return this.#x;
  }
}

export function peek(h: Hidden): f32 {
  return h.x;
}

export function make(): Hidden {
  return new Hidden();
}
`;

  it('is taken by both halves of the shader, the compiler and the editor (Rule 12.7)', () => {
    for (const [name, source] of Object.entries({ COUNTER, GAUGE, HIDDEN })) {
      expect([name, compile(source, { fileName: 'm.shade.ts' }).diagnostics]).toEqual([name, []]);
      const service = createTypeshadeLanguageService();
      service.openDocument('m.shade.ts', source);
      expect([name, service.getDiagnostics('m.shade.ts')]).toEqual([name, []]);
    }
  });

  it('declares the private name as itself beside the accessor of its name, with its comment', () => {
    const v = face(COUNTER).view;
    expect(v).toContain(`export declare class Counter {
  constructor();
  /** The count so far. */
  #n: u32;
  /** The count, read through the accessor. */
  get n(): u32;
  /** Counts once. */
  tick(): u32;
}
`);
    expect(v).not.toMatch(/\bprivate n\b/);
  });

  it('declares the private name as itself beside a method of its name, and keeps each comment on its line', () => {
    const v = face(GAUGE).view;
    expect(v).toContain(`export declare class Gauge {
  constructor();
  /** The level. */
  #level: f32;
  /** The id, which nothing changes. */
  readonly #id: u32;
  /** The scale, public. */
  scale: f32;
  /** Reads the level. */
  level(): f32;
  /** Sets the level. */
  set(v: f32): void;
}
`);
  });

  it('is type-checked by tsc: a host reads the accessor and cannot name the field', async () => {
    expect(
      await hostErrors(
        COUNTER,
        `import { Counter, level } from './terrain.shade.ts';
const c = new Counter();
export const n: number = c.n;
export const t: number = c.tick();
export const l: number = level(c);
export const a = c.#n;
export const b = level({ n: 1 });
`,
      ),
    ).toEqual(['app.ts TS18013', 'app.ts TS2345']);
  });

  it('is type-checked by tsc beside a method of the name of a private field', async () => {
    expect(
      await hostErrors(
        GAUGE,
        `import { Gauge } from './terrain.shade.ts';\nconst g = new Gauge();\nexport const v: number = g.level() + g.scale;\ng.set(2);\n`,
      ),
    ).toEqual([]);
  });

  it('shows the accessor on hover over the read of a name the field shares, in the editor', () => {
    const f = face(COUNTER);
    const host = `import { Counter } from './m.shade.ts';
const c = new Counter();
export const v = c.n;
`;
    const read = hover(f.view, host, 'n;');
    expect(read.errors).toEqual([]);
    expect(read.documentation).toBe('The count, read through the accessor.');
  });

  it('reads c.n in the shader as the accessor, in both halves (Rule 12.7)', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('m.shade.ts', COUNTER);
    const at = COUNTER.indexOf('c.n;') + 2;
    const shown =
      service.getHover('m.shade.ts', service.positionAt('m.shade.ts', at))?.contents ?? '';
    expect(shown).toContain('u32');
    expect(shown).toContain('The count, read through the accessor.');
    expect(shown).not.toContain('The count so far.');
    const level = compile(COUNTER, { fileName: 'm.shade.ts' }).module.funcs.find(
      (f) => f.name === 'level',
    );
    const body = level?.body[0];
    expect(body).toMatchObject({
      s: 'return',
      expr: { op: 'call', fn: 'Counter_get_n', type: { kind: 'scalar', scalar: 'u32' } },
    });
  });

  it('spells a class no export declares by its fields, a private name as a quoted key', async () => {
    const f = face(HIDDEN);
    expect(f.view).toContain(
      'export declare function peek(h: { readonly "#x": f32; readonly y: f32 }): f32;',
    );
    expect(f.view).toContain('export declare function make(): { "#x": f32; y: f32 };');
    expect(
      await hostErrors(
        HIDDEN,
        `import { make, peek } from './terrain.shade.ts';
export const a: number = peek(make());
const plain = { x: 0, y: 1 };
export const b = peek(plain);
`,
      ),
    ).toEqual(['app.ts TS2345']);
    const m = await load(HIDDEN);
    const made = (m.make as () => object)();
    expect(Object.keys(made)).toEqual(['#x', 'y']);
    expect((m.peek as (h: object) => number)(made)).toBe(0);
    expect(() => (m.peek as (h: object) => number)({ x: 0, y: 1 })).toThrow(
      new TypeError(
        'peek(): parameter "h" (Hidden): at .#x, the field is missing. "#x" is a private name, which an instance holds and a plain object does not. Build the value with new.',
      ),
    );
  });

  const BINDINGS = `"use typeshade";

export class Gain {
  #g: f32 = 1.;
  get g(): f32 {
    return this.#g;
  }
  scale: f32 = 2.;
}

declare const gain: uniform<Gain>;
declare const bank: storage<array<Gain>, "read_write">;
declare const buf: storage<array<f32>, "read_write">;

@compute([64]) export function scaled(gid: builtin<"global_invocation_id">) {
  if (gid.x >= buf.length) {
    return;
  }
  buf[gid.x] = buf[gid.x] * gain.g * bank[0].scale;
}
`;

  it('names the private field by its host key in the layouts of the call layer, the WebGL2 pass program among them, and moves no byte', async () => {
    const f = face(BINDINGS);
    const entry = f.exports.find((e) => e.name === 'scaled');
    expect(entry?.kind).toBe('compute');
    if (entry?.kind !== 'compute') return;
    const names = (l: unknown): string[] =>
      [...JSON.stringify(l).matchAll(/\["(#?[a-z]+)",\d+,/g)].map((x) => x[1]!);
    const gain = entry.entry.bindings.find((b) => b.name === 'gain');
    expect(gain && 'layout' in gain ? names(gain.layout) : []).toEqual(['#g', 'scale']);
    const program = entry.entry.gl;
    expect(program).toBeDefined();
    if (program === undefined) return;
    const uniform = program.uniforms.find((u) => u.name === 'gain')!;
    expect(JSON.stringify(uniform.layout)).toContain('"name":"#g"');
    const own = compile(BINDINGS).module;
    const plain = buildManifest(own, {}, compile(BINDINGS).wgsl);
    const was = plain.gl?.computes?.scaled;
    expect(was && !('none' in was) ? JSON.stringify(was.uniforms[0]!.layout) : '').toBe(
      JSON.stringify(uniform.layout).replaceAll('"#g"', '"g"'),
    );
    const m = await load(BINDINGS);
    const Gain = m.Gain as new () => object;
    const layout = layoutFromPack(uniform.layout);
    const bytes = new DataView(new ArrayBuffer(16));
    packBytes(bytes, 0, layout, new Gain(), 'gain');
    expect([bytes.getFloat32(0, true), bytes.getFloat32(4, true)]).toEqual([1, 2]);
    expect(() => packBytes(bytes, 0, layout, { g: 1, scale: 2 }, 'gain')).toThrow(Misfit);
    const manifest = m.default as typeof plain;
    expect(JSON.stringify(manifest.bindings.map((b) => b.layout))).toBe(
      JSON.stringify(plain.bindings.map((b) => b.layout)),
    );
    expect(JSON.stringify(manifest.bindings)).not.toContain('"#g"');
  });
  it('gives a host program no member of the private name, so c.n is the accessor alone', () => {
    const f = face(COUNTER);
    const named = `import { Counter } from './m.shade.ts';
const c = new Counter();
const v = c.n;
export { v };
`;
    expect(hover(f.view, named, 'n;').errors).toEqual([]);
    const field = named.replace('c.n;', 'c.level;');
    expect(hover(f.view, field, 'level;').errors).toEqual([
      "Property 'level' does not exist on type 'Counter'.",
    ]);
  });
});
