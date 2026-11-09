import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';
import { compile } from './compile.js';

describe('Phase 9 for', () => {
  it('lowers for (let i: i32 = 0; i < 16; i++)', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): i32 {
        let s: i32 = 0;
        for (let i: i32 = 0; i < 16; i++) {
          s = s + i;
        }
        return s;
      }
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.funcs[0]!.body.some((s) => s.s === 'for')).toBe(true);
    expect(r.wgsl).toMatch(/for\s*\(/);
  });

  it('accepts i += 2 and a folded 4 * 4 bound', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): i32 {
        let s: i32 = 0;
        for (let i: i32 = 0; i < 4 * 4; i += 2) s = s + i;
        return s;
      }
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  });

  it('accepts a local const LIMIT bound', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): i32 {
        const LIMIT: i32 = 8;
        let s: i32 = 0;
        for (let i: i32 = 0; i < LIMIT; i++) s = s + i;
        return s;
      }
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  });

  it('takes a runtime bound the body writes as an open loop (Rule 7.5, change 0136)', () => {
    // This was `TS8006 for bound reads "n", which the loop body writes, so it does not bound
    // the loop. Read it into a const before the loop, or write the loop as a while.`
    const src = `
      "use typeshade";
      export function f(n0: i32): i32 {
        let s: i32 = 0;
        let n: i32 = n0;
        for (let i: i32 = 0; i < n; i++) { s = s + i; n = n - 1; }
        return s;
      }
    `;
    const r = compileTsSource(src);
    expect(r.diagnostics).toEqual([]);
    // i = 0, 1, 2 against n = 6, 5, 4: the bound moves, and the loop ends where it meets it.
    expect(compile(src).eval('f', [6])).toBe(3);
  });

  it('rejects i-- against i < 8', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): i32 {
        let s: i32 = 0;
        for (let i: i32 = 0; i < 8; i--) s = s + i;
        return s;
      }
    `);
    expect(r.diagnostics.some((d) => /does not exit|step/.test(d.message))).toBe(true);
  });

  it('lowers while (i < 8)', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): i32 {
        let i: i32 = 0;
        while (i < 8) { i++; }
        return i;
      }
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.funcs[0]!.body.some((s) => s.s === 'for')).toBe(true);
  });

  it('allows break inside for', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): i32 {
        let s: i32 = 0;
        for (let i: i32 = 0; i < 8; i++) {
          if (i > 3) break;
          s = s + i;
        }
        return s;
      }
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  });
});
