import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';
import { TS_CODES } from './codes.js';

describe('Phase 12 semantic bans', () => {
  it('no longer bans console: the standard console is lowered, not refused', () => {
    // `console` left the list of refused host names when the JavaScript Console API became part
    // of the surface (src/core/console.ts): a call is lowered to a `console.<method>` call
    // statement that the CPU path delivers to the host's console sink. console.test.ts pins what
    // it lowers to and which methods are refused; this pins only that it compiles.
    const r = compileTsSource(`
      "use typeshade";
      export function f(): void {
        console.log(1.);
      }
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  });

  it('rejects fetch, as a function nothing declares', () => {
    // There is no list of host names (Rule 2.1): `fetch` is an unknown callee, said once on its
    // name, and the string handed to it is not lowered to say a second thing (host-names.test.ts).
    const r = compileTsSource(`
      "use typeshade";
      export function f(): f32 {
        fetch("x");
        return 1.;
      }
    `);
    expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([
      `${TS_CODES.UNKNOWN_FN} Unknown function "fetch". Declare it in this file, or import it from another shader module.`,
    ]);
  });

  it('rejects Date / new, as a name nothing declares', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): f32 {
        const t = new Date();
        return 1.;
      }
    `);
    expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([
      `${TS_CODES.UNKNOWN_NAME} Unknown identifier "Date".`,
    ]);
  });

  it('rejects await and async', () => {
    const r = compileTsSource(`
      "use typeshade";
      export async function f(): Promise<f32> {
        return await 1.;
      }
    `);
    expect(r.diagnostics.some((d) => d.code === TS_CODES.HOST_STMT)).toBe(true);
  });

  it('rejects for-in, and for-of over what is not an array', () => {
    // for-of over an array is a counted loop (Rule 7.5, for-of.test.ts); over a vector it is
    // refused where it is lowered, and for-in has no meaning on a shader value at all.
    const r = compileTsSource(`
      "use typeshade";
      export function f(xs: vec3): f32 {
        for (const x of xs) { }
        for (const k in xs) { }
        return 0.;
      }
    `);
    expect(
      r.diagnostics.some(
        (d) => d.code === TS_CODES.TYPE_MISMATCH && /for-of iterates an array/.test(d.message),
      ),
    ).toBe(true);
    expect(
      r.diagnostics.some((d) => d.code === TS_CODES.HOST_STMT && /for-in/.test(d.message)),
    ).toBe(true);
  });

  it('rejects try/catch', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): f32 {
        try { return 1.; } catch { return 0.; }
      }
    `);
    expect(r.diagnostics.some((d) => d.code === TS_CODES.HOST_STMT)).toBe(true);
  });

  it('a top-level let is a per-invocation variable (§24); var stays refused', () => {
    const ok = compileTsSource(`
      "use typeshade";
      let acc: f32 = 0.;
      export function f(): f32 { return acc; }
    `);
    expect(ok.diagnostics.some((d) => d.code === TS_CODES.TOP_LEVEL)).toBe(false);
    expect(ok.wgsl).toContain('var<private> acc: f32 = 0.0;');
    const r = compileTsSource(`
      "use typeshade";
      var acc: f32 = 0.;
      export function f(): f32 { return acc; }
    `);
    expect(r.diagnostics.some((d) => d.code === TS_CODES.TOP_LEVEL)).toBe(true);
  });

  it('still compiles a pure helper', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function add(a: f32, b: f32): f32 {
        return a + b;
      }
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.wgsl).toEqual(expect.any(String));
  });
});
