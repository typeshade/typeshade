import { describe, expect, it } from 'vitest';
import { compileTsSources } from './module.js';
import { TS_CODES } from './codes.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const editorReading = (files: readonly { fileName: string; source: string }[]) => {
  const service = createTypeshadeLanguageService();
  for (const f of files) service.openDocument(f.fileName, f.source);
  return Object.fromEntries(
    files.map((f) => [
      f.fileName,
      service.getDiagnostics(f.fileName).map((d) => `${d.source} ${String(d.code)}: ${d.message}`),
    ]),
  );
};

describe('where the editor disagrees with compileTsSources over several files', () => {
  it('the editor sees a sibling file as missing where compileTsSources resolves it (disagreement)', () => {
    const files = [
      {
        fileName: 'math.ts',
        source: `"use typeshade";\nexport function square(x: f32): f32 { return x * x; }`,
      },
      {
        fileName: 'app.ts',
        source: `"use typeshade";\nimport { square } from "./math";\nexport function foo(x: f32): f32 { return square(x) + 1; }`,
      },
    ];
    expect(compileTsSources(files).diagnostics).toEqual([]);
    expect(editorReading(files)['app.ts']).toEqual([
      "typescript 2307: Cannot find module './math' or its corresponding type declarations.",
    ]);
  });

  it('the editor reads a syntax error as TypeScript diagnostics, compileTsSources as SYNTAX', () => {
    const files = [
      {
        fileName: 'app.ts',
        source: `"use typeshade";\nexport function foo(x: f32): f32 { return square(x; }`,
      },
    ];
    expect(compileTsSources(files).diagnostics.every((d) => d.code === TS_CODES.SYNTAX)).toBe(true);
    expect(editorReading(files)['app.ts']).toEqual([
      "typescript 2304: Cannot find name 'square'.",
      "typescript 1005: ')' expected.",
    ]);
  });

  it('the editor does not see two files whose explicit slots collide', () => {
    const files = [
      {
        fileName: 'a.ts',
        source: `"use typeshade"\nconst gain = uniform<f32>(3)\nexport function ga(): f32 { return gain }\n`,
      },
      {
        fileName: 'b.ts',
        source: `"use typeshade"\nconst bias = uniform<f32>({ group: 0, binding: 3 })\nexport function gb(): f32 { return bias }\n`,
      },
    ];
    expect(compileTsSources(files).diagnostics.map((d) => d.code)).toEqual([TS_CODES.UNSUPPORTED]);
    expect(editorReading(files)).toEqual({ 'a.ts': [], 'b.ts': [] });
  });
});
