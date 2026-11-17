import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('.', import.meta.url));

const MAY_IMPORT: Readonly<Record<string, readonly string[]>> = {
  core: [],
  rhi: ['core'],
  compiler: ['core'],
  runtime: ['core', 'rhi'],
  'language-service': ['core', 'compiler'],
  algorithms: ['core', 'runtime'],
  random: ['core', 'runtime'],
  cli: ['core', 'compiler', 'language-service', 'runtime'],
};

const KNOWN: readonly string[] = [
  'compiler/ts/host-face-contracts.ts -> runtime/resource.ts',
  'compiler/ts/host-face.ts -> runtime/resource.ts',
  'core/cpu-entries.ts -> rhi/cpu-program.ts',
  'core/debug/watch.ts -> compiler/ts/source-file.ts',
  'core/host-draw.ts -> rhi/cpu-program.ts',
  'core/host-draw.ts -> rhi/cpu.ts',
  'core/host-draw.ts -> rhi/rhi.ts',
  'core/host-draw.ts -> rhi/webgpu.ts',
  'core/host-draw.ts -> runtime/gl.ts',
  'core/host-draw.ts -> runtime/program.ts',
  'core/host-draw.ts -> runtime/resources.ts',
  'core/host-draw.ts -> runtime/runtime.ts',
  'core/host-entry-program.ts -> rhi/cpu-program.ts',
  'core/host-entry-program.ts -> rhi/cpu.ts',
  'core/host-entry-program.ts -> rhi/rhi.ts',
  'core/host-entry-program.ts -> runtime/gl.ts',
  'core/host-entry-program.ts -> runtime/program.ts',
  'core/host-entry-program.ts -> runtime/runtime.ts',
  'core/host-runtime.ts -> runtime/host-types.ts',
  'core/host-runtime.ts -> runtime/resource.ts',
  'core/host-runtime.ts -> runtime/resources.ts',
  'core/spec-conformance/coredef-witness.ts -> compiler/ts/source-file.ts',
  'core/spec-conformance/coredef-witness.ts -> language-service/host.ts',
  'core/spec-conformance/coredef-witness.ts -> language-service/service.ts',
  'core/testing/both-halves.ts -> compiler/ts/compile.ts',
  'core/testing/both-halves.ts -> language-service/service.ts',
  'core/testing/cpu-program.ts -> compiler/ts/compile.ts',
  'core/testing/cpu-program.ts -> rhi/cpu-program.ts',
  'core/testing/fuse-chain.ts -> compiler/ts/compile.ts',
  'core/testing/fuse-chain.ts -> compiler/ts/context.ts',
  'core/testing/fuse-chain.ts -> compiler/ts/host-face.ts',
  'core/testing/fuse-chain.ts -> compiler/ts/kernel-loops.ts',
];

const layerOf = (path: string): string => path.split('/')[0]!;

export function forbiddenImports(path: string, text: string): string[] {
  const from = layerOf(path);
  const allowed = MAY_IMPORT[from];
  if (allowed === undefined) return [];
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false);
  const found = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (specifier === undefined || !ts.isStringLiteral(specifier)) continue;
    if (!specifier.text.startsWith('.')) continue;
    const target = join(dirname(path), specifier.text).split(sep).join('/').replace(/\.js$/, '.ts');
    const to = layerOf(target);
    if (to === from || target.startsWith('..') || !target.includes('/')) continue;
    if (!allowed.includes(to)) found.add(`${path} -> ${target}`);
  }
  return [...found];
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('a directory of src/ imports only the layers below it', () => {
  const found = sourceFiles(SRC)
    .map((path) => relative(SRC, path).split(sep).join('/'))
    .flatMap((path) => forbiddenImports(path, readFileSync(join(SRC, path), 'utf8')))
    .sort();

  it('no source file gains an import against the layer order', () => {
    const added = found.filter((edge) => !KNOWN.includes(edge));
    expect(
      added,
      'Each import goes against MAY_IMPORT of src/layer-policy.test.ts: core imports no ' +
        'other directory, rhi and compiler import core, runtime imports core and rhi, ' +
        'language-service imports core and compiler. Move the code that both sides need ' +
        'into the lower layer, or move this file into the layer its imports belong to. ' +
        'Do not add the import to KNOWN.',
    ).toEqual([]);
  });

  it('KNOWN lists no import that is gone', () => {
    const gone = KNOWN.filter((edge) => !found.includes(edge));
    expect(gone, 'Remove each of these lines from KNOWN: the list only shrinks.').toEqual([]);
  });

  it('sees an import against the order, and spares one along it', () => {
    const up = "import { compile } from '../compiler/ts/compile.js';";
    const down = "import type { Module } from '../core/ir/nodes.js';";
    expect(forbiddenImports('core/x.ts', up)).toEqual(['core/x.ts -> compiler/ts/compile.ts']);
    expect(forbiddenImports('compiler/x.ts', down)).toEqual([]);
    expect(forbiddenImports('index.ts', up)).toEqual([]);
  });
});
