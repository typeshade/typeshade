import { describe, it } from 'vitest';
import { bothRefuse, bothTake } from '../../core/testing/both-halves.js';

const program = (body: string): string =>
  `"use typeshade";\nconst K = 1 | 2;\nexport function t(f: f32, i: i32, u: u32, g: f32): f32 {\n  ${body}\n}\n`;

const bare = (text: string): string =>
  `"${text}" is an integer by its bit operator, and this position takes an f32.`;
const named = (text: string): string => `${bare(text)} Write "f32(${text})" for the float value.`;

const MAX_MISMATCH =
  'max takes arguments of one type; the first is f32, this one i32. Cast one side: f32(x) or i32(x).';
const COMPOUND_MISMATCH =
  'Type mismatch: cannot += f32 and i32 — no implicit int/float conversion. Cast explicitly: f32(intVal) or i32(floatVal) / u32(floatVal).';

describe('an arm of ?: with no f32 arm keeps the text of its position (#1301)', () => {
  it('a declared i32 arm keeps the error of the call or the operator', () => {
    bothRefuse(
      program('return sqrt(i > 1 ? K : i);'),
      'TS8036',
      'sqrt takes an f32, or a vector of them; got i32.',
    );
    bothRefuse(program('return max(f, i > 1 ? K : i);'), 'TS8036', MAX_MISMATCH);
    bothRefuse(program('let x = 0.0; x += i > 1 ? K : i; return x;'), 'TS8003', COMPOUND_MISMATCH);
  });

  it('two integer arms name the whole ?: as the tree', () => {
    for (const body of [
      'return sqrt(i > 1 ? K : 2);',
      'return max(f, i > 1 ? K : 2);',
      'return Math.sqrt(i > 1 ? K : 2);',
    ]) {
      bothRefuse(program(body), 'TS8036', named('i > 1 ? K : 2'));
    }
    bothRefuse(program('return sqrt(f > 1.0 ? K : 2);'), 'TS8036', named('f > 1.0 ? K : 2'));
    bothRefuse(
      program('return sqrt(i > 1 ? i > 2 ? K : 3 : 4);'),
      'TS8036',
      named('i > 1 ? i > 2 ? K : 3 : 4'),
    );
    bothRefuse(program('let x = 0.0; x += i > 1 ? K : 2; return x;'), 'TS8003', COMPOUND_MISMATCH);
  });

  it('the whole ?: edit of a call argument compiles in both halves', () => {
    bothTake(program('return sqrt(f32(i > 1 ? K : 2));'));
    bothTake(program('return max(f, f32(i > 1 ? K : 2));'));
  });

  it('an arm beside an f32 arm in a call argument names its tree', () => {
    bothRefuse(program('return sqrt(i > 1 ? K : g);'), 'TS8003', named('K'));
    bothRefuse(program('return sqrt(i > 1 ? K : 2.5);'), 'TS8003', named('K'));
    bothTake(program('return sqrt(i > 1 ? f32(K) : g);'));
  });
});
