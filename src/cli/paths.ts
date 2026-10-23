// Host-independent paths shared by the explicit CLI commands.
/** A path's Windows drive, `D:`, when the path is written on one (`D:/work`, `D:\\work`). */
const DRIVE = /^[A-Za-z]:(?=[\\/]|$)/;

/**
 * `path` joined onto `base`, with `.` and `..` segments resolved and `/` between segments. A path
 * that starts with `/` or names a drive is absolute. On Windows the working directory is on a
 * drive (`D:/work`): a path there keeps its drive, upper-cased, and `\` separates its segments as
 * `/` does, since a path that lost its drive for a leading `/` names nothing (#384). A path that
 * starts with `/` or `\` on a base with a drive is on that drive. Off a drive, `\` is a character
 * of a name, as POSIX has it.
 */
export function resolvePath(base: string, path: string): string {
  const baseDrive = DRIVE.exec(base)?.[0];
  const rooted = path.startsWith('/') || (baseDrive !== undefined && path.startsWith('\\'));
  const joined = DRIVE.test(path) ? path : rooted ? `${baseDrive ?? ''}${path}` : `${base}/${path}`;
  const drive = DRIVE.exec(joined)?.[0] ?? '';
  const parts: string[] = [];
  for (const part of joined.slice(drive.length).split(drive === '' ? '/' : /[\\/]/)) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `${drive.toUpperCase()}/${parts.join('/')}`;
}

/** `path` relative to `from`, for display; `path` itself when it is not under `from`. */
export function relativeTo(from: string, path: string): string {
  const root = resolvePath(from, '.');
  const prefix = root.endsWith('/') ? root : `${root}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}
