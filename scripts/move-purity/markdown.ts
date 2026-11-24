const TOKEN = /[\w@./-]+/g;
const EXTENSION = /\.(?:ts|md|json|mjs|yml)$/;

export function directoriesOf(paths: Iterable<string>): Set<string> {
  const directories = new Set<string>();
  for (const path of paths) {
    let at = path.lastIndexOf('/');
    while (at > 0) {
      directories.add(path.slice(0, at));
      at = path.lastIndexOf('/', at - 1);
    }
  }
  return directories;
}

function normalizeLine(
  line: string,
  tracked: ReadonlySet<string>,
  directories: ReadonlySet<string>,
) {
  return line.replace(TOKEN, (token) => {
    const trimmed = token.replace(/\.+$/, '');
    if (EXTENSION.test(trimmed) && tracked.has(trimmed)) return 'PATH';
    const directory = trimmed.replace(/\/$/, '');
    const directoryLike = directory.includes('/') || trimmed.endsWith('/');
    return directoryLike && directories.has(directory) ? 'PATH' : token;
  });
}

export function pathOnlyMarkdown(
  base: string | undefined,
  head: string | undefined,
  tracked: ReadonlySet<string>,
): boolean {
  const directories = directoriesOf(tracked);
  const counts = new Map<string, number>();
  const add = (text: string | undefined, step: number): void => {
    for (const line of (text ?? '').split('\n')) {
      const key = normalizeLine(line, tracked, directories);
      counts.set(key, (counts.get(key) ?? 0) + step);
    }
  };
  add(base, 1);
  add(head, -1);
  return [...counts.values()].every((n) => n === 0);
}
