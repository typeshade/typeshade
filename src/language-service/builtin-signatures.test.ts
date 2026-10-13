// The generated scalar overloads name `ScalarOf` (change 0063).
//
// A row over a scalar returns `ScalarOf<P0, …>`, which `SHADE_DTS` declares once from `BRANDS`,
// in place of a conditional chain written into each overload. These cases pin the generated
// text; `ambient-parity.test.ts` pins that no type moved, in both halves, and
// `coredef-overloads.test.ts` reads every SUPPORTED instance.
import { describe, expect, it } from 'vitest';
import { COREDEF } from '../core/builtins/coredef.js';
import type { CoreDefRow } from '../core/builtins/coredef-types.js';
import { SHADE_DTS } from './ambient.js';
import {
  generatedOverloads,
  overloadOf,
  SCALAR_OF_ARITY,
  scalarOfDeclaration,
} from './builtin-signatures.js';

describe('ScalarOf', () => {
  it('is declared once in the ambient library, as the generator writes it', () => {
    const declaration = scalarOfDeclaration();
    expect(declaration.startsWith('type ScalarOf<A, B = unknown, C = unknown> = ')).toBe(true);
    expect(SHADE_DTS.split(declaration)).toHaveLength(2);
    expect(SCALAR_OF_ARITY).toBe(3);
  });

  it('is what every generated scalar overload returns, and no inline chain is left', () => {
    const scalar = [...generatedOverloads().values()]
      .flat()
      .filter((o) => /<P0 extends /.test(o) && !o.endsWith('): void'));
    expect(scalar.length).toBeGreaterThan(0);
    const returning = scalar.filter((o) => /\): ScalarOf<P\d(, P\d)*>$/.test(o));
    expect(returning.map((o) => /function (\w+)/.exec(o)![1])).toContain('pow');
    expect(returning).toContain(
      'declare function pow<P0 extends number, P1 extends number>(a0: P0, a1: P1): ScalarOf<P0, P1>',
    );
    expect(returning).toContain(
      'declare function clamp<P0 extends number, P1 extends number, P2 extends number>(a0: P0, a1: P1, a2: P2): ScalarOf<P0, P1, P2>',
    );
    expect(SHADE_DTS).not.toMatch(/\[P\d\] extends \[boolean\]/);
  });

  it('refuses a row whose result reads more arguments than ScalarOf takes', () => {
    const clamp = COREDEF.rows.find(
      (r) => r.kind === 'fn' && r.name === 'clamp' && r.ret === 'T',
    ) as CoreDefRow;
    const wide: CoreDefRow = {
      ...clamp,
      name: 'wide',
      params: [0, 1, 2, 3].map((i) => ({ name: `p${String(i)}`, type: 'T' })),
      signature: 'fn wide<T: fiu32_f16>(T, T, T, T) -> T',
    };
    expect(overloadOf(clamp)).toMatch(/ScalarOf<P0, P1, P2>$/);
    expect(() => overloadOf(wide)).toThrow(
      'builtin-signatures: fn wide<T: fiu32_f16>(T, T, T, T) -> T reads its result from 4 arguments, and ScalarOf takes 3',
    );
  });
});
