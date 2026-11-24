import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const LIB = '/p/lib.shade.ts';
const ENTRY = '/p/b.shade.ts';
const VERTEX = `interface VsOut {
  pos: builtin<"position">;
  uv: vec2;
}
@vertex
export function vs(i: builtin<"vertex_index">): VsOut {
  return { pos: vec4(0., 0., 0., 1.), uv: vec2(f32(i), 0.) };
}
`;

const DECLARATIONS: readonly (readonly [string, (name: string) => string])[] = [
  ['an interface', (name) => `export interface ${name} {\n  a: f32;\n}\n`],
  ['a type alias', (name) => `export type ${name} = {\n  a: f32;\n};\n`],
];

const NAMES: readonly (readonly [string, string])[] = [
  ['an ASCII name', 'Size'],
  ['a name with a dollar sign', 'Size$'],
  ['a name with a leading dollar sign', '$Size'],
  ['a name with a zero width joiner', 'Si‍ze'],
  ['a name with a zero width non-joiner', 'Si‌ze'],
];

const files = (declare: (name: string) => string, name: string): Record<string, string> => ({
  [LIB]: `"use typeshade";\n${declare(name)}export function make(x: f32): ${name} {\n  const p: ${name} = { a: x };\n  return p + 1.;\n}\n`,
  [ENTRY]: `"use typeshade";
import { make } from "./lib.shade.ts";
interface ${name} {
  z: f32;
}
declare const u: uniform<${name}>;
${VERTEX}@fragment
export function fs(v: VsOut): vec4 {
  return vec4(make(v.uv.x).a * u.z, 0., v.uv);
}
`,
});

describe('a sentence of an imported file names a declaration as its file writes it', () => {
  for (const [kind, declare] of DECLARATIONS) {
    for (const [label, name] of NAMES) {
      it(`${kind}, ${label}: once, in lib.shade.ts, in both halves`, () => {
        const sources = files(declare, name);
        const said = `Type mismatch: cannot + ${name} and f32. Types must match.`;
        const compiled = compile(sources[ENTRY]!, {
          fileName: ENTRY,
          readDocument: (n) => sources[n],
        }).diagnostics.filter((d) => d.code === 'TS8003');
        expect(compiled.map((d) => [d.fileName, d.message])).toEqual([[LIB, said]]);
        const service = createTypeshadeLanguageService();
        for (const [n, text] of Object.entries(sources)) service.openDocument(n, text);
        const shown = [ENTRY, LIB].flatMap((uri) =>
          service
            .getDiagnostics(uri)
            .filter((d) => d.code === 'TS8003')
            .map((d) => [d.uri, d.message]),
        );
        expect(shown).toEqual([[LIB, said]]);
      });
    }
  }
});
