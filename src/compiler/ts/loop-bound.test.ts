import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';
import { bothRefuse } from '../../core/testing/both-halves.js';

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
    // Both breaks leave something else: the inner for, and the switch.
    bothRefuse(
      `
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
    `,
      'TS8007',
      'while (true) has no break or return in its body, so it never ends. Leave it with a ' +
        'break, or write the exit into the condition.',
    );
  });

  it('takes for (;;) with a break, and refuses one with no way out (change 0136)', () => {
    const open = compileTsSource(`
      "use typeshade";
      export function f(): void {
        for (;;) { break; }
      }
    `);
    expect(open.diagnostics).toEqual([]);
    bothRefuse(
      `
      "use typeshade";
      export function f(): void {
        let a = 0.;
        for (;;) { a += 1.; }
      }
    `,
      'TS8007',
      'for (;;) has no break or return in its body, so it never ends. Leave it with a ' +
        'break, or write the exit into the condition.',
    );
  });
});
