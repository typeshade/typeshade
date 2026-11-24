import { dirname } from 'node:path/posix';
import ts from 'typescript';
import { packageEntries } from './package-entries.js';

export interface Side {
  readonly root: string;
  readonly texts: ReadonlyMap<string, string>;
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  readonly options: ts.CompilerOptions;
  readonly host: ts.CompilerHost;
  sourceOf(path: string): ts.SourceFile | undefined;
  pathOf(fileName: string): string | undefined;
}

const PROGRAM_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
  noLib: true,
  types: [],
  skipLibCheck: true,
  strict: true,
  allowImportingTsExtensions: true,
};

const onDisk = (name: string): boolean => name.includes('/node_modules/');

function directoriesOf(files: Iterable<string>, root: string): Set<string> {
  const directories = new Set<string>();
  for (const file of files) {
    let directory = dirname(file);
    while (!directories.has(directory) && directory.length >= root.length) {
      directories.add(directory);
      directory = dirname(directory);
    }
  }
  return directories;
}

export function createSide(
  root: string,
  texts: ReadonlyMap<string, string>,
  baseOptions: ts.CompilerOptions = PROGRAM_OPTIONS,
): Side {
  const entries = packageEntries(texts);
  const options: ts.CompilerOptions = {
    ...baseOptions,
    baseUrl: root,
    paths: Object.fromEntries([...entries].map(([specifier, file]) => [specifier, [file]])),
  };
  const files = new Map<string, string>();
  for (const [path, text] of texts) if (path.endsWith('.ts')) files.set(`${root}/${path}`, text);
  const directories = directoriesOf(files.keys(), root);
  const read = (name: string): string | undefined =>
    files.get(name) ?? (onDisk(name) ? ts.sys.readFile(name) : undefined);
  const host: ts.CompilerHost = {
    fileExists: (name) => files.has(name) || (onDisk(name) && ts.sys.fileExists(name)),
    readFile: read,
    directoryExists: (name) =>
      directories.has(name) || (onDisk(`${name}/`) && ts.sys.directoryExists(name)),
    getDirectories: () => [],
    realpath: (name) => (onDisk(name) ? (ts.sys.realpath?.(name) ?? name) : name),
    getSourceFile: (name, languageVersion) => {
      const text = read(name);
      return text === undefined
        ? undefined
        : ts.createSourceFile(name, text, languageVersion, true);
    },
    getDefaultLibFileName: (compilerOptions) => ts.getDefaultLibFilePath(compilerOptions),
    writeFile: () => undefined,
    getCurrentDirectory: () => root,
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  };
  const program = ts.createProgram({ rootNames: [...files.keys()], options, host });
  const prefix = `${root}/`;
  return {
    root,
    texts,
    program,
    checker: program.getTypeChecker(),
    options,
    host,
    sourceOf: (path) => program.getSourceFile(`${prefix}${path}`),
    pathOf: (fileName) =>
      fileName.startsWith(prefix) && files.has(fileName)
        ? fileName.slice(prefix.length)
        : undefined,
  };
}
