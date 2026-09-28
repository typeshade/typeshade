// Verifies: Rule 3.9 (docs/language-design.md; traced in reqs/).
//
// The one rule a specifier resolves by, for `compile()` and the language service alike
// (surface §68, proposal 0024): a relative path, or a package found in `node_modules` from the
// importing file's directory up and read through its `package.json`. Each case is a file tree the
// rule reads through a `readDocument` over it, and the reads it made are asserted where the
// order Node searches in is the point.

import { describe, expect, it } from 'vitest';
import {
  packageKey,
  packageOf,
  resolveRelativeSpecifier,
  resolveSpecifier,
  resolveSpecifierFile,
} from './specifier.js';

/** A file tree: path to text. A `package.json` is written as its object. */
type Tree = Readonly<Record<string, string | object>>;

/** `readDocument` over `tree`, recording each name it is asked for. */
const reader = (tree: Tree) => {
  const reads: string[] = [];
  const read = (fileName: string): string | undefined => {
    reads.push(fileName);
    const entry = tree[fileName];
    return entry === undefined
      ? undefined
      : typeof entry === 'string'
        ? entry
        : JSON.stringify(entry);
  };
  return { read, reads };
};

const resolve = (tree: Tree, from: string, specifier: string) =>
  resolveSpecifier(from, specifier, reader(tree).read);

const SHADE_NOISE = '/p/node_modules/shade-noise/';

describe('a relative specifier', () => {
  it.each([
    ['./noise.shade.ts', '/p/src/main.shade.ts', '/p/src/noise.shade.ts'],
    ['../lib/noise.shade.js', '/p/src/main.shade.ts', '/p/lib/noise.shade.ts'],
    ['./noise.shade', '/p/src/main.shade.ts', '/p/src/noise.shade.ts'],
    ['./lib/noise.shade.ts', 'main.shade.ts', 'lib/noise.shade.ts'],
    ['./lib.shade.ts', 'file:///p/main.shade.ts', 'file:///p/lib.shade.ts'],
  ])('%s from %s names %s, and reads nothing', (specifier, from, file) => {
    const { read, reads } = reader({});
    expect(resolveSpecifier(from, specifier, read)).toEqual({ kind: 'file', file });
    expect(resolveRelativeSpecifier(from, specifier)).toBe(file);
    expect(reads).toEqual([]);
  });
});

describe('a package with "exports"', () => {
  it('reads a string target for the name alone, and exports no subpath', () => {
    const tree = {
      [`${SHADE_NOISE}package.json`]: { name: 'shade-noise', exports: './src/index.shade.ts' },
    };
    expect(resolve(tree, '/p/src/main.shade.ts', 'shade-noise')).toEqual({
      kind: 'file',
      file: `${SHADE_NOISE}src/index.shade.ts`,
    });
    expect(resolve(tree, '/p/src/main.shade.ts', 'shade-noise/hash')).toEqual({
      kind: 'not-exported',
      name: 'shade-noise',
      subpath: './hash',
    });
  });

  it('tries typeshade, then import, then default, wherever the package wrote them', () => {
    const at = (conditions: object) => ({
      [`${SHADE_NOISE}package.json`]: { name: 'shade-noise', exports: { '.': conditions } },
    });
    const file = (conditions: object) =>
      resolveSpecifierFile('/p/main.shade.ts', 'shade-noise', reader(at(conditions)).read);
    expect(file({ typeshade: './src/index.shade.ts', default: './dist/index.js' })).toBe(
      `${SHADE_NOISE}src/index.shade.ts`,
    );
    // Node would take `default` here, the first key written; the rule takes `typeshade`.
    expect(file({ default: './dist/index.js', typeshade: './src/index.shade.ts' })).toBe(
      `${SHADE_NOISE}src/index.shade.ts`,
    );
    expect(file({ default: './dist/index.js', import: './dist/index.mjs' })).toBe(
      `${SHADE_NOISE}dist/index.mjs`,
    );
    expect(file({ require: './dist/index.cjs', default: './dist/index.js' })).toBe(
      `${SHADE_NOISE}dist/index.js`,
    );
    // A condition whose own conditions match nothing falls through to the next one.
    expect(
      file({ typeshade: { worker: './src/worker.shade.ts' }, default: './src/index.shade.ts' }),
    ).toBe(`${SHADE_NOISE}src/index.shade.ts`);
    expect(file({ import: { typeshade: './src/index.shade.ts', default: './x.js' } })).toBe(
      `${SHADE_NOISE}src/index.shade.ts`,
    );
    // No condition the rule reads.
    expect(file({ require: './dist/index.cjs', node: './dist/index.js' })).toBeUndefined();
  });

  it('reads a map of conditions with no subpath key as the name alone', () => {
    const tree = {
      [`${SHADE_NOISE}package.json`]: {
        name: 'shade-noise',
        exports: { typeshade: './src/index.shade.ts', default: './dist/index.js' },
      },
    };
    expect(resolveSpecifierFile('/p/main.shade.ts', 'shade-noise', reader(tree).read)).toBe(
      `${SHADE_NOISE}src/index.shade.ts`,
    );
  });

  it('matches a * pattern, the most specific first, and a null blocks what it matches', () => {
    const tree = {
      [`${SHADE_NOISE}package.json`]: {
        name: 'shade-noise',
        version: '1.2.0',
        exports: {
          '.': { typeshade: './src/index.shade.ts', default: './dist/index.js' },
          './*': { typeshade: './src/*.shade.ts' },
          './warp/*': { typeshade: './src/warp/*.shade.ts' },
          './internal/*': null,
          './legacy': './src/old.shade.ts',
          './*.js': './dist/*.js',
        },
      },
    };
    const file = (specifier: string) =>
      resolveSpecifier('/p/src/main.shade.ts', specifier, reader(tree).read);
    expect(file('shade-noise/hash')).toEqual({
      kind: 'file',
      file: `${SHADE_NOISE}src/hash.shade.ts`,
    });
    expect(file('shade-noise/warp/domain')).toEqual({
      kind: 'file',
      file: `${SHADE_NOISE}src/warp/domain.shade.ts`,
    });
    expect(file('shade-noise/legacy')).toEqual({
      kind: 'file',
      file: `${SHADE_NOISE}src/old.shade.ts`,
    });
    // `./*.js` and `./*` both match and share a base: the longer key wins, as in Node.
    expect(file('shade-noise/extra.js')).toEqual({
      kind: 'file',
      file: `${SHADE_NOISE}dist/extra.js`,
    });
    expect(file('shade-noise/internal/seed')).toEqual({
      kind: 'not-exported',
      name: 'shade-noise',
      subpath: './internal/seed',
    });
  });

  it('never leaves the package: a target or a match with a "..", ".", empty or node_modules segment names nothing', () => {
    const tree = {
      [`${SHADE_NOISE}package.json`]: {
        name: 'shade-noise',
        exports: {
          '.': '../elsewhere/index.shade.ts',
          './up': './src/../../x.shade.ts',
          './bare': 'src/bare.shade.ts',
          './nested': './node_modules/dep/index.shade.ts',
          './x*': './src/x*.shade.ts',
        },
      },
    };
    const notExported = (specifier: string, subpath: string) =>
      expect(resolve(tree, '/p/main.shade.ts', specifier)).toEqual({
        kind: 'not-exported',
        name: 'shade-noise',
        subpath,
      });
    notExported('shade-noise', '.');
    notExported('shade-noise/up', './up');
    notExported('shade-noise/bare', './bare');
    notExported('shade-noise/nested', './nested');
    // `./x*` matches `./x/y` with `/y`, whose empty first segment would step out of `src/`.
    notExported('shade-noise/x/y', './x/y');
  });

  it('takes the first valid target of an array, and skips a null or an invalid one', () => {
    const at = (targets: unknown[]) => ({
      [`${SHADE_NOISE}package.json`]: { name: 'shade-noise', exports: { '.': targets } },
    });
    const resolution = (targets: unknown[]) =>
      resolve(at(targets), '/p/main.shade.ts', 'shade-noise');
    expect(resolution(['not-relative.js', './src/index.shade.ts'])).toEqual({
      kind: 'file',
      file: `${SHADE_NOISE}src/index.shade.ts`,
    });
    expect(resolution([null, { typeshade: './src/index.shade.ts' }])).toEqual({
      kind: 'file',
      file: `${SHADE_NOISE}src/index.shade.ts`,
    });
    expect(resolution([])).toMatchObject({ kind: 'not-exported' });
    expect(resolution([null])).toMatchObject({ kind: 'not-exported' });
    expect(resolution([{ require: './x.cjs' }])).toMatchObject({ kind: 'not-exported' });
  });

  it('refuses an "exports" that mixes subpaths and conditions, as Node does', () => {
    const tree = {
      [`${SHADE_NOISE}package.json`]: {
        name: 'shade-noise',
        exports: { '.': './src/index.shade.ts', typeshade: './src/index.shade.ts' },
      },
    };
    expect(resolve(tree, '/p/main.shade.ts', 'shade-noise')).toMatchObject({
      kind: 'not-exported',
      subpath: '.',
    });
  });
});

describe('a package with no "exports"', () => {
  const tree = {
    [`${SHADE_NOISE}package.json`]: { name: 'shade-noise', main: 'noise.shade.ts' },
  };

  it('reads a subpath by the relative rule', () => {
    expect(
      resolveSpecifierFile('/p/main.shade.ts', 'shade-noise/noise.shade.ts', reader(tree).read),
    ).toBe(`${SHADE_NOISE}noise.shade.ts`);
    expect(
      resolveSpecifierFile('/p/main.shade.ts', 'shade-noise/noise.shade.js', reader(tree).read),
    ).toBe(`${SHADE_NOISE}noise.shade.ts`);
    expect(
      resolveSpecifierFile('/p/main.shade.ts', 'shade-noise/lib/hash.shade', reader(tree).read),
    ).toBe(`${SHADE_NOISE}lib/hash.shade.ts`);
  });

  it('names nothing by the name alone, and says what its main field names', () => {
    expect(resolve(tree, '/p/main.shade.ts', 'shade-noise')).toEqual({
      kind: 'no-main',
      name: 'shade-noise',
      root: SHADE_NOISE,
      main: 'noise.shade.ts',
    });
  });
});

describe('finding a package', () => {
  it('looks from the importing file up, two directories and more, the nearest first', () => {
    const tree = {
      '/p/node_modules/shade-noise/package.json': { exports: './index.shade.ts' },
      '/p/src/node_modules/shade-noise/package.json': { exports: './near.shade.ts' },
    };
    expect(
      resolveSpecifierFile('/p/src/deep/er/main.shade.ts', 'shade-noise', reader(tree).read),
    ).toBe('/p/src/node_modules/shade-noise/near.shade.ts');
    expect(
      resolveSpecifierFile('/p/lib/deep/main.shade.ts', 'shade-noise', reader(tree).read),
    ).toBe('/p/node_modules/shade-noise/index.shade.ts');
    const { read, reads } = reader(tree);
    resolveSpecifier('/p/lib/deep/main.shade.ts', 'shade-noise', read);
    expect(reads).toEqual([
      '/p/lib/deep/node_modules/shade-noise/package.json',
      '/p/lib/node_modules/shade-noise/package.json',
      '/p/node_modules/shade-noise/package.json',
    ]);
  });

  it('finds a scoped package, and its subpath', () => {
    const tree = {
      '/p/node_modules/@shade/noise/package.json': {
        name: '@shade/noise',
        exports: { '.': './src/index.shade.ts', './*': './src/*.shade.ts' },
      },
    };
    expect(resolveSpecifierFile('/p/main.shade.ts', '@shade/noise', reader(tree).read)).toBe(
      '/p/node_modules/@shade/noise/src/index.shade.ts',
    );
    expect(resolveSpecifierFile('/p/main.shade.ts', '@shade/noise/hash', reader(tree).read)).toBe(
      '/p/node_modules/@shade/noise/src/hash.shade.ts',
    );
  });

  it('resolves a package that imports a package from its own file up, skipping node_modules itself', () => {
    const tree = {
      '/p/node_modules/shade-warp/node_modules/shade-noise/package.json': {
        exports: './nested.shade.ts',
      },
      '/p/node_modules/shade-noise/package.json': { exports: './hoisted.shade.ts' },
    };
    // Its own dependency, installed inside it.
    expect(
      resolveSpecifierFile(
        '/p/node_modules/shade-warp/src/warp.shade.ts',
        'shade-noise',
        reader(tree).read,
      ),
    ).toBe('/p/node_modules/shade-warp/node_modules/shade-noise/nested.shade.ts');
    // A hoisted one, found above the package's own node_modules.
    const { read, reads } = reader(tree);
    expect(
      resolveSpecifierFile('/p/node_modules/shade-grain/src/grain.shade.ts', 'shade-noise', read),
    ).toBe('/p/node_modules/shade-noise/hoisted.shade.ts');
    expect(reads).toEqual([
      '/p/node_modules/shade-grain/src/node_modules/shade-noise/package.json',
      '/p/node_modules/shade-grain/node_modules/shade-noise/package.json',
      '/p/node_modules/shade-noise/package.json',
    ]);
    // A relative import inside a package stays in it.
    expect(
      resolveSpecifierFile('/p/node_modules/shade-warp/src/warp.shade.ts', './hash.shade.ts', read),
    ).toBe('/p/node_modules/shade-warp/src/hash.shade.ts');
  });

  it("keeps a uri's scheme, and stops at the root of a relative name", () => {
    const tree = { 'file:///p/node_modules/shade-noise/package.json': { exports: './i.shade.ts' } };
    expect(
      resolveSpecifierFile('file:///p/src/main.shade.ts', 'shade-noise', reader(tree).read),
    ).toBe('file:///p/node_modules/shade-noise/i.shade.ts');
    const { read, reads } = reader({});
    expect(resolveSpecifier('src/main.shade.ts', 'shade-noise', read)).toEqual({
      kind: 'no-package',
      name: 'shade-noise',
      from: 'src',
    });
    expect(reads).toEqual([
      'src/node_modules/shade-noise/package.json',
      'node_modules/shade-noise/package.json',
    ]);
    expect(resolveSpecifier('main.shade.ts', 'shade-noise', read)).toMatchObject({ from: '.' });
  });

  it('finds nothing with no readDocument, and says where it looked', () => {
    expect(resolveSpecifier('/p/src/main.shade.ts', 'shade-noise', undefined)).toEqual({
      kind: 'no-package',
      name: 'shade-noise',
      from: '/p/src',
    });
  });
});

describe('a specifier that names no package', () => {
  it.each([
    ['#noise', 'import-map'],
    ['/p/lib/noise.shade.ts', 'not-a-name'],
    ['node:fs', 'not-a-name'],
    ['https://example.com/noise.shade.ts', 'not-a-name'],
    ['C:/p/noise.shade.ts', 'not-a-name'],
    ['@shade', 'not-a-name'],
    ['@shade/', 'not-a-name'],
    ['.hidden/noise', 'not-a-name'],
    ['shade-noise/', 'not-a-name'],
    ['shade-noise/../other', 'not-a-name'],
    ['shade-noise/a/%2e%2e/b', 'not-a-name'],
  ])('%s is %s, and reads nothing', (specifier, kind) => {
    const { read, reads } = reader({});
    expect(resolveSpecifier('/p/main.shade.ts', specifier, read)).toEqual({ kind });
    expect(reads).toEqual([]);
  });
});

describe('the package a file belongs to', () => {
  const tree = {
    '/p/node_modules/shade-noise/package.json': { name: 'shade-noise', version: '1.2.0' },
    '/p/node_modules/@shade/grain/package.json': { name: '@shade/grain', version: '0.1.0' },
    '/p/node_modules/.pnpm/shade-noise@1.2.0/node_modules/shade-noise/package.json': {
      name: 'shade-noise',
      version: '1.2.0',
    },
    '/p/node_modules/aliased/package.json': { name: 'shade-noise', version: '2.0.0' },
  };
  const { read } = reader(tree);

  it('is read off the last node_modules in its path, with its name and version', () => {
    expect(packageOf('/p/node_modules/shade-noise/src/noise.shade.ts', read)).toEqual({
      name: 'shade-noise',
      version: '1.2.0',
      root: '/p/node_modules/shade-noise/',
      path: 'src/noise.shade.ts',
    });
    expect(packageOf('/p/node_modules/@shade/grain/grain.shade.ts', read)).toMatchObject({
      name: '@shade/grain',
      path: 'grain.shade.ts',
    });
    // The name its package.json gives, under an alias.
    expect(packageOf('/p/node_modules/aliased/x.shade.ts', read)).toMatchObject({
      name: 'shade-noise',
      version: '2.0.0',
    });
    expect(packageOf('/p/src/main.shade.ts', read)).toBeUndefined();
    expect(packageOf('/p/node_modules/.bin/x', read)).toBeUndefined();
  });

  it('keys one version of a file once, whatever path reached it', () => {
    const hoisted = packageOf('/p/node_modules/shade-noise/src/noise.shade.ts', read)!;
    const linked = packageOf(
      '/p/node_modules/.pnpm/shade-noise@1.2.0/node_modules/shade-noise/src/noise.shade.ts',
      read,
    )!;
    expect(packageKey(hoisted)).toBe('shade-noise@1.2.0/src/noise.shade.ts');
    expect(packageKey(linked)).toBe(packageKey(hoisted));
    expect(packageKey(packageOf('/p/node_modules/aliased/src/noise.shade.ts', read)!)).toBe(
      'shade-noise@2.0.0/src/noise.shade.ts',
    );
    // With no version to trust, a file is its own.
    expect(
      packageKey(packageOf('/q/node_modules/shade-noise/src/noise.shade.ts', read)!),
    ).toBeUndefined();
  });
});
