// ═══ The corpus demonstrates all three struct spellings ═══
//
// §2 of the surface document says a struct is one shape written three ways — `class`,
// `interface` and `type X = { … }` — and that plain data without field metadata uses the type
// alias, while a struct used as entry I/O has to be a class, because only a class field can
// carry `@builtin` and `@location`.
//
// The corpus did not show that. Measured before this file existed: 32 example files declared a
// class, none declared an interface or an object type alias, and 14 of the structs were plain
// data with no decorator and no method. `hello-camera.shade.ts` declared `class Camera` while
// §2 illustrates the same struct, by name, as `type Camera = { … }`.
//
// Nothing could have caught it. The three spellings produce the identical `StructDecl`, so the
// WGSL, the GLSL and the reflection are byte-for-byte the same, and every golden and gate reads
// exactly those. A reader is the only instrument that sees the difference, which is why this is
// a corpus check and not a compiler one: what it protects is that someone learning from the
// examples meets more than one way to declare a struct.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));

function sources(): { name: string; text: string }[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.shade.ts'))
    .map((name) => ({ name, text: readFileSync(join(DIR, name), 'utf8') }));
}

describe('the example corpus shows each way to declare a struct', () => {
  it('reads a corpus big enough to be worth checking', () => {
    expect(sources().length).toBeGreaterThan(20);
  });

  it.each([
    ['class', /^(abstract )?class \w+/m],
    ['interface', /^interface \w+/m],
    ['type alias', /^type \w+ = \{/m],
  ])('at least one example declares a struct with %s', (_spelling, pattern) => {
    const hits = sources().filter((s) => pattern.test(s.text));
    expect(hits.map((h) => h.name).join(', ') || '(none)').not.toBe('(none)');
  });

  it('the struct §2 illustrates is written the way §2 writes it', () => {
    // The document's own example of plain data is `type Camera = { view: mat4; pos: vec3 }`.
    // The example file of the same name declared a class, so the two disagreed about one
    // struct, by name.
    const camera = sources().find((s) => s.name === 'hello-camera.shade.ts');
    expect(camera, 'hello-camera.shade.ts is missing from the corpus').toBeDefined();
    expect(camera!.text).toContain('type Camera = {');
  });
});
