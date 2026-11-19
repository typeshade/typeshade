import { describe, it, expect } from 'vitest';
import { emitGlslModule, type ShaderType, type ModuleDecl } from 'typeshade';
import { f32T } from 'typeshade/core/ir';

describe('glsl-es300 — fixed-size array declarators', () => {
  const array3: ShaderType = { kind: 'array', elem: f32T, size: 3 };
  const array2x3: ShaderType = {
    kind: 'array',
    elem: { kind: 'array', elem: f32T, size: 3 },
    size: 2,
  };

  it('places array dimensions after local names, parameters, and struct fields', () => {
    const mod: ModuleDecl = {
      consts: [],
      structs: [{ name: 'ArrayHolder', fields: [{ name: 'values', type: array3 }] }],
      bindings: [],
      funcs: [
        {
          name: 'mutate',
          params: [{ name: 'values', type: array3, mode: 'inout' }],
          ret: { kind: 'void' },
          body: [{ s: 'var', name: 'localValues', type: array3 }],
        },
      ],
    };

    const glsl = emitGlslModule(mod);
    expect(glsl).toContain('float values[3];');
    expect(glsl).toContain('void mutate(inout float values[3])');
    expect(glsl).toContain('float localValues[3] = float[3](0.0, 0.0, 0.0);');
    expect(glsl).not.toContain('float[3] values');
    expect(glsl).not.toContain('float[3] localValues');
  });

  it('preserves dimension order for nested fixed-size array declarators', () => {
    const mod: ModuleDecl = {
      consts: [],
      structs: [{ name: 'NestedArrayHolder', fields: [{ name: 'values', type: array2x3 }] }],
      bindings: [],
      funcs: [],
    };

    expect(emitGlslModule(mod)).toContain('float values[2][3];');
  });
});
