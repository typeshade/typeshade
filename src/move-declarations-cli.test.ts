import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMove } from '../scripts/move-declarations/run.js';
import { runCli } from '../scripts/move-purity.js';

let root = '';
let output: string[] = [];
let errors: string[] = [];

const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });

const write = (files: Record<string, string>): void => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
};

const commit = (files: Record<string, string>, message: string): void => {
  write(files);
  git('add', '-A');
  git('commit', '-q', '-m', message);
};

const OPERATIONS = `import { helper } from './lib.js';

export function one(x: number): number {
  return helper(x) + 1;
}

export function two(x: number): number {
  return one(x) * 2;
}

export function stay(): number {
  return 3;
}
`;

const SPLIT_ARGS = ['--from', 'src/a.ts', '--to', 'src/a/ops.ts', '--move', 'one,two'];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'move-declarations-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'check@example.com');
  git('config', 'user.name', 'Check');
  git('config', 'commit.gpgsign', 'false');
  commit(
    {
      '.prettierrc.json': readFileSync(join(process.cwd(), '.prettierrc.json'), 'utf8'),
      'src/a.ts': OPERATIONS,
      'src/lib.ts': `export const helper = (x: number): number => x;\n`,
    },
    'Base',
  );
  output = [];
  errors = [];
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
    output.push(String(line));
  });
  vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
    errors.push(String(line));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe('the move-declarations command line (docs/structure-refactoring-plan.md, S0 item b)', () => {
  it('writes nothing on a dry run, and prints the same plan each time', async () => {
    expect(await runMove([...SPLIT_ARGS, '--dry-run'], root)).toBe(0);
    const first = output.join('\n');
    expect(git('status', '--porcelain')).toBe('');
    expect(existsSync(join(root, 'src/a'))).toBe(false);
    output = [];
    expect(await runMove([...SPLIT_ARGS, '--dry-run'], root)).toBe(0);
    expect(output.join('\n')).toBe(first);
    expect(first).toContain('Move plan: src/a.ts -> src/a/ops.ts');
    expect(first).toContain('Move purity: pure.');
  });

  it('writes both files and leaves a range that the checker accepts', async () => {
    expect(await runMove(SPLIT_ARGS, root)).toBe(0);
    expect(readFileSync(join(root, 'src/a/ops.ts'), 'utf8')).toContain('export function two(');
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toContain(
      `export { one, two } from './a/ops.js';`,
    );
    expect(output.join('\n')).toContain('Move: pure');
    git('add', '-A');
    git('commit', '-q', '-m', 'Move one and two\n\nMove: pure');
    output = [];
    expect(runCli(['--base', 'HEAD~1', '--head', 'HEAD', '--require'], root)).toBe(0);
  });

  it('prints the plan as JSON', async () => {
    expect(await runMove([...SPLIT_ARGS, '--dry-run', '--json'], root)).toBe(0);
    const plan = JSON.parse(output.join('\n')) as { pure: boolean; moved: { names: string[] }[] };
    expect(plan.pure).toBe(true);
    expect(plan.moved.map((unit) => unit.names[0])).toEqual(['one', 'two']);
  });

  it('refuses with a reason, exits 1 and writes nothing', async () => {
    const args = ['--from', 'src/a.ts', '--to', 'src/a/ops.ts', '--move', 'missing'];
    expect(await runMove(args, root)).toBe(1);
    expect(errors.join('\n')).toContain('Refused: name not found');
    expect(git('status', '--porcelain')).toBe('');
  });

  it('refuses a source with uncommitted changes', async () => {
    write({ 'src/a.ts': `${OPERATIONS}\nexport const EXTRA = 1;\n` });
    expect(await runMove(SPLIT_ARGS, root)).toBe(1);
    expect(errors.join('\n')).toContain('uncommitted changes');
  });

  it('reports a bad command line with exit 2', async () => {
    expect(await runMove(['--from', 'src/a.ts'], root)).toBe(2);
    expect(errors.join('\n')).toContain('Usage: bun scripts/move-declarations.ts');
    expect(await runMove(['--bogus'], root)).toBe(2);
  });
});

const STUBS: Record<string, string> = {
  'src/core/ir/index.ts': `export type Expr = any;\nexport type FuncDecl = any;\nexport type ModuleDecl = any;\nexport type ShaderType = any;\nexport type Stmt = any;\n`,
  'src/core/ir/types.ts': `export const typeKey = (_type: unknown): string => '';\n`,
  'src/core/passes/effects.ts': `export const fnWrites = (_f: unknown): Set<string> => new Set();\n`,
  'src/core/ir/visit.ts': `export const eachExpr = (_e: unknown, _f: (x: any) => void): void => undefined;\n`,
  'src/core/passes/opt/ir-transform.ts': `export const mapExpr = (e: any, _f: (x: any) => any): any => e;\n`,
  'src/core/passes/opt/expr-utils.ts': `export const bodyHasRaw = (_b: unknown): boolean => false;\nexport const collectLocals = (_b: unknown): Set<string> => new Set();\nexport const collectMutatedRoots = (_b: unknown): Set<string> => new Set();\n`,
  'src/core/passes/opt/sroa/blocks.ts': `export const eachBlockStmt = (_b: unknown, _f: (s: any) => void): void => undefined;\nexport const eachBodyExpr = (_b: unknown, _f: (e: any) => void): void => undefined;\nexport const rewriteBlocks = (b: any, _f: (x: any) => any): any => b;\n`,
};

function diagnosticsOf(files: readonly string[]): number {
  const program = ts.createProgram(
    files.map((file) => join(root, file)),
    {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: [],
      allowImportingTsExtensions: true,
    },
  );
  return ts.getPreEmitDiagnostics(program).length;
}

describe('the move-declarations command line on a real file of src/', () => {
  it('splits src/core/passes/opt/sroa.ts, stays pure and adds no program diagnostic', async () => {
    const sroa = 'src/core/passes/opt/sroa.ts';
    commit({ ...STUBS, [sroa]: readFileSync(join(process.cwd(), sroa), 'utf8') }, 'Real file');
    const before = diagnosticsOf([sroa]);
    const args = [
      '--from',
      sroa,
      '--to',
      'src/core/passes/opt/sroa/shape.ts',
      '--move',
      'Split,splitOf,MAX_ELEMENTS',
    ];
    expect(await runMove(args, root)).toBe(0);
    const target = 'src/core/passes/opt/sroa/shape.ts';
    expect(readFileSync(join(root, target), 'utf8')).toContain('export interface Split');
    expect(readFileSync(join(root, sroa), 'utf8')).toContain(`from './sroa/shape.js'`);
    expect(diagnosticsOf([sroa, target])).toBeLessThanOrEqual(before);
    git('add', '-A');
    git('commit', '-q', '-m', 'Move\n\nMove: pure');
    output = [];
    expect(runCli(['--base', 'HEAD~1', '--head', 'HEAD', '--require'], root)).toBe(0);
  });
});
