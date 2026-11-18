import { describe, expect, it } from 'vitest';
import { compileTsSources } from './module.js';

describe('compileTsSources symbols are offsets into the entry file, whatever spelling the caller gives it', () => {
  const a = {
    fileName: './a.ts',
    source:
      '"use typeshade";\nexport function helper(ha: f32): f32 {\n  const inA = ha;\n  return inA;\n}\n',
  };
  const b = {
    fileName: './b.ts',
    source:
      '"use typeshade";\nimport { helper } from "./a";\nexport function main(mb: f32): f32 {\n  const inB = helper(mb);\n  return inB;\n}\n',
  };

  for (const entry of ['b.ts', './b.ts']) {
    it(`records the entry file's declarations for entry "${entry}"`, () => {
      const r = compileTsSources([a, b], entry);
      expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
      expect(r.symbols.map((s) => `${s.kind}:${s.name}`)).toEqual([
        'function:main',
        'param:mb',
        'local:inB',
      ]);
      for (const s of r.symbols) {
        expect(b.source.slice(s.start, s.start + s.length)).toBe(s.name);
      }
    });
  }

  it('records the first file given when no entry is named', () => {
    const r = compileTsSources([a, b]);
    expect(r.symbols.map((s) => s.name)).toEqual(['helper', 'ha', 'inA']);
    for (const s of r.symbols) {
      expect(a.source.slice(s.start, s.start + s.length)).toBe(s.name);
    }
  });
});
