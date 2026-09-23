import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';

describe('constant loop bounds', () => {
  it('accepts i < 16', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): i32 {
        let s: i32 = 0;
        for (let i: i32 = 0; i < 16; i++) s = s + i;
        return s;
      }
    `);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  });

  it('accepts a const LIMIT bound', () => {
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

  it('accepts i < n (runtime bound, Rule 7.5)', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(n: i32): i32 {
        let s: i32 = 0;
        for (let i: i32 = 0; i < n; i++) s = s + i;
        return s;
      }
    `);
    expect(r.diagnostics).toEqual([]);
  });

  it('accepts while (true) with a break, an open loop (Rule 7.5)', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): void {
        while (true) { break; }
      }
    `);
    expect(r.diagnostics).toEqual([]);
  });

  it('rejects while (true) with no way out', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): f32 {
        let a = 0.;
        while (true) {
          a += 1.;
          for (let i: i32 = 0; i < 4; i++) { if (a > 8.) { break; } }
          switch (i32(a)) { case 3: { break; } default: { a += 1.; } }
        }
        return a;
      }
    `);
    // Both breaks leave something else: the inner for, and the switch.
    expect(r.diagnostics.map((d) => d.code)).toEqual(['TS8007']);
    expect(r.diagnostics[0]!.message).toMatch(/^while \(true\) has no break or return/);
  });

  it('rejects for (;;)', () => {
    const r = compileTsSource(`
      "use typeshade";
      export function f(): void {
        for (;;) { break; }
      }
    `);
    expect(r.diagnostics.some((d) => /exit condition|infinite/i.test(d.message))).toBe(true);
  });
});
