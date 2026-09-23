// The honest refusals (roadmap 0.3 item T10, #92): `symbol`, a union, a tuple, a capturing
// closure and `instanceof`. Each was "TS8099 Unsupported expression" or "TS8002 Unsupported
// type syntax", followed by two or three more diagnostics about the same one mistake.
//
// Applying the standing rule — the constraint has to be the target's, not this compiler's —
// three of the five turned out not to be refusals at all:
//
//   `[f32, f32]`                 a list of a length the type fixes is `array<f32, 2>`, which
//                                both backends already take in every position, a return
//                                included (measured: see the tuple describe below)
//   `0 | 1 | 2`                  every member names one type, so the union names it too
//   `f32 & { [brand]: 'm' }`     a brand carries no data; the value is the f32
//
// What is left is refused with one sentence naming the reason and the fix, and nothing after
// it: a declaration this file could not lower no longer makes its call sites say "Unknown
// function" as well, and a parameter or return whose annotation was refused no longer repeats
// that it "requires a TypeShade type annotation" when it has one.
//
// Verifies: Rule 4.5, Rule 4.6, Rule 7.8, Rule 12.1, Rule 12.4, Rule 12.5, Rule 12.6 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileTsSource } from './source-file.js';

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => d.message);

const FS = `@fragment
export function fs(): vec4 {
  return vec4(1.)
}
`;

describe('a tuple is a list of a length the type fixes, which is array<T, N>', () => {
  it('returns one, from both backends', () => {
    const r = compile(`"use typeshade";
function two(): [f32, f32] {
  return [1., 2.];
}
@fragment
export function fs(): vec4 {
  const t = two();
  return vec4(t[0], t[1], 0., 1.);
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn two() -> array<f32, 2> {');
    expect(r.wgsl).toContain('return array<f32, 2>(1.0, 2.0);');
    // GLSL ES 3.00 spells the same function `float[2] two()`, and takes it: unlike ESSL 100
    // it has array return values. The compile gate is what proves the pair links.
    expect(r.glsl?.fragment).toContain('float[2] two() {');
  });

  it('takes one as a parameter, and a list written at the call site', () => {
    const r = compile(`"use typeshade";
function plus(p: [f32, f32]): f32 {
  return p[0] + p[1];
}
@fragment
export function fs(): vec4 {
  return vec4(plus([1., 2.]), 0., 0., 1.);
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn plus(p: array<f32, 2>) -> f32 {');
  });

  it('takes a list in a struct field that declares an array', () => {
    const r = compile(`"use typeshade";
class Box {
  xs: array<f32, 2>;
  k: f32;
}
@fragment
export function fs(): vec4 {
  const b: Box = { xs: [1., 2.], k: 3. };
  return vec4(b.xs[0], b.xs[1], b.k, 1.);
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('let b = Box(array<f32, 2>(1.0, 2.0), 3.0);');
  });

  it('names its elements, the way TypeScript lets a tuple do', () => {
    const r = compile(`"use typeshade";
function span(): [lo: f32, hi: f32] {
  return [0., 1.];
}
@fragment
export function fs(): vec4 {
  return vec4(span()[1], 0., 0., 1.);
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn span() -> array<f32, 2> {');
  });

  it('says a tuple of several types is a struct', () => {
    expect(
      errorsOf(`"use typeshade"
function f(p: [f32, vec3]): f32 {
  return 1.
}
${FS}`)[0],
    ).toBe(
      '"[f32, vec3]" holds a f32 and a vec3. A list of one type is array<T, N>; a list of ' +
        'several is a struct, so declare one with a field per element and return that.',
    );
  });

  it('says a tuple that does not fix its length has no array to be', () => {
    expect(
      errorsOf(`"use typeshade"
function f(p: [f32, ...f32[]]): f32 {
  return 1.
}
${FS}`)[0],
    ).toBe(
      '"[f32, ...f32[]]" does not fix its length, and every array on the GPU outside storage ' +
        'has a length known at compile time. Write the elements out, or declare array<T, N>.',
    );
  });

  it('reports an element that names no type on the element, not on the tuple', () => {
    // The tuple is not what is wrong, so the tuple says nothing: `string` answers for itself.
    expect(
      errorsOf(`"use typeshade"
function f(p: [f32, string]): f32 {
  return 1.
}
${FS}`),
    ).toEqual([
      'A string has no GPU representation: there is nothing for it to be at run ' +
        'time. Text that picks between cases is an enum, whose members are numbers.',
    ]);
  });
});

describe('a union of members that name one type names it too', () => {
  it('integer literals are an i32, the way an enum member is', () => {
    const r = compile(`"use typeshade";
type Mode = 0 | 1 | 2;
function pick(m: Mode): f32 {
  return m === 1 ? 1. : 0.;
}
@fragment
export function fs(): vec4 {
  return vec4(pick(1), 0., 0., 1.);
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn pick(m: i32) -> f32 {');
    // The bare `1` at the call site takes the parameter's type, the retarget every integer
    // argument already gets.
    expect(r.wgsl).toContain('pick(1)');
  });

  it('a literal written as a float is an f32, and true | false is a bool', () => {
    const r = compile(`"use typeshade";
type Half = 0.5 | 1.5;
function f(h: Half, on: true | false): f32 {
  return on ? h : 0.;
}
@fragment
export function fs(): vec4 {
  return vec4(f(0.5, true), 0., 0., 1.);
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn f(h: f32, on: bool) -> f32 {');
  });

  it('two spellings of one type are that type', () => {
    const r = compile(`"use typeshade";
type Meters = f32;
function f(x: Meters | f32): f32 {
  return x;
}
@fragment
export function fs(): vec4 {
  return vec4(f(1.), 0., 0., 1.);
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn f(x: f32) -> f32 {');
  });

  it('says what a union of two types would have to be, and nothing else', () => {
    expect(
      errorsOf(`"use typeshade";
function f(x: f32 | vec3): f32 {
  return 1.;
}
@fragment
export function fs(): vec4 {
  return vec4(f(1.), 0., 0., 1.);
}
`),
    ).toEqual([
      'A union is more than one type and a GPU value has exactly one, so "f32 | vec3" would ' +
        'have to be f32 in one place and vec3 in another. Write one function per type.',
    ]);
  });

  it('says a union of strings is an enum', () => {
    expect(
      errorsOf(`"use typeshade"
function f(m: 'lo' | 'hi'): f32 {
  return 1.
}
${FS}`)[0],
    ).toBe(
      "A string has no GPU representation, so \"'lo' | 'hi'\" names no type a value can " +
        'have. Write the cases as an enum, whose members are numbers.',
    );
  });

  it('says there is no null to hold', () => {
    expect(
      errorsOf(`"use typeshade"
function f(x: f32 | null): f32 {
  return 1.
}
${FS}`)[0],
    ).toContain('There is no null on the GPU');
  });
});

describe('a symbol brand is erased, and a symbol value is not', () => {
  it('a branded alias is the type it brands', () => {
    const r = compile(`"use typeshade";
declare const brand: unique symbol;
type Meters = f32 & { readonly [brand]: 'm' };
function half(m: Meters): f32 {
  return m * 0.5;
}
@fragment
export function fs(): vec4 {
  return vec4(half(2. as Meters), 0., 0., 1.);
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn half(m: f32) -> f32 {');
    // The declaration itself reaches nothing: no binding, no module constant, no group.
    expect(r.wgsl).not.toContain('brand');
    expect(r.module?.bindings ?? []).toEqual([]);
  });

  it('a brand written the other common way is erased too', () => {
    const r = compile(`"use typeshade";
type Meters = f32 & { readonly __brand: 'm' };
function half(m: Meters): f32 {
  return m * 0.5;
}
@fragment
export function fs(): vec4 {
  return vec4(half(2. as Meters), 0., 0., 1.);
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn half(m: f32) -> f32 {');
  });

  it('says what a symbol is, and says it once', () => {
    expect(
      errorsOf(`"use typeshade"
const key = Symbol('k')
${FS}`),
    ).toEqual(['"Symbol" is a host/JS API. "use typeshade" files cannot touch the JS runtime.']);
  });

  it('says a symbol annotation names no value', () => {
    expect(
      errorsOf(`"use typeshade"
function f(k: symbol): f32 {
  return 1.
}
${FS}`)[0],
    ).toContain('A symbol is a JS runtime value, and the GPU has no such type');
  });

  it('says an intersection of two carriers is no one layout', () => {
    expect(
      errorsOf(`"use typeshade"
function f(x: f32 & vec3): f32 {
  return 1.
}
${FS}`)[0],
    ).toContain('An intersection is one value in every one of its types at once');
  });
});

describe('instanceof and in ask what a value is at run time', () => {
  it('instanceof names the reason and the fix, on the whole expression', () => {
    // Before this the operands were lowered first, so the message was "Unknown identifier B"
    // about the base class — the one part of the line that is spelled right.
    expect(
      errorsOf(`"use typeshade";
class B {
  x: f32;
}
class D extends B {
  y: f32;
}
@fragment
export function fs(): vec4 {
  const d = new D();
  return vec4(d instanceof B ? 1. : 0., 0., 0., 1.);
}
`),
    ).toEqual([
      '"instanceof" asks what a value is at run time. A struct on the GPU is its fields and ' +
        'nothing else — no type tag to read — and every call this file emits is resolved at ' +
        'compile time, so a base-typed value is its base. Give the struct a field saying ' +
        'which kind it holds, and branch on that.',
    ]);
  });

  it('in says the answer is already in the type', () => {
    expect(
      errorsOf(`"use typeshade";
class B {
  x: f32;
}
@fragment
export function fs(): vec4 {
  const b = new B();
  return vec4('x' in b ? 1. : 0., 0., 0., 1.);
}
`)[0],
    ).toContain('"in" asks which fields a value has at run time');
  });
});

describe('one mistake reads as one sentence', () => {
  it('a refused parameter annotation does not also say the parameter has none', () => {
    const errs = errorsOf(`"use typeshade";
function f(x: f32 | vec3): f32 {
  return 1.;
}
@fragment
export function fs(): vec4 {
  return vec4(f(1.), 0., 0., 1.);
}
`);
    expect(errs).toHaveLength(1);
    expect(errs.join('\n')).not.toContain('requires a TypeShade type annotation');
    expect(errs.join('\n')).not.toContain('Unknown function');
  });

  it('a parameter with no annotation at all still says so', () => {
    expect(
      errorsOf(`"use typeshade"
function f(x): f32 {
  return 1.
}
${FS}`)[0],
    ).toBe('Parameter "x" requires a TypeShade type annotation.');
  });

  it('a refused return annotation does not also say the return is unsupported', () => {
    const errs = errorsOf(`"use typeshade";
function f(): f32 | vec3 {
  return 1.;
}
@fragment
export function fs(): vec4 {
  return vec4(f(), 0., 0., 1.);
}
`);
    expect(errs).toHaveLength(1);
    expect(errs.join('\n')).not.toContain('Unsupported return type');
  });

  it('a refused local function does not also say the call has no callee', () => {
    const errs = errorsOf(`"use typeshade";
@fragment
export function fs(): vec4 {
  const k: f32 = 2.;
  let scale = (x: f32): f32 => x * k;
  return vec4(scale(1.), 0., 0., 1.);
}
`);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('"scale" is a function, so it is declared with const');
  });

  it('a call to a name nothing declares still says so', () => {
    expect(
      errorsOf(`"use typeshade";
@fragment
export function fs(): vec4 {
  return vec4(nowhere(1.), 0., 0., 1.);
}
`)[0],
    ).toContain('Unknown function "nowhere"');
  });

  it('a name refused inside one body is still unknown when called from another', () => {
    const errs = errorsOf(`"use typeshade";
function other(): f32 {
  return scale(1.);
}
@fragment
export function fs(): vec4 {
  const k: f32 = 2.;
  const scale = (x: f32): f32 => x * k;
  return vec4(other(), 0., 0., 1.);
}
`);
    expect(errs.join('\n')).toContain('Unknown function "scale"');
  });
});

// #171: a refused DECLARATION binds no name, and every later read of the name used to add a
// `TS8022 Unknown identifier` to the one refusal, naming a symbol the author did declare. The
// report is dropped only when an error stands inside the declaration the name resolves to, so
// each row below is one mistake and one sentence, and the last three are the reports that must
// survive: a name out of scope, a name read before its declaration, a name nobody declared.
describe('a refused declaration is the one diagnostic for its name (Rule 12.4, #171)', () => {
  const one = (src: string, message: string) => {
    const errs = errorsOf(src);
    expect(errs, errs.join('\n')).toHaveLength(1);
    expect(errs[0]).toContain(message);
  };

  it('an annotated local whose initializer is refused', () => {
    one(
      `"use typeshade";
export function g(v: f32): f32 { return v; }
export function f(x: f64): f32 {
  const y: f32 = g(x);
  return y + y;
}
`,
      'Argument 1 of "g" type mismatch.',
    );
  });

  it('an unannotated local whose initializer is refused', () => {
    one(
      `"use typeshade";
export function g(a: f32, b: f32): f32 { return a + b; }
export function f(x: f32): f32 {
  const r = g(x);
  return r * r;
}
`,
      '"g" expects 2 argument(s), got 1.',
    );
    one(
      `"use typeshade";
export function f(a: vec3, b: vec2): vec3 {
  const c = a + b;
  return c * 2.;
}
`,
      'Vectors must have the same size.',
    );
  });

  it('a declare that is not a binding type, and a binding type on a top-level let', () => {
    one(
      `"use typeshade";
declare const x: f32;
export function f(): f32 {
  return x * 2.;
}
`,
      'declare "x" must be uniform<T>',
    );
    one(
      `"use typeshade";
let x: uniform<f32>;
export function f(): f32 {
  return x * 2.;
}
`,
      'needs declare: declare let x: uniform<f32>.',
    );
  });

  it('a refused local that is then assigned, compound-assigned and written through', () => {
    one(
      `"use typeshade";
export function f(x: f32): vec3 {
  let y = nope(x);
  y = vec3(2.);
  y += vec3(1.);
  y.x = 1.;
  return y;
}
`,
      'Unknown function "nope"',
    );
  });

  it('a host API is refused once, not also as an unknown identifier', () => {
    one(
      `"use typeshade";
export function f(x: f32): f32 {
  const t = Date.now();
  return t + x;
}
`,
      '"Date" is a host/JS API.',
    );
  });

  it('a name read outside the block that refused it is still unknown', () => {
    expect(
      errorsOf(`"use typeshade";
export function f(x: f32): f32 {
  if (x > 0.) {
    const y = nope(x);
  }
  return y;
}
`),
    ).toEqual([
      'Unknown function "nope". Declare it in this file, or import it from another shader module.',
      'Unknown identifier "y".',
    ]);
  });

  it('a name read before its declaration says so, and names no other spelling', () => {
    // TypeScript's TS2448: the name is declared, so a spelling guess would send the author to
    // another name; the remedy is the order (Rule 12.1).
    expect(
      errorsOf(`"use typeshade";
export function f(x: f32): f32 {
  const z = w * 2.;
  const w = nope(x);
  return z;
}
`),
    ).toEqual([
      '"w" is read before its declaration. Declare it above this line.',
      'Unknown function "nope". Declare it in this file, or import it from another shader module.',
    ]);
  });

  it('a name nobody declared is still unknown beside a clean declaration', () => {
    expect(
      errorsOf(`"use typeshade";
export function f(x: f32): f32 {
  const y = x * 2.;
  return yy;
}
`),
    ).toEqual(['Unknown identifier "yy".']);
  });
});

describe('the keyword types a TypeScript habit reaches for name the one that is meant', () => {
  it('number has a width', () => {
    expect(
      errorsOf(`"use typeshade"
function f(x: number): f32 {
  return 1.
}
${FS}`)[0],
    ).toBe('A number on the GPU has a width. Write f32 for a float, i32 or u32 for an integer.');
  });

  it('boolean is spelled bool', () => {
    expect(
      errorsOf(`"use typeshade"
function f(x: boolean): f32 {
  return 1.
}
${FS}`)[0],
    ).toBe('TypeShade spells the boolean "bool".');
  });

  it('a string expression says why there is nothing for it to be', () => {
    expect(
      errorsOf(`"use typeshade";
@fragment
export function fs(): vec4 {
  const label = "hi";
  return vec4(1.);
}
`)[0],
    ).toContain('A string has no GPU representation');
  });
});
