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
    // math family and the derivatives, bits and packing are 148 rows and 379 instances.
    expect(rows.length).toBeGreaterThanOrEqual(140);
    expect(instances.length).toBeGreaterThanOrEqual(370);
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
