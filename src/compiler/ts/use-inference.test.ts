// A `let` of a written number takes its type from its uses (change 0134 items 1 and 3; Rule
// 5.1, surface §13; `docs/owner-decisions.md` OD-7).
//
// Each case reads BOTH halves on one source (Rule 12.7): `compile()` (its diagnostics with code
// and text, the WGSL, the value on the CPU oracle) and the language service (`getDiagnostics`,
// and `getHover` on the declaration, since the inferred type is the point).
//
// Verifies: Rule 5.1 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const service = (source: string) => {
  const s = createTypeshadeLanguageService();
  s.openDocument('a.shade.ts', source);
  return s;
};
const editor = (source: string): string[] =>
  service(source)
    .getDiagnostics('a.shade.ts')
    .map((d) => `${String(d.code)}: ${String(d.message)}`);
/** The editor's hover on the first `let <name>` of `source`. */
const hover = (source: string, name: string): string => {
  const s = service(source);
  const at = source.indexOf(`let ${name}`) + 4;
  return String(s.getHover('a.shade.ts', s.positionAt('a.shade.ts', at))?.contents);
};

const HEAD = `"use typeshade";
interface Q { id: u32; }
function h(a: u32): u32 { return a; }
`;
/** A module with one function over a `u32`, an `i32`, an `f32`, a `bool`, an array and an `f64`. */
const fn = (body: string, ret = 'u32'): string =>
  `${HEAD}export function t(vi: u32, ii: i32, x: f32, c: bool, xs: array<f32, 8>, d: f64): ${ret} {
  ${body}
}`;
const ARGS = [5, -3, 0.5, true, [1, 2, 3, 4, 5, 6, 7, 8], 2] as const;

/** Both halves accept `source`; the editor hovers `name` as `type`; returns the compile. */
const typed = (source: string, name: string, type: string) => {
  const result = compile(source);
  expect(result.diagnostics).toEqual([]);
  expect(editor(source)).toEqual([]);
  expect(hover(source, name)).toContain(`let ${name}: ${type}`);
  expect(result.wgsl).toContain(`var ${name}: ${type === 'f64' ? 'vec2<f32>' : type} = `);
  return result;
};

/** Both halves report exactly `messages`, each a `TS8003`. */
const refused = (source: string, messages: readonly string[]) => {
  const result = compile(source);
  expect(result.diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual(
    messages.map((m) => `TS8003: ${m}`),
  );
  expect(result.wgsl).toBeUndefined();
  expect(editor(source)).toEqual(messages.map((m) => `TS8003: ${m}`));
};

describe('the forms an author writes (the table of change 0134)', () => {
  it('a float accumulator: let acc = 0; acc += x', () => {
    const result = typed(fn('let acc = 0; acc += x; return acc;', 'f32'), 'acc', 'f32');
    expect(result.eval('t', ARGS)).toBe(0.5);
  });

  it('an integer accumulator: let n = 0; n += vi (refused before)', () => {
    const result = typed(fn('let n = 0; n += vi; n += vi; return n;'), 'n', 'u32');
    expect(result.wgsl).toContain('var n: u32 = 0u;');
    expect(result.eval('t', ARGS)).toBe(10);
  });

  it('a running maximum: let m = 0; m = max(m, vi) (refused before)', () => {
    const result = typed(fn('let m = 0; m = max(m, vi); return m;'), 'm', 'u32');
    expect(result.wgsl).toContain('m = max(m, vi);');
    expect(result.eval('t', ARGS)).toBe(5);
  });

  it('a counter used as an index: let j = 0; xs[j] (refused before)', () => {
    const result = typed(fn('let j = 0; j = j + 1; return xs[j];', 'f32'), 'j', 'i32');
    expect(result.eval('t', ARGS)).toBe(2);
  });

  it('bit flags: let f = 0; f = f | 4 (refused before)', () => {
    const result = typed(fn('let f = 0; f = f | 4; return u32(f);'), 'f', 'i32');
    expect(result.eval('t', ARGS)).toBe(4);
  });

  it('a number nothing decides stays the f32 the compiler chooses (item 3)', () => {
    const source = fn('let k = 7; let half = k / 2; return u32(half * 2);');
    const result = typed(source, 'k', 'f32');
    expect(hover(source, 'half')).toContain('let half: f32');
    // 3.5 * 2: the value is a float, as before the change (F14 of the proposal).
    expect(result.eval('t', ARGS)).toBe(7);
  });

  it('an explicit type still compiles: let k: u32 = 1', () => {
    const source = fn('let k: u32 = 1; k += vi; return k;');
    expect(compile(source).diagnostics).toEqual([]);
    expect(editor(source)).toEqual([]);
  });
});

describe('each place a number reaches (item 1)', () => {
  it.each([
    ['an arithmetic peer', 'let k = 3; return vi + k * 2;', 'u32', 11],
    ['a comparison', 'let k = 0; return k < ii ? 1 : 2;', 'i32', 2],
    ['an equality', 'let k = 5; return k == vi ? 1 : 2;', 'u32', 1],
    ['a builtin argument beside a typed one', 'let k = 9; return min(k, vi);', 'u32', 5],
    ['a vector constructor argument', 'let k = 4; return vec3u(k, 1, 2).x;', 'u32', 4],
    ['an arm of a conditional', 'let k = 0; k = c ? vi : k; return k;', 'u32', 5],
    ['an arm of select', 'let k = 2; return select(k, vi, c);', 'u32', 5],
    ['a field of an object literal', 'let k = 5; const q: Q = { id: k }; return q.id;', 'u32', 5],
    ['a bitwise operand beside a typed one', 'let m = 0xff; return vi & m;', 'u32', 5],
    ['a shift target', 'let k = 1; return u32(k << 2);', 'i32', 4],
    ['a compound assignment', 'let n = 1; n *= vi; return n;', 'u32', 5],
    ['an assignment from a typed value', 'let n = 0; n = vi; return n;', 'u32', 5],
    ['a return in a function with a declared result', 'let k = 5; k += 1; return k;', 'u32', 6],
    ['an argument of a declared parameter', 'let k = 5; return h(k);', 'u32', 5],
    ['an array constructor element', 'let k = 1; return array<u32, 2>(k, 2)[0];', 'u32', 1],
    [
      'a switch selector',
      'let k = 1; switch (k) { case 1: return vi; default: return 0; }',
      'i32',
      5,
    ],
    ['a while condition', 'let n = 0; while (n < vi) { n += 2; } return n;', 'u32', 6],
  ])('%s: %s', (_place, body, type, value) => {
    const result = typed(fn(body), /let (\w+)/.exec(body)![1]!, type);
    expect(result.eval('t', ARGS)).toBe(value);
  });

  it('a peer that is an f64 makes the value an f64, as the written number is one', () => {
    const source = fn('let k = 5; return f32(d * k);', 'f32');
    expect(typed(source, 'k', 'f64').eval('t', ARGS)).toBe(10);
  });

  it('another value that takes its type the same way: a chain, in any source order', () => {
    const forward = fn('let a = 0; let b = 0; a += vi; b += a; return b;');
    const backward = fn('let b = 0; let a = 0; b += a; a += vi; return b;');
    for (const source of [forward, backward]) {
      typed(source, 'a', 'u32');
      expect(hover(source, 'b')).toContain('let b: u32');
    }
    expect(compile(forward).eval('t', ARGS)).toBe(5);
    expect(compile(backward).eval('t', ARGS)).toBe(0);
  });

  it('a use before the deciding use takes the decided type', () => {
    const result = typed(fn('let k = 0; const q = k + 1; k += vi; return q;'), 'k', 'u32');
    expect(result.wgsl).toContain('let q = (k + 1u);');
  });

  it('a value through a float use: let it = 0; it += 1; return it / 100', () => {
    const result = typed(fn('let it = 0; it += 1; return it / 100;', 'f32'), 'it', 'f32');
    expect(result.eval('t', ARGS)).toBe(0.01);
  });

  it('a local function that captures the value reads the decided type', () => {
    const source = fn('let k = 0; const f = (): u32 => h(k); k += 1; return f();');
    expect(typed(source, 'k', 'u32').eval('t', ARGS)).toBe(1);
  });

  it('takes u32 where a written operand does not fit an i32: f | 3000000000', () => {
    const result = typed(fn('let f = 0; f = f | 3000000000; return f;'), 'f', 'u32');
    expect(result.eval('t', ARGS)).toBe(3000000000);
  });
});

describe('where nothing decides, the compiler chooses f32 (item 3, decision Q5)', () => {
  it('holds a value an i32 cannot: let h = 3000000000; h += 1 (F17)', () => {
    const source = fn('let big = 3000000000; big += 1; return f32(big);', 'f32');
    const result = typed(source, 'big', 'f32');
    expect(result.wgsl).toContain('var big: f32 = 3000000000.0;');
  });

  it('a conversion is no demand: let k = 7; u32(k)', () => {
    const result = typed(fn('let k = 7; return u32(k);'), 'k', 'f32');
    expect(result.eval('t', ARGS)).toBe(7);
  });

  it('a value no place reads is an f32, and the program compiles', () => {
    const source = fn('let k = 0; return vi;');
    expect(compile(source).diagnostics).toEqual([]);
    expect(editor(source)).toEqual([]);
    expect(hover(source, 'k')).toContain('let k: f32');
  });

  it('let h = 3 / 2; h += i stays refused: 1.5 fits no integer (decision Q1)', () => {
    refused(fn('let half = 3 / 2; half += ii; return u32(half);'), [
      '"half" is an i32 by its uses, and its value "3 / 2" is not one. Write the type, "let half: f32 = 3 / 2", and convert the uses that need i32.',
    ]);
  });
});

describe('what stays refused', () => {
  it('an initializer that does not fit the type the uses give', () => {
    refused(fn('let n = -1; n += vi; return n;'), [
      'The value has to fit: -1 is outside u32, which holds 0 to 4294967295 (§13).',
    ]);
  });

  it('an integer use and a float use of one value, where the float use stands', () => {
    refused(fn('let j = 0; let a = 0.; a += j; return u32(xs[j]);'), [
      'Type mismatch: cannot += f32 and i32 — no implicit int/float conversion. Cast explicitly: f32(intVal) or i32(floatVal) / u32(floatVal).',
    ]);
  });

  it('uses that demand two integer types name the annotation remedy first', () => {
    const source = fn('let k = 1; k += vi; k += ii; return k;');
    const first = compile(source).diagnostics[0]!;
    expect(`${first.code}: ${first.message}`).toBe(
      'TS8003: Cannot infer "k": its uses require i32 and u32. Write an explicit type annotation on "k" and cast the uses that need another type.',
    );
    expect(editor(source)[0]).toBe(`TS8003: ${first.message}`);
  });
});

describe('the division rule (decisions Q6 and Q11)', () => {
  // One edit, the one that compiles where the quotient stands (Amendment A2, "하나만"); the
  // compiler checks it before it names it (change 0134).
  const sentence = (op: '/' | '/='): string =>
    `"k" is a u32 where another line reads it, and no operand of "k ${op} 2" has a declared ` +
    `type, so the "${op}" does not say which division it is. Write "let k: u32 = 7" for the ` +
    `integer division.`;

  it('refuses let k = 7; const r = h(k); return r + k / 2; (emitted k / 2u before, F20)', () => {
    refused(fn('let k = 7; const r = h(k); return r + k / 2;'), [sentence('/')]);
  });

  it('refuses let k = 7; h(k); k /= 2; (a u32 division before, F21)', () => {
    refused(fn('let k = 7; h(k); k /= 2; return k;'), [sentence('/=')]);
  });

  it('refuses a value the new inference made an integer: n += vi; n / 2', () => {
    refused(fn('let k = 7; k += vi; return k / 2;'), [sentence('/')]);
  });

  it('accepts let k = 7; h(k); return vi / k; a declared u32 divides (F21)', () => {
    const source = fn('let k = 7; h(k); return vi / k;');
    const result = typed(source, 'k', 'u32');
    expect(result.wgsl).toContain('return (vi / k);');
    expect(result.eval('t', [15, 0, 0, false, [], 0])).toBe(2);
  });

  it('accepts the two edits the sentence names, and a conversion to u32', () => {
    const annotated = fn('let k: u32 = 7; h(k); return k / 2;');
    expect(compile(annotated).diagnostics).toEqual([]);
    expect(editor(annotated)).toEqual([]);
    expect(compile(annotated).eval('t', ARGS)).toBe(3);
    const converted = fn('let k = 7; h(k); return f32(k) / 2;', 'f32');
    expect(compile(converted).diagnostics).toEqual([]);
    expect(editor(converted)).toEqual([]);
    expect(compile(converted).eval('t', ARGS)).toBe(3.5);
    const cast = fn('let k = 7; h(k); return u32(k) / 2;');
    expect(compile(cast).diagnostics).toEqual([]);
    expect(editor(cast)).toEqual([]);
  });

  it('accepts % and a division where nothing made the value an integer', () => {
    const rem = fn('let k = 7; k += vi; return k % 2;');
    expect(compile(rem).diagnostics).toEqual([]);
    expect(editor(rem)).toEqual([]);
    const float = fn('let k = 7; return k / 2;', 'f32');
    expect(typed(float, 'k', 'f32').eval('t', ARGS)).toBe(3.5);
  });
});

describe('the counter of a for (Amendment A1 of change 0134)', () => {
  it('a counted for keeps its counter: an i32, or a u32 against a u32 bound', () => {
    const i = fn('let a = 0; for (let j = 0; j < 4; j++) { a += xs[j]; } return a;', 'f32');
    expect(compile(i).diagnostics).toEqual([]);
    expect(editor(i)).toEqual([]);
    expect(hover(i, 'j')).toContain('let j: i32');
    const u = fn('let a = 0; for (let j = 0; j < vi; j++) { a += 1; } return a;', 'f32');
    expect(compile(u).diagnostics).toEqual([]);
    expect(hover(u, 'j')).toContain('let j: u32');
  });

  it('the counter of a for that is not counted takes its type from its uses: an f32 here', () => {
    // The owner's example: refused before with "cannot += f32 and i32".
    const source = fn(
      'let a = 0; for (let j = 0; ; j++) { a += j; if (a > x) { break; } } return a;',
      'f32',
    );
    const result = compile(source);
    expect(result.diagnostics).toEqual([]);
    expect(editor(source)).toEqual([]);
    expect(hover(source, 'j')).toContain('let j: f32');
    expect(result.eval('t', [0, 0, 2.5, false, [], 0])).toBe(3);
  });

  it('an open counter used as an index is an i32', () => {
    const source = fn('let a = 0; for (let j = 0; a < x; j++) { a += xs[j]; } return a;', 'f32');
    expect(compile(source).diagnostics).toEqual([]);
    expect(editor(source)).toEqual([]);
    expect(hover(source, 'j')).toContain('let j: i32');
  });

  it('an open counter nothing decides is the f32 the compiler chooses', () => {
    // An i32 before the change: `for (var j: i32 = 0; (a < x); j = (j + 1))`.
    const source = fn('let a = 0; for (let j = 0; a < x; j++) { a += 1; } return a;', 'f32');
    const result = compile(source);
    expect(result.diagnostics).toEqual([]);
    expect(editor(source)).toEqual([]);
    expect(hover(source, 'j')).toContain('let j: f32');
    expect(result.wgsl).toContain('var j: f32 = 0.0;');
  });
});

describe("an open counter that no use gives a type (the owner's decision of 2026-11-11)", () => {
  // "A2 우선: 거부": such a counter reads as the f32 the compiler chooses, and was an i32 on
  // `main`, so a `/` over it is refused with the one edit that compiles where the quotient
  // stands (Amendment A2, "하나만"), as a `/` over a value its uses made an integer is.
  const sentence =
    '"j" is the counter of a "for" that is not counted, and no use gives it a type. No operand ' +
    'of "j / 2" has a declared type, so the "/" does not say which division it is. Write ' +
    '"f32(j) / 2" for the float division.';
  const open =
    'let a = 0.0; for (let j = 0; ; j++) { a += f32(j / 2); if (j > 5) { break; } } return a;';
  const bounded = 'let a = 0.0; for (let j = 0; j * 2 < 8; j++) { a += f32(j / 2); } return a;';

  it.each([
    [open, 'f32(j) / 2', 10.5],
    [bounded, 'f32(j) / 2', 3],
  ])('refuses %s (an integer division on main), and its edit compiles', (body, edit, value) => {
    refused(fn(body, 'f32'), [sentence]);
    const edited = fn(body.replace('j / 2', edit), 'f32');
    expect(compile(edited).diagnostics).toEqual([]);
    expect(editor(edited)).toEqual([]);
    expect(compile(edited).eval('t', ARGS)).toBe(value);
  });

  it('a declared counter keeps the integer division of main', () => {
    const source = fn(open.replace('let j = 0', 'let j: i32 = 0'), 'f32');
    expect(compile(source).diagnostics).toEqual([]);
    expect(editor(source)).toEqual([]);
    expect(compile(source).eval('t', ARGS)).toBe(9);
  });
});

describe('a counted for whose start or bound its uses type (review of #1250, finding 1)', () => {
  // The default i32 of the counter asks an integer of no kind of such a value, so the value's
  // other uses decide it, and the counter counts in that type (change 0136, "a u32 against a
  // u32 bound"). Each gives what the annotated program gives.
  it.each([
    ['let n = 0; n += vi; let a = 0.0; for (let j = 0; j < n; j++) { a += xs[j]; } return a;', 'n'],
    [
      'let s = 0; s += vi; s -= 5; let a = 0.0; for (let j = s; j < vi; j++) { a += xs[j]; } return a;',
      's',
    ],
  ])('%s', (body, name) => {
    const source = fn(body, 'f32');
    const result = typed(source, name, 'u32');
    expect(hover(source, 'j')).toContain('let j: u32');
    expect(result.eval('t', ARGS)).toBe(15);
    const annotated = compile(fn(body.replace(`let ${name} = 0`, `let ${name}: u32 = 0`), 'f32'));
    expect(annotated.diagnostics).toEqual([]);
    expect(annotated.eval('t', ARGS)).toBe(15);
  });
});

describe('the uses #1184\'s deviation 10 lists (Amendment A3, "4a와 이어서 머지")', () => {
  // With #1184 alone, `let y = k` took `f32`, so each of these was refused; each compiled on
  // `main`, where `k` was a `u32` by its declared use `h(k)`, and gives that value here.
  const XS = [1, 2, 3, 4, 5, 6, 7, 8];
  const program = (body: string, pre = ''): string => `"use typeshade";
function h(a: u32): u32 { return a; }
${pre}
export function t(vi: u32, xs: array<f32, 8>): f32 {
  ${body}
}`;
  it.each([
    ['const k = 7; h(k); let y = k; return f32(vi + y);', '', 10],
    ['const k = 7; h(k); let y = k; return xs[y];', '', 8],
    ['const k = 7; h(k); let y = k; return f32(h(y));', '', 7],
    [
      'const k = 7; h(k); let y = k; let a = 0.; switch (y) { case 7: a = 1.; break; default: a = 2.; } return a;',
      '',
      1,
    ],
    ['return xs[g()];', 'function g() { const k = 7; h(k); return k; }', 8],
    ['return f32(vi + g());', 'function g() { const k = 7; h(k); return k; }', 10],
    [
      'const k = 3; h(k); let y = k; let a = 0.; for (let j = y; j < 8; j++) { a += f32(h(j)); } return a;',
      '',
      25,
    ],
    [
      'const k = 3; h(k); let y = k + 1; let a = 0.; for (let j = y; j < 8; j++) { a += f32(h(j)); } return a;',
      '',
      22,
    ],
    [
      'let a = 0.; for (let j = g(); j < 8; j++) { a += f32(h(j)); } return a;',
      'function g() { const k = 3; h(k); return k; }',
      25,
    ],
  ])('%s', (body, pre, value) => {
    const source = program(body, pre);
    const result = compile(source);
    expect(result.diagnostics).toEqual([]);
    expect(editor(source)).toEqual([]);
    expect(result.eval('t', [3, XS])).toBe(value);
  });

  it('a / over such a let stays refused, as #1184 refuses it', () => {
    const source = program('const k = 7; h(k); let y = k; return f32(y / 2);');
    const lines = compile(source).diagnostics.map((d) => `${d.code}: ${d.message}`);
    expect(lines).toEqual([expect.stringContaining('does not say which division it is')]);
    expect(editor(source)).toEqual(lines);
  });
});
