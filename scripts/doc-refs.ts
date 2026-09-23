// ═══ The references the prose makes, and whether the tree still has what they name ═══
//
// The drift this reads, measured 2026-09-23. `doc-snippets.test.ts` compiles every shader fence
// in the docs, and `api-doc-coverage.test.ts` holds every export to a doc comment, but nothing
// read the SENTENCES around them. So when a file, a script, a rule or a diagnostic code went
// away, every sentence that named it stayed: `src/AGENTS.md` still sent readers to a
// `scripts/capture-polygon-snapshots.ts` that no longer exists, and `docs/use-typeshade-plan.md`
// to a `docs/use-typeshade-spec.md` that never did. An agent reading those files first, as
// `CLAUDE.md` tells it to, was reading instructions about a tree that is not this one.
//
// WHAT A REFERENCE IS. Only a claim the tree can answer with yes or no, so that a gate built on
// this module fails for a reason and never for a guess:
//
//   path     a backticked token with a `/` or a Markdown link target that names a file
//            (`src/index.ts`, `[the guide](AUTHORING.md)`); it resolves against the doc's own
//            directory, then the repository root, then `src/`, then as the tail of any
//            tracked path, so `compiler/ts/codes.ts` resolves. A bare `codes.ts` is read only
//            in the agent maps (`AGENTS.md`, `CLAUDE.md`), whose job is naming this tree's files;
//            elsewhere a bare name is as often the reader's own file (`launch.json`)
//   anchor   the `#fragment` of a Markdown link into a `.md` file: a GitHub heading slug
//   section  `docs/x.md §N.M`: a heading numbered `N.M` in that file. A document whose headings
//            carry no numbers (`AUTHORING.md`) is cited by heading, `AUTHORING.md#fp64`: "the
//            eleventh section" is true only until a section is inserted above it
//   rule     `Rule N.M`: a `**Rule N.M.**` paragraph in `docs/language-design.md`
//   code     `TS8nnn` / `SDnnnn`: a diagnostic code the compiler defines
//   script   `bun run <name>` / `npm run <name>`: a script in `package.json`
//
// A citation of another repository's document says whose it is ("X-GIS CLAUDE.md §5": this
// package began as `shader-dsl` in the X-GIS monorepo) and is not resolved here.
//
// Markdown is read outside its fences (a fence is code, and `doc-snippets.test.ts` compiles
// it). TypeScript is read too, but only for the references code makes INTO the prose: a `.md`
// path, a section of one, and a rule. That is the other half of the dependency, the comment
// that says "docs/language-design.md Rule 9.2" and goes stale when the rule is renumbered.
//
// WHAT IS NOT READ. `CHANGELOG.md` and `docs/HISTORY.md` describe the past, and a name that is
// gone is exactly what they are for. A document that is itself a measurement of another tree
// says so at its top with `<!-- doc-refs: skip-file — reason -->`; one sentence that must name
// something absent carries `<!-- doc-refs: skip — reason -->` on the line above it or on it. The reason
// is required, so the exemption carries its justification in the doc, as in doc-snippets.
//
// Usage: bun scripts/doc-refs.ts            (lists every dead reference, exits 1 if any)

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The repository these scripts read. By default the one they live in; a downstream repository
 * that vendors the compiler (the site, the editor extension) sets `TYPESHADE_DOCS_ROOT` to its
 * own root to run `ifchange.ts` over itself (`scripts/downstream-impact.ts` explains).
 */
export const ROOT =
  process.env.TYPESHADE_DOCS_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..');

/** Files that record the past on purpose: what they name may be gone. */
export const HISTORY_FILES: ReadonlySet<string> = new Set(['CHANGELOG.md', 'docs/HISTORY.md']);

/** Generated files: their content is a bake, checked by their own test, not prose. */
const GENERATED_FILES: ReadonlySet<string> = new Set(['src/__api__/surface.md']);
/** The Doorstop items, derived from docs/language-design.md by `scripts/reqs-sync.ts`. */
const GENERATED_DIRS: readonly string[] = ['reqs/rules/', 'reqs/surface/'];

export type RefKind = 'path' | 'anchor' | 'section' | 'rule' | 'code' | 'script';

export interface DocRef {
  readonly kind: RefKind;
  /** Repository-relative file the reference is written in. */
  readonly file: string;
  /** 1-based line. */
  readonly line: number;
  /** The reference as written. */
  readonly text: string;
  /** For `anchor` / `section`, and a Markdown link's `path`: the target file, repository-relative. */
  readonly target?: string;
}

export interface DeadRef extends DocRef {
  readonly why: string;
}

const SKIP_FILE = /<!--\s*doc-refs:\s*skip-file\s*—\s*\S.*-->/;
const SKIP_LINE = /<!--\s*doc-refs:\s*skip\s*—\s*\S.*-->/;
/** A marker quoted in a code span (`<!-- doc-refs: skip — … -->` in a sentence about it) is prose. */
export const outsideCode = (line: string): string => line.replace(/`[^`\n]*`/g, '');
const MARKER_WITHOUT_REASON = /<!--\s*doc-refs:\s*(skip|skip-file)\s*(-->|—\s*-->)/;

export const git = (...args: string[]): string =>
  execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 << 20,
    // A caller that probes (`git show base:path` for a file the base lacks) handles the throw;
    // git's own "fatal:" line would only be noise on the terminal.
    stdio: ['ignore', 'pipe', 'pipe'],
  });

let trackedCache: string[] | undefined;
/** Every tracked file, plus files added but not yet committed (a new file is part of the tree). */
export function trackedFiles(): string[] {
  trackedCache ??= git('ls-files', '--cached', '--others', '--exclude-standard')
    .split('\n')
    .filter((f) => f && existsSync(join(ROOT, f)));
  return trackedCache;
}

/** The prose this repository ships and its agents read: every Markdown file but the bakes. */
export function markdownFiles(): string[] {
  return trackedFiles().filter(
    (f) =>
      f.endsWith('.md') &&
      !GENERATED_FILES.has(f) &&
      !GENERATED_DIRS.some((d) => f.startsWith(d)) &&
      !f.startsWith('node_modules/'),
  );
}

/**
 * The reader and its test quote dead references on purpose, as examples and as fixtures; the
 * downstream checks name files that live in the downstream repositories.
 */
const SELF: ReadonlySet<string> = new Set([
  'scripts/doc-refs.ts',
  'scripts/doc-impact.ts',
  'src/doc-references.test.ts',
  'scripts/ifchange.ts',
  'src/ifchange.test.ts',
  'scripts/downstream-impact.ts',
  'src/downstream-impact.test.ts',
  'scripts/changes.ts',
  'src/changes.test.ts',
]);

/** TypeScript whose comments may cite the prose. */
export function sourceFiles(): string[] {
  return trackedFiles().filter(
    (f) => /\.(ts|mts|mjs)$/.test(f) && !f.includes('__emit-goldens__') && !SELF.has(f),
  );
}

// ─── extraction ────────────────────────────────────────────────────────────────────────────

const FILE_EXT = /\.(ts|tsx|mts|mjs|cjs|js|json|md|ya?ml|wgsl|glsl|sh|html|css|py)$/;
/** A token that could be a path: no spaces, no placeholders, no globs, no URLs. */
const PATHISH = /^[A-Za-z0-9_@.\-/]+$/;

/** Strip `:12`, `:12-40`, `#L12` and `#anchor` off a path token. */
const stripLocation = (token: string): string => token.replace(/(:\d+(-\d+)?|#.*)$/, '');

function looksLikePath(token: string): boolean {
  if (!PATHISH.test(token) || token.includes('//')) return false;
  if (token.startsWith('dist/') || token.includes('node_modules') || token.startsWith('@'))
    return false;
  if (
    token.startsWith('.') &&
    !token.startsWith('./') &&
    !token.startsWith('../') &&
    !token.startsWith('.github/')
  )
    return false;
  const bare = stripLocation(token);
  return FILE_EXT.test(bare);
}

const RULE = /\bRule (\d+\.\d+)\b/g;
const CODE = /\b(TS8\d{3}|SD\d{4})\b/g;
const SCRIPT = /\b(?:bun|npm) run ([a-z][\w:-]*)/g;
const SECTION = /((?:[\w.-]+\/)*[\w.-]+\.md)[`)]? ?§ ?(\d+(?:\.\d+)*)/g;
const BACKTICK = /`([^`\n]+)`/g;

/** This package began as `shader-dsl` inside the X-GIS monorepo, and some comments still cite
 *  that repository's documents ("X-GIS CLAUDE.md §5"). Those name another tree on purpose. */
const citesXGis = (line: string, at: number): boolean =>
  /X-GIS('s)?\s+\S*$/.test(line.slice(Math.max(0, at - 24), at));
const MD_LINK = /\]\(([^)\s]+)\)/g;

/** Every reference in one file. Markdown is read outside fences; TypeScript only for prose refs. */
export function extractRefs(file: string, text = readFileSync(join(ROOT, file), 'utf8')): DocRef[] {
  const refs: DocRef[] = [];
  const isMd = file.endsWith('.md');
  // A bare `name.ts` in most prose is as likely the reader's file (`launch.json`, `rim.ts`) as
  // one of ours. The agent maps are different: they exist to name this tree's files.
  const isMap = /(^|\/)(AGENTS|CLAUDE)\.md$/.test(file);
  if (isMd && text.split('\n').some((l) => SKIP_FILE.test(outsideCode(l)))) return refs;
  const lines = text.split('\n');
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const at = i + 1;
    if (isMd) {
      const open = /^\s*(`{3,}|~{3,})/.exec(line);
      if (open) {
        if (fence === null) fence = open[1]!;
        else if (line.trim().startsWith(fence)) fence = null;
        continue;
      }
      if (fence !== null) continue;
      if (
        SKIP_LINE.test(outsideCode(line)) ||
        (i > 0 && SKIP_LINE.test(outsideCode(lines[i - 1]!)))
      )
        continue;
    }
    const push = (kind: RefKind, text: string, target?: string): void => {
      refs.push({ kind, file, line: at, text, ...(target ? { target } : {}) });
    };

    for (const m of line.matchAll(SECTION)) {
      if (!citesXGis(line, m.index)) push('section', `${m[1]} §${m[2]}`, m[1]);
    }
    if (!/MISRA/.test(line)) for (const m of line.matchAll(RULE)) push('rule', `Rule ${m[1]}`);

    if (isMd) {
      for (const m of line.matchAll(CODE)) push('code', m[1]!);
      for (const m of line.matchAll(SCRIPT)) push('script', m[1]!);
      for (const m of line.matchAll(BACKTICK)) {
        const token = m[1]!.trim();
        if (looksLikePath(token) && (token.includes('/') || isMap) && !citesXGis(line, m.index))
          push('path', token);
      }
      for (const m of line.matchAll(MD_LINK)) {
        const href = m[1]!;
        // A scheme is another site; a leading `/` is a page of typeshade.dev, not a file here.
        if (/^[a-z][a-z+.-]*:/i.test(href) || /^[#</]/.test(href)) {
          if (href.startsWith('#') && href.length > 1) push('anchor', href, file);
          continue;
        }
        const [path, anchor] = href.split('#') as [string, string | undefined];
        // A link resolves the way GitHub resolves it: from the document's directory, and only there.
        push('path', path, normalize(join(dirname(file), path)));
        if (anchor && path.endsWith('.md')) {
          push('anchor', href, normalize(join(dirname(file), path)));
        }
      }
    } else {
      // Code cites the prose by path, and by heading: `docs/debugging.md`, `AUTHORING.md#fp64`.
      for (const m of line.matchAll(/(?<![\w/.-])((?:[\w.-]+\/)*[\w.-]+\.md)(#[\w-]+)?/g)) {
        if (citesXGis(line, m.index)) continue;
        push('path', m[1]!);
        if (m[2]) push('anchor', `${m[1]}${m[2]}`, normalize(m[1]!));
      }
    }
  }
  return refs;
}

// ─── resolution ────────────────────────────────────────────────────────────────────────────

/** GitHub's heading slug: lowercase, punctuation dropped, spaces to `-`. */
export function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

const headingCache = new Map<string, string[]>();
function headings(file: string): string[] {
  let hs = headingCache.get(file);
  if (!hs) {
    const text = existsSync(join(ROOT, file)) ? readFileSync(join(ROOT, file), 'utf8') : '';
    hs = [];
    let fence = false;
    for (const line of text.split('\n')) {
      if (/^\s*(`{3,}|~{3,})/.test(line)) fence = !fence;
      else if (!fence && /^#{1,6} /.test(line)) hs.push(line.replace(/^#+ /, '').trim());
    }
    headingCache.set(file, hs);
  }
  return hs;
}

function anchorExists(file: string, anchor: string): boolean {
  const seen = new Map<string, number>();
  for (const h of headings(file)) {
    const base = slug(h);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    if ((n === 0 ? base : `${base}-${n}`) === anchor) return true;
  }
  // An explicit HTML anchor in the target.
  const text = existsSync(join(ROOT, file)) ? readFileSync(join(ROOT, file), 'utf8') : '';
  return new RegExp(`(id|name)="${anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(text);
}

function sectionExists(file: string, number: string): boolean {
  const n = number.replace(/\./g, '\\.');
  const numbered = new RegExp(`^(§ ?)?${n}(\\.|\\s|\\)|:|$)`);
  const inline = new RegExp(`§ ?${n}(?![\\d.]*\\d)`);
  return headings(file).some((h) => numbered.test(h) || inline.test(h));
}

let rulesCache: Set<string> | undefined;
export function definedRules(): Set<string> {
  rulesCache ??= new Set(
    [
      ...readFileSync(join(ROOT, 'docs/language-design.md'), 'utf8').matchAll(
        /\*\*Rule (\d+\.\d+)\.\*\*/g,
      ),
    ].map((m) => m[1]!),
  );
  return rulesCache;
}

let codesCache: Set<string> | undefined;
export function definedCodes(): Set<string> {
  codesCache ??= new Set(
    ['src/compiler/ts/codes.ts', 'src/core/diagnostics/codes.ts'].flatMap((f) =>
      [...readFileSync(join(ROOT, f), 'utf8').matchAll(/['"](TS8\d{3}|SD\d{4})['"]/g)].map(
        (m) => m[1]!,
      ),
    ),
  );
  return codesCache;
}

export function definedScripts(): Set<string> {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  return new Set(Object.keys(pkg.scripts ?? {}));
}

let byBasename: Map<string, string[]> | undefined;
let dirs: Set<string> | undefined;
function pathExists(from: string, token: string): boolean {
  const bare = stripLocation(token).replace(/\/$/, '');
  const candidates = [join(dirname(from), bare), bare, join('src', bare)].map((p) => normalize(p));
  if (candidates.some((p) => existsSync(join(ROOT, p)))) return true;
  if (!byBasename) {
    byBasename = new Map();
    dirs = new Set();
    for (const f of trackedFiles()) {
      const b = basename(f);
      byBasename.set(b, [...(byBasename.get(b) ?? []), f]);
      for (let d = dirname(f); d !== '.'; d = dirname(d)) dirs.add(d);
    }
  }
  const tail = bare.replace(/^(\.\.?\/)+/, '');
  if ((byBasename.get(basename(tail)) ?? []).some((f) => f === tail || f.endsWith(`/${tail}`)))
    return true;
  return [...dirs!].some((d) => d === tail || d.endsWith(`/${tail}`));
}

/** The reason a reference no longer holds, or `null` when the tree still has what it names. */
export function resolve(ref: DocRef): string | null {
  switch (ref.kind) {
    case 'path':
      if (ref.target) {
        return existsSync(join(ROOT, ref.target))
          ? null
          : `the link resolves to ${ref.target}, which does not exist`;
      }
      return pathExists(ref.file, ref.text) ? null : 'no such file in the tree';
    case 'anchor': {
      const target = existsSync(join(ROOT, ref.target!))
        ? ref.target!
        : resolveMarkdown(ref.file, ref.target!);
      const anchor = decodeURIComponent(ref.text.split('#')[1] ?? '');
      if (!target) return null; // the path ref reports the file
      return anchorExists(target, anchor) ? null : `no heading with slug #${anchor} in ${target}`;
    }
    case 'section': {
      const target = resolveMarkdown(ref.file, ref.target!);
      if (!target) return `no such document ${ref.target}`;
      const number = ref.text.split('§')[1]!;
      if (sectionExists(target, number)) return null;
      return headings(target).some((h) => /^(§ ?)?\d+\./.test(h))
        ? `no heading numbered ${number} in ${target}`
        : `${target} does not number its headings, so §${number} names nothing that survives a reorder — cite \`${target}#<heading-slug>\``;
    }
    case 'rule':
      return definedRules().has(ref.text.slice(5))
        ? null
        : 'no such rule in docs/language-design.md';
    case 'code':
      return definedCodes().has(ref.text) ? null : 'no such diagnostic code';
    case 'script':
      return definedScripts().has(ref.text) ? null : 'no such script in package.json';
  }
}

function resolveMarkdown(from: string, target: string): string | null {
  // A Markdown link is relative to its document; a code comment names a path from the root.
  const order = from.endsWith('.md')
    ? [join(dirname(from), target), target]
    : [target, join(dirname(from), target)];
  for (const p of [...order, join('docs', target)].map((x) => normalize(x))) {
    if (existsSync(join(ROOT, p))) return relative(ROOT, join(ROOT, p));
  }
  return null;
}

/** Every file this module reads, with the exemptions applied. */
export function scannedFiles(): string[] {
  return [...markdownFiles().filter((f) => !HISTORY_FILES.has(f)), ...sourceFiles()];
}

/** Skip markers written without a reason: an exemption must say why. */
export function reasonlessMarkers(): DocRef[] {
  const out: DocRef[] = [];
  for (const file of markdownFiles()) {
    readFileSync(join(ROOT, file), 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (MARKER_WITHOUT_REASON.test(outsideCode(line)))
          out.push({ kind: 'path', file, line: i + 1, text: line.trim() });
      });
  }
  return out;
}

export function deadRefs(files = scannedFiles()): DeadRef[] {
  const dead: DeadRef[] = [];
  for (const file of files) {
    for (const ref of extractRefs(file)) {
      const why = resolve(ref);
      if (why) dead.push({ ...ref, why });
    }
  }
  return dead;
}

export const formatRef = (r: DeadRef): string =>
  `${r.file}:${r.line}  ${r.kind} \`${r.text}\` — ${r.why}`;

if (import.meta.main) {
  const dead = deadRefs();
  for (const r of dead) console.log(formatRef(r));
  console.log(`\n${dead.length} dead reference(s) in ${scannedFiles().length} files.`);
  process.exit(dead.length ? 1 : 0);
}
