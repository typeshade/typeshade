import { describe, expect, it } from 'vitest';
import { portableOrigin } from './vite-origin.js';

describe('portable fusion identities across filesystem path flavors (0122)', () => {
  it.each([
    ['/checkout/project', '/checkout/project/src/a.shade.ts', 'src/a.shade.ts'],
    ['/other/project/', '/other/project/src/a.shade.ts?import', 'src/a.shade.ts'],
    ['/checkout/project', '/checkout/shared/a.shade.ts', '../shared/a.shade.ts'],
    ['/checkout/project', '/checkout/project-other/a.shade.ts', '../project-other/a.shade.ts'],
    ['/checkout/project', '/checkout/project/src/../a.shade.ts', 'a.shade.ts'],
    ['C:\\checkout\\project', 'C:\\checkout\\project\\src\\a.shade.ts', 'src/a.shade.ts'],
    ['C:/checkout/project/', 'c:/checkout/project/src/a.shade.ts?import', 'src/a.shade.ts'],
    ['C:/checkout/project', 'C:/checkout/shared/a.shade.ts', '../shared/a.shade.ts'],
    ['\\\\server\\share\\project', '\\\\server\\share\\project\\src\\a.shade.ts', 'src/a.shade.ts'],
    ['//server/share/project', '//SERVER/SHARE/project/src/a.shade.ts', 'src/a.shade.ts'],
    ['//server/share/project', '//server/share/shared/a.shade.ts', '../shared/a.shade.ts'],
  ])('%s to %s retains its relative identity', async (root, file, relative) => {
    expect(await portableOrigin('@acme/effects', root, file)).toBe(
      JSON.stringify(['@acme/effects', relative]),
    );
  });

  it.each([
    [undefined, '/project/a.shade.ts'],
    ['project', '/project/a.shade.ts'],
    ['C:project', 'C:/project/a.shade.ts'],
    ['/project', 'src/a.shade.ts'],
    ['C:/project', 'C:a.shade.ts'],
    ['C:/project', 'D:/project/a.shade.ts'],
    ['//server/share/project', '//server/other/a.shade.ts'],
    ['//server/share/project', '//other/share/a.shade.ts'],
    ['/project', 'C:/project/a.shade.ts'],
    ['C:/project', '/project/a.shade.ts'],
  ])('refuses an unavailable or incompatible root %s for %s', async (root, file) => {
    await expect(portableOrigin('pkg', root, file!)).rejects.toThrow(
      'typeshade(): originNamespace requires',
    );
  });

  it('preserves the namespace verbatim and separates tuple components', async () => {
    const namespace = ' @acme/pkg#"\\ ';
    expect(
      JSON.parse(await portableOrigin(namespace, '/project', '/project/src/a.shade.ts')),
    ).toEqual([namespace, 'src/a.shade.ts']);
    expect(await portableOrigin('a/b', '/project', '/project/c.shade.ts')).not.toBe(
      await portableOrigin('a', '/project', '/project/b/c.shade.ts'),
    );
  });
});
