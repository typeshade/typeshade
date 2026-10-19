// The GLSL writer spells every name the plan renames (Proposal 0070, C6): a declaration whose name
// GLSL ES 3.00 or this writer cannot spell takes the planned GLSL spelling, the references follow
// it, and the WGSL keeps the authored name. A field spelled alike in both stages keeps one name,
// because GLSL links a varying by name and the std140 host offsets come from the field's index.
//
// Verifies: Rule 3.2, Rule 3.3, Rule 3.4, Rule 9.5 (docs/language-design.md; traced in reqs/).
import { describe, expect, it } from 'vitest';
import { emitModule } from './wgsl.js';
import { emitGlslStages } from './glsl.js';
import { reflect } from '../reflect.js';
import { allKindsModule } from '../testing/all-kinds-module.js';

/** The declared name of each `in` or `out` varying of a stage's text. */
const varyings = (text: string, qualifier: 'in' | 'out'): string[] =>
  [...text.matchAll(new RegExp(`^${qualifier} \\w+ (\\w+);`, 'gmu'))].map((m) => m[1]!);

describe('GLSL writer spells the names of the plan (Proposal 0070, C6)', () => {
  // Every kind takes a name GLSL ES 3.00 reserves or this writer renames: `half` (reserved in
  // ES 3.00, free in WGSL), the writer's own `buffer`, `shared`, `texture` and `main`, and `input`.
  const m = allKindsModule(
    {
      const: 'half',
      helper: 'texture',
      binding: 'buffer',
      override: 'shared',
      struct: 'packed',
      field: 'half',
      param: 'input',
      entry: 'main',
      fragment: 'input',
    },
    'graphics',
  );
  const { vertex, fragment } = emitGlslStages(m);

  it('emits both stages, and the WGSL keeps the authored names', () => {
    expect(vertex).toContain('void main()');
    expect(fragment).toContain('void main()');
    const wgsl = emitModule(m);
    expect(wgsl).toMatch(/\bhalf\b/u);
    expect(wgsl).toMatch(/\bbuffer\b/u);
  });

  it('declares no identifier GLSL cannot spell, and no name with two underscores', () => {
    for (const text of [vertex, fragment]) {
      expect(text).not.toMatch(/\bhalf\b/u);
      expect(text).not.toMatch(/\bshared\b/u);
      expect(text).not.toMatch(/\bpacked\b/u);
      expect(text).not.toMatch(/\bbuffer\b/u);
      expect(text).not.toMatch(/__/u);
    }
  });

  it('gives a varying one spelling in both stages, which GLSL links by name', () => {
    const out = varyings(vertex, 'out');
    const input = varyings(fragment, 'in');
    expect(out).toHaveLength(1);
    expect(input).toEqual(out);
    expect(out[0]).toBe('half_1');
  });

  it('reports the GLSL spelling of a name that differs, and no other', () => {
    const record = reflect(m);
    const binding = record.bindGroups.flatMap((g) => g.entries).find((b) => b.name === 'buffer');
    expect(binding?.emitted).toBe('buffer');
    expect(binding?.emittedGlsl).toBe('buffer_');
    const override = record.overrides.find((o) => o.name === 'shared');
    // WGSL reserves `shared` too, so both targets spell it `shared_` and no GLSL spelling is recorded.
    expect(override?.emitted).toBe('shared_');
    expect(override?.emittedGlsl).toBeUndefined();
  });

  it('spells the entry named main, selected by its authored name, without a second main', () => {
    const { fragment: named } = emitGlslStages(m, { fragmentEntry: 'input' });
    expect(named.match(/\bvoid main\(\)/gu)).toHaveLength(1);
    expect(named).not.toMatch(/__/u);
  });
});
