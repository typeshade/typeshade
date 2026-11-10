// ═══ "use typeshade" is the first statement (Rule 3.1, #200, proposal 0012) ═══
//
// A directive after another top-level statement compiled clean, but in ECMAScript it is no
// directive at all: a directive prologue is only the leading string-literal statements, so
// TypeScript read the file as ordinary code with a stray string in it and TypeShade read it as a
// shader. Such a directive is now TS8069, reported on the directive. The rest of the file is still
// checked, so the editor keeps its answers while the directive is out of place.
//
// Both halves read the same source (CLAUDE.md, "A test reads both halves"): compile()'s
// diagnostics and emit, and the language service's getDiagnostics and getHover.
//
// Verifies: Rule 3.1 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { isTypeshadeSource } from './source-file.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const BODY = 'export function f(x: f32): f32 {\n  return x * 2.;\n}\n';
const sentence = (what: string): string =>
  `"use typeshade" must be the file's first statement: here it follows ${what}, so TypeScript ` +
  'reads it as an ordinary string and not as a directive. Move it to the top of the file.';

const editor = (source: string) => {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', source);
  return { service, diagnostics: service.getDiagnostics('a.ts') };
};

describe('a directive after another statement', () => {
  it.each([
    ['a class declaration', 'class A {\n  x: f32;\n}\n'],
    ['a function declaration', 'function g(): f32 {\n  return 1.;\n}\n'],
    ['a variable declaration', 'const K = 1.;\n'],
    ['the "enable f16" directive', '"enable f16";\n'],
  ])('after %s is TS8069 on the directive, in both halves', (what, before) => {
    const source = `${before}"use typeshade";\n${BODY}`;
    const line = before.split('\n').length - 1;

    const compiled = compile(source);
    expect(compiled.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([
      `TS8069 ${sentence(what)}`,
    ]);
    expect(compiled.diagnostics[0]!.line).toBe(line + 1);
    expect(compiled.wgsl).toBeUndefined();

    const { diagnostics } = editor(source);
    expect(diagnostics.map((d) => `${String(d.code)} ${d.message}`)).toEqual([
      `TS8069 ${sentence(what)}`,
    ]);
    expect(diagnostics[0]!.range.start.line).toBe(line);
  });

  it('still checks the rest of the file, and the editor still answers hover', () => {
    const source = `class A {\n  x: f32;\n}\n"use typeshade";\n${BODY.replace('x * 2.', 'x * true')}`;
    expect(compile(source).diagnostics.map((d) => d.code)).toContain('TS8069');
    expect(compile(source).diagnostics.length).toBeGreaterThan(1);
    const { service } = editor(source);
    const hover = service.getHover('a.ts', service.positionAt('a.ts', source.indexOf('f32') + 1));
    expect(hover).toBeDefined();
  });

  it('is still a TypeShade source, so a bundler routes it to the compiler', () => {
    expect(isTypeshadeSource(`class A {\n  x: f32;\n}\n"use typeshade";\n${BODY}`)).toBe(true);
  });
});

describe('the valid neighbours', () => {
  it.each([
    [
      'a leading comment',
      `// SPDX-License-Identifier: MIT\n/* header */\n"use typeshade";\n${BODY}`,
    ],
    ['"enable f16" after the directive', `"use typeshade";\n"enable f16";\n${BODY}`],
    ['the directive first', `"use typeshade";\n${BODY}`],
  ])('%s compiles clean in both halves', (_what, source) => {
    expect(compile(source).diagnostics).toEqual([]);
    expect(editor(source).diagnostics).toEqual([]);
  });

  it('no directive at all is still TS8001, not TS8069', () => {
    expect(compile(BODY).diagnostics.map((d) => d.code)).toEqual(['TS8001']);
  });
});
