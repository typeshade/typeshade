// Verifies: Rule 11.22 (docs/language-design.md; traced in reqs/).
// ═══ The `finite-math` contract and the inlining boundary (change 0107, surface §78) ═══
//
// Each rewrite fires in a function that opted in and nowhere else, keeps an operand that has an
// effect, and never reaches an `f64` operand. The CPU oracle keeps the source's meaning, so a NaN
// or an infinity still reads as the source says there. No inlining pass moves a body across the
// boundary of an opted-in function, in either direction. Each source is read on both halves
// (Rule 12.7).

import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { compileModule } from '../oracle.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import type { ModuleDecl } from '../ir/index.js';
import { finiteMath } from './finite-math.js';
import { inlineLinearAll } from './inline-linear.js';
import { restructureCalls } from './restructure-calls.js';
import { forceInline } from './force-inline.js';
import { autoInline } from './auto-inline.js';
import { inlineFn } from './inline.js';
import { outsideContracts } from './contract-boundary.js';

/** Compiles `body` on both halves, which must both accept it, and returns the result. */
function accepted(body: string): ReturnType<typeof compile> {
  const src = `"use typeshade";\n${body}\n`;
  const result = compile(src, { fileName: 'fm.shade.ts' });
  expect(result.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([]);
  const service = createTypeshadeLanguageService();
  service.openDocument('fm.shade.ts', src);
  expect(service.getDiagnostics('fm.shade.ts')).toEqual([]);
  return result;
}

/** The text of `fn name(` through its closing brace in a WGSL text. */
function fnText(wgsl: string, name: string): string {
  const at = wgsl.indexOf(`fn ${name}(`);
  expect(at, `fn ${name} is emitted`).toBeGreaterThanOrEqual(0);
  return wgsl.slice(at, wgsl.indexOf('\n}\n', at) + 2);
}

/** The same body, once under the contract and once exact. */
const PAIR = (
  body: string,
): string => `const relaxed = numerics(["finite-math"], function relaxed(x: f32, a: vec3f, b: vec3f): vec4f {
  ${body}
});
function exact(x: f32, a: vec3f, b: vec3f): vec4f {
  ${body}
}
export const fs = fragment(function fs(p: builtin<"position", vec4f>): vec4f {
  return relaxed(p.x, p.xyz, p.zyx) + exact(p.y, p.zyx, p.xyz);
});`;

describe('the finite-math rewrites (change 0107)', () => {
  it('folds x * 0, 0 * x and x - x to zero in the opted-in function only', () => {
    const r = accepted(
      PAIR(`let s = sin(x);
  return vec4f(s * 0., 0. * cos(x), s - s, 1.);`),
    );
    const wgsl = r.wgsl ?? '';
    expect(fnText(wgsl, 'relaxed')).not.toMatch(/\* 0\.0|0\.0 \*|\(s - s\)/);
    expect(fnText(wgsl, 'exact')).toMatch(/\(s \* 0\.0\)/);
    expect(fnText(wgsl, 'exact')).toMatch(/\(0\.0 \* cos\(x\)\)/);
    expect(fnText(wgsl, 'exact')).toMatch(/\(s - s\)/);
  });

  it('folds mix(a, b, 0) to a and mix(a, b, 1) to b in the opted-in function only', () => {
    const r = accepted(PAIR(`return vec4f(mix(a, b, 0.) + mix(a, b, 1.), 1.);`));
    const wgsl = r.wgsl ?? '';
    expect(fnText(wgsl, 'relaxed')).not.toContain('mix(');
    expect(fnText(wgsl, 'relaxed')).toMatch(/\(a \+ b\)/);
    expect(fnText(wgsl, 'exact').match(/mix\(/g)).toHaveLength(2);
  });

  it('keeps the oracle exact: NaN, an infinity and a signed zero read as the source says', () => {
    const r = accepted(`const relaxed = numerics(["finite-math"], function relaxed(x: f32): vec4f {
  return vec4f(x * 0., x - x, mix(x, 1., 0.), mix(1., x, 1.));
});
export const fs = fragment(function fs(p: builtin<"position", vec4f>): vec4f {
  return relaxed(p.x);
});`);
    const relaxed = compileModule(r.module).fns['relaxed']!;
    const [m0, d0] = relaxed(NaN) as number[];
    expect(m0).toBeNaN();
    expect(d0).toBeNaN();
    const [mi, di] = relaxed(Infinity) as number[];
    expect(mi).toBeNaN();
    expect(di).toBeNaN();
    expect(Object.is((relaxed(-2) as number[])[0], -0)).toBe(true);
    // The emitted function folds all four: the GPU result differs from the oracle only outside
    // the contract's domain, and in the sign of a zero.
    expect(fnText(r.wgsl ?? '', 'relaxed')).toMatch(/vec4<f32>\(0\.0, 0\.0, x, x\)/);
  });

  it('keeps an operand that has an effect', () => {
    const r = accepted(`declare const buf: storage<array<f32>, "read_write">;
function bump(): f32 {
  buf[0] = buf[0] + 1.;
  return 2.;
}
const relaxed = numerics(["finite-math"], function relaxed(x: f32): f32 {
  return bump() * 0. + x;
});
export const main = compute([1], function main(gid: builtin<"global_invocation_id", vec3u>) {
  buf[gid.x] = relaxed(1.);
});`);
    // The front end reads the call in its own statement, so the fold drops the product and the
    // call stays.
    expect(fnText(r.wgsl ?? '', 'relaxed')).toMatch(/bump\(\)/);
  });

  it('never reaches an f64 operand', () => {
    const r = accepted(`const relaxed = numerics(["finite-math"], function relaxed(x: f32): f32 {
  const d = f64(x);
  return f32(d * f64(0.) + (d - d));
});
export const fs = fragment(function fs(p: builtin<"position", vec4f>): vec4f {
  return vec4f(relaxed(p.x));
});`);
    const relaxed = r.module!.funcs.find((f) => f.name === 'relaxed')!;
    expect(finiteMath(r.module!).funcs.find((f) => f.name === 'relaxed')).toEqual(relaxed);
    const text = fnText(r.wgsl ?? '', 'relaxed');
    expect(text).toMatch(/df64_mul/);
    expect(text).toMatch(/df64_sub/);
  });

  it('is the identity on a module where no function opted in', () => {
    const r = accepted(`function exact(x: f32): vec4f {
  return vec4f(x * 0., x - x, 0., 1.);
}
export const fs = fragment(function fs(p: builtin<"position", vec4f>): vec4f {
  return exact(p.x);
});`);
    expect(finiteMath(r.module!)).toBe(r.module);
  });
});

describe('the inlining boundary (change 0107, item 6)', () => {
  const SOURCE = `function helper(x: f32): f32 {
  return x * 2.;
}
const relaxed = numerics(["finite-math"], function relaxed(x: f32): f32 {
  return helper(x) + 1.;
});
function caller(x: f32): f32 {
  return relaxed(x) * 3.;
}
export const fs = fragment(function fs(p: builtin<"position", vec4f>): vec4f {
  return vec4f(caller(p.x), helper(p.y), 0., 1.);
});`;

  /** The names `name`'s body calls in `m`. */
  const callsOf = (m: ModuleDecl, name: string): string[] => {
    const out: string[] = [];
    JSON.stringify(m.funcs.find((f) => f.name === name)?.body, (k, v: unknown) => {
      if (k === 'fn' && typeof v === 'string') out.push(v);
      return v;
    });
    return out;
  };

  it.each([
    ['inlineLinearAll', (m: ModuleDecl) => inlineLinearAll(m)],
    ['forceInline', (m: ModuleDecl) => forceInline(m, 'all')],
    ['autoInline', (m: ModuleDecl) => autoInline(m)],
    ['inlineFn(relaxed)', (m: ModuleDecl) => inlineFn(m, 'relaxed')],
    ['inlineFn(helper)', (m: ModuleDecl) => inlineFn(m, 'helper')],
    ['restructureCalls', (m: ModuleDecl) => restructureCalls(m)],
  ])('%s neither inlines the opted-in function nor inlines into it', (_, pass) => {
    const m = accepted(SOURCE).module!;
    const out = pass(m);
    const before = m.funcs.find((f) => f.name === 'relaxed');
    expect(
      out.funcs.find((f) => f.name === 'relaxed'),
      'kept as it was',
    ).toBe(before);
    expect(callsOf(out, 'relaxed')).toContain('helper');
    expect(
      out.funcs.some((f) => f.name === 'helper'),
      'its callee is kept',
    ).toBe(true);
    if (out.funcs.some((f) => f.name === 'caller'))
      expect(callsOf(out, 'caller')).toContain('relaxed');
  });

  it('runs the pass unwrapped on a module with no contract', () => {
    const m = accepted(
      SOURCE.replace(
        'const relaxed = numerics(["finite-math"], function relaxed(x: f32): f32 {\n  return helper(x) + 1.;\n});',
        'function relaxed(x: f32): f32 {\n  return helper(x) + 1.;\n}',
      ),
    ).module!;
    expect(m.funcs.some((f) => f.numerics !== undefined)).toBe(false);
    let seen: ModuleDecl | undefined;
    outsideContracts(m, (x) => (seen = x));
    expect(seen).toBe(m);
  });
});
