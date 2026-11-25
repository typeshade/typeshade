import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import type { DrawBinding } from './host-entry.js';
import type { ModuleDecl } from './ir/nodes.js';
import type { ShaderType, StructDecl } from './ir/index.js';
import {
  buildManifest,
  calleesOf,
  closureOf,
  dataTextureOf,
  glDrawOf,
  glVertexOf,
  layoutOf,
} from './manifest.js';

const moduleOf = (source: string): ModuleDecl => {
  const r = compile(source, { fileName: 'invariants.shade.ts' });
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return r.module!;
};

const names = (bs: readonly { name: string }[] | undefined) => bs?.map((b) => b.name);

const F64_TWO_KERNELS = `"use typeshade";
declare const out: storage<array<f32>, "read_write">;
@compute([1]) export function wide(gid: builtin<"global_invocation_id">) {
  const x: f64 = f64(f32(gid.x)) * 1.5;
  console.log("x", f32(x));
  out[gid.x] = f32(x);
}
@compute([1]) export function plain(gid: builtin<"global_invocation_id">) {
  out[gid.x] = 1.;
}
`;

const DRAW_AND_STORING_KERNEL = `"use typeshade";
class Frame { t: f32; }
declare const frame: uniform<Frame>;
declare const data: storage<array<f32>, "read_write">;
@compute([1]) export function store(gid: builtin<"global_invocation_id">) { data[gid.x] = 1.; }
interface VsOut { pos: builtin<"position">; }
@vertex export function vs(v: builtin<"vertex_index">): VsOut {
  return { pos: vec4(f32(v), 0., 0., 1.) };
}
@fragment export function fs(): vec4 { return vec4(frame.t, 0., 0., 1.); }
`;

const RESPELLED_NAMES = `"use typeshade";
class Frame { t: f32; }
declare const buffer: uniform<Frame>;
declare const buffer_: storage<array<f32>, "read_write">;
@compute([1]) export function store(gid: builtin<"global_invocation_id">) {
  buffer_[gid.x] = 1.;
}
@fragment export function fs(): vec4 { return vec4(buffer.t, 0., 0., 1.); }
`;

const entryArguments = (m: ModuleDecl, name: string) => {
  const declared = new Set(m.funcs.map((f) => f.name));
  const callees = new Map(m.funcs.map((f) => [f.name, calleesOf(f, declared)]));
  return {
    f: m.funcs.find((f) => f.name === name)!,
    closure: closureOf(name, callees),
    byName: new Map(m.funcs.map((f) => [f.name, f])),
    declared,
  };
};

const uniformBinding = (name: string): DrawBinding => ({
  name,
  group: 0,
  binding: 0,
  space: 'uniform',
  writes: false,
  layout: { k: 's', t: 'u32' },
  s: 'u32',
});

const storageBinding = (name: string): DrawBinding => ({
  name,
  group: 0,
  binding: 1,
  space: 'storage',
  writes: false,
  layout: { k: 'a', n: null, st: 4, e: { k: 's', t: 'f32' } },
  s: 'array<f32>',
});

const textureBinding = (name: string, guard = false): DrawBinding => ({
  name,
  group: 0,
  binding: 2,
  space: 'texture',
  s: 'texture_2d<f32>',
  ...(guard ? { guard: true as const } : {}),
});

describe('the byte layout of an emulated f64', () => {
  const structs = new Map<string, StructDecl>();
  const layout = (t: ShaderType, kind: 'std140' | 'std430' = 'std430') =>
    layoutOf(t, kind, structs);

  it('puts the lo plane of a vecN<f64> at the aligned size of the hi plane', () => {
    expect(layout({ kind: 'f64' })).toEqual({ k: 's', t: 'f64' });
    expect(layout({ kind: 'vec64', n: 2 })).toEqual({ k: 'v', n: 2, t: 'f64', lo: 8 });
    expect(layout({ kind: 'vec64', n: 3 })).toEqual({ k: 'v', n: 3, t: 'f64', lo: 16 });
    expect(layout({ kind: 'vec64', n: 4 })).toEqual({ k: 'v', n: 4, t: 'f64', lo: 16 });
  });
});

describe('the WebGL2 data texture of a read-only storage array', () => {
  const structs = new Map<string, StructDecl>([
    [
      'Lanes',
      {
        name: 'Lanes',
        fields: [
          { name: 'a', type: { kind: 'scalar', scalar: 'f32' } },
          { name: 'b', type: { kind: 'vec', n: 3, elem: 'f32' } },
        ],
      } as StructDecl,
    ],
    [
      'Bad',
      {
        name: 'Bad',
        fields: [{ name: 'a', type: { kind: 'vec', n: 2, elem: 'u32' } }],
      } as StructDecl,
    ],
  ]);
  const storage = (elem: ShaderType, access: 'read' | 'read_write' = 'read') =>
    ({
      name: 's',
      space: 'storage',
      access,
      type: { kind: 'array', elem },
    }) as Parameters<typeof dataTextureOf>[0];

  it('is one lane for a scalar, and its own width for a vector, three padded to four', () => {
    expect(dataTextureOf(storage({ kind: 'scalar', scalar: 'f32' }), structs)).toEqual({
      format: 'r32float',
      lanes: 1,
    });
    expect(dataTextureOf(storage({ kind: 'scalar', scalar: 'u32' }), structs)).toEqual({
      format: 'r32uint',
      lanes: 1,
    });
    expect(dataTextureOf(storage({ kind: 'scalar', scalar: 'i32' }), structs)).toEqual({
      format: 'r32sint',
      lanes: 1,
    });
    expect(dataTextureOf(storage({ kind: 'vec', n: 2, elem: 'f32' }), structs)?.lanes).toBe(2);
    expect(dataTextureOf(storage({ kind: 'vec', n: 3, elem: 'f32' }), structs)?.lanes).toBe(4);
    expect(dataTextureOf(storage({ kind: 'vec', n: 4, elem: 'f32' }), structs)?.lanes).toBe(4);
  });

  it('is the std430 stride in r32float lanes for a struct of f32, u32 and vecN<f32>', () => {
    expect(dataTextureOf(storage({ kind: 'struct', name: 'Lanes' }), structs)).toEqual({
      format: 'r32float',
      lanes: 8,
    });
  });

  it('has none for a read_write array, a struct of another field and another element', () => {
    expect(
      dataTextureOf(storage({ kind: 'scalar', scalar: 'f32' }, 'read_write'), structs),
    ).toBeUndefined();
    expect(dataTextureOf(storage({ kind: 'struct', name: 'Bad' }), structs)).toBeUndefined();
    expect(dataTextureOf(storage({ kind: 'struct', name: 'Gone' }), structs)).toBeUndefined();
    expect(dataTextureOf(storage({ kind: 'scalar', scalar: 'bool' }), structs)).toBeUndefined();
    expect(dataTextureOf(storage({ kind: 'vec', n: 2, elem: 'u32' }), structs)).toBeUndefined();
  });
});

describe('the _fp64 guard of a manifest', () => {
  const m = moduleOf(F64_TWO_KERNELS);

  it('is bound for every entry of a module that emulates f64, not only the one that reads it', () => {
    const p = buildManifest(m);
    expect(names(p.entries.find((e) => e.name === 'wide')!.bindings)).toEqual(['out', '_fp64']);
    expect(names(p.entries.find((e) => e.name === 'plain')!.bindings)).toEqual(['out', '_fp64']);
    const guard = p.bindings.find((b) => b.name === '_fp64')!;
    expect(guard.injected).toBe(true);
    expect(guard.type).toBe('texture_2d<f32>');
  });

  it('is bound by no entry under the integer flavor', () => {
    const p = buildManifest(m, { emit: { fp64Flavor: 'integer' } });
    expect(names(p.entries.find((e) => e.name === 'plain')!.bindings)).toEqual(['out']);
    expect(names(p.bindings)).toEqual(['out']);
  });
});

describe('the options of packModule()', () => {
  const m = moduleOf(F64_TWO_KERNELS);

  it('records the console variant as the default one for true, as an option for the default', () => {
    const on = buildManifest(m, { console: true });
    expect(on.console).toBeDefined();
    expect(on.variants).toBeUndefined();
    const dflt = buildManifest(m);
    expect(dflt.console).toBeUndefined();
    expect(dflt.variants?.console).toEqual(on.console);
  });

  it('leaves the console variant off for false and omits it for never', () => {
    for (const option of [false, 'never'] as const) {
      const p = buildManifest(m, { console: option });
      if (option === 'never') {
        expect(p.console).toBeUndefined();
        expect(p.variants).toBeUndefined();
      } else {
        expect(p.console).toBeUndefined();
        expect(p.variants?.console).toBeDefined();
      }
    }
  });

  it('adds the portable IR on request only, after every other field', () => {
    expect(buildManifest(m)).not.toHaveProperty('ir');
    expect(buildManifest(m, { ir: false })).not.toHaveProperty('ir');
    const keys = Object.keys(buildManifest(m, { ir: true }));
    expect(keys[keys.length - 1]).toBe('ir');
  });
});

describe('the WebGL2 programs of a module whose writer refuses it whole', () => {
  const m = moduleOf(DRAW_AND_STORING_KERNEL);

  it('keeps the vertex and fragment programs of the entries, and has no pair', () => {
    const p = buildManifest(m);
    expect(p.glsl).toBeUndefined();
    const vertex = p.gl?.vertices?.['vs'];
    const draw = p.gl?.draws?.['fs'];
    expect(vertex).toBeDefined();
    expect(vertex).not.toHaveProperty('none');
    expect(draw).toBeDefined();
    expect(draw).not.toHaveProperty('none');
    expect((draw as { fragment: string }).fragment).not.toContain('data');
    expect((draw as { blocks: object }).blocks).toEqual({ frame: 'Frame' });
  });

  it('emits an entry on its own from what it reaches, so a storage array another entry writes is no part of it', () => {
    const { f, closure, byName, declared } = entryArguments(m, 'fs');
    const draw = glDrawOf(m, f, [uniformBinding('frame')], closure, byName, declared);
    expect('none' in draw).toBe(false);
    expect((draw as { fragment: string }).fragment).not.toContain('data');
    const vs = entryArguments(m, 'vs');
    const vertex = glVertexOf(
      m,
      vs.f,
      [],
      vs.closure,
      vs.byName,
      vs.declared,
      undefined,
      new Set(),
      undefined,
    );
    expect('none' in vertex).toBe(false);
  });
});

describe('the module a draw is emitted from when the writer refuses the whole', () => {
  it('keeps the GLSL spellings of the module it was cut from, so the draw reads the block it declares', () => {
    const p = buildManifest(moduleOf(RESPELLED_NAMES));
    const draw = p.gl?.draws?.['fs'];
    expect(draw).not.toHaveProperty('none');
    expect((draw as { blocks: object }).blocks).toEqual({ buffer: 'Frame' });
    const glsl = p.bindings.find((b) => b.name === 'buffer')!.emittedGlsl!;
    expect(glsl).not.toBe('buffer');
    expect((draw as { fragment: string }).fragment).toContain(`} ${glsl};`);
  });
});

describe('what a WebGL2 draw refuses', () => {
  const m = moduleOf(DRAW_AND_STORING_KERNEL);
  const { f, closure, byName, declared } = entryArguments(m, 'fs');
  const draw = (
    bindings: readonly DrawBinding[],
    dataTextures?: ReadonlySet<string>,
    texturesMayDrop = false,
  ) =>
    glDrawOf(
      m,
      f,
      bindings,
      closure,
      byName,
      declared,
      undefined,
      dataTextures,
      undefined,
      texturesMayDrop,
    );

  it('refuses a storage binding that is no data texture, and takes one that is', () => {
    expect(draw([uniformBinding('frame'), storageBinding('data')])).toEqual({
      none: 'it reaches the storage binding "data", and the WebGL2 tier does not support a storage binding in a draw yet',
    });
    expect(
      draw([uniformBinding('frame'), storageBinding('data')], new Set(['data'])),
    ).not.toHaveProperty('none');
  });

  it('lists a read-only storage array as data only where the program samples it', () => {
    const r = draw([uniformBinding('frame'), storageBinding('data')], new Set(['data']));
    expect(r).not.toHaveProperty('data');
  });

  it('skips a uniform whose name the program never mentions, since a stage that reads no field declares no block', () => {
    const r = draw([uniformBinding('frame'), uniformBinding('unused_binding')]);
    expect(r).toMatchObject({ blocks: { frame: 'Frame' } });
    expect((r as { blocks: object }).blocks).not.toHaveProperty('unused_binding');
  });

  it('refuses a uniform whose name the program mentions but declares no block for', () => {
    expect(draw([uniformBinding('main')])).toEqual({
      none: 'its GLSL declares no uniform block for "main"',
    });
  });

  it('refuses a texture whose name the program mentions but declares no sampler2D for', () => {
    expect(draw([textureBinding('main')])).toEqual({
      none: 'its GLSL declares no sampler2D for "main"',
    });
  });

  it('skips the guard where the program does not read it, and a texture it dropped only where textures may drop', () => {
    expect(draw([uniformBinding('frame'), textureBinding('_fp64', true)])).not.toHaveProperty(
      'none',
    );
    expect(
      draw([uniformBinding('frame'), textureBinding('dropped')], undefined, true),
    ).not.toHaveProperty('none');
    expect(draw([uniformBinding('frame'), textureBinding('dropped')])).toEqual({
      none: 'its GLSL declares no sampler2D for "dropped"',
    });
  });

  it('refuses a uniform the program declares and the draw does not bind', () => {
    expect(draw([])).toEqual({
      none: 'its GLSL declares a uniform "frame" the draw does not bind',
    });
  });
});

describe('the pass program of a compute entry', () => {
  it('is why it has none, in the words of the pass builder, where it cannot be built', () => {
    const m = moduleOf(`"use typeshade";
declare const ramp: texture_1d<f32>;
declare const out: storage<array<f32>, "read_write">;
@compute([1]) export function main(gid: builtin<"global_invocation_id">) {
  out[gid.x] = textureLoad(ramp, i32(gid.x), 0).x;
}
`);
    const p = buildManifest(m);
    const compute = p.gl?.computes?.['main'];
    expect(compute).toBeDefined();
    expect(compute).toHaveProperty('none');
    expect((compute as { none: string }).none).toContain('texture_1d');
  });
});

describe('the modules the manifest is built from', () => {
  const specifiersOf = (file: string): string[] =>
    [...readFileSync(file, 'utf8').matchAll(/(?:from|import)\s+'([^']+)'/g)].map((m) => m[1]!);

  it('import no TypeScript and nothing of the front end, so every producer computes the same manifest', () => {
    const seen = new Set<string>();
    const external = new Set<string>();
    const walk = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const spec of specifiersOf(file)) {
        if (!spec.startsWith('.')) {
          external.add(spec);
          continue;
        }
        const target = join(dirname(file), spec).replace(/\.js$/, '.ts');
        if (existsSync(target)) walk(target);
      }
    };
    walk(join(import.meta.dirname, 'manifest.ts'));
    expect(seen.size).toBeGreaterThan(10);
    expect([...external].filter((s) => s === 'typescript' || s.startsWith('typescript/'))).toEqual(
      [],
    );
    expect([...seen].filter((f) => f.includes('/compiler/'))).toEqual([]);
  });
});
