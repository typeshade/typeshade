// === Regression coverage for TypeshadeHost's default resolveImport/multi-file resolution ===
//
// Bug: `joinPath` used to split the whole concatenated `${dir}${specifier}` string on `/` and
// drop every empty segment, which ate a uri authority — `file:///main.ts` + `./lib.ts` produced
// `file:/lib.ts` (two slashes lost) and `/main.ts` + `./lib.ts` produced `lib.ts` (the leading
// slash lost) — so a multi-file import never actually resolved to the uri the adapter opened
// the imported document under, for either shape. A `.js` specifier (the extension this
// repository's own source uses) was also never rewritten to `.ts`.

import { describe, expect, it } from 'vitest';
import { createTypeshadeLanguageService } from './service.js';

describe('default resolveImport / multi-file resolution', () => {
  it('resolves a relative import across two file:///-shaped uris', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument(
      'file:///lib.ts',
      '"use typeshade"\nexport function k(): f32 {\n  return 1.\n}\n',
    );
    service.openDocument(
      'file:///main.ts',
      '"use typeshade"\nimport { k } from "./lib.ts"\nexport function f(): f32 {\n  return k()\n}\n',
    );
    const diagnostics = service.getDiagnostics('file:///main.ts');
    expect(
      diagnostics.filter((d) => d.code === 2307),
      `unexpected "Cannot find module" diagnostics: ${JSON.stringify(diagnostics)}`,
    ).toEqual([]);
  });

  it('resolves a relative import across two absolute /-shaped uris', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument(
      '/lib.ts',
      '"use typeshade"\nexport function k(): f32 {\n  return 1.\n}\n',
    );
    service.openDocument(
      '/main.ts',
      '"use typeshade"\nimport { k } from "./lib.ts"\nexport function f(): f32 {\n  return k()\n}\n',
    );
    const diagnostics = service.getDiagnostics('/main.ts');
    expect(diagnostics.filter((d) => d.code === 2307)).toEqual([]);
  });

  it("rewrites a .js specifier to .ts, matching how this repository's own source imports", () => {
    const service = createTypeshadeLanguageService();
    service.openDocument(
      'file:///lib.ts',
      '"use typeshade"\nexport function k(): f32 {\n  return 1.\n}\n',
    );
    service.openDocument(
      'file:///main.ts',
      '"use typeshade"\nimport { k } from "./lib.js"\nexport function f(): f32 {\n  return k()\n}\n',
    );
    const diagnostics = service.getDiagnostics('file:///main.ts');
    expect(diagnostics.filter((d) => d.code === 2307)).toEqual([]);
  });

  it('resolves a parent-directory import (..) against a nested uri', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument(
      'file:///lib.ts',
      '"use typeshade"\nexport function k(): f32 {\n  return 1.\n}\n',
    );
    service.openDocument(
      'file:///src/main.ts',
      '"use typeshade"\nimport { k } from "../lib.ts"\nexport function f(): f32 {\n  return k()\n}\n',
    );
    const diagnostics = service.getDiagnostics('file:///src/main.ts');
    expect(diagnostics.filter((d) => d.code === 2307)).toEqual([]);
  });
});

// Regression: getScriptVersion returned the adapter's version verbatim for an open document and
// a fixed '1' for a file read through readDocument, so a text change under a repeated or
// omitted version (open at 1, update with no version: the store's own counter starts at 1 too)
// left TypeScript reusing the old SourceFile, and an imported file opened in the editor at
// version 1 collided with the imported copy's '1'. The import-aware cache key in service.ts is
// built from the same versions, so it inherited every one of these.
describe('script versions follow the text (design doc §7)', () => {
  const B_OK = '"use typeshade";\nexport function k(): f32 {\n  return 1.\n}\n';
  const B_BOOL = '"use typeshade";\nexport function k(): bool {\n  return true\n}\n';
  const B_BAD = '"use typeshade";\nexport function k(): f32 {\n  return true\n}\n';
  const A =
    '"use typeshade";\nimport { k } from "./b.js"\nexport function f(): f32 {\n  return k()\n}\n';
  const tsErrors = (service: ReturnType<typeof createTypeshadeLanguageService>, uri: string) =>
    service
      .getDiagnostics(uri)
      .filter((d) => d.source === 'typescript')
      .map((d) => d.code);

  it('reflects a text change under the same version, reopened without a close', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('/b.ts', B_OK, 1);
    expect(tsErrors(service, '/b.ts')).toEqual([]);
    service.openDocument('/b.ts', B_BAD, 1);
    expect(tsErrors(service, '/b.ts')).toContain(2322);
  });

  it('reflects a text change when the version was given once and then omitted, in the document and its importer', () => {
    const service = createTypeshadeLanguageService();
    service.openDocument('/b.ts', B_OK, 1);
    service.openDocument('/a.ts', A, 1);
    expect(tsErrors(service, '/b.ts')).toEqual([]);
    expect(tsErrors(service, '/a.ts')).toEqual([]);
    service.updateDocument('/b.ts', B_BAD);
    expect(tsErrors(service, '/b.ts')).toContain(2322);
    service.updateDocument('/b.ts', B_BOOL);
    expect(tsErrors(service, '/b.ts')).toEqual([]);
    expect(tsErrors(service, '/a.ts')).toContain(2322);
  });

  it('lets an imported file opened in the editor at version 1 replace the copy read from disk', () => {
    const service = createTypeshadeLanguageService({
      readDocument: (uri) => (uri === '/b.ts' ? B_OK : undefined),
    });
    service.openDocument('/a.ts', A, 1);
    expect(tsErrors(service, '/a.ts')).toEqual([]);
    service.openDocument('/b.ts', B_BOOL, 1);
    expect(tsErrors(service, '/a.ts')).toContain(2322);
  });

  it('re-reads a closed import through readDocument instead of keeping the first read', () => {
    let disk = B_OK;
    const service = createTypeshadeLanguageService({
      readDocument: (uri) => (uri === '/b.ts' ? disk : undefined),
    });
    service.openDocument('/a.ts', A, 1);
    expect(tsErrors(service, '/a.ts')).toEqual([]);
    service.openDocument('/b.ts', B_OK, 1);
    service.updateDocument('/b.ts', B_BOOL, 2);
    expect(tsErrors(service, '/a.ts')).toContain(2322);
    disk = B_BOOL;
    service.closeDocument('/b.ts');
    // The saved file is what the importer sees now, not the first text ever read from disk.
    expect(tsErrors(service, '/a.ts')).toContain(2322);
    disk = B_OK;
    service.openDocument('/b.ts', B_OK, 3);
    service.closeDocument('/b.ts');
    expect(tsErrors(service, '/a.ts')).toEqual([]);
  });
});
