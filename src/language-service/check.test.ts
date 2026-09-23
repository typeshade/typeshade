// `typeshade check`: the merged answer is the editor's answer plus the backends', and it never
// reports the false positives plain `tsc` reports on code the compiler accepts.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { SHADE_DTS } from './ambient.js';
import { checkDocuments, checkOpenDocument, type CheckDocument } from './check.js';
import { createTypeshadeLanguageService } from './service.js';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const doc = (path: string, text: string): CheckDocument => ({ path, uri: `/p/${path}`, text });

/** A valid shader written in the arithmetic `"use typeshade"` is authored in. */
const VALID = `"use typeshade";
export function shade(n: vec3, l: vec3, albedo: vec3): vec3 {
  const d = max(dot(n, l), 0.);
  const lit = albedo * d + albedo * 0.1;
  return normalize(n + l) * 0.5 + lit;
}
`;

/** What plain `tsc` says about `text` over the ambient lib, with no language service. */
function plainTsc(text: string): readonly ts.Diagnostic[] {
  const files: Record<string, string> = { 'shade.d.ts': SHADE_DTS, 'a.shade.ts': text };
  const host: ts.CompilerHost = {
    getSourceFile: (f) =>
      files[f] === undefined
        ? undefined
        : ts.createSourceFile(f, files[f]!, ts.ScriptTarget.Latest, true),
    getDefaultLibFileName: () => 'shade.d.ts',
    writeFile: () => {},
    getCurrentDirectory: () => '',
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (f) => files[f] !== undefined,
    readFile: (f) => files[f],
  };
  const program = ts.createProgram(
    ['shade.d.ts', 'a.shade.ts'],
    { noLib: true, strict: true, experimentalDecorators: true, target: ts.ScriptTarget.ES2022 },
    host,
  );
  return program.getSemanticDiagnostics(program.getSourceFile('a.shade.ts'));
}

describe('typeshade check', () => {
  it('reports nothing on vector arithmetic the compiler accepts, where plain tsc reports it', () => {
    expect(
      plainTsc(VALID).map((d) => d.code),
      'plain tsc no longer reports the vector arithmetic; the reason this command exists moved',
    ).toEqual([2362, 2362, 2322, 2365]);
    const report = checkDocuments([doc('valid.shade.ts', VALID)]);
    expect(report.diagnostics).toEqual([]);
    expect(report.errors).toBe(0);
  });

  it('merges the TypeScript half, the TypeShade half and their positions', () => {
    const text = `"use typeshade";
export function fogFactor(dist: f32, density: f32): f32 {
  const f = exp(-density * dist);
  f = clmap(f, 0., 1.);
  return f;
}
`;
    const report = checkDocuments([doc('fog.shade.ts', text)]);
    const rows = report.diagnostics.map((d) => `${d.line}:${d.column} ${d.source} ${d.code}`);
    // The write to the `const` is one mistake both halves see: TypeScript's TS2588 and the
    // compiler's TS8005, merged to the compiler's (Rule 12.4). The typo only TypeScript sees,
    // since the compiler refused the statement at the write.
    expect(rows).toEqual(['4:3 typeshade TS8005', '4:7 typescript TS2552']);
    const typo = report.diagnostics.find((d) => d.code === 'TS2552')!;
    expect(typo.message).toBe("Cannot find name 'clmap'. Did you mean 'clamp'?");
    expect(typo).toMatchObject({ file: 'fog.shade.ts', endLine: 4, endColumn: 12, length: 5 });
    expect(report.errors).toBe(2);
  });

  it("keeps TypeScript's spelling fix for an unknown name, and the compiler's sentence goes", () => {
    // The one pair the merge keeps TypeScript's side of: "Did you mean" is the remedy, and the
    // compiler's TS8004 names none. The compiler's own run must not bring TS8004 back either,
    // which it did while the command added every compiler row the service lacked.
    const text = `"use typeshade";
export function f(x: f32): f32 {
  return clmap(x, 0., 1.);
}
`;
    const report = checkDocuments([doc('typo.shade.ts', text)]);
    expect(report.diagnostics.map((d) => `${d.source} ${d.code} ${d.message}`)).toEqual([
      "typescript TS2552 Cannot find name 'clmap'. Did you mean 'clamp'?",
    ]);
  });

  it("carries the backends' verdict, which the language service never computes (Rule 12.3)", () => {
    // WGSL takes a loose scalar uniform; GLSL ES 3.00 has no std140 block for one. A render
    // module compiles, and the GLSL shortfall is a warning.
    const render = `"use typeshade";
declare const scale: uniform<f32>;

@fragment
export function fs(): vec4 {
  return vec4(scale, 0., 0., 1.);
}
`;
    const report = checkDocuments([doc('render.shade.ts', render)]);
    expect(report.diagnostics.map((d) => `${d.severity} ${d.code}`)).toEqual(['warning TS8015']);
    expect(report.diagnostics[0]!.message).toContain("uniform binding 'scale' must be a struct");
    expect(report.errors).toBe(0);
    expect(report.warnings).toBe(1);

    // A compute-only module has no GLSL stage to miss, so its GLSL refusal is not news.
    const compute = `"use typeshade";
declare let data: storage<array<f32>>;

@compute([64])
export function main(@builtin("global_invocation_id") gid: vec3u) {
  data[gid.x] = 1.;
}
`;
    expect(checkDocuments([doc('compute.shade.ts', compute)]).diagnostics).toEqual([]);
  });

  it('checks each file on its own, so two TypeScript scripts do not collide', () => {
    // No import and no export: each is a TypeScript script, whose top-level names are global.
    const script = `"use typeshade";
class FsOut {
  @location(0) color: vec4;
}

@fragment
function fs(): FsOut {
  return { color: vec4(1.) };
}
`;
    const report = checkDocuments([doc('a.shade.ts', script), doc('b.shade.ts', script)]);
    expect(report.diagnostics).toEqual([]);
  });

  it('reports the deprecation warnings only when asked (§13)', () => {
    const text = `"use typeshade";
export function f(): f32 {
  let i = 0;
  i = i + 1.;
  return i;
}
`;
    expect(checkDocuments([doc('d.shade.ts', text)]).diagnostics).toEqual([]);
    const asked = checkDocuments([doc('d.shade.ts', text)], { deprecations: true });
    expect(asked.diagnostics.map((d) => `${d.severity} ${d.code}`)).toEqual(['warning TS8053']);
  });

  it('finds no error in any example shader, the corpus the compile gate proves valid', () => {
    // README's measurement of plain tsc over this corpus is 214 TS1206 and 328 arithmetic
    // errors, none of them real. The only rows left here are the GLSL shortfalls compile()
    // itself reports as TS8015 warnings.
    const dir = join(PKG_DIR, 'examples');
    const docs = readdirSync(dir)
      .filter((f) => f.endsWith('.shade.ts'))
      .sort()
      .map((f) => ({
        path: `examples/${f}`,
        uri: join(dir, f),
        text: readFileSync(join(dir, f), 'utf8'),
      }));
    expect(docs.length, 'read no examples — the reader is broken').toBeGreaterThanOrEqual(60);
    const report = checkDocuments(docs, { readDocument: (uri) => readFileSync(uri, 'utf8') });
    expect(
      report.diagnostics
        .filter((d) => d.severity === 'error')
        .map((d) => `${d.file}:${d.line} ${d.code} ${d.message}`),
    ).toEqual([]);
    for (const d of report.diagnostics) expect(`${d.severity} ${d.code}`).toBe('warning TS8015');
  });
});

describe('checkOpenDocument: the same check over a service the caller keeps', () => {
  it('reports what checkDocuments reports, for the one document asked about', () => {
    // A render module with a TypeScript mistake, a compiler mistake and a GLSL shortfall: every
    // source the check draws on.
    const text = `"use typeshade";
declare const scale: uniform<f32>;

@fragment
export function fs(): vec4 {
  const y = 1.;
  y = 2.;
  return vec4(scale, colr, 0., 1.);
}
`;
    const other = `"use typeshade";
export function g(x: f32): f32 {
  return nope;
}
`;
    const service = createTypeshadeLanguageService();
    service.openDocument('/p/a.shade.ts', text);
    service.openDocument('/p/b.shade.ts', other);
    const kept = checkOpenDocument(service, doc('a.shade.ts', text));
    expect(kept).toEqual(checkDocuments([doc('a.shade.ts', text)]).diagnostics);
    expect(kept.map((d) => `${d.severity} ${d.code}`)).toEqual(['error TS8005', 'error TS8022']);
    // The service keeps the other document open, and its rows are not this one's.
    expect(kept.every((d) => d.file === 'a.shade.ts')).toBe(true);
  });
});
