import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { bothHalves, bothRefuse } from '../../core/testing/both-halves.js';
import { arrayT, f32T } from '../../core/ir/types.js';
import {
  readOnlyPhrase,
  recordCallFormBinding,
  recordRecoveredBinding,
  writableRemedy,
  type Binding,
  type BindingKind,
} from './context.js';

const COMPUTE = (decl: string, body: string): string => `"use typeshade"
${decl}
@compute([1, 1, 1]) export function cs(gid: builtin<'global_invocation_id'>): void {
${body}
}
`;

const FRAGMENT = (decl: string, body: string): string => `"use typeshade"
${decl}
@fragment export function fs(uv: location<0, vec2>): vec4 {
${body}
}
`;

const sourceFileOf = (): ts.SourceFile =>
  ts.createSourceFile('a.shade.ts', '', ts.ScriptTarget.Latest, true);

const storageArray = (name: string): Binding => ({
  kind: 'binding',
  name,
  type: arrayT(f32T),
  mutable: false,
  space: 'storage',
});

describe('the sentence a refused assignment gives for each kind of name', () => {
  const PHRASES: readonly (readonly [BindingKind, string])[] = [
    ['binding', 'a read-only resource'],
    ['module', 'a module const'],
    ['override', 'an override constant, set by the pipeline'],
    ['modvar', 'a module variable'],
    ['param', 'declared with const'],
    ['local', 'declared with const'],
  ];
  for (const [kind, phrase] of PHRASES) {
    it(`names a ${kind} as "${phrase}"`, () => {
      expect(readOnlyPhrase(kind)).toBe(phrase);
    });
  }

  it('refuses a write to an override in both halves, with the override phrase', () => {
    bothRefuse(
      FRAGMENT('declare const K: override<f32>;', '  K = 2.;\n  return vec4(K);'),
      'TS8005',
      'Cannot assign to "K" — it is an override constant, set by the pipeline.',
    );
  });

  it('refuses a write to a uniform in both halves, with no remedy sentence', () => {
    bothRefuse(
      FRAGMENT('declare const u: uniform<vec4>;', '  u = vec4(1.);\n  return vec4(1.);'),
      'TS8005',
      'Cannot assign to "u" — it is a read-only resource.',
    );
  });
});

describe('the remedy a read-only storage binding names', () => {
  it('names the declaration form the author wrote, for a declare const', () => {
    bothRefuse(
      COMPUTE('declare const xs: storage<f32[], "read">;', '  xs[gid.x] = 1.;'),
      'TS8005',
      'Cannot assign to "xs" — it is a read-only resource. Write "declare const xs: storage<array<f32>, "read_write">" to write to it.',
    );
  });

  it('names the call form the author wrote, with its arguments, for a call binding', () => {
    bothRefuse(
      COMPUTE('const xs = storage<f32[], "read">({ binding: 3 });', '  xs[gid.x] = 1.;'),
      'TS8005',
      'Cannot assign to "xs" — it is a read-only resource. Write "const xs = storage<array<f32>, "read_write">({ binding: 3 })" to write to it.',
    );
  });

  it('says nothing for a binding whose declared type was recovered', () => {
    const file = sourceFileOf();
    const binding = storageArray('mnd');
    expect(writableRemedy(binding, file)).toBe(
      ' Write "declare const mnd: storage<array<f32>, "read_write">" to write to it.',
    );
    recordRecoveredBinding(file, 'mnd');
    expect(writableRemedy(binding, file)).toBe('');
  });

  it('names the call form only for the file that recorded it', () => {
    const file = sourceFileOf();
    recordCallFormBinding(file, 'xs', '({ binding: 1 })');
    expect(writableRemedy(storageArray('xs'), file)).toBe(
      ' Write "const xs = storage<array<f32>, "read_write">({ binding: 1 })" to write to it.',
    );
    expect(writableRemedy(storageArray('xs'), sourceFileOf())).toBe(
      ' Write "declare const xs: storage<array<f32>, "read_write">" to write to it.',
    );
  });

  it('says nothing for a binding that is not in storage', () => {
    expect(writableRemedy({ ...storageArray('xs'), space: 'uniform' })).toBe('');
    expect(writableRemedy({ ...storageArray('xs'), kind: 'module' })).toBe('');
  });

  it('drops a use of a recovered binding without a second sentence, in both halves', () => {
    const halves = bothHalves(
      COMPUTE('declare const mnd: storage<mat2x3<f64>>;', '  mnd[0] = mnd[0];'),
    );
    const refusal =
      'typeshade TS8027: mat2x3<f64> has no emulated-double form: the fp64 pass carries a square ' +
      'matrix of doubles only (mat2, mat3, mat4). Declare it mat2x3 and narrow, or use a square shape.';
    expect(halves.compiler).toEqual([refusal]);
    expect(halves.editor.filter((l) => l.startsWith('typeshade'))).toEqual([refusal]);
  });
});

describe('the names a body gives its locals', () => {
  it('refuses a second declaration of a name in one block in both halves', () => {
    const halves = bothHalves(FRAGMENT('', '  let a = 1.;\n  let a = 2.;\n  return vec4(a);'));
    expect(halves.compiler).toEqual(['typeshade TS8023: Duplicate binding "a" in this scope.']);
    expect(halves.editor).toContain('typeshade TS8023: Duplicate binding "a" in this scope.');
  });

  it('keeps the counter of a while loop clear of a function named _w', () => {
    const { result } = bothHalves(
      FRAGMENT(
        'function _w(): f32 { return 1.; }',
        '  let n = 0;\n  while (n < 3) { n++; }\n  return vec4(_w() + f32(n));',
      ),
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.wgsl).toContain('var _w_1: i32');
    expect(result.wgsl).toContain('(1.0 + f32(n))');
  });
});
