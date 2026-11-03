// === The `.gitignore` rules a `tshc` directory walk follows (#1001) ===
//
// `tshc check`, `tshc sync` and `tshc migrate` search a directory for `*.shade.ts`. A project keeps
// files there that are not its own sources: the copy a build makes, a cache, a checkout of another
// project that a symbolic link reaches. Its `.gitignore` already says so. This module reads that
// file the way Git does (gitignore(5)), over text, so `run.ts` stays free of the host.
//
// Read: blank lines and `#` comments; `!` to include again; a trailing `/` for a directory only;
// a `/` at the start or in the middle, which fixes a pattern to the directory of its `.gitignore`;
// `*`, `?`, `[…]` and `**`; `\` to quote a character; and trailing spaces, which a `\` can quote.
// Not read: `.git/info/exclude`, the global ignore file, and the case folding of a file system.
// A pattern with a `[` that nothing closes matches no path, as it does in Git.
// A file that Git tracks and a pattern matches is ignored here all the same.

/** What the walk needs from its host to find the rules above a directory. */
export interface IgnoreHost {
  readFile(path: string): string | undefined;
  /** `'file'`, `'directory'`, or `undefined` when nothing is at `path`. */
  kind(path: string): 'file' | 'directory' | undefined;
}

export interface IgnoreRule {
  /** The directory of the `.gitignore` that holds the rule, as the walk spells it. */
  readonly base: string;
  readonly negated: boolean;
  readonly directoryOnly: boolean;
  /** Matches the path from `base`, written with `/`. */
  readonly pattern: RegExp;
}

const literal = (c: string): string => c.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');

/** The index of the `]` that closes the bracket opened at `open`, or -1 when none does. */
function bracketEnd(glob: string, open: number): number {
  let at = open + 1;
  if (glob[at] === '!' || glob[at] === '^') at++;
  if (glob[at] === ']') at++; // a `]` first in the bracket is a member
  for (; at < glob.length; at++) {
    if (glob[at] === '\\') at++;
    else if (glob[at] === ']') return at;
  }
  return -1;
}

/** The class for the bracket `[body]`. A class never matches `/`. */
function bracket(body: string): string {
  const negated = body.startsWith('!') || body.startsWith('^');
  let members = '';
  for (let i = negated ? 1 : 0; i < body.length; i++) {
    const c = body[i]!;
    if (c === '\\') members += literal(body[++i] ?? '\\');
    else members += c === ']' || c === '^' ? `\\${c}` : c;
  }
  return `[${negated ? '^/' : ''}${members}]`;
}

/** The regular expression source for `glob`, which has no `/` at its start or its end. Undefined
 *  for a glob with a `[` that nothing closes: Git matches no path with it. */
function expression(glob: string): string | undefined {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '\\') {
      if (i + 1 < glob.length) out += literal(glob[++i]!);
    } else if (c === '?') out += '[^/]';
    else if (c === '*') {
      let end = i;
      while (glob[end + 1] === '*') end++;
      const between =
        (i === 0 || glob[i - 1] === '/') && (end === glob.length - 1 || glob[end + 1] === '/');
      if (end > i && between) {
        // `**` that fills a whole segment spans directories: `**/x` and `a/**/x` reach any depth
        // (zero directories too), and a closing `/**` is all that lies inside.
        if (end === glob.length - 1) out += '.*';
        else out += '(?:.*/)?';
        if (end < glob.length - 1) end++; // the `/` after it
      } else out += '[^/]*';
      i = end;
    } else if (c === '[') {
      const close = bracketEnd(glob, i);
      if (close < 0) return undefined;
      out += bracket(glob.slice(i + 1, close));
      i = close;
    } else out += literal(c);
  }
  return out;
}

/** The rules of one `.gitignore`, `text`, which lies in the directory `base`. */
export function parseIgnoreFile(text: string, base: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    let line = raw.replace(/(?<!\\)[ \t]+$/, '');
    if (line === '' || line.startsWith('#')) continue;
    const negated = line.startsWith('!');
    if (negated) line = line.slice(1);
    const directoryOnly = line.endsWith('/');
    if (directoryOnly) line = line.slice(0, -1);
    if (line === '') continue;
    const anchored = line.includes('/');
    const body = expression(line.startsWith('/') ? line.slice(1) : line);
    if (body === undefined) continue;
    rules.push({
      base,
      negated,
      directoryOnly,
      pattern: new RegExp(`^${anchored ? '' : '(?:.*/)?'}${body}$`),
    });
  }
  return rules;
}

/**
 * Whether `rules` ignore the entry at `path`, a directory or a file. The last rule that matches
 * decides, so a deeper `.gitignore` (later in `rules`) overrules a shallower one, and `!` includes
 * again what an earlier rule ignored. A rule applies to the entries below its `base` only.
 *
 * The walk asks about an entry once, where it finds it, and does not enter an ignored directory.
 * That is how Git reads a path too: nothing inside an ignored directory can be included again.
 */
export function isIgnored(
  rules: readonly IgnoreRule[],
  path: string,
  isDirectory: boolean,
): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.directoryOnly && !isDirectory) continue;
    const prefix = `${rule.base}/`;
    if (path.startsWith(prefix) && rule.pattern.test(path.slice(prefix.length)))
      ignored = !rule.negated;
  }
  return ignored;
}

const parentOf = (dir: string): string | undefined => {
  const cut = dir.lastIndexOf('/');
  return cut < 0 ? undefined : dir.slice(0, cut);
};

/**
 * The rules of the `.gitignore` files that apply to the entries of `start` and are not in `start`
 * itself: those of the directories from the root of its repository down to its parent, the
 * repository's root being the nearest directory, `start` included, that holds a `.git`. With no
 * repository around `start`, no file above it is a project's ignore file, and there are no rules.
 * A path that a command names is the walk's start, and nothing above it ignores it.
 */
export function inheritedRules(host: IgnoreHost, start: string): IgnoreRule[] {
  const above: string[] = [];
  let dir: string | undefined = start;
  while (dir !== undefined) {
    if (dir !== start) above.push(dir);
    if (host.kind(`${dir}/.git`) !== undefined)
      return above.reverse().flatMap((d) => {
        const text = host.readFile(`${d}/.gitignore`);
        return text === undefined ? [] : parseIgnoreFile(text, d);
      });
    dir = parentOf(dir);
  }
  return [];
}
