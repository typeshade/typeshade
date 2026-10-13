// The spelling plan of Proposal 0070 (C1): which names each target cannot spell, the fresh
// spelling of each, the collision and determinism rules, and the host-owned names.
//
// Implements: Rule 3.2, Rule 3.3, Rule 3.4 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import type { ConstDecl, FuncDecl, ModuleDecl, StructDecl } from './ir/index.js';
import { f32T } from './ir/index.js';
import { fromPortable, toPortable } from './ir/portable.js';
import { freshSpelling } from './passes/variable-names.js';
import { UnsupportedFeatureError } from './backend.js';
import {
  assertHostOwnedSpellable,
  emittedName,
  inheritSpellings,
  planSpellings,
  spellingsOf,
  spellsNothing,
  unspellable,
  type SpellingPlan,
  type TargetSpellings,
} from './spelling-plan.js';
import {
  GLSL_ES300_RESERVED,
  GLSL_WRITER_RESERVED,
  WGSL_PREDECLARED,
  WGSL_RESERVED,
} from './reserved-words.js';

/** A module with the given parts and nothing else. IR literals only: any string is a valid name. */
function moduleOf(parts: Partial<ModuleDecl>): ModuleDecl {
  return { consts: [], structs: [], bindings: [], funcs: [], ...parts };
}

const constOf = (name: string): ConstDecl => ({ name, type: f32T, wgslValue: 0, cpuValue: 0 });

const helper = (name: string, params: string[] = [], body: FuncDecl['body'] = []): FuncDecl => ({
  name,
  params: params.map((p) => ({ name: p, type: f32T })),
  ret: { kind: 'void' },
  body,
});

const planAll = (name: string, kind: 'const' | 'helper'): SpellingPlan => {
  const m =
    kind === 'const' ? moduleOf({ consts: [constOf(name)] }) : moduleOf({ funcs: [helper(name)] });
  return planSpellings(m);
};

const valuesOf = (t: TargetSpellings): string[] =>
  [t.funcs, t.entries, t.consts, t.vars, t.bindings, t.overrides, t.structs, t.members].flatMap(
    (map) => [...map.values()],
  );

describe('unspellable: the names each target cannot spell as an identifier', () => {
  it('refuses every WGSL reserved word on WGSL and every GLSL ES 3.00 word on GLSL', () => {
    for (const word of WGSL_RESERVED) expect(unspellable('wgsl', word), word).toBe(true);
    for (const word of GLSL_ES300_RESERVED) expect(unspellable('glsl', word), word).toBe(true);
  });

  it('refuses the six GLSL writer words on GLSL and spells them on WGSL unless WGSL reserves them', () => {
    for (const word of GLSL_WRITER_RESERVED) expect(unspellable('glsl', word), word).toBe(true);
    expect(unspellable('wgsl', 'buffer')).toBe(false);
    expect(unspellable('wgsl', 'texture')).toBe(false);
    expect(unspellable('wgsl', 'main')).toBe(false);
  });

  it('refuses the shapes each target cannot spell', () => {
    for (const name of ['$a', 'a$', '_', '__a']) expect(unspellable('wgsl', name), name).toBe(true);
    for (const name of ['$a', 'a$', 'gl_a', 'a__b', 'café', 'class'])
      expect(unspellable('glsl', name), name).toBe(true);
  });

  it('spells the controls: a word only one target reserves, and the predeclared names', () => {
    expect(unspellable('wgsl', 'half')).toBe(false);
    expect(unspellable('glsl', 'half')).toBe(true);
    expect(unspellable('glsl', '_')).toBe(false);
    expect(unspellable('wgsl', 'fract')).toBe(false);
    expect(unspellable('wgsl', 'vec3f')).toBe(false);
    for (const name of WGSL_PREDECLARED) expect(unspellable('wgsl', name), name).toBe(false);
  });
});

describe('freshSpelling: the sequence of the writers', () => {
  it('keeps the spellings that the variable pass gave before the extraction', () => {
    const none = () => false;
    const pins: [string, string][] = [
      ['class', 'class_'],
      ['$x', '_x_'],
      ['_', 'value_'],
      ['gl_x', 'ts_gl_x_'],
      ['café', 'cafue9_'],
      ['a__b', 'a_b_'],
    ];
    for (const [name, spelled] of pins) expect(freshSpelling(name, none, none), name).toBe(spelled);
  });

  it('numbers the candidates past every taken name and every bad one', () => {
    const taken = new Set(['shared_', 'shared_1']);
    expect(
      freshSpelling(
        'shared',
        (c) => taken.has(c),
        () => false,
      ),
    ).toBe('shared_2');
    expect(
      freshSpelling(
        'shared',
        () => false,
        (c) => c === 'shared_',
      ),
    ).toBe('shared_1');
  });
});

describe('planSpellings: a clean module and the literal pins', () => {
  it('renames nothing in a module whose names every target spells', () => {
    const m = moduleOf({ consts: [constOf('x')], funcs: [helper('f', ['a'])] });
    const plan = planSpellings(m);
    expect(spellsNothing(plan.wgsl)).toBe(true);
    expect(spellsNothing(plan.glsl)).toBe(true);
    expect(spellingsOf(m)).toBe(spellingsOf(m));
  });

  it('spells each literal of the pins from the code that the writers use today', () => {
    expect(planAll('class', 'const').wgsl.consts.get('class')).toBe('class_');
    expect(planAll('$x', 'const').wgsl.consts.get('$x')).toBe('_x_');
    expect(planAll('_', 'const').wgsl.consts.get('_')).toBe('value_');
    expect(planAll('gl_x', 'const').glsl.consts.get('gl_x')).toBe('ts_gl_x_');
    expect(planAll('café', 'const').glsl.consts.get('café')).toBe('cafue9_');
    expect(planAll('a__b', 'const').glsl.consts.get('a__b')).toBe('a_b_');
    // A constant is not a function: `fract` renames only as a helper.
    expect(planAll('fract', 'helper').wgsl.funcs.get('fract')).toBe('fract_');
    expect(planAll('fract', 'const').wgsl.consts.size).toBe(0);
  });
});

describe('planSpellings: collisions, one spelling per target, and determinism', () => {
  // Authored names: consts `shared_` and `shared_1`, a local `shared_2`, a parameter `shared_3`,
  // and struct fields `half_` and `half`. The binding `shared` and the field `half` must avoid
  // all of them.
  const collisionModule = (extra: Partial<ModuleDecl> = {}): ModuleDecl =>
    moduleOf({
      consts: [constOf('shared_'), constOf('shared_1')],
      bindings: [
        {
          group: 0,
          binding: 0,
          name: 'shared',
          space: 'storage',
          access: 'read',
          type: { kind: 'array', elem: f32T },
        },
      ],
      structs: [
        {
          name: 'Pack',
          fields: [
            { name: 'half_', type: f32T },
            { name: 'half', type: f32T },
          ],
        } satisfies StructDecl,
      ],
      funcs: [
        helper(
          'use',
          ['shared_3'],
          [{ s: 'let', name: 'shared_2', expr: { op: 'param', type: f32T, name: 'shared_3' } }],
        ),
      ],
      ...extra,
    });

  it('spells a binding and a field past every authored name of the module', () => {
    const plan = planSpellings(collisionModule());
    expect(plan.glsl.bindings.get('shared')).toBe('shared_4');
    expect(plan.glsl.members.get('half')).toBe('half_1');
    expect(plan.wgsl.bindings.get('shared')).toBe('shared_4');
    expect(plan.wgsl.consts.size).toBe(0);
  });

  it('gives each emitted name one spelling, distinct from every other name and every authored name', () => {
    const plan = planSpellings(collisionModule());
    for (const t of [plan.wgsl, plan.glsl]) {
      const values = valuesOf(t);
      expect(new Set(values).size).toBe(values.length);
      for (const value of values)
        expect(['shared_', 'shared_1', 'shared_2', 'shared_3', 'half_']).not.toContain(value);
    }
  });

  it('avoids the spelling an extern takes on the target', () => {
    const plan = planSpellings(
      collisionModule({
        externs: [{ name: 'host', type: f32T, spelling: { wgsl: 'shared_4', glsl: 'shared_4' } }],
      }),
    );
    expect(plan.glsl.bindings.get('shared')).toBe('shared_5');
  });

  it('is the same for a module after a portable round trip', () => {
    const m = collisionModule();
    const again = fromPortable(toPortable(m, 'test'));
    expect(planSpellings(again)).toEqual(planSpellings(m));
  });
});

describe('planSpellings: host-owned names and their structs', () => {
  const hostModule = (): ModuleDecl =>
    moduleOf({
      bindings: [
        {
          group: 0,
          binding: 0,
          name: 'buffer',
          space: 'uniform',
          type: { kind: 'struct', name: 'Host' },
          owner: 'host',
        },
        {
          group: 0,
          binding: 1,
          name: 'scale',
          space: 'uniform',
          type: { kind: 'struct', name: 'Settings' },
        },
      ],
      structs: [
        { name: 'Host', fields: [{ name: 'half', type: f32T }] },
        { name: 'Settings', fields: [{ name: 'half', type: f32T }] },
      ],
    });

  it('keeps a host-owned binding and its struct out of the maps', () => {
    const plan = planSpellings(hostModule());
    expect(plan.glsl.bindings.has('buffer')).toBe(false);
    expect(plan.glsl.structs.has('Host')).toBe(false);
    expect(plan.glsl.hostStructs.has('Host')).toBe(true);
    expect(plan.glsl.hostStructs.has('Settings')).toBe(false);
  });

  it('keeps the host struct fields out of the members, while a module struct field still follows the plan', () => {
    const plan = planSpellings(hostModule());
    expect(plan.glsl.members.get('half')).toBe('half_');
    expect(emittedName(plan.glsl.members, 'half')).toBe('half_');
  });

  it('refuses a host-owned name the target cannot spell, and only on that target', () => {
    expect(() => assertHostOwnedSpellable(hostModule(), 'glsl')).toThrow(UnsupportedFeatureError);
    expect(() => assertHostOwnedSpellable(hostModule(), 'wgsl')).not.toThrow();
  });

  it('reaches the structs of a host struct through its fields', () => {
    const m = moduleOf({
      bindings: [
        {
          group: 0,
          binding: 0,
          name: 'u',
          space: 'uniform',
          type: { kind: 'struct', name: 'Outer' },
          owner: 'host',
        },
      ],
      structs: [
        { name: 'Outer', fields: [{ name: 'inner', type: { kind: 'struct', name: 'Inner' } }] },
        { name: 'Inner', fields: [{ name: 'half', type: f32T }] },
      ],
    });
    const plan = planSpellings(m);
    expect([...plan.glsl.hostStructs].sort()).toEqual(['Inner', 'Outer']);
    expect(plan.glsl.members.size).toBe(0);
  });
});

describe('inheritSpellings: a derived module takes the parent plan', () => {
  it('gives the child the parent plan, and returns the child', () => {
    const parent = moduleOf({
      bindings: [{ group: 0, binding: 0, name: 'shared', space: 'uniform', type: f32T }],
    });
    const child = moduleOf({ consts: [constOf('shared_')] });
    expect(inheritSpellings(child, parent)).toBe(child);
    expect(spellingsOf(child)).toBe(spellingsOf(parent));
    expect(spellingsOf(child).glsl.bindings.get('shared')).toBe('shared_');
  });
});
