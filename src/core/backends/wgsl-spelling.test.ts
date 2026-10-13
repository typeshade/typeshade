// The WGSL writer spells every name the plan renames (Proposal 0070, C3): a declaration named like
// a WGSL reserved word or a predeclared function is emitted under its planned name, and the
// references follow it. Functional check of the writer; the record reads are in emitted-record.test.ts.
//
// Verifies: Rule 3.2, Rule 3.3, Rule 9.5 (docs/language-design.md; traced in reqs/).
import { describe, expect, it } from 'vitest';
import { emitModule } from './wgsl.js';
import { allKindsModule } from '../testing/all-kinds-module.js';

describe('WGSL writer spells the names of the plan (Proposal 0070, C3)', () => {
  const m = allKindsModule(
    {
      const: 'class',
      var: 'shared',
      helper: 'fract',
      entry: 'step',
      struct: 'common',
      field: 'half',
      param: 'f32',
    },
    'compute',
  );
  const wgsl = emitModule(m);

  it('emits without a throw, and no declaration keeps a reserved name', () => {
    expect(wgsl).not.toMatch(/\bfn step\(/);
    expect(wgsl).not.toMatch(/\bfn fract\(/);
    expect(wgsl).not.toMatch(/\bconst class\b/);
    expect(wgsl).not.toMatch(/\bstruct common\b/);
  });

  it('spells each renamed declaration with its planned name', () => {
    expect(wgsl).toMatch(/\bfn step_\(/);
    expect(wgsl).toMatch(/\bfn fract_\(/);
    expect(wgsl).toMatch(/\bconst class_\b/);
    expect(wgsl).toMatch(/\bstruct common_\b/);
  });
});
