// `new` on a class the file declares (#86, and the DX note on it). A shader has no heap, and
// for a while the diagnostic said so first: "`new` allocates a JS object. Use struct types and
// vec constructors, or a class the file declares." A reader met that on the first `new` they
// wrote and concluded `new` was out, which it is not. This file pins the opposite: every
// ordinary `new` on a declared class compiles, and each thing that is refused says its own
// reason rather than blaming the allocation.

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileTsSource } from './source-file.js';
import { TS_CODES } from './codes.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`);

const file = (head: string, body: string) => `"use typeshade"
${head}@fragment
export function fs(): vec4 {
${body}
}
`;
const agree = (r: ReturnType<typeof compile>, expected: number[]): void => {
  for (const make of [compileModule, compileModuleJs]) {
    expect(make(r.module).fns['fs']!(), make.name).toEqual(expected);
  }
};

describe('a class the file declares is built with new', () => {
  it('with a constructor, and without one', () => {
    const withCtor = compile(
      file(
        `class P {
  x: f32
  y: f32
  constructor(x: f32, y: f32) {
    this.x = x
    this.y = y
  }
}
`,
        `  const p = new P(1., 2.)\n  return vec4(p.x, p.y, 0., 1.)`,
      ),
    );
    expect(withCtor.diagnostics).toEqual([]);
    expect(withCtor.wgsl).toContain('let p = P_new(1.0, 2.0);');
    agree(withCtor, [1, 2, 0, 1]);
    // No constructor: TypeScript's implicit one, which takes nothing and zeroes the fields.
    const without = compile(
      file(
        `class P {\n  x: f32\n  y: f32\n}\n`,
        `  const p = new P()\n  return vec4(p.x, p.y, 0., 1.)`,
      ),
    );
    expect(without.diagnostics).toEqual([]);
    agree(without, [0, 0, 0, 1]);
  });

  it('with field initializers, in a method, as an argument, and on a derived class', () => {
    const inits = compile(
      file(
        `class P {\n  x: f32 = 3.\n  y: f32 = 4.\n}\n`,
        `  const p = new P()\n  return vec4(p.x, p.y, 0., 1.)`,
      ),
    );
    expect(inits.diagnostics).toEqual([]);
    agree(inits, [3, 4, 0, 1]);
    const inMethod = compile(
      file(
        `class V {
  x: f32
  constructor(x: f32) {
    this.x = x
  }
  scaled(k: f32): V {
    return new V(this.x * k)
  }
}
function take(v: V): f32 {
  return v.x
}
`,
        `  const v = new V(2.)\n  return vec4(v.scaled(3.).x, take(new V(5.)), 0., 1.)`,
      ),
    );
    expect(inMethod.diagnostics).toEqual([]);
    expect(inMethod.wgsl).toContain('return V_new((self_.x * k));');
    expect(inMethod.wgsl).toContain('take(V_new(5.0))');
    agree(inMethod, [6, 5, 0, 1]);
    const derived = compile(
      file(
        `class B {\n  x: f32 = 1.\n}\nclass D extends B {\n  y: f32 = 2.\n}\n`,
        `  const d = new D()\n  return vec4(d.x, d.y, 0., 1.)`,
      ),
    );
    expect(derived.diagnostics).toEqual([]);
    agree(derived, [1, 2, 0, 1]);
  });
});

describe('what a new is refused on says its own reason', () => {
  const TAIL = `\n@fragment\nexport function fs(): vec4 {\n  return vec4(1.)\n}\n`;

  it('a name the file does not declare as a class', () => {
    expect(
      errorsOf(
        `"use typeshade"\nfunction g(): f32 {\n  const d = new Date()\n  return 1.\n}${TAIL}`,
      )[0],
    ).toBe(
      `${TS_CODES.HOST_STMT} A class this file declares is built with "new", and "Date" is not one of them. "new" on anything else allocates a JS object, which a shader has no heap for.`,
    );
  });

  it('an interface or a type alias, which carry no constructor', () => {
    const message = (name: string) =>
      `${TS_CODES.HOST_STMT} "${name}" is a type, not a value: an interface and a type alias declare a shape and carry no constructor. Write the object literal, { field: value }, or declare "${name}" as a class to give it one.`;
    expect(
      errorsOf(
        file(`interface P {\n  x: f32\n}\n`, `  const p = new P()\n  return vec4(p.x, 0., 0., 1.)`),
      )[0],
    ).toBe(message('P'));
    expect(
      errorsOf(
        file(`type Q = {\n  x: f32\n}\n`, `  const q = new Q()\n  return vec4(q.x, 0., 0., 1.)`),
      )[0],
    ).toBe(message('Q'));
  });

  it('an abstract class, once and not twice', () => {
    expect(
      errorsOf(
        file(
          `abstract class S {
  k: f32
  abstract area(): f32
}
class Q extends S {
  s: f32
  area(): f32 {
    return this.s
  }
}
`,
          `  const q = new S()\n  return vec4(q.k, 0., 0., 1.)`,
        ),
      )[0],
    ).toBe(
      `${TS_CODES.HOST_STMT} "S" is abstract, so there is no instance of it to build. Construct a class that extends it.`,
    );
  });

  it('a class of statics alone, which emits no struct to build', () => {
    // Before this it emitted `fn U_new() -> U` with no `struct U` anywhere, which Tint refuses,
    // and reported nothing at all.
    expect(
      errorsOf(
        file(
          `class U {\n  static half(x: f32): f32 {\n    return x * 0.5\n  }\n}\n`,
          `  const u = new U()\n  return vec4(U.half(2.), 0., 0., 1.)`,
        ),
      )[0],
    ).toBe(
      `${TS_CODES.CLASS_MEMBER} "U" declares only static members, so it is a group of functions and there is no value of it to build. Call "U.f(...)" directly.`,
    );
  });

  it('arguments to a class that declares no constructor, naming both ways to write it', () => {
    expect(
      errorsOf(
        file(
          `class P {\n  x: f32\n  y: f32\n}\n`,
          `  const p = new P(1., 2.)\n  return vec4(p.x, p.y, 0., 1.)`,
        ),
      )[0],
    ).toBe(
      `${TS_CODES.ARITY_MISMATCH} "P" declares no constructor, so "new P()" takes no arguments, as it does in TypeScript. Declare a constructor to pass values, or write the fields: { x: ..., y: ... }.`,
    );
  });
});
