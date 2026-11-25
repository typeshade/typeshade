import { posix, relative, sep } from 'node:path';
import ts from 'typescript';
import type { ShapeContext } from './types.js';

export interface SkipRule {
  name: string;
  reason: string;
  matches(rel: string): boolean;
}

const segments = (rel: string): string[] => rel.split('/').slice(0, -1);

export const SKIP_RULES: readonly SkipRule[] = [
  {
    name: 'test files',
    reason: 'a *.test.ts file is a check of the code, not code of the product',
    matches: (rel) => rel.endsWith('.test.ts'),
  },
  {
    name: 'testing directories',
    reason: 'a testing/ directory of src holds helpers that only tests load',
    matches: (rel) => segments(rel).includes('testing'),
  },
  {
    name: 'api directory',
    reason: 'src/__api__/ holds the baked API documents, not code',
    matches: (rel) => rel.startsWith('src/__api__/'),
  },
  {
    name: 'fixtures directories',
    reason: 'a fixtures/ directory holds inputs of tests',
    matches: (rel) => segments(rel).some((name) => name === 'fixtures' || name === 'fixture'),
  },
  {
    name: 'generated files',
    reason: 'a *.generated.ts file is written by a bake script (bun run bake:libm)',
    matches: (rel) => rel.endsWith('.generated.ts'),
  },
  {
    name: 'shade sources',
    reason: 'a *.shade.ts file is "use typeshade" source, not TypeScript of the compiler',
    matches: (rel) => rel.endsWith('.shade.ts'),
  },
];

export interface ContextOptions {
  root: string;
  files?: readonly string[];
}

const VIRTUAL_ROOT = '/virtual';

const toPosix = (path: string): string => path.split(sep).join('/');

function repoCompilerOptions(root: string): ts.CompilerOptions {
  const path = posix.join(root, 'tsconfig.json');
  const read = ts.readConfigFile(path, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(read.config ?? {}, ts.sys, root);
  return {
    ...parsed.options,
    noEmit: true,
    composite: false,
    incremental: false,
    declaration: false,
    declarationMap: false,
    sourceMap: false,
    tsBuildInfoFile: undefined,
  };
}

const MEMORY_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  noEmit: true,
  noLib: true,
  types: [],
};

function memoryHost(sources: ReadonlyMap<string, string>): ts.CompilerHost {
  const hasDirectory = (directory: string): boolean =>
    [...sources.keys()].some((path) => path.startsWith(`${directory}/`));
  return {
    fileExists: (path) => sources.has(path),
    readFile: (path) => sources.get(path),
    getSourceFile: (path, language) => {
      const text = sources.get(path);
      return text === undefined ? undefined : ts.createSourceFile(path, text, language, true);
    },
    getDefaultLibFileName: () => `${VIRTUAL_ROOT}/lib.d.ts`,
    writeFile: () => {},
    getCurrentDirectory: () => VIRTUAL_ROOT,
    getDirectories: () => [],
    directoryExists: hasDirectory,
    getCanonicalFileName: (path) => path,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  };
}

function assemble(
  root: string,
  program: ts.Program,
  only: readonly string[] | undefined,
): ShapeContext {
  const rel = (sf: ts.SourceFile): string =>
    sf.fileName.startsWith(`${root}/`) ? sf.fileName.slice(root.length + 1) : sf.fileName;
  const all = program
    .getSourceFiles()
    .filter((sf) => !sf.isDeclarationFile && rel(sf).startsWith('src/'));
  const skipped: Record<string, number> = Object.fromEntries(
    SKIP_RULES.map((rule) => [rule.name, 0]),
  );
  const kept = all.filter((sf) => {
    const rule = SKIP_RULES.find((candidate) => candidate.matches(rel(sf)));
    if (rule === undefined) return true;
    skipped[rule.name] = (skipped[rule.name] ?? 0) + 1;
    return false;
  });
  const wanted = only === undefined ? undefined : new Set(only);
  return {
    root,
    program,
    checker: program.getTypeChecker(),
    analysed: wanted === undefined ? kept : kept.filter((sf) => wanted.has(rel(sf))),
    all,
    rel,
    skipped,
  };
}

export function createContext(options: ContextOptions): ShapeContext {
  const root = toPosix(options.root);
  const names = ts.sys.readDirectory(posix.join(root, 'src'), ['.ts']);
  const program = ts.createProgram({
    rootNames: names,
    options: repoCompilerOptions(root),
  });
  return assemble(root, program, options.files);
}

export function createContextFromSources(
  sources: Record<string, string>,
  files?: readonly string[],
): ShapeContext {
  const entries = Object.entries(sources).map(
    ([path, text]) => [posix.join(VIRTUAL_ROOT, path), text] as const,
  );
  const map = new Map(entries);
  const host = memoryHost(map);
  const program = ts.createProgram({
    rootNames: [...map.keys()],
    options: MEMORY_OPTIONS,
    host,
  });
  return assemble(VIRTUAL_ROOT, program, files);
}

export const relativeToRoot = (root: string, path: string): string =>
  toPosix(relative(root, posix.resolve(root, toPosix(path))));
