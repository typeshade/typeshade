// Member and component assignment in "use typeshade" (#8 A2): `v.x = 0.`, `o.pos = …`,
// `ps[i].a = 1.` and `v.x += 1.` write through a field, a single vector component or an
// element, as WGSL, GLSL ES 3.00 and the fn() EDSL's `v.x.assign(…)` do. A swizzle naming
// more than one component is rejected, as WGSL rejects it.

import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';
import { compile } from './compile.js';
import { typeKey } from '../../core/ir/types.js';
import type { Expr, ModuleDecl, Stmt } from '../../core/ir/nodes.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';

const STRUCTS = `
  class P {
    a: f32
    b: f32
  }
`;

function lowerBody(source: string): readonly Stmt[] {
  const r = compileTsSource(`"use typeshade";\n${source}`);
  expect(r.diagnostics).toEqual([]);
  return r.funcs[0]!.body;
}

function diagnose(source: string): string {
  const r = compileTsSource(`"use typeshade";\n${source}`);
  expect(r.diagnostics.length).toBeGreaterThan(0);
  return r.diagnostics[0]!.message;
}

function code(source: string): string | undefined {
  const r = compileTsSource(`"use typeshade";\n${source}`);
  expect(r.diagnostics.length).toBeGreaterThan(0);
  return r.diagnostics[0]!.code;
}

function expectMember(e: Expr, field: string, type: string, base: (x: Expr) => void): void {
  expect(e.op).toBe('member');
  if (e.op !== 'member') return;
  expect(e.field).toBe(field);
  expect(typeKey(e.type)).toBe(type);
  base(e.base);
}

const varref = (name: string, type: string) => (x: Expr) => {
  expect(x.op).toBe('varref');
  if (x.op === 'varref') expect(x.name).toBe(name);
  expect(typeKey(x.type)).toBe(type);
};

describe('component assignment', () => {
  it('lowers v.x = a to an assign whose target is a member of the var', () => {
    const body = lowerBody(`
      export function f(a: f32): vec3 {
        let v = vec3(0.);
        v.x = a;
        return v;
      }
    `);
    const s = body[1]!;
    expect(s.s).toBe('assign');
    if (s.s !== 'assign') return;
    expectMember(s.target, 'x', 'f32', varref('v', 'vec3<f32>'));
    expect(s.expr.op).toBe('param');
  });

  it('accepts an rgba component and keeps the spelling the author wrote', () => {
    const body = lowerBody(`
      export function f(a: f32): vec4 {
        let c = vec4(0.);
        c.r = a;
        c.a = 1.;
        return c;
      }
    `);
    const first = body[1]!;
    const second = body[2]!;
    if (first.s !== 'assign' || second.s !== 'assign') throw new Error('expected two assigns');
    expectMember(first.target, 'r', 'f32', varref('c', 'vec4<f32>'));
    expectMember(second.target, 'a', 'f32', varref('c', 'vec4<f32>'));
  });

  it('lowers v.x += 1. to an assignOp on the member', () => {
    const body = lowerBody(`
      export function f(): vec3 {
        let v = vec3(0.);
        v.x += 1.;
        return v;
      }
    `);
    const s = body[1]!;
    expect(s.s).toBe('assignOp');
    if (s.s !== 'assignOp') return;
    expect(s.bop).toBe('+');
    expectMember(s.target, 'x', 'f32', varref('v', 'vec3<f32>'));
    expect(s.expr).toEqual({ op: 'lit', type: expect.anything(), value: 1 });
    expect(typeKey(s.expr.type)).toBe('f32');
  });

  it('takes the component kind for a bare integer literal in v.x += 1', () => {
    const body = lowerBody(`
      export function f(): vec3u {
        let v = vec3u(u32(1), u32(2), u32(3));
        v.x += 1;
        return v;
      }
    `);
    const s = body[1]!;
    if (s.s !== 'assignOp') throw new Error(`expected an assignOp, got ${s.s}`);
    expect(typeKey(s.expr.type)).toBe('u32');
  });

  it('lowers v.z++ to an assignOp, so the target is written once', () => {
    // A member target is read AND written by the assign-of-binop form, and CSE hoisting that
    // repeated read into an immutable `let` is what made a storage-rooted `++` emit invalid
    // WGSL. The compound form names the lvalue once.
    const body = lowerBody(`
      export function f(): vec3 {
        let v = vec3(0.);
        v.z++;
        return v;
      }
    `);
    const s = body[1]!;
    if (s.s !== 'assignOp') throw new Error(`expected an assignOp, got ${s.s}`);
    expect(s.bop).toBe('+');
    expectMember(s.target, 'z', 'f32', varref('v', 'vec3<f32>'));
    expect(s.expr).toEqual({ op: 'lit', type: expect.anything(), value: 1 });
  });

  it('keeps a bare name on the assign-of-binop form, so its emit does not move', () => {
    const body = lowerBody(`
      export function f(): i32 {
        let i: i32 = 0;
        i++;
        return i;
      }
    `);
    const s = body[1]!;
    if (s.s !== 'assign') throw new Error(`expected an assign, got ${s.s}`);
    expect(s.expr.op).toBe('binop');
  });

  it('rejects ++ on a target there is nothing to add 1 to', () => {
    expect(
      diagnose(`
        export function f(): bool {
          let b = true;
          b++;
          return b;
        }
      `),
    ).toBe('Cannot apply ++ to bool: ++ steps a numeric scalar (f32, i32, u32, f64).');
    expect(
      diagnose(`
        ${STRUCTS}
        export function f(x: f32): f32 {
          let p: P = { a: x, b: 0. };
          p--;
          return p.a;
        }
      `),
    ).toBe('Cannot apply -- to struct:P: -- steps a numeric scalar (f32, i32, u32, f64).');
  });
});

describe('field assignment', () => {
  it('lowers o.a = x on a struct local', () => {
    const body = lowerBody(`
      ${STRUCTS}
      export function f(x: f32): f32 {
        let p: P = { a: 0., b: 0. };
        p.a = x;
        return p.a;
      }
    `);
    const s = body[1]!;
    if (s.s !== 'assign') throw new Error(`expected an assign, got ${s.s}`);
    expectMember(s.target, 'a', 'f32', varref('p', 'struct:P'));
  });

  it('lowers a field of an element: ps[i].a = 1.', () => {
    const body = lowerBody(`
      ${STRUCTS}
      declare const ps: storage<array<P>, "read_write">
      @compute([64, 1, 1])
      export function k(@builtin("global_invocation_id") gid: vec3u) {
        ps[gid.x].a = 1.;
      }
    `);
    const s = body[0]!;
    if (s.s !== 'assign') throw new Error(`expected an assign, got ${s.s}`);
    expect(s.target.op).toBe('member');
    if (s.target.op !== 'member') return;
    expect(s.target.field).toBe('a');
    expect(s.target.base.op).toBe('index');
  });

  it('lowers a component of a field: o.pos.x = 2.', () => {
    const body = lowerBody(`
      class VsOut {
        @builtin("position") pos: vec4
        @location(0) uv: vec2
      }
      @vertex
      export function vs(@location(0) p: vec2): VsOut {
        let o: VsOut = { pos: vec4(p, 0., 1.), uv: p };
        o.pos.x = 2.;
        return o;
      }
    `);
    const s = body[1]!;
    if (s.s !== 'assign') throw new Error(`expected an assign, got ${s.s}`);
    expect(s.target.op).toBe('member');
    if (s.target.op !== 'member') return;
    expect(s.target.field).toBe('x');
    expect(s.target.base.op).toBe('member');
    if (s.target.base.op !== 'member') return;
    expect(s.target.base.field).toBe('pos');
  });
});

describe('emitted text', () => {
  const RENDER = `
    "use typeshade";
    class VsOut {
      @builtin("position") pos: vec4;
      @location(0) uv: vec2;
    }
    class Color {
      @location(0) color: vec4;
    }
    @vertex
    export function vs(@location(0) p: vec2): VsOut {
      let o: VsOut = { pos: vec4(p, 0., 1.), uv: p };
      o.pos.x = o.pos.x * 2.;
      return o;
    }
    @fragment
    export function fs(v: VsOut): Color {
      let c = vec4(0.);
      c.r = v.uv.x;
      c.a = 1.;
      return { color: c };
    }
  `;

  it('emits the member assignment verbatim in WGSL', () => {
    const c = compile(RENDER);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(c.wgsl).toContain('o.pos.x = (o.pos.x * 2.0);');
    expect(c.wgsl).toContain('c.r = v.uv.x;');
    expect(c.wgsl).toContain('c.a = 1.0;');
  });

  it('emits the member assignment verbatim in GLSL ES 3.00', () => {
    const c = compile(RENDER);
    expect(c.glsl?.vertex).toContain('o.pos.x = (o.pos.x * 2.0);');
    expect(c.glsl?.fragment).toContain('c.r = uv.x;');
    expect(c.glsl?.fragment).toContain('c.a = 1.0;');
  });

  it('emits a compound component assignment as WGSL `+=`', () => {
    const c = compile(`
      "use typeshade";
      export function f(): vec3 {
        let v = vec3(0.);
        v.x += 1.;
        return v;
      }
    `);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(c.wgsl).toContain('v.x += 1.0;');
  });

  it('emits a field write through an element in WGSL', () => {
    const c = compile(`
      "use typeshade";
      ${STRUCTS}
      declare const ps: storage<array<P>, "read_write">
      @compute([64, 1, 1])
      export function k(@builtin("global_invocation_id") gid: vec3u) {
        ps[gid.x].a = 1.;
        ps[gid.x].b += 2.;
      }
    `);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(c.wgsl).toContain('ps[gid.x].a = 1.0;');
    expect(c.wgsl).toContain('ps[gid.x].b += 2.0;');
  });
});

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

describe('rejections', () => {
  it('rejects a swizzle naming more than one component, as WGSL does', () => {
    const src = `
      export function f(a: f32): vec3 {
        let v = vec3(0.);
        v.xy = vec2(a, a);
        return v;
      }
    `;
    expect(diagnose(src)).toBe(
      'Cannot assign to the swizzle ".xy" — WGSL writes one component at a time. ' +
        'Assign each component (e.g. v.x = …; v.y = …), or build a whole vec3<f32> and assign that.',
    );
    expect(code(src)).toBe('TS8018');
  });

  it('rejects a multi-component rgba swizzle too', () => {
    expect(
      diagnose(`
        export function f(a: f32): vec4 {
          let c = vec4(0.);
          c.rg = vec2(a, a);
          return c;
        }
      `),
    ).toContain('Cannot assign to the swizzle ".rg"');
  });

  it('rejects a write through a parameter', () => {
    const src = `
      export function f(v: vec3): vec3 {
        v.x = 1.;
        return v;
      }
    `;
    expect(diagnose(src)).toBe(
      'Cannot write through parameter "v" — parameters are not writable. Use a local or storage.',
    );
    expect(code(src)).toBe('TS8018');
  });

  it('rejects a write through a const local', () => {
    const src = `
      export function f(a: f32): vec3 {
        const v = vec3(0.);
        v.x = a;
        return v;
      }
    `;
    expect(diagnose(src)).toBe('Cannot assign to "v" — it is declared with const.');
    expect(code(src)).toBe('TS8005');
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
    ).toBe('Unknown field "c" on struct:P.');
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
    ).toBe('.z out of range on vec2<f32>.');
  });
});

describe('a write through a storage binding survives the optimizer', () => {
  // The lvalue occurs twice in the source here, and its root is a `constref` (how this
  // surface spells a binding read). CSE used to hoist the whole `ps[…]` navigation into an
  // immutable `let` and rewrite the store into it — `let _cse1 = ps[i]; _cse1.b = …` — which
  // Tint rejects with "cannot assign to value of type 'f32'". The guard is targetRoot /
  // refsLocal in src/core/passes/opt/expr-utils.ts, pinned there too.
  const COMPUTED = `
    "use typeshade";
    ${STRUCTS}
    declare const ps: storage<array<P>, "read_write">
    @compute([64, 1, 1])
    export function k(@builtin("global_invocation_id") gid: vec3u) {
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
      @compute([64, 1, 1])
      export function k(@builtin("global_invocation_id") gid: vec3u) {
        ps[gid.x * u32(2) + u32(1)].a++;
      }
    `);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(c.wgsl).toMatch(/ps\[[^\]]*\]\.a \+= 1\.0;/);
  });
});

/** One module from source, for a test that needs BOTH CPU backends rather than `compile()`'s
 *  single `eval`: the interpreter and the generator have to agree bit for bit. */
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

describe('what ++ and -- step', () => {
  it('steps an emulated double, which the fp64 pass lowers', () => {
    // The steppable check rejected f64 when it was first written, which broke a program that
    // compiled: `s++` on an emulated double emits a df64 add, and Tint takes it. A check
    // meant to stop an invalid emit must not reject a valid one.
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
    // Measured against origin/main before narrowing the check: `v++` on a `vec3` and on a
    // `vec3f64` alike came back as `TS8015 Backend emit failed: … SD0017 … vec constant with no
    // valueExpr`, because the step is built as ONE literal of the target's type and no vector
    // literal has a spelling. So this refuses nothing that compiled; it moves the failure to
    // the source, where the message can name the addition to write instead.
    expect(
      diagnose('export function f(): vec3 {\n  let v = vec3(1., 2., 3.);\n  v++;\n  return v;\n}'),
    ).toBe(
      'Cannot apply ++ to vec3<f32>: a vector has no literal to step by. Write the addition out, e.g. v = v + vec3(1., 1., 1.).',
    );
    expect(
      diagnose(`
        declare const vs: storage<array<vec3f64>, "read_write">
        @compute([64, 1, 1])
        export function k(@builtin("global_invocation_id") gid: vec3u) {
          vs[gid.x]++;
        }
      `),
    ).toBe(
      'Cannot apply ++ to vec3<f64>: a vector has no literal to step by. Write the addition out.',
    );
  });

  it('names an addition to write only where that addition compiles', () => {
    // The `e.g.` clause is carried by the vector kinds whose written-out addition is accepted:
    // the native ones. `v + vec2i(1, 1)` compiles since #8 A3 typed a literal inside a vector
    // constructor from its element, and no filling of `vec3f64(...)` compiles at all, so that
    // kind names no example rather than one the compiler then refuses. Each spelling below was
    // compiled to check which way it goes.
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
    // ...and the integer example is one that compiles, which is what earns it the clause.
    expect(
      compileTsSource(
        '"use typeshade";\nexport function f(x: i32): vec2i {\n  let v = vec2i(x, x);\n  v = v + vec2i(1, 1);\n  return v;\n}',
      ).diagnostics,
    ).toEqual([]);
  });

  it('declares the df64 helper the f64 step calls, on a member and on an element', () => {
    // The fp64 pass's f64 arm of `assignOp` emitted `df64_add(...)` without registering the
    // helper (`ctx.used.add`), which its vec64 arm does — so the module called a function it
    // never declared and Tint rejected it. Reachable through the member and element `++` this
    // item adds, and through the `xs[i] += y` that was already there.
    for (const [program, helper] of [
      [
        `"use typeshade";
        declare const xs: storage<array<f64>, "read_write">;
        @compute([64, 1, 1])
        export function k(@builtin("global_invocation_id") gid: vec3u) {
          xs[gid.x]++;
        }`,
        'fn df64_add(',
      ],
      [
        `"use typeshade";
        declare const xs: storage<array<f64>, "read_write">;
        @compute([64, 1, 1])
        export function k(@builtin("global_invocation_id") gid: vec3u) {
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
        @compute([64, 1, 1])
        export function k(@builtin("global_invocation_id") gid: vec3u) {
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

  it('leaves the source struct alone when the copy is written', () => {
    const c = compile(`
      "use typeshade";
      ${STRUCTS}
      export function f(p: P): f32 {
        let q: P = p;
        q.a = 100.;
        return p.a;
      }
    `);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
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

  it('rejects an element write through a parameter', () => {
    expect(
      diagnose(`
        class C {
          xs: array<f32, 4>
        }
        export function f(p: C, i: i32): f32 {
          p.xs[i] = 1.;
          return p.xs[0];
        }
      `),
    ).toBe(
      'Cannot write through parameter "p" — parameters are not writable. Use a local or storage.',
    );
  });

  it('still takes the element writes that were always legal', () => {
    const c = compile(`
      "use typeshade";
      declare const xs: storage<array<f32>, "read_write">;
      @compute([64, 1, 1])
      export function k(@builtin("global_invocation_id") gid: vec3u) {
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
