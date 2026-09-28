// `typeshade/emit` (change 0025, section 5): `repack` builds a program's manifest again from the
// IR the manifest carries, and gives what `packModule` gives with the same options, byte for
// byte, over every example; and its refusals. The IR's own round trip, target by target, is
// `src/core/ir/portable.test.ts`.
//
// Verifies: Rule 11.11.

import { describe, expect, it } from 'vitest';
import { examples } from '../examples/index.js';
import { shadeExamples } from '../examples/_shade.js';
import { packModule } from './compiler/ts/pack.js';
import type { ModuleDecl } from './core/ir/nodes.js';
import { VERSION } from './core/version.js';
import { repack } from './emit.js';

const corpus = [...examples, ...shadeExamples].filter(
  (e): e is typeof e & { module: ModuleDecl } => e.module !== undefined,
);

describe('repack (change 0025, section 5)', () => {
  for (const ex of corpus) {
    it(`${ex.id}: gives packModule's manifest, from the manifest's IR`, () => {
      const built = packModule(ex.module, { ir: true });
      // The recorded variant, which the build did not record.
      expect(JSON.stringify(repack(built, { console: true }))).toBe(
        JSON.stringify(packModule(ex.module, { console: true })),
      );
      // And the IR again, the same IR: a manifest repacked can be repacked.
      expect(JSON.stringify(repack(built, { ir: true }))).toBe(JSON.stringify(built));
    });
  }

  it('refuses a manifest that carries no IR, and IR another version wrote', () => {
    const m = corpus[0]!.module;
    expect(() => repack(packModule(m))).toThrow(
      'repack() builds a manifest again from the IR it carries, and this one carries none. Build it with packModule(m, { ir: true }) or typeshade({ ir: true }).',
    );
    const built = packModule(m, { ir: true });
    expect(() => repack({ ...built, ir: { ...built.ir!, compiler: '0.0.0-other' } })).toThrow(
      `This program's IR was written by typeshade 0.0.0-other, and this is typeshade ${VERSION}: only the version that wrote it reads it.`,
    );
  });
});
