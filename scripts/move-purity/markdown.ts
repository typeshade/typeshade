const TOKEN = /[\w@./-]+/g;

export function renamedPaths(renames: ReadonlyMap<string, string>): Map<string, string> {
  const paths = new Map(renames);
  for (const [from, to] of renames) {
    const fromName = from.slice(from.lastIndexOf('/') + 1);
    const toName = to.slice(to.lastIndexOf('/') + 1);
    if (fromName === toName && from.includes('/') && to.includes('/')) {
      paths.set(from.slice(0, from.lastIndexOf('/')), to.slice(0, to.lastIndexOf('/')));
    }
  }
  return paths;
}

function followRenames(line: string, renames: ReadonlyMap<string, string>): string {
  return line.replace(TOKEN, (token) => {
    const trimmed = token.replace(/\.+$/, '');
    const bare = trimmed.replace(/\/$/, '');
    const target = renames.get(trimmed) ?? renames.get(bare);
    if (target === undefined) return token;
    const slash = trimmed.length > bare.length && !renames.has(trimmed) ? '/' : '';
    return target + slash + token.slice(trimmed.length);
  });
}

export function renamingOnlyMarkdown(
  base: string | undefined,
  head: string | undefined,
  renames: ReadonlyMap<string, string>,
): boolean {
  const counts = new Map<string, number>();
  const add = (text: string | undefined, step: number, follow: boolean): void => {
    for (const line of (text ?? '').split('\n')) {
      const key = follow ? followRenames(line, renames) : line;
      counts.set(key, (counts.get(key) ?? 0) + step);
    }
  };
  add(base, 1, true);
  add(head, -1, false);
  return [...counts.values()].every((n) => n === 0);
}
