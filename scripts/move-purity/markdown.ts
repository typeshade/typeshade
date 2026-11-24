import { dirname, join, relative } from 'node:path/posix';

const TOKEN = /[\w@./-]+/g;

function followRenames(
  line: string,
  renames: ReadonlyMap<string, string>,
  documentDirectory: string,
): string {
  return line.replace(TOKEN, (token) => {
    const trimmed = token.replace(/\.+$/, '');
    const tail = token.slice(trimmed.length);
    const direct = renames.get(trimmed);
    if (direct !== undefined) return direct + tail;
    const beside = renames.get(join(documentDirectory, trimmed));
    if (beside !== undefined) return relative(documentDirectory, beside) + tail;
    return token;
  });
}

export function renamingOnlyMarkdown(
  documentPath: string,
  base: string | undefined,
  head: string | undefined,
  renames: ReadonlyMap<string, string>,
): boolean {
  const directory = dirname(documentPath);
  const counts = new Map<string, number>();
  const add = (text: string | undefined, step: number, follow: boolean): void => {
    for (const line of (text ?? '').split('\n')) {
      const key = follow ? followRenames(line, renames, directory) : line;
      counts.set(key, (counts.get(key) ?? 0) + step);
    }
  };
  add(base, 1, true);
  add(head, -1, false);
  return [...counts.values()].every((n) => n === 0);
}
