// Change 0111, milestone 3 (amendment 3): every registered example's entry forms are plain
// TypeScript. A `tsc --strict` with no TypeScript library and the published ambient library
// (`SHADE_DTS`), and no diagnostic filter, reports no TS1206 (a decorator where TypeScript has
// none) and no TS2564 (a field with no initializer). The diagnostics of vector arithmetic,
// which TypeScript has no operator overloading for, stay out of this check and in the language
// service's filters (amendment 3). A parameter qualifier, `@inout a: f32`, is the language's
// form (Rule 8.25, change 0137), and its TS1206 under a plain `tsc` is a cost of the owner's
// decision OD-5 that the editor hides: it is left out of this check, and only it.
//
// Verifies: Rule 6.6, Rule 8.1 (docs/language-design.md; traced in reqs/).

import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHADE_DTS } from '../src/language-service/ambient.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));

/** Every `*.shade.ts` under `examples/`, its subdirectories included. */
function shaderFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    if (name.isDirectory()) shaderFiles(path, out);
    else if (name.name.endsWith('.shade.ts')) out.push(path);
  }
  return out;
}

/** The two codes change 0111 removes from a `"use typeshade"` file. */
const ENTRY_FORM_CODES = new Set([1206, 2564]);

/** Whether `d` is TS1206 on a parameter qualifier, `@inout` or `@out` (change 0137). */
function onQualifier(d: ts.Diagnostic): boolean {
  if (d.code !== 1206 || d.file === undefined || d.start === undefined) return false;
  let node: ts.Node | undefined;
  const visit = (n: ts.Node): void => {
    if (d.start! < n.getStart(d.file) || d.start! >= n.getEnd()) return;
    node = n;
    ts.forEachChild(n, visit);
  };
  visit(d.file);
  while (node !== undefined && !ts.isDecorator(node)) node = node.parent;
  return (
    node !== undefined &&
    ts.isIdentifier(node.expression) &&
    (node.expression.text === 'inout' || node.expression.text === 'out') &&
    ts.isParameter(node.parent)
  );
}

describe('the examples are plain TypeScript in their entry forms (change 0111)', () => {
  it('a plain tsc --strict reports no TS1206 but on a qualifier and no TS2564 in any example', () => {
    const files = shaderFiles(ROOT);
    expect(files.length).toBeGreaterThan(100);
    const ambient = join(ROOT, '__shade__.d.ts');
    const texts = new Map<string, string>([[ambient, SHADE_DTS]]);
    for (const f of files) texts.set(f, readFileSync(f, 'utf8'));
    const options: ts.CompilerOptions = {
      strict: true,
      noLib: true,
      noEmit: true,
      types: [],
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowImportingTsExtensions: true,
    };
    const host = ts.createCompilerHost(options);
    host.getSourceFile = (name, version) => {
      const text = texts.get(name) ?? (name.endsWith('.ts') ? readOrUndefined(name) : undefined);
      return text === undefined ? undefined : ts.createSourceFile(name, text, version, true);
    };
    host.fileExists = (name) => texts.has(name) || readOrUndefined(name) !== undefined;
    host.readFile = (name) => texts.get(name) ?? readOrUndefined(name);
    const program = ts.createProgram([...texts.keys()], options, host);
    const all = ts.getPreEmitDiagnostics(program);
    // The exemption reads what it is for: `examples/reference-parameters.shade.ts` writes
    // qualifiers (AGENTS.md#gate-discipline).
    expect(all.filter(onQualifier).length).toBeGreaterThan(0);
    const found = all
      .filter((d) => ENTRY_FORM_CODES.has(d.code) && d.file !== undefined && !onQualifier(d))
      .map((d) => {
        const { line } = d.file!.getLineAndCharacterOfPosition(d.start ?? 0);
        return `${relative(ROOT, d.file!.fileName)}:${line + 1} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
      });
    expect(found).toEqual([]);
  });
});

function readOrUndefined(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}
