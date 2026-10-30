// A document-input audit is valid only for the code and dependency baseline that was read.
// Unknown readers and stale audits retain the existing document-test scope.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { classify, importsOf, resolveRelative } from './doc-tests.js';

export interface DocumentContract {
  test: string;
  inputs: string[];
  sources?: string[];
  fingerprint: string;
}

export interface DocumentSelection {
  files: string[];
  total: number;
  scoped: string[];
  fallback: string[];
}

// Changes to the selection policy or shared execution inputs invalidate every audit.
// Keep digest storage out of this list and out of static imports to avoid a circular hash.
export const CONTROL_FILES = [
  'package.json',
  'bun.lock',
  '.node-version',
  '.bun-version',
  'tsconfig.json',
  'tsconfig.base.json',
  'tsconfig.tests.json',
  'vitest.config.ts',
  '.github/workflows/ci.yml',
  'scripts/doc-tests.ts',
  'scripts/affected-tests.ts',
  'scripts/doc-test-selection.ts',
  'src/core/testing/yield-between-tests.ts',
] as const;

const slash = (path: string): string => path.replaceAll('\\', '/');
const safePath = (path: unknown): path is string =>
  typeof path === 'string' &&
  path.length > 0 &&
  !isAbsolute(path) &&
  !/[\\:*?\[\]{}\0]/.test(path) &&
  path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
const validInput = (pattern: unknown): pattern is string =>
  typeof pattern === 'string' &&
  (pattern.endsWith('/*.md')
    ? safePath(pattern.slice(0, -5))
    : safePath(pattern) && pattern.endsWith('.md'));

/** Hash the mapping, local import closures and explicitly audited file inputs. */
export function fingerprint(
  root: string,
  test: string,
  inputs: string[],
  sources: string[] = [],
): string {
  return digest(root, test, inputs, sources, new Map());
}

type AuditedSource = { content: string; dependencies: string[] };

function digest(
  root: string,
  test: string,
  inputs: string[],
  sources: string[],
  cache: Map<string, AuditedSource>,
): string {
  if (
    !safePath(test) ||
    !Array.isArray(inputs) ||
    !inputs.length ||
    !inputs.every(validInput) ||
    !Array.isArray(sources) ||
    !sources.every(safePath)
  )
    throw new Error('Invalid document-input contract.');
  root = resolve(root);
  const files = new Map<string, string>();
  const visit = (path: string): void => {
    const file = slash(relative(root, path));
    if (!safePath(file)) throw new Error(`Input outside repository: ${path}`);
    if (files.has(file)) return;
    let source = cache.get(path);
    if (!source) {
      let at = root;
      for (const part of file.split('/')) {
        at = join(at, part);
        if (lstatSync(at).isSymbolicLink()) throw new Error(`Symlink in audited input: ${file}`);
      }
      if (!lstatSync(path).isFile()) throw new Error(`Input is not a regular file: ${file}`);
      source = { content: readFileSync(path, 'utf8').replace(/\r\n/g, '\n'), dependencies: [] };
      if (/\.[cm]?[jt]s$/.test(file)) {
        for (const specifier of importsOf(path, false).specifiers) {
          if (!specifier.startsWith('.')) continue;
          const spec = specifier.split('?')[0]!;
          const next = resolveRelative(path, spec);
          if (!next) throw new Error(`Unresolved audited import: ${file} -> ${specifier}`);
          const requested = resolve(dirname(path), spec);
          if (requested !== next && existsSync(requested))
            throw new Error(`Ambiguous audited import: ${file} -> ${specifier}`);
          source.dependencies.push(next);
        }
      }
      cache.set(path, source);
    }
    files.set(file, source.content);
    for (const next of source.dependencies) visit(next);
  };
  for (const file of [test, ...CONTROL_FILES, ...sources]) visit(resolve(root, file));
  return createHash('sha256')
    .update(
      JSON.stringify({
        schema: 1,
        test,
        inputs: [...inputs].sort(),
        sources: [...sources].sort(),
        files: [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      }),
    )
    .digest('hex');
}

function matches(pattern: string, file: string): boolean {
  if (!pattern.endsWith('/*.md')) return pattern === file;
  const prefix = pattern.slice(0, -4);
  const tail = file.startsWith(prefix) ? file.slice(prefix.length) : '';
  return tail.length > 0 && !tail.includes('/') && tail.endsWith('.md');
}

// A symlink can make a Markdown file depend on a path the declared pattern cannot name.
function regularInputs(root: string, patterns: string[]): boolean {
  try {
    for (const pattern of patterns) {
      const wildcard = pattern.endsWith('/*.md');
      const path = wildcard ? pattern.slice(0, -5) : pattern;
      let at = root;
      for (const part of path.split('/')) {
        at = join(at, part);
        try {
          if (lstatSync(at).isSymbolicLink()) return false;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      if (wildcard && existsSync(at)) {
        if (
          readdirSync(at, { withFileTypes: true }).some(
            (entry) => entry.name.endsWith('.md') && !entry.isFile(),
          )
        )
          return false;
      }
      if (!wildcard && existsSync(at) && !lstatSync(at).isFile()) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function validContract(value: DocumentContract): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    safePath(value.test) &&
    Array.isArray(value.inputs) &&
    value.inputs.length > 0 &&
    value.inputs.every(validInput) &&
    (value.sources === undefined ||
      (Array.isArray(value.sources) && value.sources.every(safePath))) &&
    typeof value.fingerprint === 'string' &&
    /^[a-f0-9]{64}$/.test(value.fingerprint)
  );
}

/** Narrow only audited readers; never interpret an absent or invalid registry as no tests. */
export function selectDocuments(
  root: string,
  changed: string[],
  contracts?: DocumentContract[],
): DocumentSelection {
  root = resolve(root);
  const classified = classify(root);
  let candidates = classified.filter((test) => test.reason !== undefined).map((test) => test.file);
  const result: DocumentSelection = {
    files: [],
    total: candidates.length,
    scoped: [],
    fallback: [],
  };
  const keepAll = (): DocumentSelection => ({ ...result, files: candidates, fallback: candidates });
  try {
    // Deliberately not a static import: the stored digests must not hash themselves.
    contracts ??= JSON.parse(
      readFileSync(join(root, 'scripts/doc-test-inputs.json'), 'utf8'),
    ) as DocumentContract[];
    if (
      !Array.isArray(contracts) ||
      !contracts.every(validContract) ||
      new Set(contracts.map((entry) => entry.test)).size !== contracts.length
    )
      return keepAll();
  } catch {
    return keepAll();
  }
  // A changed reader can stop matching the basic classifier (for example, by changing
  // how it loads fs). A registered test still needs its stale-audit check in that case.
  const inventory = new Set(classified.map((test) => test.file));
  candidates = [
    ...new Set([
      ...candidates,
      ...contracts
        .filter((contract) => inventory.has(contract.test))
        .map((contract) => contract.test),
    ]),
  ].sort();
  result.total = candidates.length;
  if (process.env.TYPESHADE_DOCS_ROOT !== undefined || process.env.NODE_OPTIONS) return keepAll();
  const indexed = new Map(contracts.map((contract) => [contract.test, contract]));
  // Share parsing only inside this synchronous selection; the next call reads fresh files.
  const cache = new Map<string, AuditedSource>();
  for (const test of candidates) {
    const contract = indexed.get(test);
    let audited = false;
    try {
      audited =
        contract !== undefined &&
        regularInputs(root, contract.inputs) &&
        contract.fingerprint === digest(root, test, contract.inputs, contract.sources ?? [], cache);
    } catch {
      /* Missing or changed input: keep the reader. */
    }
    if (!audited || !contract) {
      result.files.push(test);
      result.fallback.push(test);
    } else {
      result.scoped.push(test);
      if (changed.some((file) => contract.inputs.some((pattern) => matches(pattern, file))))
        result.files.push(test);
    }
  }
  return result;
}
