// Type aliases that are not object types (roadmap 0.3 item T2, design #92, §2).
// `type Meters = f32` is ordinary TypeScript for "another name for this type", and it is the
// shape a developer reaches for before any of the GPU ones. Measured on `main` before this:
// the alias fell through to the capitalized-name arm of the type map and became a struct named
// after itself, so `m * 0.5` was "cannot * struct:Meters and f32" and a lowercase alias was an
// unknown type. What is pinned here: the alias resolves wherever a type may stand, an alias of
// an object type is still a struct, a cycle is named rather than recursed, and the shapes that
// were refused before are refused still.
//
// Verifies: Rule 4.2 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileTsSource } from './source-file.js';
import { TS_CODES } from './codes.js';

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`);

const FS = (body: string) => `@fragment
export function fs(@location(0) uv: vec2): vec4 {
${body}
}
`;
const file = (head: string, body: string) => `"use typeshade"\n${head}${FS(body)}`;

describe('a type alias is another name for its target', () => {
  it('names a scalar, a vector and a bool vector, in a parameter and a return', () => {
    const r = compile(
      file(
        `type Meters = f32
type Color = vec3
type Mask = vec3b
function half(m: Meters): Meters {
  return m * 0.5
}
function dim(c: Color): Color {
  return c * 0.5
}
function lit(m: Mask): bool {
  return any(m)
}
`,
        `  const c = dim(vec3(1., 1., 1.))
  return vec4(c * half(2.), select(0., 1., lit(vec3b(true, false, false))))`,
      ),
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn half(m: f32) -> f32 {');
    expect(r.wgsl).toContain('fn dim(c: vec3<f32>) -> vec3<f32> {');
    expect(r.wgsl).toContain('fn lit(m: vec3<bool>) -> bool {');
    // No struct was invented for any of the three.
    expect(r.wgsl).not.toContain('struct Meters');
    expect(r.wgsl).not.toContain('struct Color');
  });

  it('names an array, a struct, and a lowercase name; and a chain of aliases resolves', () => {
    const arr = compile(
      file(
        `type Grid = array<f32, 3>\n`,
        `  const g: Grid = [1., 2., 3.]\n  return vec4(g[1], 0., 0., 1.)`,
      ),
    );
    expect(arr.diagnostics).toEqual([]);
    expect(arr.wgsl).toContain('array<f32, 3>');
    const st = compile(
      file(
        `class P {
  x: f32
  y: f32
}
type Point = P
function first(p: Point): f32 {
  return p.x
}
`,
        `  return vec4(first({ x: 1., y: 2. }), 0., 0., 1.)`,
      ),
    );
    expect(st.diagnostics).toEqual([]);
    expect(st.wgsl).toContain('fn first(p: P) -> f32 {');
    const lower = compile(
      file(
        `type meters = f32\ntype far = meters\nfunction half(m: far): far {\n  return m * 0.5\n}\n`,
        `  return vec4(half(2.), 0., 0., 1.)`,
      ),
    );
    expect(lower.diagnostics).toEqual([]);
    expect(lower.wgsl).toContain('fn half(m: f32) -> f32 {');
  });

  it('stands wherever a type stands: a binding, a class field, a module const', () => {
    const r = compile(
      file(
        `type Meters = f32
class C {
  d: Meters
}
type Conf = C
declare const u: uniform<Conf>
const UNIT: Meters = 1.
`,
        `  return vec4(u.d * UNIT, 0., 0., 1.)`,
      ),
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('  d: f32,');
    expect(r.wgsl).toContain('var<uniform> u: C;');
    expect(r.wgsl).toContain('const UNIT: f32 = 1.0;');
  });

  it('an object-type alias is still a struct, and a builtin name still wins', () => {
    const r = compile(
      file(
        `type P = {
  x: f32
  y: f32
}
function mid(p: P): f32 {
  return (p.x + p.y) * 0.5
}
`,
        `  return vec4(mid({ x: 1., y: 2. }), 0., 0., 1.)`,
      ),
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('struct P {');
    // An alias cannot shadow a builtin name: `vec3` is the vector, not the alias.
    const shadow = compile(
      file(
        `type vec3 = f32\nfunction f(v: vec3): f32 {\n  return v.x\n}\n`,
        `  return vec4(f(vec3(1., 2., 3.)), 0., 0., 1.)`,
      ),
    );
    expect(shadow.diagnostics).toEqual([]);
    expect(shadow.wgsl).toContain('fn f(v: vec3<f32>) -> f32 {');
  });

  it('an unused host-shaped alias stays invisible', () => {
    // The reachability rule collectStructs already had: a declaration that describes a type
    // nothing uses is not a shader type and draws no diagnostic.
    expect(
      errorsOf(
        file(
          `type Config = { seed: number }\ntype Params = Config\n`,
          `  return vec4(1., 0., 0., 1.)`,
        ),
      ),
    ).toEqual([]);
  });
});

describe('what a type alias still does not do', () => {
  it('a cycle is named, with the chain', () => {
    expect(
      errorsOf(
        file(
          `type A = A\nfunction f(a: A): f32 {\n  return 1.\n}\n`,
          `  return vec4(f(1.), 0., 0., 1.)`,
        ),
      )[0],
    ).toBe(
      `${TS_CODES.UNKNOWN_TYPE} Type alias "A" is defined in terms of itself (A -> A), so it names no type.`,
    );
    expect(
      errorsOf(
        file(
          `type A = B\ntype B = A\nfunction f(a: A): f32 {\n  return 1.\n}\n`,
          `  return vec4(f(1.), 0., 0., 1.)`,
        ),
      )[0],
    ).toBe(
      `${TS_CODES.UNKNOWN_TYPE} Type alias "A" is defined in terms of itself (A -> B -> A), so it names no type.`,
    );
  });

  it('a union of two types and a generic alias keep their refusals', () => {
    // The union says what it is and what to write instead now (roadmap 0.3 item T10, #92),
    // rather than "unsupported type syntax"; a union whose members name ONE type is the case
    // that is no longer refused, and union.test.ts holds it.
    expect(
      errorsOf(
        file(
          `type N = f32 | i32\nfunction f(a: N): f32 {\n  return 1.\n}\n`,
          `  return vec4(1., 0., 0., 1.)`,
        ),
      )[0],
    ).toContain(
      'A union is more than one type and a GPU value has exactly one, so "f32 | i32" would ' +
        'have to be f32 in one place and i32 in another. Write one function per type.',
    );
    expect(
      errorsOf(
        file(
          `type Box<T> = T\nfunction f(a: Box<f32>): f32 {\n  return a\n}\n`,
          `  return vec4(1., 0., 0., 1.)`,
        ),
      )[0],
    ).toContain('Type arguments are not supported yet');
  });
});

describe('an optional class field is refused, as an interface member already was', () => {
  it('says a struct field is always present', () => {
    // Measured before this: the class took the `?` and emitted `y: f32` as a required member
    // with no diagnostic, so the three spellings of one struct disagreed about it silently.
    expect(
      errorsOf(`"use typeshade"
class P {
  x: f32
  y?: f32
}
declare const u: uniform<P>
${FS(`  return vec4(u.x, 0., 0., 1.)`)}`),
    ).toEqual([
      `${TS_CODES.STRUCT_FIELD} Optional field "y?" on "P" is not supported: a struct field is always present in the buffer the host fills.`,
    ]);
  });
});
