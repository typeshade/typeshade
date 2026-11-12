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
import { checkedEditCompiles } from './abstract-const.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { checkDocuments } from '../../language-service/check.js';

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

// Issue 1261: a bitwise operator over two operands with no type of their own (written integers,
// constants of no fixed type that are integer-written) is a bitwise operand with no typed peer:
// an integer of no kind, an `i32` unless a position declares `u32` (Rule 5.1, change 0134 item
// 1). The tests before this read the compiler's diagnostics only where a program was refused,
// and the editor's half only through the shared analysis, so `let f = K | J`, which emitted
// `var f: f32 = (K | J);` with no diagnostic in either half, passed both: no test read the
// emit of a bitwise operator over two operands with no type. Each case here reads the emit or
// the diagnostic of `compile()`, the editor's `getDiagnostics`, and the hover where the type
// is the point. The emit was measured against Tint (`operator | (f32, f32)` is refused, the
// `i32` and `u32` forms accepted).
describe('a bitwise operator over written integers takes an integer (issue 1261)', () => {
  const K = 'const K = 6;\nconst J = 3;\n';
  const mod = (pre: string, body: string, ret = 'i32', params = 'ii: i32'): string =>
    `"use typeshade";\n${pre}export function t(${params}): ${ret} {\n  ${body}\n}`;

  it.each([
    ['|', 'K | J', 7],
    ['&', 'K & J', 2],
    ['^', 'K ^ J', 5],
    ['<<', 'K << J', 48],
    ['>>', 'K >> 1', 3],
    ['~', '~K', -7],
    ['| over written numbers', '1 | 2', 3],
    ['a written number beside a constant', 'K | 8', 14],
    ['two operators', '(K | J) & ~1', 6],
  ])('let f = %s is an i32', (_, init, value) => {
    const source = mod(K, `let f = ${init};\n  return ii + f;`);
    const result = compile(source);
    expect(result.diagnostics).toEqual([]);
    expect(editor(source)).toEqual([]);
    expect(hover(source, 'f')).toContain('let f: i32');
    expect(result.wgsl).toContain('var f: i32 = ');
    expect(result.wgsl).not.toMatch(/\d\.0 [|&^]|\(K [|&^]/);
    expect(result.eval('t', [1])).toBe(1 + value);
  });

  it('the program of the issue: let f = K | J with no other use', () => {
    const source = mod('const K = 1; const J = 2;\n', 'let f = K | J;\n  f += 1;\n  return f;');
    const result = compile(source);
    expect(result.diagnostics).toEqual([]);
    expect(editor(source)).toEqual([]);
    expect(hover(source, 'f')).toContain('let f: i32');
    expect(result.wgsl).toContain('var f: i32 = ');
    expect(result.wgsl).not.toContain('var f: f32');
    expect(result.eval('t', [0])).toBe(4);
  });

  it.each([
    ['an annotation', 'let f: u32 = K | J;\n  return vi + f;', 12],
    ['a declared parameter', 'return h(K ^ J);', 5],
    ['a typed peer', 'return vi + (K << 1);', 17],
    ['a shift of a bitwise expression', 'return vi + ((K | J) << 1);', 19],
  ])('a position that declares u32 gives it: %s', (_, body, value) => {
    const source = mod(`${K}function h(a: u32): u32 { return a; }\n`, body, 'u32', 'vi: u32');
    const result = compile(source);
    expect(result.diagnostics).toEqual([]);
    expect(editor(source)).toEqual([]);
    expect(result.wgsl).not.toMatch(/\d\.0 [|&^]|~\d\.0/);
    expect(result.eval('t', [5])).toBe(value);
  });

  it('a function-local const over written integers is an i32', () => {
    const source = mod('', 'const m = 1 | 2;\n  return ii * m;');
    const result = compile(source);
    expect(result.diagnostics).toEqual([]);
    expect(editor(source)).toEqual([]);
    expect(result.wgsl).not.toContain('1.0 | 2.0');
    expect(result.eval('t', [2])).toBe(6);
  });

  it('a module variable over module constants is an i32, and u32 where declared', () => {
    const plain = mod(K, 'f = f + ii;\n  return f;').replace('export', 'let f = K | J;\nexport');
    const result = compile(plain);
    expect(result.diagnostics).toEqual([]);
    expect(editor(plain)).toEqual([]);
    expect(hover(plain, 'f')).toContain('let f: i32');
    expect(result.wgsl).toContain('var<private> f: i32 = ');
    const declared = mod(K, 'f = f + vi;\n  return f;', 'u32', 'vi: u32').replace(
      'export',
      'let f: u32 = K | J;\nexport',
    );
    expect(compile(declared).diagnostics).toEqual([]);
    expect(editor(declared)).toEqual([]);
    expect(compile(declared).wgsl).toContain('var<private> f: u32 = ');
  });

  it('a function that returns one has an i32 result', () => {
    const source = mod(`${K}function g() { return K | J; }\n`, 'return ii + g();');
    const result = compile(source);
    expect(result.diagnostics).toEqual([]);
    expect(editor(source)).toEqual([]);
    const s = service(source);
    const at = source.indexOf('function g') + 9;
    expect(String(s.getHover('a.shade.ts', s.positionAt('a.shade.ts', at))?.contents)).toContain(
      'function g(): i32',
    );
    expect(result.wgsl).toContain('fn g() -> i32');
    expect(result.eval('t', [1])).toBe(8);
  });

  it('a module constant over written integers keeps its value and its f32, as before', () => {
    const source = mod('const M = 1 | 2;\n', 'return x * M;', 'f32', 'x: f32');
    const result = compile(source);
    expect(result.diagnostics).toEqual([]);
    expect(editor(source)).toEqual([]);
    expect(result.wgsl).toContain('const M: f32 = 3.0;');
    expect(result.eval('t', [2])).toBe(6);
  });

  it('beside an f32 the integer is refused where the f32 use stands, and the cast compiles', () => {
    const mismatch =
      'Type mismatch: cannot + f32 and i32 — no implicit int/float conversion. Cast explicitly: ' +
      'f32(intVal) or i32(floatVal) / u32(floatVal).';
    for (const body of ['return x + (1 | 2);', 'let f = K | J;\n  return x + f;']) {
      const source = mod(K, body, 'f32', 'x: f32');
      const result = compile(source);
      expect(result.diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([
        `TS8003: ${mismatch}`,
      ]);
      expect(result.wgsl).toBeUndefined();
      expect(editor(source)).toEqual([`TS8003: ${mismatch}`]);
    }
    const cast = mod(K, 'let f = K | J;\n  return x + f32(f);', 'f32', 'x: f32');
    expect(compile(cast).diagnostics).toEqual([]);
    expect(editor(cast)).toEqual([]);
    expect(compile(cast).eval('t', [0.5])).toBe(7.5);
  });

  // The reviews of #1272 at 2aacc2fb and 11cd1e82. A bitwise expression over written integers
  // is a constant whose value is the one TypeScript computes (`exact`, below), whatever the
  // order of its operands. Each emit was measured against Tint on 2026-11-12 (Chrome for Testing
  // 153, SwiftShader) and accepted. Tint accepts a concrete integer that wraps, so these tests
  // hold each value to TypeScript's.
  const exact = (init: string, pre = ''): number =>
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    Number(new Function(`${pre.replace(/\n/g, ';')} return (${init});`)());
  it.each([
    ['(~3 & 255) << 24', '', 'i32'],
    ['(~MASK & 255) << 24', 'const MASK = 3;\n', 'i32'],
    ['~1073741824 << 1', '', 'i32'],
    ['~(-2147483648)', '', 'i32'],
    ['~0 + 1', '', 'i32'],
    ['-(~2147483647)', '', 'u32'],
    ['(1 | 0) + 2147483647', '', 'u32'],
    ['2147483647 + (1 | 0)', '', 'u32'],
  ])('~ and arithmetic over written integers take the exact value: %s', (init, pre, type) => {
    // `~3` was left to Tint, which evaluated the constant as an abstract integer and refused
    // `((~3 & 255) << 24u)`: "value 4227858432 cannot be represented as 'i32'".
    const value = exact(init, pre);
    const source = mod(pre, `let a = ${init};\n  return f32(a);`, 'f32');
    const result = compile(source);
    expect(result.diagnostics).toEqual([]);
    expect(editor(source)).toEqual([]);
    expect(hover(source, 'a')).toContain(`let a: ${type}`);
    expect(result.wgsl).toContain(`var a: ${type} = ${String(value)}${type === 'u32' ? 'u' : ''};`);
    expect(result.wgsl).not.toContain('~');
    expect(result.eval('t', [0])).toBe(value);
  });

  it.each([
    ['let a: u32 = (1 | 2) - 5;', '-2 is outside u32, which holds 0 to 4294967295'],
    ['let a: u32 = -5 + (1 | 2);', '-2 is outside u32, which holds 0 to 4294967295'],
    ['let a: u32 = vi;\n  a += (1 | 2) - 5;', '-2 is outside u32, which holds 0 to 4294967295'],
    [
      'let a: i32 = (1 | 0) + 2147483647;',
      '2147483648 is outside i32, which holds -2147483648 to 2147483647 (§13). Write the i32 ' +
        'with the same bits, -2147483648, or declare a u32.',
    ],
    ['let a: u32 = (1 << 30) * 4;', '4294967296 is outside u32, which holds 0 to 4294967295'],
    ['let a: u32 = ~1 * 2000000000;', '-4000000000 is outside u32, which holds 0 to 4294967295'],
  ])('a value the type does not hold is refused as the written number is: %s', (body, words) => {
    // Each wrapped into the type with no diagnostic at 11cd1e82, or before.
    const message = `The value has to fit: ${words}${words.includes('(§13)') ? '' : ' (§13).'}`;
    const source = mod(K, `${body}\n  return a;`, 'u32', 'vi: u32');
    const result = compile(source);
    expect(result.diagnostics.map((d) => `${d.code}: ${d.message}`)).toContain(
      `TS8003: ${message}`,
    );
    expect(result.wgsl).toBeUndefined();
    expect(editor(source)).toContain(`TS8003: ${message}`);
  });

  it.each([
    ['let a: u32 = ~0;', '~0', -1, '0xffffffff', 4294967295],
    ['let a: u32 = (~3 & 255) << 24;', '(~3 & 255) << 24', -67108864, '0xfc000000', 4227858432],
    ['let a: u32 = 0;\n  a ^= ~0;', '~0', -1, '0xffffffff', 4294967295],
  ])(
    'a negative bit operation in a u32 is refused and names the u32 bits: %s',
    (body, written, value, bits, after) => {
      // TypeScript computes the negative value, so the u32 refuses it as the written number; the
      // edit is the u32 with the same bits (the owner's decision of 2026-11-11, "거부 유지").
      const message =
        `The value has to fit: ${String(value)} is outside u32, which holds 0 to 4294967295 ` +
        `(§13). Write the u32 with the same bits, ${bits}.`;
      const source = mod('', `${body}\n  return a;`, 'u32', 'vi: u32');
      const result = compile(source);
      expect(result.diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([
        `TS8003: ${message}`,
      ]);
      expect(result.wgsl).toBeUndefined();
      expect(editor(source)).toEqual([`TS8003: ${message}`]);
      const fixed = source.replace(written, bits);
      expect(compile(fixed).diagnostics).toEqual([]);
      expect(editor(fixed)).toEqual([]);
      expect(compile(fixed).eval('t', [0])).toBe(after);
    },
  );

  it('the order of the operands does not change a comparison: vi > (0 | 0) - 1', () => {
    // `(vi > 4294967295u)` at 11cd1e82: false, where TypeScript says true.
    const mismatch =
      'Type mismatch: cannot compare u32 and i32 — WGSL has no implicit integer conversion. ' +
      'Cast one side: u32(…) or i32(…), e.g. a + u32(b).';
    for (const cond of ['vi > (0 | 0) - 1', 'vi > -1 + (0 | 0)', 'vi > ~0']) {
      const source = mod('', `return ${cond} ? 1 : 0;`, 'u32', 'vi: u32');
      expect(compile(source).diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([
        `TS8003: ${mismatch}`,
      ]);
      expect(editor(source)).toEqual([`TS8003: ${mismatch}`]);
    }
    const fine = mod('', 'return vi < (1 | 2) + 1 ? 1 : 0;', 'u32', 'vi: u32');
    expect(compile(fine).diagnostics).toEqual([]);
    expect(editor(fine)).toEqual([]);
    expect(compile(fine).eval('t', [3])).toBe(1);
  });

  it('a u32 return and an argument take the exact value', () => {
    const ret = mod('', 'return (1 | 2) - 5;', 'u32', 'vi: u32');
    const words = 'The value has to fit: -2 is outside u32, which holds 0 to 4294967295 (§13).';
    expect(compile(ret).diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([
      `TS8003: ${words}`,
    ]);
    expect(editor(ret)).toEqual([`TS8003: ${words}`]);
    const arg = mod(
      `${K}function h(a: u32): u32 { return a; }\n`,
      'return h((1 | 2) * 3);',
      'u32',
      'vi: u32',
    );
    expect(compile(arg).diagnostics).toEqual([]);
    expect(editor(arg)).toEqual([]);
    expect(compile(arg).eval('t', [0])).toBe(9);
  });

  it('a shift amount ~0 is out of range, and ~0 & 3 is 3', () => {
    const message =
      'A shift amount must be between 0 and 31, got -1: a 32-bit integer has no bit to shift ' +
      'into.';
    const source = mod('', 'return vi << ~0;', 'u32', 'vi: u32');
    expect(compile(source).diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([
      `TS8003: ${message}`,
    ]);
    expect(editor(source)).toEqual([`TS8003: ${message}`]);
    const masked = mod('', 'return vi << (~0 & 3);', 'u32', 'vi: u32');
    expect(compile(masked).diagnostics).toEqual([]);
    expect(editor(masked)).toEqual([]);
    expect(compile(masked).wgsl).toContain('(vi << 3u)');
    expect(compile(masked).eval('t', [1])).toBe(8);
  });

  it.each([
    ['let a: u32 = (1 | 2) ^ 4;', 7],
    ['let a: u32 = ~4 & 7;', 3],
    ['let a: u32 = 1 | (1 << 4);', 17],
    ['let a: u32 = ~0 + 1;', 0],
    ['let a: u32 = -1 & 255;', 255],
    ['let a: u32 = (1 | 2) + 3000000000;', 3000000003],
    ['let a: u32 = vi;\n  a += 1 | 2;', 8],
    ['let a: u32 = vi;\n  a -= (1 | 2) - 2;', 4],
    ['let a: u32 = vi;\n  a |= K | J;', 7],
  ])('a declared u32 reaches a mixed tree: %s', (body, value) => {
    // Each was refused with "cannot let/const a u32 and i32", an i32 the author did not write.
    const source = mod(K, `${body}\n  return a;`, 'u32', 'vi: u32');
    const result = compile(source);
    expect(result.diagnostics).toEqual([]);
    expect(editor(source)).toEqual([]);
    expect(result.wgsl).toContain('var a: u32 = ');
    expect(result.eval('t', [5])).toBe(value);
  });

  it('a constant reads as its written value: K | 1 with K = 3000000000 is a u32', () => {
    const source = mod('const K = 3000000000;\n', 'let a = K | 1;\n  return a;', 'u32', 'vi: u32');
    const result = compile(source);
    expect(result.diagnostics).toEqual([]);
    expect(editor(source)).toEqual([]);
    expect(hover(source, 'a')).toContain('let a: u32');
    expect(result.wgsl).toContain('var a: u32 = 3000000001u;');
    expect(result.eval('t', [0])).toBe(3000000001);
  });

  it('a u32 value beside a negative one is refused in words the author wrote', () => {
    const message =
      'Bitwise "|" has no integer type for 3000000000 and -1: 3000000000 is a u32, and a u32 ' +
      'does not hold -1. Write -1 as its u32 bits, 4294967295.';
    for (const pre of ['', 'const K = 3000000000;\n']) {
      const init = pre === '' ? '3000000000 | -1' : 'K | -1';
      const source = mod(pre, `let a = ${init};\n  return a;`, 'u32', 'vi: u32');
      const result = compile(source);
      expect(result.diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([
        `TS8003: ${message}`,
      ]);
      expect(editor(source)).toEqual([`TS8003: ${message}`]);
    }
    const fixed = mod('', 'let a = 3000000000 | 4294967295;\n  return a;', 'u32', 'vi: u32');
    expect(compile(fixed).diagnostics).toEqual([]);
    expect(editor(fixed)).toEqual([]);
    expect(compile(fixed).eval('t', [0])).toBe(4294967295);
  });

  it.each([
    ['return f32((1 | 2) / 2);', '1 | 2', '(1 | 2) / 2', 'f32(1 | 2) / 2', 1.5],
    [
      'return f32(((1 | 2) * 3) / 2);',
      '(1 | 2) * 3',
      '((1 | 2) * 3) / 2',
      'f32((1 | 2) * 3) / 2',
      4.5,
    ],
    ['return f32(~2 / 2);', '~2', '~2 / 2', 'f32(~2) / 2', -1.5],
    ['let a = 1 | 2;\n  return f32(a / 2);', 'a', 'a / 2', 'f32(a) / 2', 1.5],
    [
      'return f32(((1 << 2) - 1) / 2);',
      '(1 << 2) - 1',
      '((1 << 2) - 1) / 2',
      'f32((1 << 2) - 1) / 2',
      1.5,
    ],
    ['return f32((1 << 3) / 3);', '1 << 3', '(1 << 3) / 3', 'f32(1 << 3) / 3', 8 / 3],
    ['let a = 1 << 2;\n  return f32(a / 3);', 'a', 'a / 3', 'f32(a) / 3', 4 / 3],
  ])(
    'a / over a bitwise expression of written integers is refused (D-b): %s',
    (body, subject, written, edit, value) => {
      // The owner's decision of 2026-11-11, D-b, "A2대로 거부": the bit operator makes the value
      // an integer, and no operand has a declared type, so the "/" does not say which division
      // it is. `(1 << 3) / 3` was 2 on main, and `(1 | 2) / 2` emitted `(1.0 | 2.0)`.
      const message =
        `"${subject}" is an integer by its bit operator, and no operand of "${written}" has a ` +
        `declared type, so the "/" does not say which division it is. Write "${edit}" for the ` +
        'float division.';
      const source = mod('', body, 'f32', 'x: f32');
      const result = compile(source);
      expect(result.diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([
        `TS8003: ${message}`,
      ]);
      expect(result.wgsl).toBeUndefined();
      expect(editor(source)).toEqual([`TS8003: ${message}`]);
      const fixed = source.replace(written, edit);
      expect(compile(fixed).diagnostics).toEqual([]);
      expect(editor(fixed)).toEqual([]);
      expect(compile(fixed).eval('t', [0])).toBeCloseTo(value, 5);
    },
  );

  it('an integer position reads the quotient: the / divides integers (Amendment A4)', () => {
    for (const [body, value] of [
      ['let j: i32 = (1 | 2) / 2;\n  return f32(j);', 1],
      ['return f32(xs[(1 << 3) / 3]);', 3],
    ] as const) {
      const source = mod('', body, 'f32', 'xs: array<f32, 4>');
      const result = compile(source);
      expect(result.diagnostics).toEqual([]);
      expect(editor(source)).toEqual([]);
      expect(result.eval('t', [[1, 2, 3, 4]])).toBe(value);
    }
  });

  it('a /= over a let of a bitwise expression names its declaration with its type', () => {
    const message =
      '"a" is an integer by its bit operator, and no operand of "a /= 2" has a declared type, ' +
      'so the "/=" does not say which division it is. Write "let a: i32 = 1 | 2" for the ' +
      'integer division.';
    const source = mod('', 'let a = 1 | 2;\n  a /= 2;\n  return a;');
    expect(compile(source).diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([
      `TS8003: ${message}`,
    ]);
    expect(editor(source)).toEqual([`TS8003: ${message}`]);
    const fixed = source.replace('let a = 1 | 2;', 'let a: i32 = 1 | 2;');
    expect(compile(fixed).diagnostics).toEqual([]);
    expect(editor(fixed)).toEqual([]);
    expect(compile(fixed).eval('t', [0])).toBe(1);
  });

  it.each([
    ['let a: i32 = (1 << 30) * 2;\n  return a;'],
    ['let a: i32 = ii;\n  a += (1 << 30) * 2;\n  return a;'],
    ['return (1 << 30) * 2;'],
  ])('an i32 position over 2147483648 is refused and names -2147483648 (D-a): %s', (body) => {
    // main wrapped each to -2147483648; TypeScript computes 2147483648.
    const message =
      'The value has to fit: 2147483648 is outside i32, which holds -2147483648 to 2147483647 ' +
      '(§13). Write the i32 with the same bits, -2147483648, or declare a u32.';
    const source = mod('', body);
    expect(compile(source).diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([
      `TS8003: ${message}`,
    ]);
    expect(editor(source)).toEqual([`TS8003: ${message}`]);
    // A compound `a += -2147483648` is refused on main as `cannot += i32 and f32`, a defect of
    // the compound assignment with a negative written number (open item of #1272).
    if (body.includes('+=')) return;
    const fixed = source.replace('(1 << 30) * 2', '-2147483648');
    expect(compile(fixed).diagnostics).toEqual([]);
    expect(editor(fixed)).toEqual([]);
  });

  it('-(1 << 31) is the u32 2147483648, which an i32 peer refuses (D-a)', () => {
    const mismatch =
      'Type mismatch: cannot + i32 and u32 — WGSL has no implicit integer conversion. Cast one ' +
      'side: i32(…) or u32(…), e.g. a + i32(b).';
    const source = mod('', 'let a = -(1 << 31);\n  return ii + a;');
    expect(hover(source, 'a')).toContain('let a: u32');
    expect(compile(source).diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([
      `TS8003: ${mismatch}`,
    ]);
    expect(editor(source)).toEqual([`TS8003: ${mismatch}`]);
  });

  it.each([
    ['((1 << 30) * 2) >> 1', 'i32'],
    ['-(1 << 31) >> 1', 'i32'],
    ['(1 << 30) * 2 - 1', 'i32'],
    ['(0xF0000000 | 0) >> 28', 'i32'],
    ['-(0x80000000 | 0)', 'u32'],
    ['((1 << 30) * 2) & ~0', 'i32'],
    ['(1 << 31) % 3', 'i32'],
    ['3 - (1 | 2) * 5', 'i32'],
  ])('an inner fold does not change how the outer operator computes: %s', (init, type) => {
    // The third review of #1272 at 82b909b1: an inner `u32` made `>>` a logical shift and
    // brought u32 bits into the arithmetic. The whole expression computes as TypeScript does.
    const value = exact(init);
    const source = mod('', `let a = ${init};\n  return f32(ii) + f32(a);`, 'f32');
    const result = compile(source);
    expect(result.diagnostics).toEqual([]);
    expect(editor(source)).toEqual([]);
    expect(hover(source, 'a')).toContain(`let a: ${type}`);
    expect(result.eval('t', [0])).toBe(value);
  });

  it.each([
    ['3000000000 | 1', 3000000001],
    ['~3000000000', 1294967295],
    ['0x80000000 << 1', 0],
    ['0xF0000000 >> 0', 4026531840],
  ])(
    'a bit operator over a written u32 whose two readings agree compiles (item 1): %s',
    (init, value) => {
      // The u32 bits and TypeScript's ToInt32 give the same bits, read as the u32.
      const source = mod('', `let a = ${init};\n  return f32(a);`, 'f32');
      const result = compile(source);
      expect(result.diagnostics).toEqual([]);
      expect(editor(source)).toEqual([]);
      expect(result.eval('t', [0])).toBe(value);
      expect(value).toBe(exact(`(${init}) >>> 0`));
    },
  );

  it.each([
    ['0xF0000000 >> 28', '0xF0000000', '28', 15, -1],
    ['0x80000000 >> 4', '0x80000000', '4', 134217728, -134217728],
    ['0xFFFFFFFF >> 4', '0xFFFFFFFF', '4', 268435455, -1],
  ])(
    'a >> whose u32 and TypeScript readings differ is refused (the owner, "거부"): %s',
    (init, left, right, u32, ts) => {
      expect(exact(init)).toBe(ts);
      const message =
        `Bitwise ">>" over ${left}, which only a u32 holds, gives ${String(u32)} on its u32 bits ` +
        `and ${String(ts)} in TypeScript, so it does not say which it means. Write ` +
        `"u32(${left}) >> ${right}" for the u32 shift.`;
      const source = mod('', `let a = ${init};\n  return f32(a);`, 'f32');
      expect(compile(source).diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([
        `TS8003: ${message}`,
      ]);
      expect(editor(source)).toEqual([`TS8003: ${message}`]);
      const fixed = source.replace(init, `u32(${left}) >> ${right}`);
      expect(compile(fixed).diagnostics).toEqual([]);
      expect(editor(fixed)).toEqual([]);
      expect(compile(fixed).eval('t', [0])).toBe(u32);
    },
  );

  it.each([
    ['((1 << 30) * 4) | 0'],
    ['((1 << 30) * 8) >> 3'],
    ['((3 | 0) * 1431655766) & 1'],
    ['((1 | 0) * 4294967296) | 0'],
    ['(7 % 3) | 0'],
    ['((7 % 3) * 5) << 1'],
  ])('only the whole expression is held to a type: %s', (init) => {
    // An intermediate value no integer type holds passes through ToInt32 at a bit operator, as
    // in TypeScript; each was refused at 0c0b5920 (`%` was "got f32").
    const value = exact(init);
    const source = mod('', `let a = ${init};\n  return f32(a);`, 'f32');
    const result = compile(source);
    expect(result.diagnostics).toEqual([]);
    expect(editor(source)).toEqual([]);
    expect(result.eval('t', [0])).toBe(value);
  });

  it.each([
    ['const K = 1 << 4;\n', 'return f32(K / 3);', 'K', 'K / 3', 'f32(K) / 3', 16 / 3],
    ['const K = (1 << 4) | 3;\n', 'return K / 2;', 'K', 'K / 2', 'f32(K) / 2', 9.5],
    [
      '',
      'return (1 | 2) / (1 << 1);',
      '1 | 2',
      '(1 | 2) / (1 << 1)',
      'f32(1 | 2) / f32(1 << 1)',
      1.5,
    ],
  ])(
    'D-b reaches a module constant, and the edit compiles in one step: %s%s',
    (pre, body, subject, written, edit, value) => {
      const message =
        `"${subject}" is an integer by its bit operator, and no operand of "${written}" has a ` +
        `declared type, so the "/" does not say which division it is. Write "${edit}" for the ` +
        'float division.';
      const source = mod(pre, body, 'f32', 'x: f32');
      expect(compile(source).diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([
        `TS8003: ${message}`,
      ]);
      expect(editor(source)).toEqual([`TS8003: ${message}`]);
      const fixed = source.replace(written, edit);
      expect(compile(fixed).diagnostics).toEqual([]);
      expect(editor(fixed)).toEqual([]);
      expect(compile(fixed).eval('t', [0])).toBeCloseTo(value, 5);
    },
  );

  it.each([
    ['let a = (1 | 2) / 2;\n  return a;', 'f32'],
    ['let a = (1 | 2) / 2;\n  let b: f32 = a;\n  return b;', 'f32'],
    ['return sin((1 | 4) / 2);', 'f32'],
    ['let q = (1 | 2) / 2;\n  return xs[q];', 'f32'],
    ['let k = (1 << 3) / 3;\n  return f32(vi + k);', 'f32'],
  ])('a refused quotient is the one mistake where it flows (Rule 12.4): %s', (body, ret) => {
    const source = mod('', body, ret, 'vi: u32, xs: array<f32, 4>');
    const lines = compile(source).diagnostics.map((d) => `${d.code}: ${d.message}`);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('does not say which division it is');
    expect(editor(source)).toEqual(lines);
  });

  it('(0x80000000 | 1) - 0x80000000 is -4294967295, which no integer type holds', () => {
    const message =
      'The value has to fit: -4294967295 is outside i32, which holds -2147483648 to 2147483647 ' +
      '(§13).';
    expect(exact('(0x80000000 | 1) - 0x80000000')).toBe(-4294967295);
    const source = mod('', 'let a = (0x80000000 | 1) - 0x80000000;\n  return f32(a);', 'f32');
    expect(compile(source).diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([
      `TS8003: ${message}`,
    ]);
    expect(editor(source)).toEqual([`TS8003: ${message}`]);
  });

  it('a module variable over a constant another line reads as an integer: a / is refused', () => {
    // `let m = K / 2` was 1.5 on main, where the module variable read `K` as its f32; it now
    // reads `K` as a constant of no fixed type, as a function does, and `vi * K` makes it an
    // integer (Amendment A2 of change 0134).
    const message =
      '"K" is a u32 where another line reads it, and no operand of "K / 2" has a declared type, ' +
      'so the "/" does not say which division it is. Write "f32(K) / 2" for the float division.';
    const source = mod(
      'const K = 3;\nlet m = K / 2;\n',
      'return f32(vi * K) + m;',
      'f32',
      'vi: u32',
    );
    expect(compile(source).diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([
      `TS8003: ${message}`,
    ]);
    expect(editor(source)).toEqual([`TS8003: ${message}`]);
    const fixed = source.replace('let m = K / 2;', 'let m = f32(K) / 2;');
    expect(compile(fixed).diagnostics).toEqual([]);
    expect(editor(fixed)).toEqual([]);
    expect(compile(fixed).eval('t', [2])).toBe(7.5);
  });

  it('a whole float-written operand is refused, not emitted as (1.0 | 2)', () => {
    const message =
      'Bitwise "|" needs i32 or u32 operands, got f32. Convert first, e.g. u32(a) | u32(b), or ' +
      'reinterpret the bits with bitcast<u32>(a).';
    const source = mod('', 'let f = 1.0 | 2;\n  return ii + i32(f);');
    const result = compile(source);
    expect(result.diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([
      `TS8003: ${message}`,
    ]);
    expect(editor(source)).toEqual([`TS8003: ${message}`]);
    const fixed = mod('', 'let f = u32(1.0) | u32(2);\n  return ii + i32(f);');
    expect(compile(fixed).diagnostics).toEqual([]);
    expect(editor(fixed)).toEqual([]);
  });

  // The fifth review of #1272 at 61c35297: one fold decides at the root (THE RULE, lit-coerce.ts).
  const one = (source: string): string => {
    const lines = compile(source).diagnostics.map((d) => `${d.code}: ${d.message}`);
    expect(lines).toHaveLength(1);
    expect(editor(source)).toEqual(lines);
    return lines[0]!;
  };
  const accepted5 = (source: string, value: number): void => {
    const result = compile(source);
    expect(result.diagnostics).toEqual([]);
    expect(editor(source)).toEqual([]);
    expect(result.eval('t', [5, 3])).toBe(value);
  };
  const T = (body: string, ret = 'i32', pre = ''): string =>
    mod(pre, body, ret, 'vi: u32, ii: i32');

  it.each([
    ['((1 | 2) / 2) | 0'],
    ['((1 << 31) / -1) | 0'],
    ['((-7 | 0) / 2) | 0'],
    ['~((1 | 2) / 2)'],
    ['(((1 << 30) * 4) / 2) | 0'],
    ['(0xF0000000 >> 28) | 0'],
    ['(0xF0000000 >> 28) + 1'],
    ['(0x80000000 >> 4) >> 0'],
    ['(1 | 2) / 2 * 2'],
    ['((1 << 30) * 4) | 0'],
    ['(0x7fffffff + 1) | 0'],
  ])('the root decides, inner operators compute as TypeScript does: %s', (init) => {
    accepted5(T(`return ${init};`), exact(init));
  });

  it.each([
    ['const K = ((1 << 30) * 4) | 0;\n', 0],
    ['const K = (0xF0000000 >> 28) | 0;\n', -1],
    ['const K = (7 % 3) | 0;\n', 1],
  ])('a module constant routes through the same fold: %s', (pre, value) => {
    accepted5(T('return K;', 'i32', pre), value);
  });

  it('a module constant refused at its root is the one mistake', () => {
    expect(one(T('return K | 0;', 'i32', 'const K = (1 << 30) * 4;\n'))).toBe(
      'TS8003: The value has to fit: 4294967296 is outside u32, which holds 0 to 4294967295 (§13).',
    );
  });

  it.each([
    ['let j: i32 = i32((1 | 2) / 2);\n  return j;', 1],
    ['let j: i32 = (1 | 2) / 2 > 1 ? 1 : 0;\n  return j;', 1],
    ['return i32(((1 | 2) / 2) * 2);', 3],
    ['let j: i32 = (1 | 2) / 2;\n  return j;', 1],
  ])(
    'a stated integer type or a comparison reads a quotient with no other value: %s',
    (body, value) => {
      // TypeScript's value, or its truncation by the integer type the program states (A4); no
      // integer division gives another value silently.
      accepted5(T(body), value);
    },
  );

  it.each([
    ['return vi + (1 << 3) / 3;', 'u32', '1 << 3', '(1 << 3) / 3', 'u32(1 << 3) / 3', 7],
    ['return min((1 << 3) / 3, ii);', 'i32', '1 << 3', '(1 << 3) / 3', 'i32(1 << 3) / 3', 2],
  ])(
    'an integer peer that states no type refuses a quotient with the integer edit: %s',
    (body, ret, subject, written, edit, value) => {
      const message =
        `TS8003: "${subject}" is an integer by its bit operator, and no operand of "${written}" ` +
        `has a declared type, so the "/" does not say which division it is. Write "${edit}" for ` +
        'the integer division.';
      const source = T(body, ret);
      expect(one(source)).toBe(message);
      const fixed = source.replace(written, edit);
      accepted5(fixed, value);
    },
  );

  it.each([['let q = (1 | 2) / 2;\n  return q | 0;'], ['let q = (1 | 2) / 2;\n  return q * 2;']])(
    'a let of a refused quotient is the one mistake where it flows: %s',
    (body) => {
      // The quotient flows into an integer position: the edit that compiles states the integer
      // division (checked, seventh review).
      const source = T(body);
      const line = one(source);
      expect(line).toContain('Write "i32(1 | 2) / 2" for the integer division.');
      const fixed = source.replace('(1 | 2) / 2', 'i32(1 | 2) / 2');
      expect(compile(fixed).diagnostics).toEqual([]);
      expect(editor(fixed)).toEqual([]);
    },
  );

  it.each([
    [
      'return 1 << ((1 << 30) * 4);',
      'TS8003: A shift amount must be between 0 and 31, got 4294967296: a 32-bit integer has no bit to shift into.',
    ],
    [
      'return ii + ((1 << 30) * 4);',
      'TS8003: The value has to fit: 4294967296 is outside i32, which holds -2147483648 to 2147483647 (§13).',
    ],
    [
      'return ((1 << 30) * 4) % 0;',
      'TS8003: Division by zero: "0" is 0 on every invocation. WGSL refuses it and GLSL ES 3.00 leaves it undefined.',
    ],
  ])('one diagnostic with true text: %s', (body, message) => {
    expect(one(T(body))).toBe(message);
  });

  it('vi + (1 << 31) / 2 is the i32 -1073741824 beside a u32', () => {
    expect(exact('(1 << 31) / 2')).toBe(-1073741824);
    expect(one(T('return vi + (1 << 31) / 2;', 'u32'))).toBe(
      'TS8003: Type mismatch: cannot + u32 and i32 — WGSL has no implicit integer conversion. ' +
        'Cast one side: u32(…) or i32(…), e.g. a + u32(b).',
    );
  });

  it('a float builtin over a quotient is refused, and the edit compiles', () => {
    const source = T('return i32(floor((1 | 2) / 2));');
    expect(one(source)).toContain('Write "f32(1 | 2) / 2" for the float division.');
    accepted5(source.replace('(1 | 2) / 2', 'f32(1 | 2) / 2'), 1);
  });

  // The sixth review of #1272 at 394d5c35.
  it.each([
    ['return ((1 | 2) / 2) / 2;', '1 | 2', '((1 | 2) / 2) / 2', '(f32(1 | 2) / 2) / 2', 0.75],
    ['return (1 << 3) / 3 / 2;', '1 << 3', '(1 << 3) / 3 / 2', 'f32(1 << 3) / 3 / 2', 4 / 3],
    [
      'return ((1 | 2) / 2) + ((1 | 2) / 4);',
      '1 | 2',
      '((1 | 2) / 2) + ((1 | 2) / 4)',
      '(f32(1 | 2) / 2) + (f32(1 | 2) / 4)',
      2.25,
    ],
    [
      'return ((1 | 2) / 2) + (1 | 4);',
      '1 | 2',
      '((1 | 2) / 2) + (1 | 4)',
      '(f32(1 | 2) / 2) + f32(1 | 4)',
      6.5,
    ],
  ])(
    'a tree with nested quotients names one edit that compiles in one step: %s',
    (body, subject, written, edit, value) => {
      const source = T(body, 'f32');
      expect(one(source)).toBe(
        `TS8003: "${subject}" is an integer by its bit operator, and no operand of "${written}" ` +
          `has a declared type, so the "/" does not say which division it is. Write "${edit}" for ` +
          'the float division.',
      );
      const fixed = source.replace(written, edit);
      const result = compile(fixed);
      expect(result.diagnostics).toEqual([]);
      expect(editor(fixed)).toEqual([]);
      expect(result.eval('t', [5, 3])).toBeCloseTo(value, 5);
    },
  );

  it.each([
    ['(1 | 2) / 0', '0'],
    ['0 / (0 | 0)', '(0 | 0)'],
    ['1 / ((0 | 0) * -1)', '((0 | 0) * -1)'],
  ])('a / by zero over a tree is one refusal, as on main: %s', (init, divisor) => {
    expect(one(T(`return ${init};`, 'f32'))).toBe(
      `TS8003: Division by zero: "${divisor}" is 0 on every invocation. WGSL refuses it and ` +
        'GLSL ES 3.00 leaves it undefined.',
    );
  });

  it('an intermediate past the doubles is Infinity, which ToInt32 reads as 0', () => {
    const product = Array.from({ length: 36 }, () => '(1 << 30)').join(' * ');
    expect(exact(`(${product}) | 0`)).toBe(0);
    accepted5(T(`return (${product}) | 0;`), 0);
    expect(one(T(`return ${product};`))).toBe(
      'TS8003: The value has to fit: Infinity is outside i32, which holds -2147483648 to 2147483647 (§13).',
    );
    accepted5(T(`return ((${product}) / 2) | 0;`), 0);
  });

  // The seventh review of #1272 at 2854afa5: the checked edit follows the refusal, compares with
  // the unedited program, and a zero divisor is the one mistake.
  const appliedAll = (source: string): string => {
    let fixed = source;
    for (const d of compile(source).diagnostics) {
      const m = /no operand of "(.*)" has a declared type, .* Write "(.*)" for the/.exec(d.message);
      if (m) fixed = fixed.replace(m[1]!, m[2]!);
    }
    return fixed;
  };
  it.each([
    ['return ii + (1|2)/(1<<1);', 'i32', 'i32(1|2)/i32(1<<1)', 4],
    ['return clamp(ii, 0, (1|2)/(1<<1));', 'i32', 'i32(1|2)/i32(1<<1)', 1],
    ['return vi + (1|2)/(1<<1);', 'u32', 'u32(1|2)/u32(1<<1)', 6],
  ])('an integer peer names a checked edit: %s', (body, ret, edit, value) => {
    const source = T(body, ret);
    expect(one(source)).toContain(`Write "${edit}" for the integer division.`);
    accepted5(appliedAll(source), value);
  });

  it('each refusal of a statement names an edit that compiles beside the others', () => {
    const source = T('return (1|2)/(1<<1) + f32((5|0)/2);', 'f32');
    const lines = compile(source).diagnostics.map((d) => d.message);
    expect(lines).toHaveLength(2);
    expect(editor(source)).toHaveLength(2);
    expect(lines[0]).toContain('Write "f32(1|2)/f32(1<<1)" for the float division.');
    expect(lines[1]).toContain('Write "f32(5|0)/2" for the float division.');
    accepted5(appliedAll(source), 1.5 + 2.5);
    // A mistake elsewhere in the statement does not make the edit look refused.
    const other = T('return (1|2)/(1<<1) + f32(undefinedThing);', 'f32');
    expect(compile(other).diagnostics[0]!.message).toContain(
      'Write "f32(1|2)/f32(1<<1)" for the float division.',
    );
  });

  it('where the operands as written do not compile, the edit converts their value', () => {
    const source = T('return ((1<<30)*4)/3;', 'f32');
    expect(one(source)).toBe(
      'TS8003: "(1<<30)*4" is an integer by its bit operator, and no operand of "((1<<30)*4)/3" ' +
        'has a declared type, so the "/" does not say which division it is. Write ' +
        '"f32(4294967296)/3" for the float division.',
    );
    const fixed = source.replace('((1<<30)*4)/3', 'f32(4294967296)/3');
    const result = compile(fixed);
    expect(result.diagnostics).toEqual([]);
    expect(editor(fixed)).toEqual([]);
    expect(result.eval('t', [5, 3])).toBeCloseTo(4294967296 / 3, -2);
  });

  it('a quotient a u32 reads through a let names the u32 edit', () => {
    const source = T('let q = (1 | 2) / 2;\n  return vi + q;', 'u32');
    expect(one(source)).toContain('Write "u32(1 | 2) / 2" for the integer division.');
    accepted5(source.replace('(1 | 2) / 2', 'u32(1 | 2) / 2'), 6);
  });

  it('the value edit keeps the text of an operand an integer type holds', () => {
    const source = T('return ((1<<30)*4)/(1|2);', 'f32');
    expect(one(source)).toContain('Write "f32(4294967296)/f32(1|2)" for the float division.');
    const fixed = source.replace('((1<<30)*4)/(1|2)', 'f32(4294967296)/f32(1|2)');
    expect(compile(fixed).diagnostics).toEqual([]);
    expect(editor(fixed)).toEqual([]);
  });

  // The ninth review of #1272 at f85c03f8, and the owner's decision of 2026-11-12: each
  // refusal's edit takes its type from where the quotient flows, every edit is compiled with the
  // others at once, and where they do not compile together no refusal names an edit.
  const GENERIC = /Write ((?:[iuf]32\(…\)(?:, | or )?)+) around (.*) to choose the division\.$/;
  const VALUE =
    /No integer type holds ".*" \(\d+\), so only the float division chooses it: write "(.*)"\.$/;
  const NO_FORM =
    /No integer type holds ".*" \(\d+\), and the quotient is read as an integer here, so no division of it computes this value\.$/;
  const lines = (source: string): string[] => {
    const got = compile(source).diagnostics.map((d) => `${d.code}: ${d.message}`);
    expect(editor(source)).toEqual(got);
    return got;
  };
  const refusalsOf = (source: string): string[] =>
    lines(source).filter((l) => l.includes('does not say which division'));
  /** The operands a remedy that names no edit offers to wrap, and the types it lists. */
  const subjectsOf = (line: string): string[] =>
    [...(GENERIC.exec(line)?.[2] ?? '').matchAll(/"([^"]*)"/g)].map((m) => m[1]!);
  const typesOf = (line: string): string[] =>
    [...(GENERIC.exec(line)?.[1] ?? '').matchAll(/([iuf]32)\(/g)].map((m) => m[1]!);
  /** Whether the refusals of `source` name edits, each proven: made together, they compile in
   *  both halves. Otherwise every refusal names none, and each wrap it offers (every type it
   *  lists around every operand it lists, or the one value edit) chooses the division. */
  const verified = (source: string): 'named' | 'generic' => {
    const refusals = refusalsOf(source);
    expect(refusals.length).toBeGreaterThan(0);
    const generic = refusals.filter((l) => GENERIC.test(l) || VALUE.test(l) || NO_FORM.test(l));
    if (generic.length === refusals.length) {
      const diagnostics = compile(source).diagnostics.filter((d) =>
        d.message.includes('does not say which division'),
      );
      for (const type of ['i32', 'u32', 'f32']) {
        let wrapped = source;
        let count = 0;
        for (const d of diagnostics) {
          const tree = /no operand of "(.*?)" has a declared type/.exec(d.message)?.[1];
          if (tree === undefined) continue;
          const value = VALUE.exec(d.message)?.[1];
          let edited = tree;
          if (value !== undefined) edited = value;
          else if (typesOf(d.message).includes(type)) {
            for (const s of subjectsOf(d.message)) edited = edited.split(s).join(`${type}(${s})`);
          } else continue;
          count++;
          wrapped = wrapped.replace(tree, edited);
        }
        // Each refusal the wraps reach is gone, and no other comes.
        if (count > 0) expect(refusalsOf(wrapped)).toHaveLength(diagnostics.length - count);
      }
      return 'generic';
    }
    expect(generic).toEqual([]);
    let fixed = source;
    for (const d of compile(source).diagnostics) {
      const m = /no operand of "(.*)" has a declared type, .* Write "(.*)" for the/.exec(d.message);
      if (m) fixed = fixed.replace(m[1]!, m[2]!);
    }
    expect(compile(fixed).diagnostics).toEqual([]);
    expect(editor(fixed)).toEqual([]);
    return 'named';
  };

  it('where the edits do not compile together, no refusal names an edit', () => {
    const source = T('let q = (1 | 2) / 2;\n  let x: f32 = q;\n  let j: i32 = q;\n  return j;');
    expect(one(source)).toBe(
      'TS8003: "1 | 2" is an integer by its bit operator, and no operand of "(1 | 2) / 2" has a ' +
        'declared type, so the "/" does not say which division it is. Write i32(…) or f32(…) ' +
        'around "1 | 2" to choose the division.',
    );
  });

  it('refusals that interfere name no edit, and the others name proven edits (F1, F3)', () => {
    // F1 example A: q is read as an f32 and as an i32, so no set compiles; r names no edit too.
    const a = T(
      'let q = (1 | 2) / 2;\n  let x: f32 = q;\n  let j: i32 = q;\n  let r = (5|0)/2;\n' +
        '  return x + f32(j) + r;',
      'f32',
    );
    expect(verified(a)).toBe('generic');
    // F1 example B: the refusals do not interfere, and each names its edit.
    const b =
      T('let r = (5|0)/2;\n  let s: i32 = r;\n  return f32(s);', 'f32') +
      '\nexport function u(ii: i32): f32 {\n  let q = (1 | 2) / 2;\n  return q;\n}\n';
    expect(verified(b)).toBe('named');
    const got = lines(b);
    expect(got[0]).toMatch(/Write "i32\(5\|0\)\/2" for the integer division\.$/);
    expect(got[1]).toMatch(/Write "f32\(1 \| 2\) \/ 2" for the float division\.$/);
    // F3: an equal error elsewhere does not make a failing edit look proven.
    const c =
      '"use typeshade";\nexport function u(ii: i32): i32 {\n  let s: i32 = 1.5;\n  return s;\n}\n' +
      'export function t(ii: i32): f32 {\n  let q = (1 | 2) / 2;\n  let x: f32 = q;\n' +
      '  let s: i32 = q;\n  return x + f32(s);\n}\n';
    const refusal = lines(c).filter((l) => l.includes('no operand of'));
    expect(refusal).toHaveLength(1);
    expect(refusal[0]).toMatch(GENERIC);
  });

  it.each([
    [
      'P2',
      'let q=(1|2)/2;\n  let j: i32=q;\n  let s=q;\n  let k: i32=s;\n  let r=(5|0)/2;\n' +
        '  return f32(j+k)+r;',
      'f32',
      '',
    ],
    [
      'R3',
      'let q=(1|2)/2;\n  let r=(5|0)/2;\n  let j: i32 = select(r, r, q > 0.5);\n  return f32(j);',
      'f32',
      '',
    ],
    [
      'U1',
      'let q = (1 | 2) / 2;\n  return h(q);',
      'u32',
      'function h(a: u32): u32 {\n  return a;\n}\n',
    ],
    ['U9', 'let q = (1 | 2) / 2;\n  return (vec2u(vi, vi) * q).x;', 'u32', ''],
    [
      'J1',
      'let q=(1|2)/2;\n  let r=(5|0)/2;\n  let z = q*r;\n  let j: i32 = z;\n  return j;',
      'i32',
      '',
    ],
    [
      'J2',
      'let q=(1|2)/2;\n  let r=(5|0)/2;\n  let z = q*r;\n  let j: i32 = z;\n  let x: f32 = z;\n' +
        '  return j + i32(x);',
      'i32',
      '',
    ],
  ])('%s names a proven edit set or no edit', (_, body, ret, pre) => {
    verified(T(body, ret, pre));
  });

  it.each([
    ['U1', 'let q = (1 | 2) / 2;\n  return h(q);', 'function h(a: u32): u32 {\n  return a;\n}\n'],
    ['U9', 'let q = (1 | 2) / 2;\n  return (vec2u(vi, vi) * q).x;', ''],
  ])('%s: a u32 position names the u32 edit', (_, body, pre) => {
    const source = T(body, 'u32', pre);
    expect(verified(source)).toBe('named');
    expect(one(source)).toContain('Write "u32(1 | 2) / 2" for the integer division.');
  });

  it.each([
    [
      'every edit compiles',
      (i: number) => `let q${i} = (${i} | 1) / 2;\n  let x${i}: f32 = q${i};`,
    ],
    [
      'every edit fails',
      (i: number) =>
        `let q${i} = (${i} | 1) / 2;\n  let x${i}: f32 = q${i};\n  let s${i}: i32 = q${i};`,
    ],
    [
      'one edit fails',
      (i: number) =>
        i === 0
          ? `let q${i} = (${i} | 1) / 2;\n  let x${i}: f32 = q${i};\n  let s${i}: i32 = q${i};`
          : `let q${i} = (${i} | 1) / 2;\n  let x${i}: f32 = q${i};`,
    ],
    [
      'each quotient read through a let',
      (i: number) => `let q${i} = (${i} | 1) / 2;\n  let s${i} = q${i};\n  let k${i}: i32 = s${i};`,
    ],
  ])('the check of 40 refusals compiles at most two edited programs: %s', (_, form) => {
    const body = Array.from({ length: 40 }, (_, i) => form(i)).join('\n  ') + '\n  return 0.0;';
    const source = T(body, 'f32');
    const before = checkedEditCompiles();
    expect(compile(source).diagnostics).toHaveLength(40);
    expect(checkedEditCompiles() - before).toBeLessThanOrEqual(2);
    verified(source);
  });

  // The tenth review of #1272 at da92036b: the use is followed through a bit operator, a long
  // chain of `let`s, an inferred type, an untyped function's result, and every path of a refused
  // `/` (a tree, a binding that holds one, a constant of no fixed type) is in the one check.
  const HU = 'function h(a: u32): u32 {\n  return a;\n}\n';
  it.each([
    ['bit operator to the result', 'let q=(5|2)/2;\n  return q & 3;', ''],
    ['bit operator to a u32 let', 'let q=(5|2)/2;\n  let k: u32 = q | 1;\n  return k;', ''],
    ['~ to a u32 let', 'let q=(5|2)/2;\n  let k: u32 = ~q;\n  return k;', ''],
    ['shift to a u32 parameter', 'let q=(5|2)/2;\n  return h(q >> 1);', HU],
    [
      'a chain of six lets',
      'let q=(5|2)/2;\n  let a=q;\n  let b=a;\n  let c=b;\n  let d=c;\n  let e=d;\n  let k: u32=e;\n  return k;',
      '',
    ],
    [
      'a vector component',
      'let q=(5|2)/2;\n  let v = vec2u(vi, vi);\n  v.y = q;\n  return v.y;',
      '',
    ],
    [
      'a field of a class',
      'let q=(5|2)/2;\n  let p = new P();\n  return u32(f32(p.id + q));',
      'class P {\n  id: u32 = 0;\n}\n',
    ],
    ['an inferred let', 'let q=(5|2)/2;\n  let w = vi;\n  return u32(f32(w + q));', ''],
    [
      'an untyped result, let',
      'let k: u32 = g();\n  return k;',
      'function g() {\n  let q=(1|2)/2;\n  return q;\n}\n',
    ],
    [
      'an untyped result, return',
      'let k: u32 = g();\n  return k;',
      'function g() {\n  return (1|2)/2;\n}\n',
    ],
  ])('a u32 position names the u32 edit: %s', (_, body, pre) => {
    const source = T(body, 'u32', pre);
    expect(verified(source)).toBe('named');
    expect(lines(source)).toHaveLength(1);
    expect(lines(source)[0]).toMatch(/Write "u32\([^"]*" for the integer division\.$/);
  });

  it('an untyped result read by an i32 names the i32 edit', () => {
    const source = T('return g() * 2;', 'i32', 'function g() {\n  return (1|2)/2;\n}\n');
    expect(verified(source)).toBe('named');
    expect(one(source)).toContain('Write "i32(1|2)/2" for the integer division.');
  });

  it.each([
    [
      'an i32 let',
      'const k = 1|2;\n  let q = k / 2;\n  let j: i32 = q;\n  return f32(j);',
      'i32(k) / 2',
    ],
    ['a u32 parameter', 'const k = 1|2;\n  let q = k / 2;\n  return f32(h(q));', 'u32(k) / 2'],
  ])('a binding that holds a tree names the edit of its use: %s', (_, body, edit) => {
    const source = T(body, 'f32', HU);
    expect(verified(source)).toBe('named');
    expect(one(source)).toContain(`Write "${edit}" for the integer division.`);
  });

  it('a binding beside a tree that flows to two types names no edit either', () => {
    const source = T(
      'const k = 1|2;\n  let q = k / 2;\n  let r = (1|2)/2;\n  let x: f32 = r;\n  let j: i32 = r;\n' +
        '  return q + x + f32(j);',
      'f32',
    );
    expect(verified(source)).toBe('generic');
  });

  it.each([
    ['nested', 'let q = ((1|2)/2)/2;\n  let x: f32 = q;\n  let j: i32 = q;\n  return x;', '"1|2"'],
    [
      'two trees',
      'let q = (1|2)/(1<<1);\n  let x: f32 = q;\n  let j: i32 = q;\n  return x;',
      'each of "1|2" and "1<<1"',
    ],
  ])(
    'the remedy that names no edit names the operands that choose the division: %s',
    (_, body, subjects) => {
      const source = T(body, 'f32');
      expect(verified(source)).toBe('generic');
      expect(one(source)).toContain(`around ${subjects} to choose the division.`);
    },
  );

  it.each([['i32'], ['u32']])(
    'a value no integer type holds, read as an integer, names no form: %s',
    (type) => {
      const source = T(`let q = ((1<<30)*4)/3;\n  let j: ${type} = q;\n  return f32(j);`, 'f32');
      expect(verified(source)).toBe('generic');
      expect(one(source)).toContain(
        'No integer type holds "(1<<30)*4" (4294967296), and the quotient is read as an ' +
          'integer here, so no division of it computes this value.',
      );
    },
  );

  it('a value no integer type holds, read as an f32, names the float form, which adds no error', () => {
    // The module names no edit (another refusal flows to two types); the value form this
    // refusal names is the one that chooses its division, and it adds no error.
    const source = T(
      'let q = ((1<<30)*4)/3;\n  let x: f32 = q;\n  let r = (1|2)/2;\n  let y: f32 = r;\n' +
        '  let j: i32 = r;\n  return x + y + f32(j);',
      'f32',
    );
    const got = refusalsOf(source);
    expect(got).toHaveLength(2);
    expect(got[0]).toContain(
      'No integer type holds "(1<<30)*4" (4294967296), so only the float division chooses it: ' +
        'write "f32(4294967296)/3".',
    );
    const edited = source.replace('((1<<30)*4)/3', 'f32(4294967296)/3');
    // Only the other refusal stays: the edit adds no error.
    expect(lines(edited)).toEqual([got[1]]);
  });

  it('a /= in a module whose edits do not compile together names the declaration to type', () => {
    const source = T(
      'let a = 1|2;\n  a /= 2;\n  let r = (1|2)/2;\n  let x: f32 = r;\n  let j: i32 = r;\n' +
        '  return f32(a) + x + f32(j);',
      'f32',
    );
    const got = lines(source);
    expect(got).toHaveLength(2);
    expect(got[0]).toContain('Declare "a" with i32 or u32 to choose the division.');
    for (const type of ['i32', 'u32']) {
      const typed = source.replace('let a = 1|2', `let a: ${type} = 1|2`);
      expect(lines(typed).filter((l) => l.includes('"a /= 2"'))).toEqual([]);
    }
  });

  it('a written type on the divisor decides the division', () => {
    const source = T('return f32((1|2)/i32(2));', 'f32');
    expect(lines(source)).toEqual([]);
    expect(compile(source).eval('t', [5, 3])).toBe(1);
  });

  it('a tree over a constant of no fixed type is one refusal, with the edit of its use', () => {
    const source = T(
      'let c0=(K|0)/2;\n  let u0: u32 = h(c0);\n  return u0;',
      'u32',
      'const K = 3;\n' + HU,
    );
    expect(verified(source)).toBe('named');
    expect(one(source)).toContain('Write "(u32(K)|0)/2" for the integer division.');
  });

  it.each([
    [
      'every edit compiles',
      (i: number) => `let c${i} = (${i} | 1) / 2;\n  let x${i}: f32 = c${i};`,
    ],
    [
      'one edit fails',
      (i: number) =>
        i === 0
          ? `let c${i} = (${i} | 1) / 2;\n  let x${i}: f32 = c${i};\n  let s${i}: i32 = c${i};`
          : `let c${i} = (${i} | 1) / 2;\n  let x${i}: f32 = c${i};`,
    ],
  ])(
    'a module of trees, bindings and constants compiles at most two edited programs: %s',
    (_, tree) => {
      const body =
        Array.from({ length: 40 }, (_, i) => {
          if (i % 3 === 0) return tree(i);
          if (i % 3 === 1)
            return `const k${i} = ${i}|1;\n  let w${i} = k${i} / 2;\n  let y${i}: f32 = w${i};`;
          return `let a${i} = (K|${i})/2;\n  let z${i}: u32 = h(a${i});`;
        }).join('\n  ') + '\n  return 0.0;';
      const source = T(body, 'f32', 'const K = 3;\n' + HU);
      const before = checkedEditCompiles();
      expect(compile(source).diagnostics).toHaveLength(40);
      expect(checkedEditCompiles() - before).toBeLessThanOrEqual(2);
      verified(source);
    },
  );

  // The eleventh review of #1272 at 56611e85.
  it.each([
    ['abs', 'return f32((1|2)/abs(1<<1));', 'f32(1|2) / f32(abs(1<<1))'],
    [
      'select',
      'return f32((1|2)/select(1<<1, 4, vi > 2));',
      'f32(1|2) / f32(select(1<<1, 4, vi > 2))',
    ],
    ['min', 'return f32((5|0)/min(1<<1, 9));', 'f32(5|0) / f32(min(1<<1, 9))'],
    ['abs of the dividend', 'return f32(abs(1|2)/2);', 'f32(abs(1|2)) / 2'],
    ['countOneBits', 'return f32((1|2)/countOneBits(3|0));', 'f32(1|2) / f32(countOneBits(3|0))'],
  ])("a builtin carries its arguments' origin, so the / stays refused: %s", (_, body, edit) => {
    const source = T(body, 'f32');
    expect(one(source)).toContain(`Write "${edit}" for the float division.`);
    expect(verified(source)).toBe('named');
  });

  it.each([
    ['/', 'return (3000000000|0)/vi;', '3000000000|0', 'u32', 600000000],
    ['%', 'return (0xF0000000|0) % u32(7);', '0xF0000000|0', 'u32', 4026531840 % 7],
    ['<', 'return u32((0xF0000000|0) < u32(7));', '0xF0000000|0', 'u32', 0],
    ['/ a conversion', 'return f32((3000000000|0)/u32(2));', '3000000000|0', 'f32', 1500000000],
  ])(
    'a tree whose u32 bits and TypeScript value differ is refused beside a u32: %s',
    (op, body, tree, ret, value) => {
      const source = T(body, ret);
      const line = one(source);
      expect(line).toContain(`"${tree}" is `);
      expect(line).toContain(`Write "u32(${tree})" for the u32 value.`);
      accepted5(source.replace(`(${tree})`, `u32(${tree})`), value);
      void op;
    },
  );

  it('a quotient that flows to an exported result is decided there, in both halves', () => {
    const lib = '"use typeshade";\nexport function g() {\n  return (1|2)/2;\n}\n';
    const main =
      '"use typeshade";\nimport { g } from "./lib.shade";\nexport function t(vi: u32): u32 {\n' +
      '  let k: u32 = g();\n  return k;\n}\n';
    const read = (uri: string): string | undefined =>
      uri.includes('lib.shade') ? lib : uri.includes('main.shade') ? main : undefined;
    const compiled = compile(main, { fileName: '/app/main.shade.ts', readDocument: read });
    const refusal = compiled.diagnostics.filter((d) => d.message.includes('which division'));
    expect(refusal.map((d) => d.message)).toEqual([
      expect.stringContaining('Write "f32(1|2)/2" for the float division.'),
    ]);
    const checked = checkDocuments(
      [
        { path: '/app/main.shade.ts', uri: '/app/main.shade.ts', text: main },
        { path: '/app/lib.shade.ts', uri: '/app/lib.shade.ts', text: lib },
      ],
      { readDocument: read },
    );
    const named = checked.diagnostics
      .filter((d) => d.message.includes('which division'))
      .map((d) => /Write "(.*)" for/.exec(d.message)?.[1]);
    expect(new Set(named)).toEqual(new Set(['f32(1|2)/2']));
    // The edit keeps the exported result an f32: the lib compiles with it.
    const fixed = lib.replace('(1|2)/2', 'f32(1|2)/2');
    expect(compile(fixed, { fileName: '/app/lib.shade.ts' }).diagnostics).toEqual([]);
  });

  it('a quotient a generic function returns names no edit', () => {
    const source = T(
      'return f32(g<u32>(vi));',
      'f32',
      'function g<T>(a: T) {\n  return (1|2)/2;\n}\n',
    );
    // The editor reads a generic function's result otherwise (its own issue); the refusal is
    // the same sentence in both halves, and names no edit.
    const ours = compile(source).diagnostics.filter((d) => d.message.includes('which division'));
    const theirs = editor(source).filter((l) => l.includes('which division'));
    expect(ours.map((d) => `${d.code}: ${d.message}`)).toEqual(theirs);
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatch(/around "1\|2" to choose the division\.$/);
  });

  it.each([
    ['return a;', ''],
    ['return h(a);', 'function h(x: u32): u32 {\n  return x;\n}\n'],
  ])("a /= takes the type of its variable's uses: %s", (ret, pre) => {
    const source = T(`let a = 1|2;\n  a /= 2;\n  ${ret}`, 'u32', pre);
    expect(one(source)).toContain('Write "let a: u32 = 1|2" for the integer division.');
    accepted5(source.replace('let a = 1|2', 'let a: u32 = 1|2'), 1);
  });

  it("a field of an object literal takes the field's declared type", () => {
    const source = T(
      'let q = (5|2)/2;\n  let p: Q = { id: q };\n  return p.id;',
      'u32',
      'interface Q {\n  id: u32;\n}\n',
    );
    expect(one(source)).toContain('Write "u32(5|2)/2" for the integer division.');
    expect(verified(source)).toBe('named');
  });

  it('a deep tree names every operand to wrap, and only the types its positions take', () => {
    const source = T(
      'let q = (((1|2)/2)/2)/(1<<2);\n  let x: f32 = q;\n  let j: i32 = q;\n  return x;',
      'f32',
    );
    expect(one(source)).toContain(
      'Write i32(…) or f32(…) around each of "1|2" and "1<<2" to choose the division.',
    );
    expect(verified(source)).toBe('generic');
  });

  it.each([
    ['a conversion inside the divisor', 'return f32((1|2)/(i32(2)+1));', 1],
    ['a /= by a conversion', 'let a = 1|2;\n  a /= i32(2);\n  return f32(a);', 1],
  ])('a written conversion decides the division: %s', (_, body, value) => {
    accepted5(T(body, 'f32'), value);
  });

  it.each([
    ['plain', (i: number) => `let q${i} = (${i} | 1) / 2;\n  let x${i}: f32 = q${i};`],
    [
      'every edit fails',
      (i: number) =>
        `let q${i} = (${i} | 1) / 2;\n  let x${i}: f32 = q${i};\n  let s${i}: i32 = q${i};`,
    ],
    [
      'one edit fails',
      (i: number) =>
        i === 0
          ? `let q${i} = (${i} | 1) / 2;\n  let x${i}: f32 = q${i};\n  let s${i}: i32 = q${i};`
          : `let q${i} = (${i} | 1) / 2;\n  let x${i}: f32 = q${i};`,
    ],
    [
      'N3',
      (i: number) => `let q${i} = (${i} | 1) / 2;\n  let s${i} = q${i};\n  let k${i}: i32 = s${i};`,
    ],
    [
      'a second set',
      (i: number) =>
        `let q${i} = (${i} | 2) / 2;\n  let s${i} = 0;\n  s${i} = q${i} & 3;\n  let u${i}: u32 = s${i};`,
    ],
  ])('the editor compiles at most two edited programs too: %s', (_, form) => {
    const body = Array.from({ length: 40 }, (_, i) => form(i)).join('\n  ') + '\n  return 0.0;';
    // A text no other test compiled, so no earlier check is reused.
    const source = T(body, 'f32', `// ${String(Math.random())}\n`);
    const before = checkedEditCompiles();
    expect(editor(source)).toHaveLength(40);
    expect(checkedEditCompiles() - before).toBeLessThanOrEqual(2);
  });

  it.each([
    ['let a = 1|2;\n  a /= 0;\n  return a;', 'i32', '', '0'],
    ['return f32((1|2) / Z);', 'f32', 'const Z = 0;\n', 'Z'],
  ])(
    'a zero divisor is the one mistake, before D-b and Amendment A2: %s',
    (body, ret, pre, divisor) => {
      expect(one(T(body, ret, pre))).toBe(
        `TS8003: Division by zero: "${divisor}" is 0 on every invocation. WGSL refuses it and ` +
          'GLSL ES 3.00 leaves it undefined.',
      );
    },
  );
});
