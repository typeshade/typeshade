// Verifies: Rule 1.4, Rule 6.7, Rule 8.5, Rule 12.7 (docs/language-design.md; traced in reqs/).
//
// Change 0132 removed the diagnostic filter: the stage call's `{ diagnostic: [...] }` option, the
// decorated `@diagnostic(…)` and the ambient `diagnostic` declaration. The compiler rewrites an
// implicit-LOD sample or a derivative in non-uniform control flow (Rule 8.5), so the filter is
// not borrowed (Rule 1.4). A source that still writes one gets one `TS8028`, an error, in
// `compile()` and in the language service on the same source (Rule 12.7), with no warning
// release. Neither sentence names a severity, and neither offers the filter again.
//
// The stage call itself is refused since change 0140, so the option is said with the call, in
// its one `TS8028`: the attribute that replaces the call, and the option to delete.

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { migrateSource } from '../../cli/migrate.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const bothHalves = (source: string): { compiler: string[]; editor: string[] } => {
  const service = createTypeshadeLanguageService();
  service.openDocument('d.shade.ts', source);
  return {
    compiler: compile(source, { fileName: 'd.shade.ts' }).diagnostics.map(
      (d) => `${d.category} ${d.code} ${d.message}`,
    ),
    editor: service
      .getDiagnostics('d.shade.ts')
      .map((d) => `${d.severity} ${String(d.code)} ${d.message}`),
  };
};

/** The one refusal of a stage call that writes the filter (changes 0132 and 0140). */
const OPTION = (written: string): string =>
  `error TS8028 a stage is an attribute on the function declaration: write "${written}", or ` +
  `run "tshc migrate" (change 0130). The attribute takes no options: delete "diagnostic: [...]"`;
const DECORATOR =
  'error TS8028 "@diagnostic(…)" is not a decorator the compiler reads (Rule 6.7). Delete it: ' +
  'the compiler rewrites each implicit-LOD sample or derivative it can reach (Rule 8.5) and ' +
  'reports each other one with TS8052 and the reason. "tshc migrate" deletes it.';

const HEAD = `"use typeshade";
declare const t: texture_2d<f32>;
declare const s: sampler;
`;

describe('a written { diagnostic: [...] } option is one TS8028 in both halves (change 0132)', () => {
  const FILTER = '{ diagnostic: ["off", "derivative_uniformity"] }';
  const sources: Readonly<Record<string, string>> = {
    vertex: `${HEAD}export const vs = vertex(function vs(i: builtin<"vertex_index", u32>): builtin<"position", vec4> {
  return vec4(f32(i), 0., 0., 1.);
}, ${FILTER});
`,
    fragment: `${HEAD}export const fs = fragment(function fs(uv: location<0, vec2>): vec4 {
  if (uv.x > 0.5) { return textureSample(t, s, uv); }
  return vec4(0.);
}, ${FILTER});
`,
    compute: `${HEAD}export const main = compute([64], function main(g: builtin<"global_invocation_id", vec3u>): void {
}, ${FILTER});
`,
    "a namespace's entry": `${HEAD}namespace N {
  export const fs = fragment(function fs(uv: location<0, vec2>): vec4 {
    return textureSample(t, s, uv);
  }, ${FILTER});
}
`,
  };
  const WRITTEN: Readonly<Record<string, string>> = {
    vertex: '@vertex export function vs(…)',
    fragment: '@fragment export function fs(…)',
    compute: '@compute([64]) export function main(…)',
    "a namespace's entry": '@fragment export function fs(…)',
  };
  for (const [where, source] of Object.entries(sources))
    it(`on ${where}`, () => {
      const { compiler, editor } = bothHalves(source);
      expect(compiler).toEqual([OPTION(WRITTEN[where]!)]);
      // What TypeScript says of the call's arguments merges into the refusal (Rule 12.4).
      expect(editor).toEqual(compiler);
    });

  it('whatever the severity and the rule, with a text that names neither', () => {
    for (const filter of [
      '{ diagnostic: ["warning", "derivative_uniformity"] }',
      '{ diagnostic: ["info", "subgroup_uniformity"] }',
      '{ diagnostic: [] }',
    ]) {
      const { compiler, editor } = bothHalves(sources.fragment!.replace(FILTER, filter));
      expect(compiler, filter).toEqual([OPTION(WRITTEN.fragment!)]);
      expect(editor, filter).toEqual(compiler);
    }
    for (const word of ['"off"', '"warning"', 'severity', 'derivative_uniformity'])
      expect(OPTION(WRITTEN.fragment!)).not.toContain(word);
  });

  it('compiles once "tshc migrate" has written the attribute and deleted the filter: the sample under the branch is rewritten, with no directive', () => {
    const migrated = migrateSource(sources.fragment!);
    expect(migrated.skipped).toEqual([]);
    const source = migrated.text;
    expect(source).toContain('@fragment\nexport function fs(uv: location<0, vec2>): vec4 {');
    expect(source).not.toContain('diagnostic');
    expect(bothHalves(source)).toEqual({ compiler: [], editor: [] });
    const wgsl = compile(source).wgsl!;
    expect(wgsl).toContain('textureSampleGrad(t, s, uv,');
    expect(wgsl).not.toContain('diagnostic(');
  });
});

describe('a written @diagnostic(…) is one TS8028 in both halves (change 0132)', () => {
  const FILTER = '@diagnostic("off", "derivative_uniformity")';
  const sources: Readonly<Record<string, string>> = {
    'a top-level helper': `${HEAD}${FILTER}
function sample(uv: vec2): vec4 { return textureSample(t, s, uv); }
@fragment export function fs(uv: location<0, vec2>): vec4 {
  if (uv.x > 0.5) { return sample(uv); }
  return vec4(0.);
}
`,
    "a namespace's function": `${HEAD}namespace N {
  ${FILTER} export function h(x: f32): f32 { return x; }
}
@fragment export function fs(uv: location<0, vec2>): vec4 {
  return vec4(N.h(uv.x));
}
`,
    'a module constant': `${HEAD}${FILTER} const K: f32 = 1.;
@fragment export function fs(): vec4 { return vec4(K); }
`,
    'a field': `${HEAD}class P { ${FILTER} a: f32; }
@fragment export function fs(): vec4 { const p = new P(); return vec4(p.a); }
`,
  };
  for (const [where, source] of Object.entries(sources))
    it(`on ${where}`, () => {
      const { compiler, editor } = bothHalves(source);
      expect(compiler).toEqual([DECORATOR]);
      // TypeScript's TS1206 on the decorator merges into the refusal (Rule 12.4).
      expect(editor).toEqual(compiler);
    });

  it('on an entry with a stage attribute, beside the warning on its parameter decorator', () => {
    const source = `${HEAD}@fragment
${FILTER}
export function fs(@builtin("position") p: vec4): vec4 {
  if (p.x > 8.) { return textureSample(t, s, p.xy); }
  return vec4(0.);
}
`;
    const { compiler, editor } = bothHalves(source);
    expect(compiler.filter((d) => d.startsWith('error'))).toEqual([DECORATOR]);
    // The stage attribute is the entry's form (change 0130): only `@builtin` warns.
    expect(compiler.filter((d) => d.startsWith('warning')).length).toBe(1);
    expect(editor).toEqual(compiler);
  });
});
