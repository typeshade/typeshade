// Build-time fusion identity (change 0122). This module is private to the Vite plugin.
// Select the path flavor from the inputs, so Windows and UNC identities do not depend on
// the operating system running the compiler. Node types are absent from the library build.
interface PathFlavor {
  isAbsolute(path: string): boolean;
  parse(path: string): { root: string };
  relative(from: string, to: string): string;
}

interface NodePath {
  readonly posix: PathFlavor;
  readonly win32: PathFlavor;
}

let pathPromise: Promise<NodePath> | undefined;
const nodePath = (): Promise<NodePath> => {
  const specifier: string = 'node:path';
  return (pathPromise ??= import(specifier) as Promise<NodePath>);
};

const slashes = (path: string): string => path.replace(/\\/g, '/');
const windows = (path: string): boolean => /^[a-z]:\//i.test(path) || path.startsWith('//');

/** The namespace and root-relative module path, encoded without ambiguous delimiters. */
export async function portableOrigin(
  namespace: string,
  root: string | undefined,
  fileName: string,
): Promise<string> {
  const invalid = (reason: string): never => {
    throw new Error(`typeshade(): originNamespace requires ${reason}.`);
  };
  if (root === undefined) invalid('an absolute Vite root from configResolved');
  const from = slashes(root!);
  const to = slashes(fileName.split('?')[0]!);
  const paths = await nodePath();
  const win = windows(from);
  const flavor = win ? paths.win32 : paths.posix;
  if (!flavor.isAbsolute(from)) invalid(`an absolute Vite root, not ${JSON.stringify(root)}`);
  if (windows(to) !== win || !flavor.isAbsolute(to))
    invalid(`an absolute shader path on the root's filesystem, not ${JSON.stringify(fileName)}`);
  // A drive or UNC share is a filesystem root. In particular, win32.relative on different
  // drives returns an absolute path; accepting that would undo the portability opt-in.
  const rootOf = (path: string): string => {
    const value = slashes(flavor.parse(path).root).replace(/\/$/, '');
    return win ? value.toLowerCase() : value;
  };
  if (rootOf(from) !== rootOf(to))
    invalid('the Vite root and shader path on the same drive or UNC share');
  return JSON.stringify([namespace, slashes(flavor.relative(from, to))]);
}
