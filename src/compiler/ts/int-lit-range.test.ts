// Verifies: Rule 5.1, Rule 5.2 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';
import { bothHalves, bothTake } from '../../core/testing/both-halves.js';

const USE = '"use typeshade";\n';

function wgslOf(source: string): string {
  bothTake(`${USE}${source}`);
  return compileTsSource(`${USE}${source}`).wgsl!;
}

function refused(source: string): ReturnType<typeof bothHalves>['result'] {
  const halves = bothHalves(`${USE}${source}`);
  expect(halves.editor).toContain(halves.compiler[0]);
  return halves.result;
}

function diagnose(source: string): string {
  return refused(source).diagnostics[0]!.message;
}

describe('an integer literal out of range for its declared type (§13: "the value has to fit")', () => {
  // `const a: u32 = 4294967296` was told "cannot let/const a u32 and f32 — no implicit
  // int/float conversion", a conversion the author never wrote. Every declared integer
  // position now says what §13 says: the value has to fit. One diagnostic, TS8003, the code
  // the scalar casts' and module constants' range checks already use.
  const U32 = 'u32, which holds 0 to 4294967295 (§13).';
  const I32 = 'i32, which holds -2147483648 to 2147483647 (§13).';
  function only(source: string): { code?: string; message: string } {
    const r = refused(source);
    expect(r.diagnostics).toHaveLength(1);
    return { code: r.diagnostics[0]!.code, message: r.diagnostics[0]!.message };
  }
  const fn = (body: string, ret = 'u32'): string =>
    `class Id { id: u32 }\nfunction g(a: u32): u32 { return a; }\nexport function f(): ${ret} {\n${body}\n}`;

  it('reports the §13 sentence at every declared integer position', () => {
    for (const [body, want] of [
      ['  const a: u32 = 4294967296;\n  return a;', `4294967296 is outside ${U32}`],
      ['  const a: u32 = -1;\n  return a;', `-1 is outside ${U32}`],
      ['  let a: u32 = 4294967296;\n  return a;', `4294967296 is outside ${U32}`],
      ['  const a: i32 = 2147483648;\n  return u32(a);', `2147483648 is outside ${I32}`],
      ['  const a: i32 = -2147483649;\n  return u32(a);', `-2147483649 is outside ${I32}`],
      ['  let a: i32 = 0;\n  a = 2147483648;\n  return u32(a);', `2147483648 is outside ${I32}`],
      [
        '  for (let k: u32 = 4294967296; k < 1; k++) {}\n  return 0;',
        `4294967296 is outside ${U32}`,
      ],
      ['  return 4294967296;', `4294967296 is outside ${U32}`],
      ['  return g(4294967296);', `4294967296 is outside ${U32}`],
      ['  const s: Id = { id: 4294967296 };\n  return s.id;', `4294967296 is outside ${U32}`],
      ['  return vec2u(4294967296, 1).x;', `4294967296 is outside ${U32}`],
      [
        '  const c = true;\n  const t: u32 = c ? 1 : 4294967296;\n  return t;',
        `4294967296 is outside ${U32}`,
      ],
      ['  const a: u32 = 4294967295 + 1;\n  return a;', `4294967296 is outside ${U32}`],
    ] as const) {
      const d = only(fn(body));
      expect(d.message, body).toBe(`The value has to fit: ${want}`);
      expect(d.code, body).toBe('TS8003');
    }
  });

  it('reports it for a module-scope variable too', () => {
    const d = only(
      'let counter: u32 = 4294967296;\nexport function f(): u32 {\n  return counter;\n}',
    );
    expect(d.message).toBe(`The value has to fit: 4294967296 is outside ${U32}`);
  });

  it('points at the literal, not the declaration', () => {
    const r = compileTsSource(
      `"use typeshade";\nexport function f(): u32 {\n  const a: u32 = 4294967296;\n  return a;\n}`,
    );
    expect(r.diagnostics[0]!.line).toBe(3);
    expect(r.diagnostics[0]!.character).toBe(18);
  });

  it('leaves the edges, and a float written as a float, as they were', () => {
    expect(
      wgslOf('export function f(): u32 {\n  let a: u32 = 4294967295;\n  return a;\n}'),
    ).toContain('4294967295u');
    expect(
      wgslOf('export function f(): i32 {\n  let b: i32 = -2147483648;\n  return b;\n}'),
    ).toContain('-2147483648');
    // Written as a float: not an integer literal, so the int/float mismatch is the right one.
    expect(diagnose('export function f(): u32 {\n  const a: u32 = 1.5;\n  return a;\n}')).toContain(
      'no implicit int/float conversion',
    );
  });
});
