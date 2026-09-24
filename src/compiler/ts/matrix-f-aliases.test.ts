// ═══ WGSL's predeclared `matCxRf` aliases (#183, proposal 0011) ═══
//
// WGSL predeclares `mat2x2f` … `mat4x4f` beside the `vecNf` aliases (Predeclared aliases), and
// Rule 2.1(a) makes them source (a) names. The vectors had their aliases from the start; the
// matrices were left out when #166 made every `matCxR` a type, so `mat2x2f` was
// `TS8002 Unknown type` while the list that diagnostic printed held `vec2f`.
//
// Both halves read the same source (CLAUDE.md, "A test reads both halves"): `compile()` accepts
// the alias as a parameter, a return, a local annotation and a constructor call, and emits
// exactly what the `matCxR` spelling emits on both targets; the language service reports
// nothing on it and names the matrix on hover.
//
// Verifies: Rule 2.1 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const SHAPES = [2, 3, 4] as const;
const ALL = SHAPES.flatMap((c) => SHAPES.map((r) => [c, r] as const));
const comps = (n: number): string => Array.from({ length: n }, (_, i) => `${i + 1}.`).join(', ');

/** One program over a matrix spelled `name`: parameter, return, local annotation, constructor. */
const program = (name: string, cols: number, rows: number): string => `"use typeshade";

export function f(m: ${name}): ${name} {
  const k: ${name} = ${name}(${comps(cols * rows)});
  return m + k;
}

export function g(): f32 {
  return f(${name}())[0][0];
}
`;

describe('the nine matCxRf aliases', () => {
  it.each(ALL)('mat%ix%if compiles to what mat%ix%i does, and the editor agrees', (cols, rows) => {
    const alias = `mat${cols}x${rows}f`;
    const source = program(alias, cols, rows);
    const viaAlias = compile(source);
    expect(viaAlias.diagnostics).toEqual([]);
    const viaName = compile(program(`mat${cols}x${rows}`, cols, rows));
    expect(viaAlias.wgsl).toBe(viaName.wgsl);
    expect(viaAlias.glsl).toEqual(viaName.glsl);

    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', source);
    expect(service.getDiagnostics('a.ts')).toEqual([]);
    const hover = service.getHover('a.ts', service.positionAt('a.ts', source.indexOf(alias) + 2));
    expect(hover?.contents).toContain(`${cols}x${rows} matrix`);
  });

  it('a refusal still quotes the matCxR spelling, not the alias', () => {
    const r = compile('"use typeshade";\nexport function f(m: mat2x2f): f32 {\n  return m;\n}\n');
    expect(r.diagnostics.map((d) => d.message).join('\n')).toContain('mat2x2');
    expect(r.diagnostics.map((d) => d.message).join('\n')).not.toContain('mat2x2f');
  });

  it('an alias takes no type argument, in either half', () => {
    const source = '"use typeshade";\nexport function f(m: mat2x2f<f64>): f32 {\n  return 1.;\n}\n';
    expect(compile(source).diagnostics.length).toBeGreaterThan(0);
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', source);
    expect(service.getDiagnostics('a.ts').length).toBeGreaterThan(0);
  });
});
