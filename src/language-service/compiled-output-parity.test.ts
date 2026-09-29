// The editor's output pane shows what the compiler emits (Rule 12.7), for every example.
//
// `getCompiledOutput` is what an editor's WGSL and GLSL panes print: the VS Code preview, and
// any host of the language service. It builds its module from the service's own analysis, and
// built it with fewer fields than `compile()` does: no overrides, no enables and no
// `diagnostic(...)` directives. So the pane printed WGSL that reads an override it never
// declares, which no WebGPU accepts, and dropped the directive that lets an entry sample under a
// branch its invocations do not share. The one test that compared the two read a program with
// none of these. This one reads every example of the corpus, so a field the compiler's module
// gains and the pane's does not is a failure here.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createTypeshadeLanguageService } from './service.js';
import { compile } from '../compiler/ts/compile.js';
import { shadeExamples } from '../../examples/_shade.js';

const EXAMPLES = join(dirname(fileURLToPath(import.meta.url)), '../../examples');

/** The examples whose outputs hold the same declarations in another order. The editor's run of
 *  the front end lowers a function whose return type is inferred (Rule 8.19) after its caller,
 *  where `compile()` lowers it before, so the pane prints `fs` above `tint`, `ring` and the
 *  local `falloff` and the compiler below them. WGSL declares in any order, and the GLSL emitter
 *  still puts every callee above `main`, so both texts compile; this set is here so an order
 *  that starts to differ anywhere else, or stops differing here, is seen. */
const REORDERED = new Set(['inferred-returns.shade.ts']);

/** A text's lines, blank ones left out, in sorted order: what two texts that hold the same
 *  declarations in another order still share. A line, not a declaration, because GLSL puts the
 *  fragment's inputs and outputs under the last function with no blank line between. */
const lines = (text: string | undefined): string[] =>
  (text ?? '')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .sort();

/** A file of the examples directory by the name an import resolves to, as `_shade.ts` reads
 *  them for `compile()`. */
const readExample = (name: string): string | undefined => {
  try {
    return readFileSync(join(EXAMPLES, name), 'utf8');
  } catch {
    return undefined;
  }
};

describe("getCompiledOutput prints compile()'s WGSL and GLSL", () => {
  it('reads a corpus with an override and a diagnostic directive in it (the instrument)', () => {
    const texts = shadeExamples.map((e) =>
      compile(readExample(e.file)!, { fileName: e.file, readDocument: readExample }),
    );
    expect(shadeExamples.length).toBeGreaterThan(50);
    expect(texts.some((r) => /^override /m.test(r.wgsl ?? ''))).toBe(true);
    expect(texts.some((r) => /^diagnostic\(off, /m.test(r.wgsl ?? ''))).toBe(true);
  });

  for (const example of shadeExamples) {
    it(example.file, () => {
      const source = readExample(example.file)!;
      const compiled = compile(source, { fileName: example.file, readDocument: readExample });
      const service = createTypeshadeLanguageService({ readDocument: readExample });
      service.openDocument(example.file, source, 1);
      const wgsl = service.getCompiledOutput(example.file, 'wgsl');
      expect(wgsl?.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      const pairs: [string | undefined, string | undefined][] = [[wgsl?.text, compiled.wgsl]];
      if (compiled.glsl !== undefined)
        for (const stage of ['vertex', 'fragment'] as const)
          pairs.push([
            service.getCompiledOutput(example.file, `glsl-${stage}`)?.text,
            compiled.glsl[stage],
          ]);
      if (!REORDERED.has(example.file)) {
        for (const [pane, compiler] of pairs) expect(pane).toBe(compiler);
        return;
      }
      for (const [pane, compiler] of pairs) expect(lines(pane)).toEqual(lines(compiler));
      expect(pairs.some(([pane, compiler]) => pane !== compiler)).toBe(true);
    });
  }
});
