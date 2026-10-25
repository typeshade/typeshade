// ═══ The graph session, the graph resolver and the choice of resolver are proven on a fake server ═══
//
// `scripts/scope/resolve.ts` talks to codebase-memory-mcp over stdio. The tests here do not run
// the real binary. A fake server (`scripts/scope/__fixtures__/fake-mcp.mjs`) answers the same
// JSON-RPC subset from the recorded fixtures, in five modes: ok, stale, noproject, stall, error.
// The tests pin the session's handshake, timeout and error answers, the graph resolver's refusals
// (a stale index, a missing project) and its answer, the choice between the graph and git
// resolvers, and the rule that keeps only tracked paths. Each repository is a throwaway one.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GraphSession,
  chooseResolver,
  openGraphResolver,
  parseListProjects,
  resolvePaths,
} from '../scripts/scope/resolve.js';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Resolver } from '../scripts/scope/resolve.js';

const FAKE_PATH = join(__dirname, '..', 'scripts', 'scope', '__fixtures__', 'fake-mcp.mjs');
const RECORDED_SEARCH = join(
  __dirname,
  '..',
  'scripts',
  'scope',
  '__fixtures__',
  'graph-search.json',
);
const TEST_TIMEOUT = 20_000;

// Runs git in a throwaway repository, with a fixed identity and no signing.
function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'scope test',
      GIT_AUTHOR_EMAIL: 'scope@example.invalid',
      GIT_COMMITTER_NAME: 'scope test',
      GIT_COMMITTER_EMAIL: 'scope@example.invalid',
    },
  }).trim();
}

// A repository with two commits, so that HEAD~1 exists. Its tree is clean at HEAD.
function makeRepo(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  git(dir, ['init', '-q']);
  git(dir, ['checkout', '-q', '-b', 'main']);
  writeFileSync(join(dir, 'a.ts'), 'export function lowerFill() {}\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'first']);
  writeFileSync(join(dir, 'a.ts'), 'export function lowerFill() { return 1; }\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'second']);
  return dir;
}

// The project name the graph resolver derives from a repository: the absolute top level with `/`
// replaced by `-`, and the leading `-` dropped.
function projectNameOf(dir: string): string {
  // The resolver derives this from Git's root spelling, which has forward slashes
  // on Windows too. Native backslashes would also corrupt the fixture's JSON text.
  return git(dir, ['rev-parse', '--show-toplevel']).replace(/\//g, '-').replace(/^-/, '');
}

// The fake server opened in one mode. The arguments are the ones openGraphResolver passes.
function fakeOpener(mode: string) {
  return (_command?: string, _args?: readonly string[], timeoutMs?: number) =>
    GraphSession.open(process.execPath, [FAKE_PATH, mode], timeoutMs);
}

describe('GraphSession with the fake server', () => {
  const savedProject = process.env.FAKE_PROJECT;

  beforeAll(() => {
    delete process.env.FAKE_PROJECT;
  });

  afterAll(() => {
    if (savedProject === undefined) delete process.env.FAKE_PROJECT;
    else process.env.FAKE_PROJECT = savedProject;
  });

  it(
    'opens in ok mode, answers search_graph with the recorded text, and closes',
    async () => {
      const session = await GraphSession.open(process.execPath, [FAKE_PATH, 'ok']);
      const answer = await session.call('search_graph', {
        project: 'home-user-typeshade-scope',
        name_pattern: '^lowerFill$',
        format: 'json',
      });
      expect(answer.isError).toBe(false);
      expect(answer.text).toBe(readFileSync(RECORDED_SEARCH, 'utf8'));
      await expect(session.close()).resolves.toBeUndefined();
    },
    TEST_TIMEOUT,
  );

  it(
    'rejects within timeoutMs when the server never answers initialize',
    async () => {
      const started = Date.now();
      await expect(
        GraphSession.open(process.execPath, [FAKE_PATH, 'stall'], 500),
      ).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(5_000);
    },
    TEST_TIMEOUT,
  );

  it(
    'gives isError true when every tools/call fails',
    async () => {
      const session = await GraphSession.open(process.execPath, [FAKE_PATH, 'error']);
      try {
        const answer = await session.call('search_graph', { name_pattern: '^x$' });
        expect(answer.isError).toBe(true);
      } finally {
        await session.close();
      }
    },
    TEST_TIMEOUT,
  );
});

describe('openGraphResolver with the fake server', () => {
  let dir: string;
  const savedProject = process.env.FAKE_PROJECT;

  beforeAll(() => {
    dir = makeRepo('scope-resolve-graph-');
    process.env.FAKE_PROJECT = projectNameOf(dir);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    if (savedProject === undefined) delete process.env.FAKE_PROJECT;
    else process.env.FAKE_PROJECT = savedProject;
  });

  it(
    'refuses a graph indexed before HEAD: resolver null, why names the stale index',
    async () => {
      const { resolver, why } = await openGraphResolver(dir, fakeOpener('stale'));
      expect(resolver).toBeNull();
      expect(why).toContain('before HEAD');
    },
    TEST_TIMEOUT,
  );

  it(
    'refuses a graph with no project of this repository: why names the missing project',
    async () => {
      const { resolver, why } = await openGraphResolver(dir, fakeOpener('noproject'));
      expect(resolver).toBeNull();
      expect(why).toContain('has no project');
    },
    TEST_TIMEOUT,
  );

  it(
    'returns a graph resolver that finds the recorded hit for lowerFill',
    async () => {
      const { resolver, why } = await openGraphResolver(dir, fakeOpener('ok'));
      expect(why).toBe('');
      expect(resolver).not.toBeNull();
      const graph = resolver as Resolver;
      expect(graph.kind).toBe('graph');
      const hits = await graph.find('lowerFill');
      expect(hits).toMatchObject([
        {
          name: 'lowerFill',
          label: 'Function',
          file: 'src/compiler/ts/lower/expression-array.ts',
          startLine: 374,
          endLine: 421,
        },
      ]);
      await graph.close();
    },
    TEST_TIMEOUT,
  );
});

describe('chooseResolver with an injected opener', () => {
  let dir: string;

  beforeAll(() => {
    dir = makeRepo('scope-resolve-choose-');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function stubGraph(): Resolver {
    return {
      kind: 'graph',
      note: 'stub graph resolver',
      find: async () => [],
      neighbours: async () => ({ callers: [], callees: [] }),
      testsOf: async () => [],
      close: async () => {},
    };
  }

  it(
    'picks the graph resolver the opener returns at HEAD on a clean tree',
    async () => {
      const graph = stubGraph();
      let calls = 0;
      const opener = async () => {
        calls += 1;
        return { resolver: graph, why: '' };
      };
      const picked = await chooseResolver(dir, 'HEAD', opener);
      expect(calls).toBe(1);
      expect(picked).toBe(graph);
      await picked.close();
    },
    TEST_TIMEOUT,
  );

  it(
    'picks git and never calls the opener when the working tree has an untracked file',
    async () => {
      const untracked = join(dir, 'untracked.ts');
      writeFileSync(untracked, 'export const x = 1;\n');
      try {
        let calls = 0;
        const opener = async () => {
          calls += 1;
          return { resolver: stubGraph(), why: '' };
        };
        const picked = await chooseResolver(dir, 'HEAD', opener);
        expect(calls).toBe(0);
        expect(picked.kind).toBe('git');
        expect(picked.note).toContain('the working tree has changes');
        await picked.close();
      } finally {
        rmSync(untracked, { force: true });
      }
    },
    TEST_TIMEOUT,
  );

  it(
    'picks git at HEAD~1 and never calls the opener',
    async () => {
      let calls = 0;
      const opener = async () => {
        calls += 1;
        return { resolver: stubGraph(), why: '' };
      };
      const picked = await chooseResolver(dir, 'HEAD~1', opener);
      expect(calls).toBe(0);
      expect(picked.kind).toBe('git');
      expect(picked.note).toContain('is not HEAD');
      await picked.close();
    },
    TEST_TIMEOUT,
  );

  it(
    'picks git with a note ending in the reason when the opener returns no resolver',
    async () => {
      const opener = async () => ({ resolver: null, why: 'x' });
      const picked = await chooseResolver(dir, 'HEAD', opener);
      expect(picked.kind).toBe('git');
      expect(picked.note).toMatch(/the graph did not run: x$/);
      await picked.close();
    },
    TEST_TIMEOUT,
  );
});

describe('resolvePaths', () => {
  it('keeps a seed path that is tracked and drops one that is not', () => {
    expect(resolvePaths(['src/a.ts', 'src/nope.ts'], ['src/a.ts', 'src/b.ts'])).toEqual([
      'src/a.ts',
    ]);
  });

  it('drops an untracked seed path', () => {
    expect(resolvePaths(['src/nope.ts'], ['src/a.ts'])).toEqual([]);
  });

  it('drops a bare name that matches 6 tracked files, as too common', () => {
    const tracked = ['a', 'b', 'c', 'd', 'e', 'f'].map((d) => `${d}/util.ts`);
    expect(resolvePaths(['util.ts'], tracked)).toEqual([]);
  });

  it('keeps a bare name that matches 2 tracked files as both paths', () => {
    const tracked = ['x/util.ts', 'y/util.ts', 'z/other.ts'];
    const resolved = resolvePaths(['util.ts'], tracked);
    expect([...resolved].sort()).toEqual(['x/util.ts', 'y/util.ts']);
  });
});

describe('openGraphResolver finds the project by its root path', () => {
  let dir: string;
  const savedProject = process.env.FAKE_PROJECT;
  const savedRoot = process.env.FAKE_ROOT;

  beforeAll(() => {
    dir = makeRepo('scope-resolve-root-');
    // A name the string rule (projectNameOf) would not produce for this repository.
    process.env.FAKE_PROJECT = 'graph-project-named-by-hand';
    process.env.FAKE_ROOT = dir;
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    if (savedProject === undefined) delete process.env.FAKE_PROJECT;
    else process.env.FAKE_PROJECT = savedProject;
    if (savedRoot === undefined) delete process.env.FAKE_ROOT;
    else process.env.FAKE_ROOT = savedRoot;
  });

  it(
    'finds the project whose root path is the top level, whatever its name',
    async () => {
      const { resolver, why } = await openGraphResolver(dir, fakeOpener('ok'));
      expect(why).toBe('');
      expect(resolver).not.toBeNull();
      await (resolver as Resolver).close();
    },
    TEST_TIMEOUT,
  );
});

describe('parseListProjects reads each project line', () => {
  it('reads a quoted root path with a space, and strips the quotes', () => {
    const text =
      'projects: 1 (cols: name root_path branch)\n' + '  alpha "/tmp/with space/alpha" main\n';
    expect(parseListProjects(text)).toEqual([{ name: 'alpha', rootPath: '/tmp/with space/alpha' }]);
  });
});

// The pid of a session's server. GraphSession keeps its child private, so the test reads it here.
function pidOf(session: GraphSession): number {
  const child = (session as unknown as { child: ChildProcessWithoutNullStreams }).child;
  const pid = child.pid;
  if (pid === undefined) throw new Error('the fake server has no pid');
  return pid;
}

// True while a process with this pid exists. process.kill with signal 0 sends nothing.
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// True while a process with this pid runs. A killed process that its parent has not reaped is a
// zombie: it has exited, yet kill(pid, 0) still succeeds on it. The zombies of a server's child are
// reaped by the init process, which in some containers (PID 1 here) does not reap them, so a
// zombie counts as gone. Without /proc, kill(pid, 0) is the only test there is.
function running(pid: number): boolean {
  if (!alive(pid)) return false;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] !== 'Z';
  } catch {
    return true;
  }
}

describe('GraphSession close ends a server that ignores the end of stdin', () => {
  it(
    'resolves within 4500 ms and the server process is gone (deaf)',
    async () => {
      const session = await GraphSession.open(process.execPath, [FAKE_PATH, 'deaf']);
      const pid = pidOf(session);
      const started = Date.now();
      await session.close();
      expect(Date.now() - started).toBeLessThan(4500);
      expect(alive(pid)).toBe(false);
    },
    TEST_TIMEOUT,
  );

  it(
    'also kills the child process the server spawned (deaf-child)',
    async () => {
      const pidDir = realpathSync(mkdtempSync(join(tmpdir(), 'scope-resolve-pid-')));
      const pidFile = join(pidDir, 'child.pid');
      const savedPidFile = process.env.FAKE_PIDFILE;
      process.env.FAKE_PIDFILE = pidFile;
      try {
        const session = await GraphSession.open(process.execPath, [FAKE_PATH, 'deaf-child']);
        const childPid = Number(readFileSync(pidFile, 'utf8'));
        expect(Number.isInteger(childPid)).toBe(true);
        await session.close();
        expect(running(childPid)).toBe(false);
      } finally {
        if (savedPidFile === undefined) delete process.env.FAKE_PIDFILE;
        else process.env.FAKE_PIDFILE = savedPidFile;
        rmSync(pidDir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT,
  );
});
