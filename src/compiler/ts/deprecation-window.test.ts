// The deprecation window's option, with no window open (Rule 13.10, change 0134).
//
// `compile(src, { deprecations: true })` and `checkDocuments(docs, { deprecations: true })`
// are the mechanism of Rule 13.10: a change of meaning warns behind the option one release
// before it moves. Change 0134 retired the one warning the option had, `TS8053`: a number
// takes its type from its uses and no default is left for an author to learn, so no
// declaration "types as f32 today and will type as i32". The option stays for a later window.
// Until one opens it reports nothing and moves no emitted byte, in both halves.
//
// Verifies: Rule 13.10 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { TS_CODES } from './codes.js';
import { checkDocuments } from '../../language-service/check.js';

// Every declaration `TS8053` warned on: a local, a module constant, a literal-only
// expression, a module variable, a field and a static field, each written as an integer and
// decided by no declared use.
const SRC = `"use typeshade";
const K = 5;
let calls = 0;
class P {
  n = 0;
  static S = 3;
}
export function f(xs: array<f32, 4>): f32 {
  let i = 0;
  const n = 2 + 3;
  let x = 5.;
  let y: f32 = 7;
  const p = new P();
  calls += 1;
  return xs[i32(i)] + K + f32(n) + x + y + p.n + P.S;
}`;

describe('the deprecation option with no window open', () => {
  it('reports no warning on a program, with the option and without it', () => {
    expect(compile(SRC).diagnostics).toEqual([]);
    expect(compile(SRC, { deprecations: true }).diagnostics).toEqual([]);
  });

  it('moves no emitted byte', () => {
    const on = compile(SRC, { deprecations: true });
    const off = compile(SRC);
    expect(on.wgsl).toBeDefined();
    expect(on.wgsl).toBe(off.wgsl);
    expect(on.glsl).toEqual(off.glsl);
    expect(on.module).toEqual(off.module);
  });

  it('reports nothing through the language service check either', () => {
    const uri = '/app/deprecations.shade.ts';
    const docs = [{ path: uri, uri, text: SRC }];
    expect(checkDocuments(docs).diagnostics).toEqual([]);
    expect(checkDocuments(docs, { deprecations: true }).diagnostics).toEqual([]);
  });

  it('has no code for the retired warning', () => {
    // TS8053 is retired and its number is not reused (the head comment of codes.ts).
    expect(Object.values(TS_CODES)).not.toContain('TS8053');
    expect(Object.keys(TS_CODES)).not.toContain('INT_LITERAL_DEPRECATION');
  });
});
