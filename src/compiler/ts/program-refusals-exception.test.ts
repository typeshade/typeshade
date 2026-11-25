import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const LIB = '/p/lib.shade.ts';
const ENTRY = '/p/b.shade.ts';

const sources: Record<string, string> = {
  [LIB]: `"use typeshade";
export interface FsIn {
  n: vec3;
}
@fragment
export function lf(v: FsIn): vec4 {
  return vec4(v.n, 1.);
}
`,
  [ENTRY]: `"use typeshade";
import { FsIn } from "./lib.shade.ts";
interface VsOut {
  pos: builtin<"position">;
  uv: vec2;
}
@vertex
export function vs(i: builtin<"vertex_index">): VsOut {
  return { pos: vec4(0., 0., 0., 1.), uv: vec2(f32(i), 0.) };
}
@fragment
export function fs(v: FsIn): vec4 {
  return vec4(v.n, 1.);
}
`,
};

const SAID =
  '"FsIn.n" has no location and the vertex results give "n" none: write location<n, T> on it.';

describe('an imported fragment entry that takes the struct owns its refusal', () => {
  it('the program that starts from another file shows it only in the imported file', () => {
    const own = compile(sources[LIB]!, { fileName: LIB, readDocument: (n) => sources[n] });
    expect(own.diagnostics.map((d) => [d.fileName, d.code, d.message])).toEqual([
      [LIB, 'TS8010', SAID],
    ]);
    const program = compile(sources[ENTRY]!, { fileName: ENTRY, readDocument: (n) => sources[n] });
    expect(program.diagnostics.map((d) => [d.fileName, d.code, d.message])).toEqual([
      [LIB, 'TS8010', SAID],
    ]);
    const service = createTypeshadeLanguageService();
    for (const [n, text] of Object.entries(sources)) service.openDocument(n, text);
    const shown = [ENTRY, LIB].flatMap((uri) =>
      service
        .getDiagnostics(uri)
        .filter((d) => d.code === 'TS8010')
        .map((d) => [d.uri, d.message]),
    );
    expect(shown).toEqual([[LIB, SAID]]);
  });
});
