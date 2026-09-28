// Verifies: Rule 12.6 (docs/language-design.md; traced in reqs/).
//
// An array with no size (`array<T>`) has its length only when the host binds it, so WGSL lets it
// live in a storage binding alone. A parameter, a result and a local that hold one, directly or
// as a struct's last field, reached Tint with no diagnostic and were refused there
// (`runtime-sized arrays can only be used in the <storage> address space`; for a result,
// `function return type must be a constructible type`). Each is now refused at the front end,
// in the compiler and in the editor on the same source. A `const` that names the binding is
// the binding, as it is in TypeScript, so nothing is copied and it stays. The rows were measured against Tint in
// Chromium once, with the neighbours Tint accepts (a field read, `.length`, a loop over the
// binding, a sized array parameter), which stay clean.

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const WHY =
  'an array with no size, which lives only in a storage binding because its length is known only when the host binds it';

const module = (body: string): string => `"use typeshade";
declare const b: storage<array<f32>, "read_write">;
class S { n: u32; xs: array<f32>; }
declare const s: storage<S, "read_write">;
${body}
`;

const compiled = (body: string): string[] =>
  compile(module(body), { fileName: 'm.shade.ts' }).diagnostics.map(
    (d) => `${d.code} ${d.message}`,
  );

const edited = (body: string): string[] => {
  const service = createTypeshadeLanguageService();
  service.openDocument('m.shade.ts', module(body));
  return service.getDiagnostics('m.shade.ts').map((d) => `${String(d.code)} ${d.message}`);
};

/** Each refusal Tint makes, as the front end now says it: `[name, program, code and text]`. */
const REFUSED: readonly (readonly [string, string, string])[] = [
  [
    'a parameter',
    `function first(ps: array<f32>): f32 { return ps[0]; }\n@compute([1]) export function cs() { b[0] = first(b); }`,
    `TS8020 Parameter "ps" is array<f32>, ${WHY}. Give it a size, array<f32, N>, or read the binding by its name inside the function instead.`,
  ],
  [
    'a parameter of a struct whose last field has no size',
    `function first(v: S): f32 { return v.xs[0]; }\n@compute([1]) export function cs() { b[0] = first(s); }`,
    `TS8020 Parameter "v" is S, whose field "xs" is array<f32>, ${WHY}. Give it a size, array<f32, N>, or read the binding by its name inside the function instead.`,
  ],
  [
    'a result',
    `function whole(): array<f32> { return b; }\n@compute([1]) export function cs() { b[0] = whole()[1]; }`,
    `TS8020 This function returns array<f32>, ${WHY}. Read the binding by its name where the value is needed.`,
  ],
  [
    'a local copy',
    `@compute([1]) export function cs() { let a = b; b[0] = a[1]; }`,
    `TS8099 "a" would copy "b", which is array<f32>, ${WHY}. Read "b" by its name instead.`,
  ],
  [
    'a local copy of a struct',
    `@compute([1]) export function cs() { let v = s; b[0] = v.xs[0]; }`,
    `TS8099 "v" would copy "s", which is S, whose field "xs" is array<f32>, ${WHY}. Read "s" by its name instead.`,
  ],
  [
    'a declared local',
    `@compute([1]) export function cs() { let a: array<f32>; b[0] = 1.; }`,
    `TS8099 "a" would be array<f32>, ${WHY}. Give the array a size: array<f32, N>.`,
  ],
];

/** What Tint accepts, beside each refusal. */
const ACCEPTED: readonly (readonly [string, string])[] = [
  ['a field read', `@compute([1]) export function cs() { b[0] = s.xs[0] + f32(s.n); }`],
  ['the length', `@compute([1]) export function cs() { b[0] = f32(b.length); }`],
  // A `const` that names the binding is the binding, as in TypeScript: nothing is copied.
  [
    'a const that names the binding',
    `@compute([1]) export function cs() { const a = b; a[0] = a[1] + f32(a.length); }`,
  ],
  [
    'a const that names a struct binding',
    `@compute([1]) export function cs() { const v = s; b[0] = v.xs[0]; }`,
  ],
  [
    'a loop over the binding',
    `@compute([1]) export function cs() { let t = 0.; for (const x of b) { t += x; } b[0] = t; }`,
  ],
  [
    'a sized array parameter',
    `function ok(ps: array<f32, 4>): f32 { return ps[0]; }\n@compute([1]) export function cs() { b[0] = ok([1., 2., 3., 4.]); }`,
  ],
];

describe('an array with no size is a storage binding, not a value (Rule 12.6)', () => {
  it.each(REFUSED)('refuses %s in the compiler and in the editor', (_name, body, want) => {
    expect(compiled(body)).toEqual([want]);
    expect(edited(body)).toContain(want);
  });

  it.each(ACCEPTED)('accepts %s', (_name, body) => {
    expect(compiled(body)).toEqual([]);
    expect(edited(body)).toEqual([]);
  });
});
