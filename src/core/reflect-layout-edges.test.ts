import { describe, it, expect } from 'vitest';
import { wgslLayout, reflect } from './reflect.js';
import { emitGlslModule } from './backends/glsl.js';
import { uniformStruct } from './sot.js';
import { fn, module, vec4 } from './ir/index.js';
import {
  arrayT,
  atomicI32T,
  atomicU32T,
  f32T,
  matT,
  samplerT,
  structT,
  u32T,
  vec2fT,
  vec4fT,
  type BindingDecl,
  type FuncDecl,
  type ModuleDecl,
  type ShaderType,
  type StructDecl,
} from './ir/index.js';

const fieldsOf = (name: string, type: ShaderType): StructDecl => ({
  name,
  fields: [{ name: 'a', type }],
});

const sizeAlign = (type: ShaderType, layout: 'std140' | 'std430') => {
  const l = wgslLayout(fieldsOf('S', type), layout);
  return { size: l.fields[0]!.size, align: l.fields[0]!.align };
};

const moduleOf = (parts: Partial<ModuleDecl>): ModuleDecl => ({
  consts: [],
  structs: [],
  bindings: [],
  funcs: [],
  ...parts,
});

const entry = (name: string, stage: 'vertex' | 'fragment' | 'compute', more = {}): FuncDecl => ({
  name,
  params: [],
  ret: { kind: 'void' },
  attrs: [`@${stage}`],
  stage,
  body: [],
  ...more,
});

describe('wgslLayout — leaf types', () => {
  it('lays an atomic integer out as its four-byte integer', () => {
    expect(sizeAlign(atomicU32T, 'std430')).toEqual({ size: 4, align: 4 });
    expect(sizeAlign(atomicI32T, 'std140')).toEqual({ size: 4, align: 4 });
  });

  it('lays a square emulated-double matrix out as a struct of df64 columns', () => {
    expect(sizeAlign(matT(2, 2, 'f64'), 'std430')).toEqual({ size: 32, align: 8 });
    expect(sizeAlign(matT(3, 3, 'f64'), 'std430')).toEqual({ size: 96, align: 16 });
    expect(sizeAlign(matT(2, 2, 'f64'), 'std140')).toEqual({ size: 32, align: 16 });
  });

  it('refuses a non-square emulated-double matrix instead of guessing a size', () => {
    expect(() => wgslLayout(fieldsOf('S', matT(2, 3, 'f64')), 'std430')).toThrow(
      /mat2x3<f64>.*square/,
    );
  });

  it('strides an array by its element size, rounded up to 16 only under std140', () => {
    expect(sizeAlign(arrayT(f32T, 4), 'std430')).toEqual({ size: 16, align: 4 });
    expect(sizeAlign(arrayT(f32T, 4), 'std140')).toEqual({ size: 64, align: 16 });
    expect(sizeAlign(arrayT(vec2fT, 3), 'std430')).toEqual({ size: 24, align: 8 });
  });

  it('gives a runtime-sized array a size of zero', () => {
    expect(sizeAlign(arrayT(f32T), 'std430').size).toBe(0);
    expect(sizeAlign(arrayT(vec4fT), 'std140').size).toBe(0);
  });

  it('gives a struct with no field a four-byte carrier, sixteen under std140', () => {
    const empty: StructDecl = { name: 'Empty', fields: [] };
    const layouts = (layout: 'std140' | 'std430') => {
      const l = wgslLayout(empty, layout);
      return { size: l.size, align: l.align, fields: l.fields.length };
    };
    expect(layouts('std430')).toEqual({ size: 4, align: 4, fields: 0 });
    expect(layouts('std140')).toEqual({ size: 16, align: 16, fields: 0 });
  });

  it('refuses a nested struct the map does not hold', () => {
    expect(() => wgslLayout(fieldsOf('S', structT('Missing')), 'std430')).toThrow(
      /struct 'Missing' not found/,
    );
  });

  it('refuses a type that is not host-shareable', () => {
    expect(() => wgslLayout(fieldsOf('S', samplerT), 'std430')).toThrow(/not host-shareable/);
  });
});

describe('reflect — module facts', () => {
  const storageBinding = (type: ShaderType, name = 'buf'): BindingDecl => ({
    group: 0,
    binding: 0,
    name,
    space: 'storage',
    access: 'read',
    type,
  });

  it('reports the data texture format of a storage binding by its element', () => {
    const formatOf = (type: ShaderType, structs: StructDecl[] = []) =>
      reflect(moduleOf({ structs, bindings: [storageBinding(type)] })).bindGroups[0]!.entries[0]!
        .glslDataTexture;
    expect(formatOf(arrayT(f32T))).toBe('r32f');
    expect(formatOf(arrayT(u32T))).toBe('r32ui');
    expect(formatOf(arrayT(structT('P')), [fieldsOf('P', u32T)])).toBe('r32ui');
    expect(formatOf(arrayT(structT('P')), [fieldsOf('P', f32T)])).toBe('r32f');
  });

  it('reports no data texture format on a uniform binding', () => {
    const m = moduleOf({
      structs: [fieldsOf('U', f32T)],
      bindings: [{ group: 0, binding: 0, name: 'u', space: 'uniform', type: structT('U') }],
    });
    expect(reflect(m).bindGroups[0]!.entries[0]).not.toHaveProperty('glslDataTexture');
  });

  it('marks portable only on a portable entry and never writes false', () => {
    const m = moduleOf({
      funcs: [entry('plain', 'compute'), entry('kern', 'compute', { portable: true })],
    });
    const [plain, kern] = reflect(m).entries;
    expect(plain).not.toHaveProperty('portable');
    expect(kern!.portable).toBe(true);
  });

  it('defaults a compute entry without a declared size to 64 by 1 by 1', () => {
    const e = reflect(moduleOf({ funcs: [entry('cs', 'compute')] })).entries[0]!;
    expect(e.workgroupShape).toEqual([64, 1, 1]);
    expect(e.workgroupSize).toBe(64);
  });

  it('lists no kernel function among the entries', () => {
    const m = moduleOf({
      funcs: [entry('cs', 'compute'), { ...entry('k', 'compute'), kernel: true }],
    });
    expect(reflect(m).entries.map((e) => e.name)).toEqual(['cs']);
  });

  it('describes the first vertex entry only', () => {
    const vs = (name: string, location: number, type: ShaderType): FuncDecl => ({
      ...entry(name, 'vertex'),
      params: [{ name: `p_${name}`, type, location }],
    });
    const r = reflect(moduleOf({ funcs: [vs('first', 0, f32T), vs('second', 0, vec4fT)] }));
    expect(r.vertex!.attributes.map((a) => a.name)).toEqual(['p_first']);
    expect(r.entries.map((e) => e.name)).toEqual(['first', 'second']);
  });

  it('lists overrides in declaration order with their defaults', () => {
    const m = moduleOf({
      overrides: [
        { name: 'zeta', type: f32T, default: 2.5 },
        { name: 'alpha', type: u32T, default: 7 },
      ],
    });
    expect(reflect(m).overrides.map((o) => [o.name, o.type, o.default])).toEqual([
      ['zeta', 'f32', 2.5],
      ['alpha', 'u32', 7],
    ]);
  });

  it('sorts the required features', () => {
    const m = moduleOf({ enables: ['floatRenderTarget', 'f16'] });
    const features = reflect(m).requiredFeatures;
    expect(features).toEqual([...features].sort());
    expect(features).toEqual(expect.arrayContaining(['f16', 'floatRenderTarget']));
  });
});

describe('the GLSL uniform block is laid out by the reflect layout engine', () => {
  const blockOf = (type: ShaderType) => {
    const U = uniformStruct('U', { group: 0, binding: 0, as: 'u' }, { m: type, k: f32T });
    return module({
      uses: [U],
      funcs: [fn('fs', {}, () => vec4(U.field.k, 0.0, 0.0, 1.0), { stage: 'fragment' })],
    });
  };

  it('emits a block for a matrix the engine admits', () => {
    expect(emitGlslModule(blockOf(matT(3, 3)), 'fragment')).toContain('layout(std140) uniform U');
  });

  it('refuses a two-row matrix field with the engine own reason', () => {
    expect(() => emitGlslModule(blockOf(matT(2, 2)), 'fragment')).toThrow(/wgslLayout/);
  });
});
