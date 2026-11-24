import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import {
  analyzeSourceFile,
  createTypeshadeLanguageService,
  createTypeshadeLanguageServiceWith,
  importHooksOf,
} from './service.js';
import { bothRefuse } from '../core/testing/both-halves.js';
import type { TypeshadeTextEdit } from './types.js';

const MAIN = '/app/main.shade.ts';
const LIB = '/app/lib.shade.ts';

function applied(text: string, edits: readonly TypeshadeTextEdit[]): string {
  const lines = text.split('\n');
  const offsetOf = (p: { line: number; character: number }): number =>
    lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character;
  return [...edits]
    .sort((a, b) => offsetOf(b.range.start) - offsetOf(a.range.start))
    .reduce(
      (t, e) => t.slice(0, offsetOf(e.range.start)) + e.newText + t.slice(offsetOf(e.range.end)),
      text,
    );
}

describe('the order of rows that share a start', () => {
  const WRITE_TO_CONST =
    '"use typeshade";\nexport function f(): f32 {\n  const k = 1.\n  k = 2.\n  return k\n}\n';

  const ARITY =
    '"use typeshade";\nexport function f(): vec4 {\n  let v: vec4 = vec4(1., 2.)\n  return v\n}\n';

  it('puts the enclosed row before the enclosing one', () => {
    const service = createTypeshadeLanguageServiceWith({}, analyzeSourceFile, { merge: false });
    service.openDocument('a.ts', ARITY);
    const rows = service.getDiagnostics('a.ts').filter((d) => d.span.start === 61);
    expect(rows.map((d) => [d.source, d.span.length])).toEqual([
      ['typescript', 4],
      ['typeshade', 12],
    ]);
  });

  it('puts the TypeScript row before the TypeShade row of one span', () => {
    const service = createTypeshadeLanguageServiceWith({}, analyzeSourceFile, { merge: false });
    service.openDocument('a.ts', WRITE_TO_CONST);
    const rows = service.getDiagnostics('a.ts').filter((d) => d.span.start === 61);
    expect(rows.map((d) => [d.source, d.span.length])).toEqual([
      ['typescript', 1],
      ['typeshade', 1],
    ]);
  });
});

describe('a diagnostic of one document that another document owns', () => {
  const LIBRARY = `"use typeshade";
export const K = 7;
export function half(x: u32): u32 { return x * (K / 2); }
`;
  const IMPORTER = `"use typeshade";
import { K, half } from "./lib.shade";
export function t(vi: u32): u32 { return vi * K + half(vi); }
`;

  it('drops the mismatch around a / that an open importing document refuses', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument(LIB, LIBRARY);
    const alone = service.getDiagnostics(LIB).map((d) => d.message);
    expect(alone).toHaveLength(1);
    expect(alone[0]).toContain('cannot * u32 and f32');
    service.openDocument(MAIN, IMPORTER);
    expect(service.getDiagnostics(LIB)).toEqual([]);
    expect(service.getDiagnostics(MAIN).map((d) => d.message)).toEqual(
      compile(IMPORTER, {
        fileName: MAIN,
        readDocument: (uri) => (uri === LIB ? LIBRARY : undefined),
      }).diagnostics.map((d) => d.message),
    );
    service.closeDocument(MAIN);
    expect(service.getDiagnostics(LIB).map((d) => d.message)).toEqual(alone);
  });
});

describe('a file the program holds without an open document', () => {
  const BROKEN = '"use typeshade";\nexport function k(): f32 {\n  return "x";\n}\n';
  const USER =
    '"use typeshade";\nimport { k } from "./lib.shade";\nexport function f(): f32 {\n  return k();\n}\n';

  it('has no diagnostics and no compiled output of its own', () => {
    const service = createTypeshadeLanguageService({
      readDocument: (uri) => (uri === LIB ? BROKEN : undefined),
    });
    service.openDocument(MAIN, USER);
    expect(service.getDocumentSymbols(LIB).map((s) => s.name)).toEqual(['k']);
    expect(service.getDiagnostics(LIB)).toEqual([]);
    expect(service.getCompiledOutput(LIB, 'wgsl')).toBeUndefined();
  });
});

describe('a document whose program carries inserted annotations', () => {
  const LIBRARY = `"use typeshade";
export class S { static K = 7; }
export function shade(c: vec2): f32 { return c.x; }
`;
  const IMPORTER = `"use typeshade";
import { S, shade } from "./lib.shade";
function h(a: u32): u32 { return a; }
@fragment export function fs(p: builtin<"position">): vec4 {
  const uv = p.xy * 2.0; const r = shade(uv);
  return vec4(r + f32(h(S.K)) + f32(S.K / 2), 0, 0, 1);
}
`;
  const open = () => {
    const files: Record<string, string> = { [LIB]: LIBRARY, [MAIN]: IMPORTER };
    const service = createTypeshadeLanguageService({ readDocument: (uri) => files[uri] });
    service.openDocument(LIB, LIBRARY);
    service.openDocument(MAIN, IMPORTER);
    return { service, files };
  };

  it('treats an inserted annotation of an imported open document as no written type', () => {
    const { service, files } = open();
    const compiled = compile(IMPORTER, { fileName: MAIN, readDocument: (uri) => files[uri] });
    expect(compiled.diagnostics.map((d) => d.message)).toHaveLength(1);
    expect(compiled.diagnostics[0]!.message).toContain('is a u32 where another line reads it');
    expect(service.getDiagnostics(MAIN).map((d) => d.message)).toEqual(
      compiled.diagnostics.map((d) => d.message),
    );
  });

  it('renames in each document through its own projection', () => {
    const { service } = open();
    const at = service.positionAt(LIB, LIBRARY.indexOf('shade('));
    const edits = service.rename(LIB, at, 'glow');
    expect(Object.keys(edits).sort()).toEqual([LIB, MAIN]);
    expect(applied(LIBRARY, edits[LIB]!)).toContain('export function glow(');
    const renamed = applied(IMPORTER, edits[MAIN]!);
    expect(renamed).toContain('import { S, glow } from');
    expect(renamed).toContain('const r = glow(uv);');
  });

  it('gives a compile beside the service the documents as written', () => {
    const { service } = open();
    const hooks = importHooksOf(service);
    expect(hooks.readDocument?.(MAIN)).toBe(IMPORTER);
    expect(hooks.readDocument?.('/app/unknown.ts')).toBeUndefined();
  });

  it('reads a file that is not open through the host', () => {
    const service = createTypeshadeLanguageService({
      readDocument: (uri) => (uri === LIB ? LIBRARY : undefined),
    });
    expect(importHooksOf(service).readDocument?.(LIB)).toBe(LIBRARY);
  });
});

describe('a file without the directive', () => {
  it('is refused by both halves with the missing directive', () => {
    bothRefuse(
      'export function f(): f32 {\n  return 1.;\n}\n',
      'TS8001',
      'Missing "use typeshade" directive. Add "use typeshade"; at the top level to mark this file for TypeShade compilation.',
    );
  });
});

describe('the hover of an import that no code uses', () => {
  const LIBRARY = '"use typeshade";\nexport function k(): f32 {\n  return 1.;\n}\n';
  const IMPORTER =
    '"use typeshade";\nimport { k } from "./lib.shade.ts";\nexport function f(): f32 {\n  return 2.;\n}\n';

  it('analyses no document that is not open', () => {
    const analysed: string[] = [];
    const service = createTypeshadeLanguageServiceWith(
      { readDocument: (uri) => (uri.endsWith('lib.shade.ts') ? LIBRARY : undefined) },
      (sourceFile, imports) => {
        analysed.push(sourceFile.fileName);
        return analyzeSourceFile(sourceFile, imports);
      },
    );
    service.openDocument(MAIN, IMPORTER);
    const hover = service.getHover(MAIN, service.positionAt(MAIN, IMPORTER.indexOf('k }')));
    expect(hover?.contents).toContain('(alias) function k(): f32');
    expect(analysed).toEqual([MAIN]);
  });
});
