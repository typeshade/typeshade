import { describe, expect, it } from 'vitest';
import { compareCommentFiles } from '../scripts/move-purity/comment-removal.js';
import { firstSyntaxDifference, syntaxStream } from '../scripts/move-purity/syntax-stream.js';

const PATH = 'src/a.ts';

const differ = (base: string, head: string) =>
  firstSyntaxDifference(syntaxStream(PATH, base), syntaxStream(PATH, head));

const BOM = String.fromCharCode(0xfeff);

describe('the syntax comparison of a comment removal ignores comments and nothing else', () => {
  it('reads a double slash inside a string and a template as text', () => {
    const base = 'const a = "// keep"; // drop\nconst b = `// ${1} /* kept */`; /* drop */\n';
    const head = 'const a = "// keep";\nconst b = `// ${1} /* kept */`;\n';
    expect(differ(base, head)).toBeUndefined();
    expect(differ(base, head.replace('// keep', 'keep'))).toBeDefined();
    expect(differ(base, head.replace('/* kept */', ''))).toBeDefined();
  });

  it('reads a regular expression that holds a block comment opener as one token', () => {
    const base = 'const r = /a\\/*b/g; // note\n';
    expect(differ(base, 'const r = /a\\/*b/g;\n')).toBeUndefined();
    expect(differ(base, 'const r = /a\\/*b/;\n')?.head?.text).toBe('/a\\/*b/');
  });

  it('reads a division next to a comment as a division', () => {
    const base = 'const x = a /* c */ / b; // d\n';
    expect(differ(base, 'const x = a / b;\n')).toBeUndefined();
    expect(differ(base, 'const x = a * b;\n')).toBeDefined();
  });

  it('reads a template with a nested substitution that holds comments', () => {
    const base = 'const t = `a${f(`b${/* c */ c}`) /* d */}`;\n';
    expect(differ(base, 'const t = `a${f(`b${c}`)}`;\n')).toBeUndefined();
    expect(differ(base, 'const t = `a${f(`b${d}`)}`;\n')).toBeDefined();
  });

  it('reads a closing angle bracket pair in a generic', () => {
    const base = 'const x: Array<Array<number> /* c */> = [];\n';
    expect(differ(base, 'const x: Array<Array<number>> = [];\n')).toBeUndefined();
    expect(differ(base, 'const x: Array<Array<string>> = [];\n')).toBeDefined();
  });

  it('keeps the shape of a restricted production that a comment line break cut', () => {
    const base = 'function f() {\n  return /*\n*/ 1;\n}\n';
    expect(differ(base, 'function f() {\n  return\n  1;\n}\n')).toBeUndefined();
    expect(differ(base, 'function f() {\n  return 1;\n}\n')).toBeDefined();
  });

  it('accepts a reflow of the same code', () => {
    const base = 'const f = (a: number) => a + 1; // sum\n';
    expect(differ(base, 'const f = (a: number) =>\n  a + 1;\n')).toBeUndefined();
    expect(differ(base, 'const f = (a: number) =>\n  a + 1,\n')).toBeDefined();
  });

  it('reports the first differing token with the line of each side', () => {
    const base = '// one\n// two\nconst a = 1;\nconst b = 2;\n';
    const head = 'const a = 1;\nconst b = 3;\n';
    const report = compareCommentFiles(PATH, base, head, new Set());
    expect(report.findings.map((f) => `${f.kind} ${f.path} ${f.detail}`)).toEqual([
      'code changed src/a.ts base line 4 2 head line 2 3',
    ]);
  });

  it('reports a token that one side lacks', () => {
    const report = compareCommentFiles(
      PATH,
      'const a = 1;\n',
      'const a = 1;\nconst b = 2;\n',
      new Set(),
    );
    expect(report.findings[0]?.detail).toContain('base line 2 EndOfFileToken');
  });

  it('holds a shebang and a byte order mark as preamble, not as a comment', () => {
    const shebang = '#!/usr/bin/env bun\nconst a = 1;\n';
    expect(compareCommentFiles(PATH, shebang, 'const a = 1;\n', new Set()).findings[0]?.kind).toBe(
      'preamble',
    );
    const marked = `${BOM}const a = 1;\n`;
    expect(compareCommentFiles(PATH, marked, 'const a = 1;\n', new Set()).findings[0]?.kind).toBe(
      'preamble',
    );
    expect(compareCommentFiles(PATH, marked, marked, new Set()).findings).toEqual([]);
  });

  it('holds a directive prologue', () => {
    const report = compareCommentFiles(
      PATH,
      "'use strict';\nconst a = 1;\n",
      'const a = 1;\n',
      new Set(),
    );
    expect(report.findings.map((f) => f.kind)).toContain('directives changed');
  });
});
