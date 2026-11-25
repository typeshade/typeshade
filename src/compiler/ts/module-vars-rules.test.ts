import { describe, expect, it } from 'vitest';
import { bothHalves, bothTake } from '../../core/testing/both-halves.js';

const program = (body: string): string => `"use typeshade";
${body}
@compute([1]) export function main(): void { }
`;

const refused = (body: string, sentence: string): void => {
  const halves = bothHalves(program(body));
  const want = `typeshade ${sentence}`;
  expect(halves.compiler).toEqual([want]);
  expect(halves.editor.filter((s) => s.startsWith('typeshade '))).toEqual([want]);
};

const noInitializer = (name: string, then: string): string =>
  `TS8033: "${name}" is workgroup memory and takes no initializer: it is zero at the start of ` +
  `each workgroup. Assign it inside the entry${then}`;

const needsDeclare = (name: string, kind: string, line: string): string =>
  `TS8033: "${name}" is a ${kind} binding the host provides, and needs declare: write "${line}".`;

const atomicIn = (name: string, type: string): string =>
  `TS8033: "${name}" cannot be ${type}: an atomic lives in storage or workgroup memory, not in a per-invocation variable.`;

describe('the per-invocation variable has no wrapper', () => {
  const removed = (name: string, type: string): string =>
    `TS8033: perInvocation<T> was removed: a top-level let is already the per-invocation variable. Drop the wrapper and write let ${name}: ${type}.`;

  it('refuses the retired wrapper with the plain let to write, with or without an initializer', () => {
    refused('let seed: perInvocation<u32> = 7;', removed('seed', 'u32'));
    refused('let seed: perInvocation<u32>;', removed('seed', 'u32'));
    refused('let seed: perInvocation;', removed('seed', 'T'));
  });

  it('takes the plain let as a private variable and the wrapper as workgroup memory', () => {
    const halves = bothTake(program('let seed: u32 = 7;\nlet tile: workgroup<array<f32, 4>>;'));
    expect(halves.result.wgsl).toContain('var<private> seed: u32 = 7u;');
    expect(halves.result.wgsl).toContain('var<workgroup> tile: array<f32, 4>;');
  });
});

describe('workgroup memory takes no initializer', () => {
  it('offers the per-invocation line spelled as the author wrote the inner type', () => {
    refused(
      'interface P { a: f32; }\nlet w: workgroup<P> = { a: 1. };',
      noInitializer('w', ', or make it per-invocation: let w: P.'),
    );
    refused(
      'let w: workgroup<array<f32, 64>> = [];',
      noInitializer('w', ', or make it per-invocation: let w: array<f32, 64>.'),
    );
    refused(
      'let w: workgroup<vec2> = vec2(0., 0.);',
      noInitializer('w', ', or make it per-invocation: let w: vec2.'),
    );
  });

  it('withholds the offer for an atomic, which a private variable cannot hold', () => {
    refused('let w: workgroup<atomic<u32>> = 0;', noInitializer('w', '.'));
  });
});

describe('a resource written as a let quotes the declare line to write', () => {
  it('adds read_write to a storage buffer that names no mode, and keeps a mode as written', () => {
    refused(
      'let dst: storage<array<f32>>;',
      needsDeclare('dst', 'storage', 'declare const dst: storage<array<f32>, "read_write">'),
    );
    refused(
      'let dst: storage<array<f32>, "read">;',
      needsDeclare('dst', 'storage', 'declare const dst: storage<array<f32>, "read">'),
    );
  });

  it('names a shape, not a line, for a storage with no type argument', () => {
    refused('let s: storage;', needsDeclare('s', 'storage', 'declare const s: storage<...>'));
  });

  it('quotes a uniform as written', () => {
    refused('let u: uniform<f32>;', needsDeclare('u', 'uniform', 'declare const u: uniform<f32>'));
  });

  it('refuses a const that names a space and says to write let', () => {
    refused(
      'const u: workgroup<f32> = 1.;',
      'TS8033: "u" is a module variable and is declared with let, not const: let u: workgroup<T>. A const is a module constant (§12).',
    );
  });
});

describe('what a module variable may hold', () => {
  it('refuses an atomic in a private variable, through a struct and an array', () => {
    refused('let a: atomic<u32>;', atomicIn('a', 'atomic<u32>'));
    refused('interface S { c: atomic<u32>; }\nlet a: S;', atomicIn('a', 'S'));
    refused('let a: array<atomic<u32>, 4>;', atomicIn('a', 'array<atomic<u32>, 4>'));
    refused('interface S { c: array<atomic<u32>, 4>; }\nlet a: S;', atomicIn('a', 'S'));
  });

  it('refuses a runtime-sized array and names the size to give', () => {
    refused(
      'let a: workgroup<array<f32>>;',
      'TS8033: "a" cannot be a workgroup<array<f32>>: a runtime-sized array lives in a storage binding only; give this one a size, array<f32, 64>.',
    );
  });

  it('refuses an optional value', () => {
    refused(
      'let a: f32 | undefined;',
      'TS8002: "f32 | undefined" holds a value and a flag saying whether it is there, which a local, a parameter, a function\'s result, a struct field or an array element may hold; a module variable may not. Carry a u32 flag beside the value, "f32".',
    );
  });
});

describe('an initializer is a constant', () => {
  it('says one sentence for a spread, before the list is counted', () => {
    refused(
      'let a: array<f32, 2> = [...[1., 2.]];',
      'TS8013: "...[1., 2.]" spreads into a list, which a shader array does not do: write the elements one by one.',
    );
  });

  it('names a call of a function of the file as no constant', () => {
    refused(
      'function g(): f32 { return 1.; }\nlet a = g();',
      'TS8033: "a" needs a constant initializer (a literal, a module const, arithmetic or a math builtin over those); "g()" is not one. Assign it inside the entry.',
    );
  });

  it('asks for a type or an initializer', () => {
    refused('let a;', 'TS8033: "a" needs a type or an initializer: let a: f32, or let a = 0.');
  });
});

describe("a let that holds a function or an override is another collector's refusal", () => {
  it('says const for a destructured function value', () => {
    refused(
      'let { sqrt } = Math;',
      'TS8099: "Math.sqrt" is a function, and a shader has no function values: bind it with const, const { sqrt } = Math. A let would hold a function value.',
    );
  });

  it('says const for an override, once', () => {
    refused('let q: override<f32> = 1.;', 'TS8014: override "q" must be const, not let.');
  });

  it('says const for a local function, once', () => {
    refused(
      'let g = (x: f32): f32 => x;',
      'TS8020: "g" is a function, so it is declared with const; a "let" would let the name point at another one, which no shader value does.',
    );
  });
});

describe('a static field the file writes is a module variable', () => {
  it('is named Class_field and per-invocation', () => {
    const halves = bothTake(
      program(
        'class C { static n: u32 = 0; static bump(): void { C.n = C.n + 1; } }\n' +
          '@compute([1]) export function run(): void { C.bump(); }',
      ).replace('@compute([1]) export function main(): void { }\n', ''),
    );
    expect(halves.result.wgsl).toContain('var<private> C_n: u32 = 0u;');
  });
});

describe('the initializer of a module variable is folded from constants', () => {
  it('takes a literal, a module const, arithmetic, a math builtin, a struct and an array', () => {
    const halves = bothTake(
      program(
        `const K = 2.;
interface P { a: f32; b: vec2 }
let a = K * 2. + sqrt(K);
let b: P = { a: 1., b: vec2(2., 3.) };
let c: array<f32, 2> = [K, 1.];
let v = vec3(K, 1., 2.) * 2.;
let m = max(vec2(K, 1.), vec2(0.5));`,
      ),
    );
    const wgsl = halves.result.wgsl ?? '';
    expect(wgsl).toContain('var<private> a: f32 = ((K * 2.0) + sqrt(K));');
    expect(wgsl).toContain('var<private> b: P = P(1.0, vec2<f32>(2.0, 3.0));');
    expect(wgsl).toContain('var<private> c: array<f32, 2> = array<f32, 2>(K, 1.0);');
    expect(wgsl).toContain('var<private> v: vec3<f32> =');
    expect(wgsl).toContain('var<private> m: vec2<f32> =');
  });

  it('takes written integers as an integer, as a function does', () => {
    const halves = bothTake(
      program(
        `const K = 1;\nconst J = 2;\nlet f = K | J;\nexport function g(): i32 { f = f + 1; return f; }`,
      ),
    );
    expect(halves.result.wgsl).toContain('var<private> f: i32 = 3;');
  });

  it('reads this in the initializer of a static field as the class', () => {
    const halves = bothTake(
      program(
        `class S { static a: f32 = 1.; static b: f32 = this.a + 1.; static bump(): void { S.b = S.b + 1.; } }\nexport function g(): void { S.bump(); }`,
      ),
    );
    expect(halves.result.wgsl).toContain('var<private> S_b: f32 = (S_a + 1.0);');
  });

  it('names a static field as Class.field when its initializer is no constant', () => {
    refused(
      `function h(): f32 { return 1.; }\nclass S { static a: f32 = 1.; static b: f32 = h(); static bump(): void { S.a = S.a + 1.; S.b = 2.; } }\nexport function g(): void { S.bump(); }`,
      'TS8033: "S.b" needs a constant initializer (a literal, a module const, arithmetic or a math builtin over those); "h()" is not one. Assign it inside the entry.',
    );
  });
});
