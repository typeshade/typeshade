// The two lists a writer renames a declared function by (`WGSL_PREDECLARED`,
// `GLSL_ES300_BUILTIN_FUNCTIONS`, change 0029), held to what they stand for.
//
// WGSL's is held to the baked names of the specification (`fixtures/wgsl-names.json`) and to the
// vocabulary the WGSL writer spells, which the IR carries: a storage texture's formats and access
// modes, the address spaces. GLSL ES 3.00's is held to its section 8, the built-in functions of the
// language, which the compile gate hands to ANGLE (`scripts/compile-gate.ts`, the declared-names
// leg): a function declared under any of the names must compile once it is renamed, and the same
// declaration must be refused where it is not, which is the instrument.
//
// Verifies: Rule 9.5 (docs/language-design.md; traced in reqs/).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALL_STORAGE_TEXTURE_FORMATS } from '../ir/types.js';
import {
  GLSL_ES300_BUILTIN_FUNCTIONS,
  GLSL_ES300_RESERVED,
  WGSL_PREDECLARED,
  WGSL_RESERVED,
} from '../reserved-words.js';

interface Names {
  readonly builtinFunctions: { readonly names: readonly string[] };
  readonly predeclaredTypes: { readonly names: readonly string[] };
  readonly typeGenerators: { readonly names: readonly string[] };
}

const wgsl = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'wgsl-names.json'),
    'utf8',
  ),
) as Names;

describe('WGSL_PREDECLARED: what WGSL predeclares that a module-scope declaration hides', () => {
  it('holds every built-in function, predeclared type and type-generator of the specification', () => {
    // The instrument first: the fixture holds what it is said to.
    expect(wgsl.builtinFunctions.names.length).toBeGreaterThan(150);
    expect(wgsl.builtinFunctions.names).toContain('textureSample');
    expect(wgsl.predeclaredTypes.names).toContain('f32');
    expect(wgsl.typeGenerators.names).toContain('array');
    const missing = [
      ...wgsl.builtinFunctions.names,
      ...wgsl.predeclaredTypes.names,
      ...wgsl.typeGenerators.names,
    ].filter((n) => !WGSL_PREDECLARED.has(n));
    expect(missing).toEqual([]);
  });

  it('holds the aliases, and the enumerants the writer spells', () => {
    for (const n of ['vec2i', 'vec3u', 'vec4f', 'vec2h', 'mat2x2f', 'mat3x4h', 'mat4x4f']) {
      expect(WGSL_PREDECLARED.has(n), n).toBe(true);
    }
    // The storage texture formats the IR can write, the access modes of one, and the address
    // spaces of a variable: Tint refuses `var<storage, read>` beside a function named `storage`
    // or `read` ("cannot use function 'read' as access"), measured.
    for (const n of [
      ...ALL_STORAGE_TEXTURE_FORMATS,
      'read',
      'write',
      'read_write',
      'function',
      'private',
      'workgroup',
      'uniform',
      'storage',
    ]) {
      expect(WGSL_PREDECLARED.has(n), n).toBe(true);
    }
  });

  it('holds no word a module may not declare at all, and leaves what Tint reads as an argument', () => {
    // A reserved word is refused where it is written (Rule 3.3), and is not this list's.
    expect([...WGSL_PREDECLARED].filter((n) => WGSL_RESERVED.has(n))).toEqual([]);
    // The built-in values and the interpolation names are the attribute's own argument: measured
    // on Tint, a function named `position` or `flat` leaves `@builtin(position)` and
    // `@interpolate(flat)` alone, so renaming one would change a name for nothing.
    for (const n of ['position', 'vertex_index', 'flat', 'linear', 'center', 'sample']) {
      expect(WGSL_PREDECLARED.has(n), n).toBe(false);
    }
  });
});

describe('GLSL_ES300_BUILTIN_FUNCTIONS: the built-in functions of GLSL ES 3.00', () => {
  it('is section 8 of the specification, 89 names', () => {
    expect(GLSL_ES300_BUILTIN_FUNCTIONS.size).toBe(89);
    for (const n of [
      'sin',
      'inversesqrt',
      'roundEven',
      'texture',
      'texelFetch',
      'dFdx',
      'fwidth',
      'not',
    ]) {
      expect(GLSL_ES300_BUILTIN_FUNCTIONS.has(n), n).toBe(true);
    }
  });

  it('holds no keyword, which the writer renames as a reserved word, and no ES 3.10 name', () => {
    expect([...GLSL_ES300_BUILTIN_FUNCTIONS].filter((n) => GLSL_ES300_RESERVED.has(n))).toEqual([]);
    // ANGLE accepts a declaration of each of these at version 300: the language does not have them.
    for (const n of ['bitCount', 'findMSB', 'frexp', 'ldexp', 'saturate', 'fma', 'atan2']) {
      expect(GLSL_ES300_BUILTIN_FUNCTIONS.has(n), n).toBe(false);
    }
  });
});
