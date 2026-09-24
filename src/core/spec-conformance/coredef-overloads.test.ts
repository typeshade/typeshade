// Verifies: Rule 12.7 (docs/language-design.md; traced in reqs/).

// ═══ Every row of Tint's overload table is claimed, and a SUPPORTED one is read by both halves ═══
//
// WHAT THIS CLOSES. A builtin's type rules were written three times by hand, in the compiler's
// result types (`mathResultType`), its argument table (`math-args.ts`) and the editor's
// declarations (`SHADE_DTS`), and a test of one copy could not see the others (0017). This suite
// reads the one table all three copy, `src/core/builtins/coredef.ts` (every overload of `core.def`,
// baked by `scripts/bake-coredef.ts`), and forces every row to be claimed by
// `src/core/builtins/overlay.ts` as exactly one of REFUSED, SUPPORTED, or DEFERRED to a family of 0017.
//
// A SUPPORTED row is held to BOTH halves on the same witness (`coredef-witness.ts`): for every
// instance of its type parameters over the types TypeShade has, `compile()` accepts it and
// types the call as the row says, and the language service reports nothing and types the call
// the same. `coredef-texture-overloads.test.ts` held the texture rows to the compiler alone; the
// `.length` of a runtime-sized array (#271) is what a one-half test lets through.
//
// THE INSTRUMENT IS PROVEN FIRST (AGENTS.md#gate-discipline): the both-halves check is run on a
// declaration that says `number` where the compiler says `u32`, and must name it.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHADE_DTS } from '../../language-service/ambient.js';
import { ATOMIC_INTRINSICS, BARRIER_INTRINSICS } from '../intrinsics.js';
import { rowTypes } from '../builtins/row-types.js';
import { NOT_WGSL, claimOf as claimOfRow, familyOf, type Claim } from '../builtins/overlay.js';
import { COREDEF } from '../builtins/coredef.js';
import type { CoreDefRow } from '../builtins/coredef-types.js';
import { compilerReadings, disagreement, editorReadings, instancesOf } from './coredef-witness.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = COREDEF;
const textures = JSON.parse(readFileSync(join(FIXTURES, 'coredef-textures.json'), 'utf8')) as {
  sha256: string;
  rows: { fn: string; params: { type: string }[]; ret: string }[];
};

const claimOf = (row: CoreDefRow): Claim | undefined => claimOfRow(row, fixture.matchers);

describe('the core.def fixture', () => {
  it('is the same snapshot the texture fixture was baked from', () => {
    expect(fixture.sha256).toBe(textures.sha256);
  });

  it('holds every texture row the texture suite claims', () => {
    const key = (fn: string, params: readonly { type: string }[], ret: string): string =>
      `${fn}(${params.map((p) => p.type).join(', ')})${ret === '' ? '' : ` -> ${ret}`}`;
    const here = new Set(fixture.rows.map((r) => key(r.name, r.params, r.ret)));
    expect(textures.rows.filter((r) => !here.has(key(r.fn, r.params, r.ret)))).toEqual([]);
  });

  it('has every kind of row, in the numbers a parse regression would move', () => {
    const count = (k: CoreDefRow['kind']): number =>
      fixture.rows.filter((r) => r.kind === k).length;
    expect(count('fn')).toBeGreaterThanOrEqual(400);
    expect(count('ctor')).toBeGreaterThanOrEqual(60);
    expect(count('conv')).toBeGreaterThanOrEqual(15);
    expect(count('op')).toBeGreaterThanOrEqual(50);
  });
});

describe('every core.def row is claimed (0017)', () => {
  it('as exactly one of REFUSED, SUPPORTED or DEFERRED to a family', () => {
    const unclaimed = fixture.rows.filter((r) => claimOf(r) === undefined).map((r) => r.signature);
    expect(unclaimed).toEqual([]);
  });

  it('refuses no row a family also names, so a refusal is never a family forgetting a row', () => {
    const both = fixture.rows.filter(
      (r) => r.kind === 'fn' && NOT_WGSL[r.name] !== undefined && familyOf(r.kind, r.name),
    );
    expect(both.map((r) => r.signature)).toEqual([]);
  });

  it('holds every SUPPORTED row to both halves on every instance', () => {
    const rows = fixture.rows.filter((r) => claimOf(r)?.status === 'SUPPORTED');
    const instances = rows.flatMap((r) => {
      const all = instancesOf(r, fixture.matchers);
      if (all === undefined) throw new Error(`SUPPORTED row with no witness form: ${r.signature}`);
      return all;
    });
    // A floor, so a claim table that stopped supporting anything cannot pass on nothing: the
    // math family, the derivatives, bits and packing, and the atomics, barriers and
    // `arrayLength` are 163 rows and 407 instances.
    expect(rows.length).toBeGreaterThanOrEqual(160);
    expect(instances.length).toBeGreaterThanOrEqual(400);
    const compiler = compilerReadings(instances);
    const editor = editorReadings(instances, SHADE_DTS);
    const parted = instances
      .map((inst, i) => disagreement(inst, compiler[i]!, editor[i]!))
      .filter((d) => d !== undefined);
    expect(parted).toEqual([]);
  }, 120_000);
});

describe('the both-halves check sees a disagreement when one is there', () => {
  // `abs` on an unsigned integer: core.def says `u32`, and the compiler agrees. An ambient
  // library whose scalar `abs` says `number` is the shape of every builtin-result drift the 0015
  // gate lists; the check must name it, and must pass the vector form beside it.
  const doctored = SHADE_DTS.split('\n')
    .filter((line) => !/^declare function abs\b/.test(line))
    .join('\n')
    .concat(
      '\ndeclare function abs(a0: number): number',
      '\ndeclare function abs<T extends vec2u | vec3u | vec4u | vec2i | vec3i | vec4i | vec2 | vec3 | vec4>(a0: T): T\n',
    );
  const rows = fixture.rows.filter((r) => r.kind === 'fn' && r.name === 'abs');

  it('finds the two abs rows, and an instance of each over TypeShade types', () => {
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => (instancesOf(r, fixture.matchers)?.length ?? 0) > 0)).toBe(true);
  });

  it('names the scalar instances the doctored declaration types `number`, and no vector one', () => {
    const instances = rows.flatMap((r) => instancesOf(r, fixture.matchers) ?? []);
    const compiler = compilerReadings(instances);
    const editor = editorReadings(instances, doctored);
    const parted = instances
      .map((inst, i) => disagreement(inst, compiler[i]!, editor[i]!))
      .filter((d) => d !== undefined);
    expect(parted).toContain('abs(u32): core.def says u32, the editor number');
    expect(parted).toContain('abs(i32): core.def says i32, the editor number');
    expect(parted.every((d) => !d.startsWith('abs(vec'))).toBe(true);
  }, 60_000);
});

describe('the IR tables of the atomics and barriers are the rows of core.def (0017)', () => {
  // `ATOMIC_INTRINSICS` and `BARRIER_INTRINSICS` stay in `core/intrinsics.ts`, which the CPU
  // runtime imports, so they are not built from the table there; they are held to it here. The
  // compiler types each call from the rows (`builtinResultType`), and these give the backends
  // the arity and the spelling.
  const family = fixture.rows.filter(
    (r) =>
      r.kind === 'fn' &&
      familyOf(r.kind, r.name) === 'atomics, barriers and arrayLength' &&
      claimOf(r)?.status === 'SUPPORTED',
  );

  it('lists every atomic row, with its arity and the kind of its result', () => {
    const fromRows = Object.fromEntries(
      family
        .filter((r) => r.name.startsWith('atomic'))
        .map((r) => {
          const ret = rowTypes(r)!.ret.k;
          const returns = ret === 'void' ? 'void' : ret === 'casResult' ? 'casResult' : 'value';
          return [r.name, { arity: r.params.length, returns }];
        }),
    );
    expect({ ...ATOMIC_INTRINSICS }).toEqual(fromRows);
  });

  it('lists every row that takes nothing and returns nothing as a barrier', () => {
    const fromRows = family
      .filter((r) => r.params.length === 0 && r.ret === '')
      .map((r) => r.name)
      .sort();
    expect([...BARRIER_INTRINSICS].sort()).toEqual(fromRows);
  });
});

describe('the both-halves check sees a disagreement on a location form', () => {
  // `atomicAdd` on an `atomic<u32>` is a `u32` to core.def and to the compiler. An ambient
  // library whose declaration says `number` must be named, on the witness that binds a storage
  // location; the `i32` instance beside it stays in agreement only if the check reads the brand.
  const doctored = SHADE_DTS.split('\n')
    .filter((line) => !/^declare function atomicAdd\b/.test(line))
    .join('\n')
    .concat(
      '\ndeclare function atomicAdd<T extends u32 | i32>(location: atomic<T>, value: T): number\n',
    );
  const rows = fixture.rows.filter((r) => r.kind === 'fn' && r.name === 'atomicAdd');

  it('names both atomicAdd instances the doctored declaration types `number`', () => {
    const instances = rows.flatMap((r) => instancesOf(r, fixture.matchers) ?? []);
    expect(instances).toHaveLength(2);
    const compiler = compilerReadings(instances);
    const editor = editorReadings(instances, doctored);
    const parted = instances
      .map((inst, i) => disagreement(inst, compiler[i]!, editor[i]!))
      .filter((d) => d !== undefined);
    expect(parted.sort()).toEqual([
      'atomicAdd(atomic<i32>, i32): core.def says i32, the editor number',
      'atomicAdd(atomic<u32>, u32): core.def says u32, the editor number',
    ]);
  }, 60_000);
});
