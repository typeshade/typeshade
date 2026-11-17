// Verifies: Rule 6.2 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';
import { compile } from './compile.js';

const STRUCTS = `
  class P {
    a: f32
    b: f32
  }
`;

function diagnose(source: string): string {
  const r = compileTsSource(`"use typeshade";\n${source}`);
  expect(r.diagnostics.length).toBeGreaterThan(0);
  return r.diagnostics[0]!.message;
}

describe('the CPU oracle evaluates the same writes', () => {
  it('evaluates component writes in place', () => {
    const c = compile(`
      "use typeshade";
      export function f(a: f32): vec3 {
        let v = vec3(0.);
        v.x = a;
        v.y += 1.;
        v.z++;
        return v;
      }
    `);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(c.eval('f', [2.5])).toEqual([2.5, 1, 1]);
  });

  it('evaluates field writes in place', () => {
    const c = compile(`
      "use typeshade";
      ${STRUCTS}
      export function g(x: f32): f32 {
        let p: P = { a: x, b: 0. };
        p.b = p.a * 2.;
        p.a += 1.;
        return p.a + p.b;
      }
    `);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(c.eval('g', [3])).toBe(10);
  });
});

describe('a write through a storage binding survives the optimizer', () => {
  const COMPUTED = `
    "use typeshade";
    ${STRUCTS}
    declare const ps: storage<array<P>, "read_write">
    @compute([64, 1, 1]) export function k(gid: builtin<"global_invocation_id">) {
      ps[gid.x + u32(1)].b = ps[gid.x + u32(1)].a * ps[gid.x + u32(1)].a;
    }
  `;

  it('stores into the buffer, not into a hoisted temp', () => {
    const c = compile(COMPUTED);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(c.wgsl).toMatch(/ps\[[^\]]*\]\.b = /);
    expect(c.wgsl).not.toMatch(/_\w+\.b = /);
    expect(c.wgsl).not.toMatch(/let \w+ = ps\[[^\]]*\];/);
  });

  it('increments a storage field through the compound form, with one load', () => {
    const c = compile(`
      "use typeshade";
      ${STRUCTS}
      declare const ps: storage<array<P>, "read_write">
      @compute([64, 1, 1]) export function k(gid: builtin<"global_invocation_id">) {
        ps[gid.x * u32(2) + u32(1)].a++;
      }
    `);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(c.wgsl).toMatch(/ps\[[^\]]*\]\.a \+= 1\.0;/);
  });
});

describe('what ++ and -- step', () => {
  it('steps an emulated double, which the fp64 pass lowers', () => {
    const r = compileTsSource(`"use typeshade";
      class U {
        x: f64;
      }
      declare const u: uniform<U>;
      export function f(): f64 {
        let s = u.x;
        s++;
        return s;
      }
    `);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('s = df64_add(s, vec2<f32>(1.0, 0.0), _fp64_g);');
  });

  it('still refuses the shapes that have no numeric step', () => {
    expect(diagnose('export function f(): bool {\n  let q = true;\n  q++;\n  return q;\n}')).toBe(
      'Cannot apply ++ to bool: ++ steps a numeric scalar (f32, i32, u32, f64).',
    );
  });

  it('refuses a vector, which has no literal to step by on either target', () => {
    expect(
      diagnose('export function f(): vec3 {\n  let v = vec3(1., 2., 3.);\n  v++;\n  return v;\n}'),
    ).toBe(
      'Cannot apply ++ to vec3: a vector has no literal to step by. Write the addition out, e.g. v = v + vec3(1., 1., 1.).',
    );
    expect(
      diagnose(`
        declare const vs: storage<array<vec3f64>, "read_write">
        @compute([64, 1, 1]) export function k(gid: builtin<"global_invocation_id">) {
          vs[gid.x]++;
        }
      `),
    ).toBe(
      'Cannot apply ++ to vec3f64: a vector has no literal to step by. Write the addition out.',
    );
  });

  it('names an addition to write only where that addition compiles', () => {
    expect(
      diagnose('export function f(): vec3 {\n  let v = vec3(1., 2., 3.);\n  v++;\n  return v;\n}'),
    ).toContain('e.g. v = v + vec3(1., 1., 1.)');
    expect(
      compileTsSource(
        '"use typeshade";\nexport function f(x: f32): vec3 {\n  let v = vec3(x, x, x);\n  v = v + vec3(1., 1., 1.);\n  return v;\n}',
      ).diagnostics,
    ).toEqual([]);

    for (const [program, hint] of [
      [
        'export function f(x: i32): vec2i {\n  let v = vec2i(x, x);\n  v++;\n  return v;\n}',
        'e.g. v = v + vec2i(1, 1)',
      ],
      [
        'export function f(x: u32): vec3u {\n  let v = vec3u(x, x, x);\n  v++;\n  return v;\n}',
        'e.g. v = v + vec3u(1, 1, 1)',
      ],
    ] as const) {
      expect(diagnose(program)).toContain(hint);
    }
    expect(
      compileTsSource(
        '"use typeshade";\nexport function f(x: i32): vec2i {\n  let v = vec2i(x, x);\n  v = v + vec2i(1, 1);\n  return v;\n}',
      ).diagnostics,
    ).toEqual([]);
  });

  it('declares the df64 helper the f64 step calls, on a member and on an element', () => {
    for (const [program, helper] of [
      [
        `"use typeshade";
        declare const xs: storage<array<f64>, "read_write">;
        @compute([64, 1, 1]) export function k(gid: builtin<"global_invocation_id">) {
          xs[gid.x]++;
        }`,
        'fn df64_add(',
      ],
      [
        `"use typeshade";
        declare const xs: storage<array<f64>, "read_write">;
        @compute([64, 1, 1]) export function k(gid: builtin<"global_invocation_id">) {
          xs[gid.x]--;
        }`,
        'fn df64_sub(',
      ],
      [
        `"use typeshade";
        class P {
          a: f64;
        }
        declare const ds: storage<array<P>, "read_write">;
        @compute([64, 1, 1]) export function k(gid: builtin<"global_invocation_id">) {
          ds[gid.x].a++;
        }`,
        'fn df64_add(',
      ],
    ] as const) {
      const r = compileTsSource(program);
      expect(r.diagnostics).toEqual([]);
      expect(r.wgsl).toContain(helper);
    }
  });
});
