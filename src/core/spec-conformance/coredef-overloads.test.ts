// Verifies: Rule 12.7 (docs/language-design.md; traced in reqs/).

// ═══ Every row of Tint's overload table is claimed, and a SUPPORTED one is read by both halves ═══
//
// WHAT THIS CLOSES. A builtin's type rules were written three times by hand, in the compiler's
// result types (`mathResultType`), its argument table (`math-args.ts`) and the editor's
// declarations (`SHADE_DTS`), and a test of one copy could not see the others (0017). This suite
// reads the one table all three copy, `fixtures/coredef.json` (every overload of `core.def`,
// baked by `scripts/bake-coredef.ts`), and forces every row to be claimed by
// `coredef-overlay.ts` as exactly one of REFUSED, SUPPORTED, or DEFERRED to a family of 0017.
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
import {
  ABSENT_TYPES,
  NOT_WGSL,
  SUPPORTED,
  extensionOf,
  familyOf,
  type Family,
} from './coredef-overlay.js';
import {
  compilerReadings,
  disagreement,
  editorReadings,
  instancesOf,
  type CoreDefRow,
} from './coredef-witness.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = JSON.parse(readFileSync(join(FIXTURES, 'coredef.json'), 'utf8')) as {
  sha256: string;
  matchers: Record<string, string[]>;
  rows: CoreDefRow[];
};
const textures = JSON.parse(readFileSync(join(FIXTURES, 'coredef-textures.json'), 'utf8')) as {
  sha256: string;
  rows: { fn: string; params: { type: string }[]; ret: string }[];
};

/** Why a row has no instance TypeShade can spell, or undefined when it has one. */
function absentType(row: CoreDefRow): string | undefined {
  const named = [...row.params.map((p) => p.type), row.ret].join(' ');
  for (const t of ABSENT_TYPES) {
    // A type written outside any constraint is one every instance needs.
    if (new RegExp(`\\b${t}\\b`).test(named)) return `every instance takes or returns \`${t}\``;
  }
  for (const [param, constraint] of Object.entries(row.implicit)) {
    const domain = fixture.matchers[constraint];
    if (domain === undefined) continue;
    const kept = domain.filter((d) => !ABSENT_TYPES.some((a) => d === a || d.startsWith(`${a}<`)));
    if (kept.length === 0) return `\`${param}: ${constraint}\` admits only types TypeShade lacks`;
  }
  return undefined;
}

type Claim =
  | { readonly status: 'REFUSED'; readonly reason: string }
  | { readonly status: 'SUPPORTED' }
  | { readonly status: 'DEFERRED'; readonly to: Family | 'an extension'; readonly reason?: string };

function claimOf(row: CoreDefRow): Claim | undefined {
  const notWgsl = row.kind === 'fn' ? NOT_WGSL[row.name] : undefined;
  if (notWgsl !== undefined) return { status: 'REFUSED', reason: notWgsl };
  const absent = absentType(row);
  if (absent !== undefined) return { status: 'REFUSED', reason: absent };
  if (SUPPORTED.has(row.signature)) return { status: 'SUPPORTED' };
  const extension = row.kind === 'fn' ? extensionOf(row.name) : undefined;
  if (extension !== undefined) return { status: 'DEFERRED', to: 'an extension', reason: extension };
  const family = familyOf(row.kind, row.name);
  return family === undefined ? undefined : { status: 'DEFERRED', to: family };
}

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

  it('supports only rows that exist, so a SUPPORTED entry cannot outlive its row', () => {
    const signatures = new Set(fixture.rows.map((r) => r.signature));
    expect([...SUPPORTED].filter((s) => !signatures.has(s))).toEqual([]);
  });

  it('holds every SUPPORTED row to both halves on every instance', () => {
    const rows = fixture.rows.filter((r) => claimOf(r)?.status === 'SUPPORTED');
    const instances = rows.flatMap((r) => {
      const all = instancesOf(r, fixture.matchers);
      if (all === undefined) throw new Error(`SUPPORTED row with no witness form: ${r.signature}`);
      return all;
    });
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
