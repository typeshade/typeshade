import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';
import { TS_CODES } from './codes.js';

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`);
const file = (head: string, body: string) => `"use typeshade"
${head}@fragment export function fs(): vec4 {
${body}
}
`;

describe('what inheritance refuses, and why', () => {
  it('a base this file does not declare, a cycle, and a field that changes type', () => {
    expect(
      errorsOf(
        file(
          `class D extends Missing {\n  y: f32\n}\n`,
          `  const d: D = { y: 1. }\n  return vec4(d.y, 0., 0., 1.)`,
        ),
      )[0],
    ).toBe(
      `${TS_CODES.UNKNOWN_TYPE} Unknown type "Missing". Declare it in this file, or import it from another shader module.`,
    );
    expect(
      errorsOf(
        file(
          `enum Missing {\n  A = 1,\n}\nclass D extends Missing {\n  y: f32\n}\n`,
          `  const d: D = { y: 1. }\n  return vec4(d.y, 0., 0., 1.)`,
        ),
      )[0],
    ).toBe(
      `${TS_CODES.STRUCT_FIELD} "D" extends "Missing", which this file does not declare as a struct. A base has to be a class or an interface whose fields are shader types.`,
    );
    expect(
      errorsOf(
        file(
          `class A extends B {\n  a: f32\n}\nclass B extends A {\n  b: f32\n}\n`,
          `  const v: A = { a: 1. }\n  return vec4(v.a, 0., 0., 1.)`,
        ),
      )[0],
    ).toContain('extends itself, through');
    expect(
      errorsOf(
        file(
          `class A {\n  x: i32\n}\nclass B extends A {\n  x: f32\n}\n`,
          `  const v: B = { x: 1. }\n  return vec4(v.x, 0., 0., 1.)`,
        ),
      )[0],
    ).toBe(
      `${TS_CODES.STRUCT_FIELD} "B" declares "x" as f32, and "A" declares it as i32. A struct has one layout, so a field cannot change type on the way down.`,
    );
  });

  it('a base-typed name holding a derived override, with the reason', () => {
    const HEAD = `class Base {\n  x: f32\n  value(): f32 { return this.x }\n}\nclass Derived extends Base {\n  y: f32\n  value(): f32 { return this.y }\n}\n`;
    const note =
      ' "Derived" extends "Base", and a name typed as the base cannot hold a derived value ' +
      'here without a proven read-only, dispatch-equivalent base view. ' +
      'Keep "Derived" as the type to preserve its methods and receiver writes.';
    expect(
      errorsOf(
        file(
          HEAD,
          `  const d: Derived = { x: 1., y: 2. }\n  const b: Base = d\n  return vec4(b.x, 0., 0., 1.)`,
        ),
      )[0],
    ).toContain(note);
    expect(
      errorsOf(`"use typeshade"
${HEAD}function take(b: Base): f32 {
  return b.x
}
@fragment export function fs(): vec4 {
  const d: Derived = { x: 1., y: 2. }
  return vec4(take(d), 0., 0., 1.)
}
`)[0],
    ).toContain(note);
  });

  it('a generic base is its instance, and a call is read as the mixin it looks like', () => {
    expect(
      errorsOf(
        file(
          `class Box<T> {\n  v: f32\n}\nclass D extends Box<f32> {\n  y: f32\n}\n`,
          `  const d: D = { v: 1., y: 2. }\n  return vec4(d.v, 0., 0., 1.)`,
        ),
      ),
    ).toEqual([]);
    expect(
      errorsOf(
        file(
          `class Base {\n  x: f32\n}\nfunction mix2(b: f32): f32 {\n  return b\n}\nclass D extends mix2(1.) {\n  y: f32\n}\n`,
          `  const d: D = { y: 2. }\n  return vec4(d.y, 0., 0., 1.)`,
        ),
      ).join(' '),
      // A call in an `extends` is the mixin pattern now (T8, #92), so what this says is why
      // `mix2` is not one, rather than that a base may not be an expression at all.
    ).toContain('so its body has to be one "return class');
  });
});
