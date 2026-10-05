// `tshc check`: the merged answer is the editor's answer plus the backends', and it never
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

describe('tshc check', () => {
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
    // compiler's TS8005, merged to the compiler's (Rule 12.4). So is the typo in the statement
    // the compiler refused at the write: it names a function nothing declares, which the
    // compiler says once the file is lowered (Rule 2.1), and TypeScript's TS2552 merges into it.
    expect(rows).toEqual(['4:3 typeshade TS8005', '4:7 typeshade TS8004']);
    const typo = report.diagnostics.find((d) => d.code === 'TS8004')!;
    expect(typo.message).toBe('Unknown function "clmap". Did you mean "clamp"?');
    expect(typo).toMatchObject({ file: 'fog.shade.ts', endLine: 4, endColumn: 12, length: 5 });
    expect(report.errors).toBe(2);
  });

  it('prints the spelling fix for an unknown name once, in the sentence the build prints', () => {
    // The compiler names the function a misspelled one is spelled like (Rule 12.1), so the
    // merge keeps its sentence, the one `compile()` and the build print, and TypeScript's
    // TS2552 says nothing more (Rule 12.4). The compiler's own run must not add a second copy,
    // which it did while the command added every compiler row the service lacked.
    const text = `"use typeshade";
export function f(x: f32): f32 {
  return clmap(x, 0., 1.);
}
`;
    const report = checkDocuments([doc('typo.shade.ts', text)]);
    expect(report.diagnostics.map((d) => `${d.source} ${d.code} ${d.message}`)).toEqual([
      'typeshade TS8004 Unknown function "clmap". Did you mean "clamp"?',
    ]);
  });

  it("prints TypeShade's spelling of a GLSL or HLSL name the compiler did not read (#218)", () => {
    // A list with no type annotation is refused whole, and the names in it are read by no one but
    // TypeScript, whose report of them was raw: "Did you mean 'mod'?" for `fmod`, which floors where
    // `fmod` truncates, and no remedy for `lerp`. The command shows the sentence the build prints for
    // each once the list is typed, on the name, the same way the editor does (Rule 12.7); an agent
    // that reads the command fixes the annotation and the two names in one round.
    const text = `"use typeshade";
export function f(a: f32, b: f32): f32 {
  const w = [fmod(a, 2.), lerp(a, b, 0.5)];
  return a;
}
`;
    const report = checkDocuments([doc('list.shade.ts', text)]);
    expect(
      report.diagnostics.map((d) => `${d.line}:${d.column} ${d.source} ${d.code} ${d.message}`),
    ).toEqual([
      '3:9 typeshade TS8002 "const w" needs an array type annotation to take a list, e.g. const w: array<f32, 2> = [...].',
      '3:14 typeshade TS8004 Unknown function "fmod". HLSL\'s fmod is the % operator, which truncates like fmod; mod() floors.',
      '3:27 typeshade TS8004 Unknown function "lerp". HLSL\'s lerp is mix here.',
    ]);
    expect(report.errors).toBe(3);
    // The same two names in a typed list are the build's own sentences, word for word.
    const typed = text.replace('const w =', 'const w: array<f32, 2> =');
    expect(
      checkDocuments([doc('typed.shade.ts', typed)]).diagnostics.map(
        (d) => `${d.code} ${d.message}`,
      ),
    ).toEqual(report.diagnostics.slice(1).map((d) => `${d.code} ${d.message}`));
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
declare const data: storage<array<f32>, "read_write">;

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
    // …and the six TS8070 warnings of `loop-on-cpu`, which shows one refused loop per rule
    // of change 0013's proof on purpose.
    for (const d of report.diagnostics)
      expect(`${d.severity} ${d.code}${d.code === 'TS8070' ? ` ${d.file}` : ''}`).toMatch(
        /^warning (TS8015|TS8070 examples\/loop-on-cpu\.shade\.ts)$/,
      );
    expect(report.diagnostics.filter((d) => d.code === 'TS8070')).toHaveLength(6);
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

  // Verifies: Rule 3.9 (docs/language-design.md; traced in reqs/).
  it('checks a module a document imports once, under its own path, and its mistakes there', () => {
    const app = `"use typeshade";
import { g } from "./lib/util.shade.ts";
export function f(x: f32): f32 {
  return g(x);
}
`;
    const util = `"use typeshade";
export function g(x: f32): f32 {
  return zork(x);
}
`;
    const disk: Record<string, string> = { '/p/lib/util.shade.ts': util };
    const report = checkDocuments([doc('app.shade.ts', app)], { readDocument: (u) => disk[u] });
    // The import is followed, so the call is not an unknown function in app.shade.ts; the
    // mistake is util's, reported at util's line and under the path it was named by.
    expect(report.files).toEqual(['app.shade.ts', 'lib/util.shade.ts']);
    expect(report.diagnostics.map((d) => `${d.file}:${d.line}:${d.column} ${d.code}`)).toEqual([
      'lib/util.shade.ts:3:10 TS8004',
    ]);
    // Handed in too, it is checked once.
    const both = checkDocuments([doc('app.shade.ts', app), doc('lib/util.shade.ts', util)], {
      readDocument: (u) => disk[u],
    });
    expect(both.files).toEqual(['app.shade.ts', 'lib/util.shade.ts']);
    expect(both.errors).toBe(1);
  });
});
