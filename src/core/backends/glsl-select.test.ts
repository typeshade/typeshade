import { describe, expect, it } from 'vitest';
import { glslSelect } from './glsl-select.js';
import type { ShaderType } from '../ir/index.js';

const f32: ShaderType = { kind: 'scalar', scalar: 'f32' };
const i32: ShaderType = { kind: 'scalar', scalar: 'i32' };
const vec3f: ShaderType = { kind: 'vec', elem: 'f32', n: 3 };
const vec2i: ShaderType = { kind: 'vec', elem: 'i32', n: 2 };
const select = glslSelect((t) =>
  t.kind === 'vec' ? `${t.elem === 'f32' ? '' : 'i'}vec${String(t.n)}` : 'float',
);

describe('a GLSL select evaluates both values, as WGSL select does', () => {
  it('spells a float pick with a bool condition as mix', () => {
    expect(select('a', 'b', 'c', f32, false)).toBe('mix(a, b, c)');
  });
  it('widens a bool condition to a bvec for a float vector', () => {
    expect(select('a', 'b', 'c', vec3f, false)).toBe('mix(a, b, bvec3(c))');
  });
  it('takes a bvec condition as it is for a float vector', () => {
    expect(select('a', 'b', 'c', vec3f, true)).toBe('mix(a, b, c)');
  });
  it('keeps the ternary for an integer pick, which GLSL ES 3.00 mix does not take', () => {
    expect(select('a', 'b', 'c', i32, false)).toBe('(c ? b : a)');
  });
  it('picks an integer vector per component', () => {
    expect(select('a', 'b', 'c', vec2i, true)).toBe(
      'ivec2(((c).x ? (b).x : (a).x), ((c).y ? (b).y : (a).y))',
    );
  });
});
