import { describe, expect, it } from 'vitest';
import { compile } from '../compile.js';
import { bothHalves, bothRefuse, bothTake } from '../../../core/testing/both-halves.js';

const KERNEL = (body: string): string => `"use typeshade";
declare const src: storage<array<f32>>;
declare const dst: storage<array<f32>, "read_write">;
@compute([64, 1, 1]) export function k(gid: builtin<"global_invocation_id">): void {
${body}
}
`;

describe('.length of an array', () => {
  it('reads the buffer through a local that copies a storage binding, however long the chain', () => {
    const halves = bothTake(
      KERNEL(
        '  const a = src;\n  const b = a;\n  if (gid.x >= b.length) { return; }\n  dst[gid.x] = b[gid.x];',
      ),
    );
    expect(halves.result.wgsl).toContain('if ((gid.x >= arrayLength(&src))) {');
  });

  it('is the i32 constant of the size for a sized array', () => {
    const halves = bothTake(`"use typeshade";
export function f(): i32 {
  const xs = array<f32, 3>(1., 2., 3.);
  return xs.length;
}
`);
    expect(halves.result.wgsl).toContain('return 3;');
  });
});

describe('a static read', () => {
  it('of a field whose initializer was refused adds nothing to that refusal', () => {
    bothRefuse(
      `"use typeshade";
class K {
  static A = nope();
}
export function f(): f32 { return K.A; }
`,
      'TS8004',
      'Unknown function "nope". Declare it in this file, or import it from another shader module.',
    );
  });

  it('of a method names the call to write', () => {
    bothRefuse(
      `"use typeshade";
class K {
  static m(x: f32): f32 { return x; }
}
export function f(): f32 { const g = K.m; return 1.; }
`,
      'TS8022',
      '"K.m" is a function; call it: K.m(...).',
    );
  });
});

describe('a static read of a name another member spells', () => {
  it('answers only as the member written, `n` beside a private `#n`', () => {
    bothRefuse(
      `"use typeshade";
class K {
  static #n(x: f32): f32 { return x; }
}
export function f(): f32 { return K.n; }
`,
      'TS8022',
      '"K" has no static field "n".',
    );
  });
});

describe('a member read', () => {
  it('through a struct nothing declares adds nothing to the refusal of its type', () => {
    bothRefuse(
      `"use typeshade";
declare const u: uniform<Foo>;
export function f(): f32 { return u.a; }
`,
      'TS8002',
      'Unknown type "Foo". Declare it in this file, or import it from another shader module.',
    );
  });

  it('names the member in an unknown-field sentence, and suggests only a field it may name', () => {
    bothRefuse(
      `"use typeshade";
class C { #count: f32 = 1.; width: f32 = 2.; }
export function f(c: C): f32 { return c.cont; }
`,
      'TS8022',
      'Unknown field "cont" on C.',
    );
    bothRefuse(
      `"use typeshade";
class C { #count: f32 = 1.; width: f32 = 2.; }
export function f(c: C): f32 { return c.widht; }
`,
      'TS8022',
      'Unknown field "widht" on C. Did you mean "width"?',
    );
  });

  it('puts the unknown-field sentence on the name of the member', () => {
    const source = `"use typeshade";
class C { width: f32 = 2.; }
export function f(c: C): f32 { return c.zzz; }
`;
    const [d] = compile(source).diagnostics;
    expect(source.slice(d!.start, d!.start + d!.length)).toBe('zzz');
  });

  it('takes the type a use decided for a field its base class declares', () => {
    const halves = bothTake(`"use typeshade";
class B { n = 0; }
class D extends B { }
export function f(x: u32): u32 { const d = new D(); d.n = x; return d.n; }
`);
    expect(halves.result.wgsl).toMatch(/n: u32/);
  });
});

describe('an object literal', () => {
  it('names a destructuring default instead of reading it as a value', () => {
    const halves = bothHalves(`"use typeshade";
export function f(): f32 { const a = 1.; const o = { a = 2. }; return 1.; }
`);
    expect(halves.compiler).toEqual([
      'typeshade TS8099: "a = ..." is a destructuring default, not a field value. Write "a: ..." instead.',
    ]);
    expect(halves.editor).toContain(
      'typeshade TS8099: "a = ..." is a destructuring default, not a field value. Write "a: ..." instead.',
    );
  });

  it('where a Record is expected is the table of its keys', () => {
    bothTake(`"use typeshade";
export function f(): f32 { const r: Record<"a" | "b", f32> = { a: 1., b: 2. }; return r.a + r.b; }
`);
  });

  it('adds nothing for a field the struct withholds', () => {
    const halves = bothHalves(`"use typeshade";
class P { a: f32 = 1.; b; }
export function f(): f32 { const o: P = { a: 1., b: 2. }; return o.a; }
`);
    const sentence = 'typeshade TS8010: Field "b" on "P" needs a type: write "b: T".';
    expect(halves.compiler).toEqual([sentence]);
    expect([...new Set(halves.editor.filter((d) => d.startsWith('typeshade ')))]).toEqual([
      sentence,
    ]);
  });
});
