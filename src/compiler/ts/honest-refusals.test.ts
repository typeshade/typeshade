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
import { compileTsSources } from './module.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

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
// report is dropped only when an error stands inside the declaration the name resolves to, or
// inside a declaration that one reads, so each row below is one mistake and one sentence, and
// the last three are the reports that must survive: a name out of scope, a name read before its
// declaration, a name nobody declared.
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

  it('a local declared from a refused one', () => {
    // `u` reads `t`, whose product was refused, so `u` is not lowered either and binds no name;
    // the one mistake is still the product, and `return u` is not an unknown identifier.
    one(
      `"use typeshade";
export function f(a: vec3, b: vec2): vec3 {
  const t = a * b;
  const u = t * 2.;
  const w = u + t;
  return w;
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
      'needs declare: write "declare const x: uniform<f32>".',
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

// Proposal 0008 §3 (Rule 12.4): where two passes each refused one node, one of them stops. Each
// shape is pinned whole, code and text, in compile() and in the editor's own diagnostics, so a
// second diagnostic about the same mistake cannot come back under either. What TypeScript itself
// adds in the editor (`Cannot find name 'Error'`) is its own list, which proposal 0007 merges.
describe('one mistake, one diagnostic, in compile() and in the editor', () => {
  const compiled = (src: string): string[] =>
    compile(src).diagnostics.map((d) => `${String(d.code)} ${d.message}`);
  const edited = (src: string): string[] => {
    const service = createTypeshadeLanguageService();
    service.openDocument('one.ts', src);
    return service
      .getDiagnostics('one.ts')
      .filter((d) => d.source === 'typeshade')
      .map((d) => `${String(d.code)} ${d.message}`);
  };
  const shader = (head: string, body: string): string =>
    `"use typeshade";\n${head}export function f(a: f32): f32 {\n${body}\n}\n${FS}`;
  const THROW = 'TS8013 try/catch/throw are JS exceptions. TypeShade has no exception path.';
  const VAR = 'TS8013 `var` is not allowed. Use `let` (mutable) or `const` (immutable).';
  const TOP_VAR =
    'TS8014 Top-level var is not allowed. Use `let` for a per-invocation variable or `const` ' +
    'for a module constant.';
  const TOP = (kind: string): string =>
    `TS8014 Unsupported top-level "${kind}". A TypeShade file is directive + types + functions + ` +
    'imports.';
  const IN_NAMESPACE = (what: string): string =>
    `TS8014 A namespace holds functions, constants, classes and namespaces; ${what} inside "N" ` +
    'has no flattened form. Declare it at the top level of the file.';
  const ASYNC = (code: string, shown: string): string =>
    `${code} ${shown} is async, and a shader function runs to completion in one call: there is ` +
    'no event loop to wait on. Remove "async" and each "await".';
  const GENERATOR = (code: string, shown: string): string =>
    `${code} ${shown} is a generator, and a shader function runs to completion in one call: ` +
    'nothing suspends it at a "yield". Remove the "*" and return one value.';
  const SPREAD = (operand: string, elements: string): string =>
    `TS8013 "...${operand}" spreads a list into a list, which a shader array does not do: write ` +
    `its elements, ${elements}.`;
  const SPREAD_ANY = (operand: string): string =>
    `TS8013 "...${operand}" spreads into a list, which a shader array does not do: write the ` +
    'elements one by one.';
  const GENERIC = (what: string, body: string): string =>
    `TS8010 "G" is a generic ${what}; a generic struct is written as a class, class G<T> ` +
    `{ ${body} } (surface §32).`;
  const TEMPLATE = 'TS8013 Template strings are JS. TypeShade has no string type.';
  const AWAIT = 'TS8013 await is host control flow. Shader functions are synchronous.';
  const LIST = 'const A: array<f32, 2> = [1., 2.];\n';
  const cases: readonly (readonly [string, string, readonly string[]])[] = [
    [
      'for…in, and no "Unsupported statement" after it',
      shader('', '  const xs: array<f32, 2> = [a, a];\n  for (const k in xs) {\n  }\n  return a;'),
      [
        "TS8013 for-in enumerates a JS object's keys, which a shader value does not have. " +
          'Iterate an array with `for (const x of xs)`, or count with ' +
          '`for (let i = 0; i < n; i++)`.',
      ],
    ],
    ['throw', shader('', '  if (a < 0.) {\n    throw 1.;\n  }\n  return a;'), [THROW]],
    ['try', shader('', '  try {\n    return a;\n  } catch {\n    return 0.;\n  }'), [THROW]],
    [
      'throw, whose operand is part of the one mistake',
      shader('', '  if (a < 0.) {\n    throw new Error("neg");\n  }\n  return a;'),
      [THROW],
    ],
    [
      'throw of a template string',
      shader('', '  if (a < 0.) {\n    throw `bad ${a}`;\n  }\n  return a;'),
      [THROW],
    ],
    // A statement the top level cannot hold is that one mistake, whatever it holds.
    ['throw at the top level', shader('throw 1.;\n', '  return a;'), [TOP('ThrowStatement')]],
    ['try at the top level', shader('try {\n} catch {\n}\n', '  return a;'), [TOP('TryStatement')]],
    [
      'for…in at the top level',
      shader('for (const k in {}) {\n}\n', '  return a;'),
      [TOP('ForInStatement')],
    ],
    [
      'var in a body, lowered as the let it would have been',
      shader('', '  var x: f32 = a;\n  x += 1.;\n  return x;'),
      [VAR],
    ],
    [
      'var holding a function in a body',
      shader('', '  var g = (x: f32): f32 => x * 2.;\n  return g(a);'),
      [VAR],
    ],
    [
      'var at the top level, bound as the let it would have been',
      shader('var k: f32 = 1.;\n', '  k += a;\n  return k;'),
      [TOP_VAR],
    ],
    [
      'var holding a function at the top level',
      shader('var g = (x: f32): f32 => x * 2.;\n', '  return g(a);'),
      [TOP_VAR],
    ],
    [
      'a function held by a top-level let, refused as a function and not also as a variable',
      shader('let g = (x: f32): f32 => x * 2.;\n', '  return g(a);'),
      [
        'TS8020 "g" is a function, so it is declared with const; a "let" would let the name ' +
          'point at another one, which no shader value does.',
      ],
    ],
    [
      'var declaring a binding at the top level',
      shader('class U {\n  k: f32;\n}\ndeclare var u: uniform<U>;\n', '  return u.k;'),
      [TOP_VAR],
    ],
    [
      'var declaring an override at the top level',
      shader('var q: override<f32> = 1.;\n', '  return q;'),
      [TOP_VAR],
    ],
    [
      'var in a namespace',
      shader('namespace N {\n  export var x = 1.;\n}\n', '  return a;'),
      [IN_NAMESPACE('a variable')],
    ],
    [
      'var in a namespace inside a namespace',
      shader('namespace N {\n  namespace M {\n    export var x = 1.;\n  }\n}\n', '  return a;'),
      [
        'TS8014 A namespace holds functions, constants, classes and namespaces; a variable ' +
          'inside "N_M" has no flattened form. Declare it at the top level of the file.',
      ],
    ],
    [
      'an interface in a namespace',
      shader('namespace N {\n  export interface I {\n    x: f32;\n  }\n}\n', '  return a;'),
      [IN_NAMESPACE('a type')],
    ],
    [
      'an object-type alias in a namespace',
      shader('namespace N {\n  export type T = { x: f32 };\n}\n', '  return a;'),
      [IN_NAMESPACE('a type')],
    ],
    [
      'a spread in a list, which names the elements, and a use of the name it declares',
      shader(
        '',
        '  const xs: array<f32, 2> = [a, 2.];\n  const b: array<f32, 4> = [...xs, 3., 4.];\n' +
          '  return b[0];',
      ),
      [SPREAD('xs', 'xs[0], xs[1]')],
    ],
    [
      'a spread in a list with no type, whose name keeps the type its elements add up to',
      shader('', '  const xs: array<f32, 2> = [a, 1.];\n  const b = [...xs, 3.];\n  return b[2];'),
      [SPREAD('xs', 'xs[0], xs[1]')],
    ],
    [
      'a spread in a list written as an argument, said before the list is counted',
      shader(
        'function sum(xs: array<f32, 3>): f32 {\n  return xs[0] + xs[1] + xs[2];\n}\n',
        '  const xs: array<f32, 2> = [a, 1.];\n  return sum([...xs, 3.]);',
      ),
      [SPREAD('xs', 'xs[0], xs[1]')],
    ],
    [
      'a spread in a list with no type anywhere',
      shader('', '  const xs: array<f32, 2> = [a, 1.];\n  return [...xs, 3.][0];'),
      [SPREAD('xs', 'xs[0], xs[1]')],
    ],
    [
      'a spread in a module constant, whose name stays declared',
      shader(`${LIST}const B: array<f32, 4> = [...A, 3., 4.];\n`, '  return B[0] + a;'),
      [SPREAD('A', 'A[0], A[1]')],
    ],
    [
      'a spread in a module constant with no type',
      shader(`${LIST}const B = [...A, 3.];\n`, '  return B[2] + a;'),
      [SPREAD('A', 'A[0], A[1]')],
    ],
    [
      'a spread in a module variable, whose name stays declared',
      shader(`${LIST}let B: array<f32, 3> = [...A, 3.];\n`, '  B[0] += a;\n  return B[0];'),
      [SPREAD('A', 'A[0], A[1]')],
    ],
    [
      'a spread in a module variable with no type',
      shader(`${LIST}let B = [...A, 3.];\n`, '  B[0] += a;\n  return B[0];'),
      [SPREAD('A', 'A[0], A[1]')],
    ],
    [
      'a spread in a default, and a call that leaves the default out',
      shader(
        `${LIST}function k(xs: array<f32, 3> = [...A, 3.]): f32 {\n  return xs[0];\n}\n`,
        '  return k() + a;',
      ),
      [SPREAD('A', 'A[0], A[1]')],
    ],
    [
      'a spread of a vector, which names its components',
      shader(
        '',
        '  const v: vec3 = vec3(a, 1., 2.);\n  const b: array<f32, 4> = [...v, 3.];\n  return b[0];',
      ),
      [SPREAD('v', 'v.x, v.y, v.z')],
    ],
    [
      'a spread of a long array, which names its first and last elements',
      shader(
        '',
        '  const xs: array<f32, 8> = [a, a, a, a, a, a, a, a];\n' +
          '  const b: array<f32, 9> = [...xs, 1.];\n  return b[0];',
      ),
      [SPREAD('xs', 'xs[0], xs[1], …, xs[7]')],
    ],
    [
      'a spread of a struct, which has no elements to name',
      shader(
        'class S {\n  x: f32 = 0.;\n  y: f32 = 0.;\n}\n',
        '  const s = new S();\n  const b: array<f32, 3> = [...s, 1.];\n  return b[0];',
      ),
      [SPREAD_ANY('s')],
    ],
    [
      'a spread in a list no call lowers',
      shader(
        'function g<T>(a: array<T, 2>): array<T, 3> {\n  return [...a, a[0]];\n}\n',
        '  return a;',
      ),
      [SPREAD_ANY('a')],
    ],
    [
      'a spread in a generic body two calls lower alike, said once with its elements',
      shader(
        'function g<T>(xs: array<T, 2>): array<T, 3> {\n  return [...xs, xs[0]];\n}\n',
        '  const i: array<i32, 2> = [1, 2];\n  const xs: array<f32, 2> = [a, a];\n' +
          '  return g(xs)[0] + f32(g(i)[0]);',
      ),
      [SPREAD('xs', 'xs[0], xs[1]')],
    ],
    [
      'a spread in a generic body two calls lower differently, said once without them',
      shader(
        'function g<T>(v: T): f32 {\n  const b: array<f32, 4> = [...v, 1.];\n  return b[0];\n}\n',
        '  return g(vec3(a, a, a)) + g(vec2(a, a));',
      ),
      [SPREAD_ANY('v')],
    ],
    [
      'an await in what a spread spreads',
      shader('', '  const b: array<f32, 3> = [...(await a), 1.];\n  return b[0];'),
      [SPREAD_ANY('(await a)')],
    ],
    [
      'a spread argument',
      shader(
        'function g(x: f32, y: f32): f32 {\n  return x + y;\n}\n',
        '  const xs: array<f32, 2> = [a, 2.];\n  return g(...xs);',
      ),
      ['TS8013 Spread is a JS runtime operation.'],
    ],
    ['a template string', shader('', '  const s = `a${a}`;\n  return a;'), [TEMPLATE]],
    [
      'a template string in a template string',
      shader('', '  const s = `a${`b${a}`}`;\n  return a;'),
      [TEMPLATE],
    ],
    [
      'a template string in a body whose return type is its own, and a call of it',
      shader('function h(x: f32) {\n  return `${x}`.length;\n}\n', '  return h(a);'),
      [TEMPLATE],
    ],
    ['await outside an async function', shader('', '  return await a;'), [AWAIT]],
    ['await standing as a statement', shader('', '  await a;\n  return a;'), [AWAIT]],
    [
      'an async function, whose await is part of it, and a call to it',
      shader(
        'async function h(x: f32): f32 {\n  const y = await x;\n  return y;\n}\n',
        '  return h(a);',
      ),
      [ASYNC('TS8013', '"h"')],
    ],
    [
      'an async function in a namespace, and a call to it through the namespace',
      shader(
        'namespace N {\n  export async function h(x: f32): f32 {\n    return await x;\n  }\n}\n',
        '  return N.h(a);',
      ),
      [ASYNC('TS8013', '"h"')],
    ],
    [
      'an async generator',
      shader('async function* h(): f32 {\n  yield 1.;\n}\n', '  return a;'),
      [
        'TS8013 "h" is an async generator, and a shader function runs to completion in one ' +
          'call: there is no event loop to wait on. Remove "async" and the "*", and return one ' +
          'value.',
      ],
    ],
    [
      'a generator, whose yield is part of it',
      shader('function* h(): f32 {\n  yield 1.;\n}\n', '  return a;'),
      [GENERATOR('TS8013', '"h"')],
    ],
    [
      'a generator with no name',
      shader('export default function* (): f32 {\n  yield 1.;\n}\n', '  return a;'),
      [GENERATOR('TS8013', 'This function')],
    ],
    [
      'a generator declared in a body',
      shader('', '  function* g(): f32 {\n    yield 1.;\n  }\n  return a;'),
      [GENERATOR('TS8013', '"g"')],
    ],
    [
      'an async arrow in a body no call lowers',
      shader(
        'function g<T>(x: T): T {\n  const h = async (y: T): T => await y;\n  return x;\n}\n',
        '  return a;',
      ),
      [ASYNC('TS8020', '"h"')],
    ],
    [
      'a generator function expression in a body no call lowers',
      shader(
        'function g<T>(x: T): T {\n  const h = function* (): T {\n    yield x;\n  };\n  return x;\n}\n',
        '  return a;',
      ),
      [GENERATOR('TS8020', '"h"')],
    ],
    [
      'an async function written as an argument',
      shader(
        'function apply(k: (x: f32) => f32, x: f32): f32 {\n  return k(x);\n}\n',
        '  return apply(async (y: f32): f32 => await y, a);',
      ),
      [ASYNC('TS8020', 'This function')],
    ],
    [
      "a class's async method",
      shader(
        'class C {\n  x: f32 = 0.;\n  async m(): f32 {\n    return await this.x;\n  }\n}\n',
        '  return a;',
      ),
      [ASYNC('TS8035', '"C.m"')],
    ],
    [
      'a generic interface used with a type argument',
      shader(
        'interface G<T> {\n  x: T;\n}\nfunction k(g: G<f32>): f32 {\n  return g.x;\n}\n',
        '  return a;',
      ),
      [GENERIC('interface', 'x: T')],
    ],
    [
      'a generic type alias used with a type argument',
      shader(
        'type G<T> = { x: T };\nfunction k(g: G<f32>): f32 {\n  return g.x;\n}\n',
        '  return a;',
      ),
      [GENERIC('type alias', 'x: T')],
    ],
    [
      'a generic interface reached through a type alias',
      shader(
        'interface G<T> {\n  x: T;\n}\ntype GF = G<f32>;\nfunction k(g: GF): f32 {\n  return g.x;\n}\n',
        '  return a;',
      ),
      [GENERIC('interface', 'x: T')],
    ],
    [
      "a generic interface typing a class's field, and a read of it",
      shader(
        'interface G<T> {\n  x: T;\n}\nclass H {\n  g: G<f32>;\n  k: f32;\n}\n' +
          'function k(h: H): f32 {\n  return h.g.x + h.k;\n}\n',
        '  return a;',
      ),
      [GENERIC('interface', 'x: T')],
    ],
    [
      'a generic interface typing the one field a class has',
      shader(
        'interface G<T> {\n  x: T;\n}\nclass H {\n  g: G<f32> = { x: 0. };\n}\n',
        '  return a;',
      ),
      [GENERIC('interface', 'x: T')],
    ],
    [
      'a generic interface with more fields than the sentence shows',
      shader(
        'interface G<T> {\n  a: T;\n  b: T;\n  c: T;\n  d: T;\n}\n' +
          'function k(g: G<f32>): f32 {\n  return g.a;\n}\n',
        '  return a;',
      ),
      [GENERIC('interface', 'a: T; b: T; …')],
    ],
  ];
  for (const [name, src, expected] of cases) {
    it(name, () => {
      expect(compiled(src)).toEqual(expected);
      expect(edited(src)).toEqual(expected);
    });
  }

  it('an async function in a namespace leaves a name nothing declares unknown', () => {
    const src = shader(
      'namespace N {\n  export async function h(x: f32): f32 {\n    return await x;\n  }\n}\n',
      '  return h(a);',
    );
    for (const said of [compiled(src), edited(src)]) {
      expect(said).toHaveLength(2);
      expect(said[0]).toBe(ASYNC('TS8013', '"h"'));
      expect(said[1]).toMatch(/^TS8004 /);
    }
  });

  // The multi-file path (the documentation gate's) says each once too; it walks no namespace, so
  // a `var` in one is said where every `var` is, and it reads a signature before it collects a
  // struct, so a generic interface is recorded first.
  it('in a program of several files', () => {
    const sources = (main: string, lib: string): string[] =>
      compileTsSources([
        {
          fileName: 'main.ts',
          source: `"use typeshade";\nimport { h } from "./lib";\n${main}export function f(a: f32): f32 {\n  return h(a);\n}\n`,
        },
        { fileName: 'lib.ts', source: `"use typeshade";\n${lib}` },
      ]).diagnostics.map((d) => `${String(d.code)} ${d.message}`);
    const H = 'export function h(x: f32): f32 {\n  return x;\n}\n';
    expect(
      sources('', 'export async function h(x: f32): f32 {\n  const y = await x;\n  return y;\n}\n'),
    ).toEqual([ASYNC('TS8013', '"h"')]);
    expect(sources('', `${H}function* g(): f32 {\n  yield 1.;\n}\n`)).toEqual([
      GENERATOR('TS8013', '"g"'),
    ]);
    expect(
      sources('interface G<T> {\n  x: T;\n}\nfunction k(g: G<f32>): f32 {\n  return g.x;\n}\n', H),
    ).toEqual([GENERIC('interface', 'x: T')]);
    expect(sources('namespace N {\n  export var x = 1.;\n}\n', H)).toEqual([
      IN_NAMESPACE('a variable'),
    ]);
    expect(sources('', `namespace N {\n  export var x = 1.;\n}\n${H}`)).toEqual([
      IN_NAMESPACE('a variable'),
    ]);
    // A body that stopped at a refusal said its error, so a call of it says nothing more.
    expect(sources('', 'export function h(x: f32) {\n  return `${x}`.length;\n}\n')).toEqual([
      TEMPLATE,
    ]);
  });

  it('the class a generic interface names compiles', () => {
    const r = compile(
      shader(
        'class G<T> {\n  x: T;\n}\nfunction k(g: G<f32>): f32 {\n  return g.x;\n}\n',
        '  const g: G<f32> = { x: a };\n  return k(g);',
      ),
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('struct G_f32 {');
  });

  it('the elements a spread sentence names compile', () => {
    for (const body of [
      '  const xs: array<f32, 2> = [a, 2.];\n  const b: array<f32, 4> = [xs[0], xs[1], 3., 4.];\n' +
        '  return b[0];',
      '  const v: vec3 = vec3(a, 1., 2.);\n  const b: array<f32, 4> = [v.x, v.y, v.z, 3.];\n' +
        '  return b[0];',
    ]) {
      expect(compiled(shader('', body))).toEqual([]);
    }
  });
});
