// Verifies: Rule 6.7, Rule 11.22, Rule 12.7 (docs/language-design.md; traced in reqs/).
//
// Change 0131 removed the numerical contract of change 0107: the `numerics(...)` call, the
// `numerics` option of a stage call and `TS8078`. A source that still writes one gets what any
// unknown function or option gets, the same code in both halves on the same source (Rule 12.7):
// `TS8004` for the call (the editor merges TypeScript's TS2304 into it, Rule 12.4) and one
// `TS8028` for the option. The stage call itself is refused since change 0140, so the option
// is said with the call, in its one `TS8028`, on a stage and on `workgroup_size` alike, with
// what TypeScript says of the call's arguments merged into it.

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
@fragment export function fs(uv: location<0, vec2>): vec4 {
  return vec4(half(uv.x), 0., 0., 1.);
}
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
  // A stage call is refused (change 0140), and its one refusal names the option to delete.
  const ONE_OPTION = (written: string): string =>
    `TS8028 a stage is an attribute on the function declaration: write "${written}", or run ` +
    `"tshc migrate" (change 0130). The attribute takes no options: delete "numerics: ["finite-math"]"`;
  const WRITTEN: Readonly<Record<string, string>> = {
    vertex: '@vertex export function vs(…)',
    fragment: '@fragment export function fs(…)',
    compute: '@compute([64]) export function main(…)',
  };
  const sources: Readonly<Record<string, string>> = {
    vertex: `"use typeshade";
export const vs = vertex(function vs(i: builtin<"vertex_index">): builtin<"position"> {
  return vec4(f32(i), 0., 0., 1.);
}, { numerics: ["finite-math"] });
`,
    fragment: `"use typeshade";
export const fs = fragment(function fs(uv: location<0, vec2>): vec4 {
  return vec4(uv, 0., 1.);
}, { numerics: ["finite-math"] });
`,
    compute: `"use typeshade";
export const main = compute([64], function main(g: builtin<"global_invocation_id">): void {
}, { numerics: ["finite-math"] });
`,
  };
  for (const [stage, source] of Object.entries(sources))
    it(`on ${stage} is one TS8028 in both halves`, () => {
      const { compiler, editor } = bothHalves(source);
      expect(compiler).toEqual([ONE_OPTION(WRITTEN[stage]!)]);
      expect(editor).toEqual(compiler);
    });
});

describe('workgroup_size takes no options (change 0131, item 1)', () => {
  const kernel = (options: string): string => `"use typeshade";
export const scale = workgroup_size([64], function scale(xs: array<f32>, i: u32): void {
  xs[i] = xs[i] * 2.;
}, ${options});
`;
  const NONE = (written: string): string =>
    `TS8028 a kernel's size is an attribute on the function declaration: write ` +
    `"@workgroup_size([64]) export function scale(…)", or run "tshc migrate" (change 0130). ` +
    `The attribute takes no options: delete "${written}"`;

  for (const [options, written] of [
    ['{ numerics: ["finite-math"] }', 'numerics: ["finite-math"]'],
    ['{ diagnostic: ["off", "derivative_uniformity"] }', 'diagnostic: [...]'],
    ['{ bogus: 1 }', 'bogus: 1'],
  ] as const)
    it(`refuses ${options} with the call, as one TS8028 in both halves`, () => {
      const { compiler, editor } = bothHalves(kernel(options));
      expect(compiler).toEqual([NONE(written)]);
      expect(editor).toEqual(compiler);
    });

  it('accepts the attribute alone in both halves', () => {
    const source = `"use typeshade";
@workgroup_size([64])
export function scale(xs: array<f32>, i: u32): void {
  xs[i] = xs[i] * 2.;
}
`;
    expect(bothHalves(source)).toEqual({ compiler: [], editor: [] });
  });
});
