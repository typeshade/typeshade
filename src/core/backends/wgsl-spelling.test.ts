// The WGSL writer spells every name the plan renames (Proposal 0070, C3): a declaration named like
// a WGSL reserved word or a predeclared function is emitted under its planned name, and the
// references follow it. Functional check of the writer; the record reads are in emitted-record.test.ts.
//
// Verifies: Rule 3.2, Rule 3.3, Rule 9.5 (docs/language-design.md; traced in reqs/).
import { describe, expect, it } from 'vitest';
import { emitModule } from './wgsl.js';
import { emitGlslModule } from './glsl.js';
import { allKindsModule } from '../testing/all-kinds-module.js';
import {
  builtin,
  f32T,
  fn,
  hostUniform,
  module,
  storageBuffer,
  vec3uT,
  voidT,
} from '../ir/index.js';

/** A compute kernel that reads the host-owned uniform `name` (Proposal 0070, Q3). */
const readsHostUniform = (name: string) => {
  const u = hostUniform(name, f32T, { group: 0, binding: 0 });
  const out = storageBuffer('out', f32T, { group: 0, binding: 1, access: 'read_write' });
  const k = fn(
    'k',
    { gid: builtin('global_invocation_id', vec3uT) },
    voidT,
    ({ gid }) => {
      out.at(gid.x).assign(u.node);
    },
    { stage: 'compute', workgroupSize: 1 },
  );
  return module({ bindings: [u.binding, out.binding], funcs: [k] });
};

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

describe('a host-owned binding keeps its name, or the writer refuses it (Proposal 0070, Q3)', () => {
  it('refuses a host-owned uniform named by a WGSL reserved word, rather than emit it', () => {
    expect(() => emitModule(readsHostUniform('shared'))).toThrow(/host-owned binding 'shared'/);
  });

  it('refuses a host-owned uniform named by a GLSL reserved word, on GLSL only', () => {
    const m = readsHostUniform('half');
    expect(emitModule(m)).toContain('var<uniform> half: f32;');
    expect(() => emitGlslModule(m, 'fragment')).toThrow(/host-owned binding 'half'/);
  });

  it('keeps a host-owned uniform that both targets spell', () => {
    expect(emitModule(readsHostUniform('scale'))).toContain('var<uniform> scale: f32;');
  });
});
