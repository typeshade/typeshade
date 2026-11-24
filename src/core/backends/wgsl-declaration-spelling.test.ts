import { describe, it, expect } from 'vitest';
import { wgslBackend, emitModule } from './wgsl.js';
import type { BindingDecl, ModuleDecl, ShaderType, StructDecl } from '../ir/index.js';
import { f32T, u32T, i32T, boolT, vec4fT } from '../ir/index.js';

const emptyModule: ModuleDecl = { consts: [], structs: [], bindings: [], funcs: [] };
const preamble = (m: Partial<ModuleDecl>): string =>
  wgslBackend.modulePreamble!({ ...emptyModule, ...m });

describe('an override is a module-scope declaration with a scalar default', () => {
  const spelled = (type: ShaderType, value: number | boolean) =>
    wgslBackend.emitOverride!({ name: 'k', type, default: value });

  it('spells the default as any literal of the type is spelled', () => {
    expect(spelled(f32T, 1)).toBe('override k: f32 = 1.0;');
    expect(spelled(f32T, 0.5)).toBe('override k: f32 = 0.5;');
    expect(spelled(u32T, 2)).toBe('override k: u32 = 2u;');
    expect(spelled(i32T, -3)).toBe('override k: i32 = -3;');
    expect(spelled(boolT, true)).toBe('override k: bool = true;');
    expect(spelled(boolT, false)).toBe('override k: bool = false;');
  });
});

describe('a struct field carries @align, then @size, then its own attribute', () => {
  const struct = (fields: StructDecl['fields']): string =>
    wgslBackend.emitStruct({ name: 'S', fields });

  it('writes the three in that order on one field', () => {
    expect(struct([{ name: 'a', type: f32T, align: 16, size: 32, attr: '@location(0)' }])).toBe(
      'struct S {\n  @align(16) @size(32) @location(0) a: f32,\n}',
    );
  });

  it('writes each of them alone', () => {
    expect(struct([{ name: 'a', type: f32T, align: 16 }])).toBe(
      'struct S {\n  @align(16) a: f32,\n}',
    );
    expect(struct([{ name: 'a', type: f32T, size: 16 }])).toBe(
      'struct S {\n  @size(16) a: f32,\n}',
    );
  });

  it('emits a field that nothing padded as the bytes it always did', () => {
    expect(
      struct([
        { name: 'a', type: f32T },
        { name: 'p', type: vec4fT, attr: '@builtin(position)' },
      ]),
    ).toBe('struct S {\n  a: f32,\n  @builtin(position) p: vec4<f32>,\n}');
  });
});

describe('a binding declares an address space only where the type has one', () => {
  const bind = (type: ShaderType, rest: Partial<BindingDecl> = {}): string =>
    wgslBackend.emitBinding({ group: 1, binding: 2, name: 'r', space: 'uniform', type, ...rest });

  it('declares each handle type without an address space', () => {
    const handles: ShaderType[] = [
      { kind: 'texture', dim: '2d', elem: 'f32' },
      { kind: 'storage-texture', dim: '2d', format: 'rgba8unorm', access: 'write' },
      { kind: 'depth-texture', dim: '2d' },
      { kind: 'sampler' },
      { kind: 'sampler-comparison' },
    ];
    for (const type of handles) {
      const line = bind(type);
      expect(line.startsWith('@group(1) @binding(2) var r: ')).toBe(true);
      expect(line).not.toContain('var<');
    }
  });

  it('declares a storage texture the way a sampled one is declared, though it is written', () => {
    expect(
      bind(
        { kind: 'storage-texture', dim: '2d', format: 'rgba8unorm', access: 'write' },
        { space: 'storage', access: 'read_write' },
      ),
    ).toBe('@group(1) @binding(2) var r: texture_storage_2d<rgba8unorm, write>;');
  });

  it('declares a buffer in its address space, and a storage buffer read-only by default', () => {
    const buffer: ShaderType = { kind: 'struct', name: 'S' };
    expect(bind(buffer)).toBe('@group(1) @binding(2) var<uniform> r: S;');
    expect(bind(buffer, { space: 'storage' })).toBe(
      '@group(1) @binding(2) var<storage, read> r: S;',
    );
    expect(bind(buffer, { space: 'storage', access: 'read_write' })).toBe(
      '@group(1) @binding(2) var<storage, read_write> r: S;',
    );
  });
});

describe('a module variable', () => {
  it('spells workgroup memory with no initializer and a private variable with one', () => {
    const arr: ShaderType = { kind: 'array', elem: f32T, size: 64 };
    expect(wgslBackend.emitModuleVar!({ name: 'tile', space: 'workgroup', type: arr })).toBe(
      'var<workgroup> tile: array<f32, 64>;',
    );
    expect(
      wgslBackend.emitModuleVar!({
        name: 'seed',
        space: 'private',
        type: u32T,
        init: { op: 'lit', type: u32T, value: 7 },
      }),
    ).toBe('var<private> seed: u32 = 7u;');
  });
});

describe('a parameter and a call', () => {
  it('spells a parameter the callee writes through as a pointer, and others by value', () => {
    expect(wgslBackend.paramDecl!({ name: 'p', type: f32T, mode: 'inout' })).toBe(
      'p: ptr<function, f32>',
    );
    expect(wgslBackend.paramDecl!({ name: 'p', type: f32T })).toBe('p: f32');
    expect(wgslBackend.paramDecl!({ name: 'p', type: vec4fT, builtin: 'position' })).toBe(
      '@builtin(position) p: vec4<f32>',
    );
    expect(wgslBackend.paramDecl!({ name: 'p', type: f32T, location: 1 })).toBe(
      '@location(1) p: f32',
    );
  });

  it('spells a call, and the select intrinsic, as name(args) in the order given', () => {
    expect(wgslBackend.intrinsic('max', ['a', 'b'])).toBe('max(a, b)');
    expect(wgslBackend.intrinsic('select', ['f', 't', 'c'])).toBe('select(f, t, c)');
  });

  it('prefixes a call whose result is discarded with a phony assignment', () => {
    expect(wgslBackend.phonyAssign).toBe('_ = ');
  });
});

describe('the directive header', () => {
  it('is empty for a module that needs nothing', () => {
    expect(preamble({})).toBe('');
    expect(preamble({ enables: [] })).toBe('');
  });

  it('writes the diagnostic rules, then the sorted deduplicated enables, then the requires', () => {
    const binding: BindingDecl = {
      group: 0,
      binding: 0,
      name: 't',
      space: 'uniform',
      type: { kind: 'storage-texture', dim: '2d', format: 'r32float', access: 'read' },
    };
    expect(
      preamble({
        enables: ['subgroups', 'f16', 'f16'],
        diagnostics: [{ severity: 'off', rule: 'derivative_uniformity' }],
        bindings: [binding],
      }),
    ).toBe(
      [
        'diagnostic(off, derivative_uniformity);',
        'enable f16;',
        'enable subgroups;',
        'requires readonly_and_readwrite_storage_textures;',
      ].join('\n'),
    );
  });

  it('writes no enable for a capability whose profile row has no directive', () => {
    expect(preamble({ enables: ['float32Blend', 'floatRenderTarget'] })).toBe('');
  });

  it('carries no trailing newline, since the driver owns the separator', () => {
    expect(preamble({ enables: ['f16'] })).toBe('enable f16;');
  });
});

describe('the absent-builtin set is a denylist', () => {
  it('holds exactly the three ids that WGSL lacks, each with a message of why', () => {
    const absent = wgslBackend.absentBuiltins!;
    expect([...absent.keys()].sort()).toEqual(['frag_coord', 'point_coord', 'point_size']);
    for (const tail of absent.values()) expect(tail).toContain('does not exist in WGSL');
  });

  it('keeps emitting a builtin id that the set does not name', () => {
    const m: ModuleDecl = {
      ...emptyModule,
      funcs: [
        {
          name: 'fs',
          attrs: ['@fragment'],
          stage: 'fragment',
          params: [{ name: 'x', type: u32T, builtin: 'a_future_builtin' }],
          ret: vec4fT,
          retAttr: '@location(0)',
          body: [{ s: 'return', expr: { op: 'lit', type: f32T, value: 0 } }],
        },
      ],
    };
    expect(emitModule(m)).toContain('@builtin(a_future_builtin) x: u32');
  });
});
