// Verifies: Rule 6.7, Rule 11.22, Rule 12.7 (docs/language-design.md; traced in reqs/).
//
// Change 0131 removed the numerical contract of change 0107: the `numerics(...)` call, the
// `numerics` option of a stage call and `TS8078`. A source that still writes one gets what any
// unknown function or option gets, the same code in both halves on the same source (Rule 12.7):
// `TS8004` for the call (the editor merges TypeScript's TS2304 into it, Rule 12.4) and one
// `TS8028` for the option. `workgroup_size` takes no options, so a third argument to it is one
// `TS8028` in both halves, with TypeScript's excess-argument TS2554 merged into it.

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const bothHalves = (source: string): { compiler: string[]; editor: string[] } => {
  const service = createTypeshadeLanguageService();
  service.openDocument('n.shade.ts', source);
  return {
    compiler: compile(source, { fileName: 'n.shade.ts' }).diagnostics.map(
      (d) => `${d.code} ${d.message}`,
    ),
    editor: service.getDiagnostics('n.shade.ts').map((d) => `${String(d.code)} ${d.message}`),
  };
};

describe('a leftover numerics(...) call (change 0131, decision 3)', () => {
  const SOURCE = `"use typeshade";
const half = numerics(["finite-math"], function half(x: f32): f32 { return x * 0.5; });
export const fs = fragment(function fs(uv: location<0, vec2>): vec4 {
  return vec4(half(uv.x), 0., 0., 1.);
});
`;

  it('is TS8004 in compile() and in the editor, with no TS8078', () => {
    const { compiler, editor } = bothHalves(SOURCE);
    const unknown = 'TS8004 Unknown function "numerics". ';
    expect(compiler[0]).toContain(unknown);
    expect(editor[0]).toContain(unknown);
    // The cascade on the class list is the one any unknown function gives; the two halves agree.
    expect(editor).toEqual(compiler);
    expect([...compiler, ...editor].some((d) => d.startsWith('TS8078'))).toBe(false);
  });
});

describe('a leftover numerics option (change 0131)', () => {
  const ONE_OPTION = 'TS8028 A stage call takes one option, "diagnostic"; ';
  const sources: Readonly<Record<string, string>> = {
    vertex: `"use typeshade";
export const vs = vertex(function vs(i: builtin<"vertex_index", u32>): builtin<"position", vec4> {
  return vec4(f32(i), 0., 0., 1.);
}, { numerics: ["finite-math"] });
`,
    fragment: `"use typeshade";
export const fs = fragment(function fs(uv: location<0, vec2>): vec4 {
  return vec4(uv, 0., 1.);
}, { numerics: ["finite-math"] });
`,
    compute: `"use typeshade";
export const main = compute([64], function main(g: builtin<"global_invocation_id", vec3u>): void {
}, { numerics: ["finite-math"] });
`,
  };
  for (const [stage, source] of Object.entries(sources))
    it(`on ${stage} is one TS8028 in both halves`, () => {
      const { compiler, editor } = bothHalves(source);
      expect(compiler).toEqual([expect.stringContaining(ONE_OPTION)]);
      expect(editor).toEqual(compiler);
    });
});

describe('workgroup_size takes no options (change 0131, item 1)', () => {
  const kernel = (options: string): string => `"use typeshade";
export const scale = workgroup_size([64], function scale(xs: array<f32>, i: u32): void {
  xs[i] = xs[i] * 2.;
}, ${options});
`;
  const NONE = 'TS8028 "workgroup_size" takes two arguments, the workgroup size and the kernel ';

  for (const options of [
    '{ numerics: ["finite-math"] }',
    '{ diagnostic: ["off", "derivative_uniformity"] }',
    '{ bogus: 1 }',
  ])
    it(`refuses ${options} with one TS8028 in both halves`, () => {
      const { compiler, editor } = bothHalves(kernel(options));
      expect(compiler).toEqual([expect.stringContaining(NONE)]);
      expect(editor).toEqual(compiler);
    });

  it('accepts the two arguments alone in both halves', () => {
    const source = `"use typeshade";
export const scale = workgroup_size([64], function scale(xs: array<f32>, i: u32): void {
  xs[i] = xs[i] * 2.;
});
`;
    expect(bothHalves(source)).toEqual({ compiler: [], editor: [] });
  });
});
