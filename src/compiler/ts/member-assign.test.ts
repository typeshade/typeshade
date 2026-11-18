// Verifies: Rule 6.2 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import type { ModuleDecl } from '../../core/ir/nodes.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { withEditor } from '../../core/testing/both-halves.js';

const STRUCTS = `
  class P {
    a: f32
    b: f32
  }
`;

function first(source: string): { code?: string; message: string } {
  const r = withEditor(compileTsSource)(`"use typeshade";\n${source}`);
  expect(r.diagnostics.length).toBeGreaterThan(0);
  return r.diagnostics[0]!;
}

const diagnose = (source: string): string => first(source).message;
const code = (source: string): string | undefined => first(source).code;

function buildModule(body: string): ModuleDecl {
  const r = compileTsSource(`"use typeshade";\n${body}`);
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return {
    consts: [...r.consts],
    structs: r.structs.map((x) => x.decl),
    bindings: [...r.bindings],
    funcs: [...r.funcs],
  };
}

describe('rejections', () => {
  it('rejects a swizzle that names a component twice (change 0106)', () => {
    const src = `
      export function f(a: f32): vec3 {
        let v = vec3(0.);
        v.xx = vec2(a, a);
        return v;
      }
    `;
    expect(diagnose(src)).toBe(
      'Cannot assign to the swizzle ".xx" — it names ".x" twice, so two writes would land on ' +
        'one component. Name each component once.',
    );
    expect(code(src)).toBe('TS8018');
  });

  it('accepts a swizzle of distinct components, xyzw and rgba alike (change 0106)', () => {
    // Before change 0106 these were TS8018; src/compiler/ts/swizzle-assign.test.ts holds what
    // they lower to and compute.
    for (const target of ['v.xy', 'v.zx', 'c.rg', 'c.bar']) {
      const r = compileTsSource(`"use typeshade";
export function f(a: f32): vec4 {
  let v = vec4(0.);
  let c = vec4(0.);
  ${target} = ${target.length === 4 ? 'vec2(a, a)' : 'vec3(a, a, a)'};
  return v + c;
}`);
      expect(r.diagnostics, target).toEqual([]);
    }
  });

  it('rejects a write through a parameter', () => {
    const src = `
      export function f(v: vec3): vec3 {
        v.x = 1.;
        return v;
      }
    `;
    expect(diagnose(src)).toBe(
      'Cannot write through parameter "v" — parameters are not writable. Use a local or storage. ' +
        "To change the caller's value, return it, and write [a, b] = f(a, b) for more than one.",
    );
    expect(code(src)).toBe('TS8018');
  });

  it('rejects a write through a const local that may hold another value', () => {
    // `const v = vec3(0.)` holds a value nothing else does, and is written through as
    // TypeScript's `const` is (Rule 6.10); `const v = w` may be one `w` holds, which TypeScript
    // would change with it and a copy here would not.
    const src = `
      export function f(a: f32): vec3 {
        let w = vec3(0.);
        const v = w;
        v.x = a;
        return v;
      }
    `;
    expect(diagnose(src)).toBe(
      '"v" is a const, and a write to a component of it changes it. Declare it with let to write it.',
    );
    expect(code(src)).toBe('TS8005');
  });

  it('writes through a const local that holds a fresh value, which becomes a var', () => {
    const r = compileTsSource(`"use typeshade";
      export function f(a: f32): vec3 {
        const v = vec3(0.);
        v.x = a;
        return v;
      }
    `);
    expect(r.diagnostics).toEqual([]);
    expect(r.funcs[0]!.body[0]!.s).toBe('var');
  });

  it('rejects a write through a read-only resource', () => {
    const src = `
      class C {
        pos: vec3
      }
      declare const cam: uniform<C>
      export function f(a: f32): vec3 {
        cam.pos.x = a;
        return cam.pos;
      }
    `;
    expect(diagnose(src)).toBe('Cannot assign to "cam" — it is a read-only resource.');
    expect(code(src)).toBe('TS8005');
  });

  it('rejects a chain rooted in an unknown name', () => {
    const src = `
      export function f(a: f32): f32 {
        q.x = a;
        return a;
      }
    `;
    expect(diagnose(src)).toBe('Cannot assign to unknown name "q".');
    // TS8022, the same code the bare-identifier arm gives the same sentence: an unresolved
    // root is an unknown name, not a target of the wrong shape (which is what TS8018 says).
    expect(code(src)).toBe('TS8022');
  });

  it('rejects a chain rooted in something that is not a name', () => {
    const src = `
      export function f(a: f32): f32 {
        vec3(0.).x = a;
        return a;
      }
    `;
    expect(diagnose(src)).toBe(
      'Assignment target must be a name, or a field, component or element of one.',
    );
    expect(code(src)).toBe('TS8018');
  });

  it('rejects a value of the wrong type for the component', () => {
    expect(
      diagnose(`
        export function f(a: vec2): vec3 {
          let v = vec3(0.);
          v.x = a;
          return v;
        }
      `),
    ).toContain('Type mismatch');
  });

  it('rejects an unknown field on a struct target', () => {
    expect(
      diagnose(`
        ${STRUCTS}
        export function f(x: f32): f32 {
          let p: P = { a: 0., b: 0. };
          p.c = x;
          return p.a;
        }
      `),
    ).toBe('Unknown field "c" on P.');
  });

  it('rejects a component out of range on the target vector', () => {
    expect(
      diagnose(`
        export function f(a: f32): vec2 {
          let v = vec2(0.);
          v.z = a;
          return v;
        }
      `),
    ).toBe('.z out of range on vec2.');
  });
});

describe('binding a value to another name copies it, as it does on the GPU', () => {
  it('leaves the source vector alone when the copy is written', () => {
    const c = compile(`
      "use typeshade";
      export function f(x: f32): f32 {
        let v = vec3(x, 0., 0.);
        let w = v;
        w.x = 100.;
        return v.x;
      }
    `);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    // `var w = v` is a value copy in WGSL and GLSL; the CPU oracle used to alias the two.
    expect(c.wgsl).toContain('var w: vec3<f32> = v;');
    expect(c.eval('f', [3])).toBe(3);
  });

  it('writes the source struct when a second name of it is written, as JavaScript does (change 0142)', () => {
    const src = `"use typeshade";
      ${STRUCTS}
      export function f(p: P): f32 {
        let q: P = p;
        q.a = 100.;
        return p.a;
      }
    `;
    const c = compile(src);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const service = createTypeshadeLanguageService();
    service.openDocument('a.shade.ts', src);
    expect(service.getDiagnostics('a.shade.ts').filter((d) => d.severity === 'error')).toEqual([]);
    expect(c.eval('f', [{ a: 3, b: 0 }])).toBe(100);
  });

  it('leaves the source struct alone when a spread copy is written, as JavaScript does', () => {
    const src = `"use typeshade";
      ${STRUCTS}
      export function f(p: P): f32 {
        let q: P = { ...p };
        q.a = 100.;
        return p.a;
      }
    `;
    const c = compile(src);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const service = createTypeshadeLanguageService();
    service.openDocument('a.shade.ts', src);
    expect(service.getDiagnostics('a.shade.ts').filter((d) => d.severity === 'error')).toEqual([]);
    expect(c.eval('f', [{ a: 3, b: 0 }])).toBe(3);
  });

  it('copies on ASSIGNMENT too, not only on a binding', () => {
    // The binding half alone left the hole open: `w = v` stores without binding, so both CPU
    // backends kept one array under two names and a later `w.x = 100.` reached through to
    // `v` — 100 on the CPU where WGSL and GLSL both give 3. Asserted on the interpreter AND
    // the generator, since the two have to stay bit-identical.
    const module = buildModule(`
      export function viaVector(x: f32): f32 {
        let v = vec3(x, 0., 0.);
        let w = vec3(0., 0., 0.);
        w = v;
        w.x = 100.;
        return v.x;
      }
      export function viaField(x: f32): f32 {
        let a = vec3(0., x, 0.);
        let b = vec3(0., 0., 0.);
        b = a;
        b.y = 100.;
        return a.y;
      }
    `);
    for (const cpu of [compileModule(module), compileModuleJs(module)]) {
      expect(cpu.fns.viaVector!(3)).toBe(3);
      expect(cpu.fns.viaField!(4)).toBe(4);
    }
  });

  it('does not copy a compound assignment result, which is already fresh', () => {
    // `w += u` builds its value with applyBin, which maps into a NEW array, so there is
    // nothing to alias and neither backend clones there — a copy per compound assignment in a
    // hot loop, bought for nothing. Pinned so the two backends stay symmetric about it.
    const module = buildModule(`
      export function f(x: f32): f32 {
        let v = vec3(x, 0., 0.);
        let w = vec3(0., 0., 0.);
        w = v;
        w += vec3(10., 10., 10.);
        return v.x;
      }
    `);
    for (const cpu of [compileModule(module), compileModuleJs(module)]) {
      expect(cpu.fns.f!(1)).toBe(1);
    }
  });
});

describe('the root rule reaches an element target too', () => {
  it('rejects an element write through a read-only resource', () => {
    expect(
      diagnose(`
        class C {
          xs: array<f32, 4>
        }
        declare const cam: uniform<C>
        export function f(i: i32): f32 {
          cam.xs[i] = 1.;
          return cam.xs[0];
        }
      `),
    ).toBe('Cannot assign to "cam" — it is a read-only resource.');
  });

  it("takes an element write through a struct parameter: the caller's object (change 0142)", () => {
    const src = `"use typeshade";
        class C {
          xs: array<f32, 4>;
        }
        export function f(p: C, i: i32): f32 {
          p.xs[i] = 1.;
          return p.xs[0];
        }
      `;
    const c = compile(src);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(c.wgsl).toContain('p: ptr<function, C>');
    const service = createTypeshadeLanguageService();
    service.openDocument('a.shade.ts', src);
    expect(service.getDiagnostics('a.shade.ts').filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('still rejects an element write through a vector parameter', () => {
    expect(
      diagnose(`
        export function f(p: vec3, i: i32): f32 {
          p[i] = 1.;
          return p[0];
        }
      `),
    ).toMatch(/parameter "p"/);
  });

  it('still takes the element writes that were always legal', () => {
    const c = compile(`
      "use typeshade";
      declare const xs: storage<array<f32>, "read_write">;
      @compute([64, 1, 1]) export function k(gid: builtin<"global_invocation_id">) {
        xs[gid.x] = 1.;
      }
    `);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(c.wgsl).toContain('xs[gid.x] = 1.0;');
  });

  it('sees through parentheses on a whole-name target', () => {
    const r = compileTsSource(`"use typeshade";
      export function f(a: vec3): vec3 {
        let v = vec3(0.);
        (v) = a;
        return v;
      }
    `);
    expect(r.diagnostics).toEqual([]);
  });
});
