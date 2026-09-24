// ═══ The traceability tree: docs/language-design.md as Doorstop items, with the links that go suspect ═══
//
// The design rules are a requirements specification in all but name: 93 numbered rules, each with
// its rationale, its source ("Derives from") and its verification ("Enforced by"). What the
// document could not do on its own is notice when one end of a link moved. A rule whose meaning
// changed left the surface sections that explain it as they were; a test named in "Enforced by"
// could be renamed, or stop mentioning the rule, and the rule went on claiming it.
//
// That is the problem requirements-management tools exist for, and this tree uses one of them,
// Doorstop (https://doorstop.readthedocs.io), in the way regulated industries use traceability
// (DO-178C, ISO 26262): every requirement is an item with a content fingerprint, every child
// records the fingerprint of the parent it was checked against, and a change to the parent makes
// the link SUSPECT until someone reads the child and clears it. `doorstop` fails while any item
// has unreviewed changes, any link is suspect, or any referenced file no longer carries its tag.
//
// THE TREE (reqs/, see reqs/README.md):
//
//   RULE  reqs/rules  one item per `**Rule N.M.**` paragraph, UID RULE-CCNN (Rule 2.1 is RULE-0201).
//                     Text: the paragraph as written. References: every file that verifies it,
//                     with the keyword `Rule N.M`, so Doorstop fails if the file is gone or no
//                     longer names the rule. `verification` says how the rule is held.
//   SURF  reqs/surface  one item per section of docs/use-typeshade-surface.md that a rule cites
//                     ("surface §13") or that cites a rule, UID SURF-NNN (surface §13 is SURF-013),
//                     linked to those rules. When a rule's text changes, its SURF links go suspect.
//
// ONE AUTHORITY. The Markdown stays the normative text (CLAUDE.md); these items are derived from
// it by this script and never edited by hand, the way `src/__api__/surface.md` is baked. What
// the script keeps from the committed items is only what Doorstop owns: the `reviewed`
// fingerprint and each link's stamp. Writing a new text beside an old fingerprint is exactly how
// a change becomes visible, so the script must never reset them.
//
// WHERE A VERIFYING FILE COMES FROM. A `.ts`/`.mjs`/`.yml` path named in the rule's "Enforced by", and
// any file carrying a `Verifies: Rule N.M` tag (a test) or an `Implements: Rule N.M` tag (the
// code). The tag is how a file states its end of the link; a rule held by a diagnostic code or by
// a test the prose calls "that test" gets its evidence this way without the prose changing. An
// author-facing `*.shade.ts` example carries no tag: the suite that compiles it stands in for it.
//
// HOW A RULE IS HELD (`verification`): `test` when a test, a gate script or a CI workflow checks
// it; `code` when only the implementation it names carries it out (an `Implements:` tag), which a
// test should come to cover; `pending` when Appendix B lists it as not yet enforced; `review`
// when its "Enforced by" says review holds it (and, when it opens with "review", ahead of `code`).
// A rule that is none of the three is an error: it claims enforcement nobody can find.
//
// Usage:
//   bun scripts/reqs-sync.ts           write reqs/ from the Markdown
//   bun scripts/reqs-sync.ts --check   exit 1, naming each item, when reqs/ is stale

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, trackedFiles } from './doc-refs.js';

const DESIGN = 'docs/language-design.md';
const SURFACE = 'docs/use-typeshade-surface.md';
const RULES_DIR = 'reqs/rules';
const SHADE_EXAMPLES = 'examples/shade-examples.test.ts';
const SURF_DIR = 'reqs/surface';

export interface RuleItem {
  readonly uid: string;
  readonly number: string;
  readonly text: string;
  /** Verifying files Doorstop checks itself. */
  readonly references: readonly string[];
  /** Verifying files Doorstop cannot see (see `doorstopSees`); `src/reqs.test.ts` checks them. */
  readonly evidence: readonly string[];
  readonly verification: 'test' | 'code' | 'pending' | 'review';
  /** Surface sections this rule's paragraph cites. */
  readonly surface: readonly number[];
}

export interface SurfItem {
  readonly uid: string;
  readonly section: number;
  readonly heading: string;
  readonly rules: readonly string[];
}

export const ruleUid = (n: string): string => {
  const [a, b] = n.split('.').map(Number) as [number, number];
  return `RULE-${String(a).padStart(2, '0')}${String(b).padStart(2, '0')}`;
};
export const surfUid = (n: number): string => `SURF-${String(n).padStart(3, '0')}`;

const read = (f: string): string => readFileSync(join(ROOT, f), 'utf8');

/** Each `**Rule N.M.**` paragraph with its bullets, as [number, lines]. */
export function ruleBlocks(md: string): [string, string[]][] {
  const lines = md.split('\n');
  const out: [string, string[]][] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\*\*Rule (\d+\.\d+)\.\*\*/.exec(lines[i]!);
    if (!m) continue;
    let j = i + 1;
    let bullets = false;
    for (; j < lines.length; j++) {
      const l = lines[j]!;
      if (/^\*\*Rule /.test(l) || /^#{1,6} /.test(l)) break;
      if (/^\s*- /.test(l) || /^\s{2,}\S/.test(l)) bullets = true;
      else if (l.trim() !== '' && bullets) break;
    }
    while (lines[j - 1]?.trim() === '') j--;
    out.push([m[1]!, lines.slice(i, j)]);
  }
  return out;
}

/** Rules Appendix B lists as not yet enforced. */
export function appendixB(md: string): Set<string> {
  const at = md.indexOf('## Appendix B');
  const out = new Set<string>();
  if (at < 0) return out;
  for (const line of md.slice(at).split('\n')) {
    if (!line.startsWith('|')) continue;
    const first = line.split('|')[1] ?? '';
    for (const m of first.matchAll(/Rule (\d+\.\d+)/g)) out.add(m[1]!);
  }
  return out;
}

/** `Verifies: Rule a.b, Rule c.d` (a test) and `Implements: Rule a.b` (the code) tags, by rule number. */
export function verifyTags(files = trackedFiles()): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const f of files) {
    if (
      !/\.(ts|mts|mjs|ya?ml)$/.test(f) ||
      f === 'scripts/reqs-sync.ts' ||
      f.endsWith('reqs.test.ts')
    )
      continue;
    const text = read(f);
    // A tag may wrap onto the next comment line (`// Rule 8.11, …`).
    for (const m of text.matchAll(
      /(?:Verifies|Implements):((?:\s*,?\s*(?:\/\/|#)?\s*Rule \d+\.\d+)+)/g,
    )) {
      for (const r of m[1]!.matchAll(/Rule (\d+\.\d+)/g)) {
        if (!out.has(r[1]!)) out.set(r[1]!, new Set());
        out.get(r[1]!)!.add(f);
      }
    }
  }
  return out;
}

/**
 * Whether Doorstop's reference finder can see a path. It skips every path with a hidden segment
 * (`.github/workflows/ci.yml`) and turns each `.gitignore` line into `*line*` with the slashes
 * and stars stripped, so `coverage/` hides `src/core/intrinsic-coverage.test.ts` too
 * (doorstop 3.2, `core/vcs/base.py`). A file it cannot see would fail as "not found" however
 * true the link is, so such a file is recorded as `evidence` and checked by `src/reqs.test.ts`.
 */
export function doorstopSees(path: string): boolean {
  if (('/' + path).includes('/.')) return false;
  const gitignore = existsSync(join(ROOT, '.gitignore')) ? read('.gitignore') : '';
  for (const line of gitignore.split('\n')) {
    const p = line.replace(/^[ @\\/*]+|[ @\\/*]+$/g, '');
    if (!p || p.startsWith('#')) continue;
    const re = new RegExp(
      '^' +
        `*${p}*`
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.') +
        '$',
    );
    if (re.test(path)) return false;
  }
  return true;
}

/** A file that checks a rule rather than carrying it out: a test, a gate script, a CI workflow. */
export const isVerifying = (f: string): boolean =>
  /\.test\.ts$/.test(f) || f.startsWith('scripts/') || /^\.github\/workflows\//.test(f);

function resolveTracked(token: string, files: readonly string[]): string | null {
  const hits = files.filter((f) => f === token || f.endsWith(`/${token}`));
  return hits.length === 1 ? hits[0]! : null;
}

export function buildRules(md = read(DESIGN), files = trackedFiles()): RuleItem[] {
  const pending = appendixB(md);
  const tags = verifyTags(files);
  return ruleBlocks(md).map(([number, lines]) => {
    const text = lines.join('\n');
    const at = lines.findIndex((l) => /^- Enforced by:/.test(l));
    const enforced = at < 0 ? '' : lines.slice(at).join('\n');
    const refs = new Set<string>(tags.get(number) ?? []);
    for (const m of enforced.matchAll(/`([^`\s]+\.(?:ts|mts|mjs|ya?ml))`/g)) {
      const f = resolveTracked(m[1]!, files);
      // An example is author-facing and carries no tag; the suite that compiles it is the evidence.
      if (f) refs.add(f.endsWith('.shade.ts') ? SHADE_EXAMPLES : f);
    }
    const surface = [
      ...new Set([...text.matchAll(/surface §(\d+)/g)].map((m) => Number(m[1]))),
    ].sort((a, b) => a - b);
    // "Enforced by: review" is the rule's own word on how it is held: a file named after it is the
    // thing review reads (Rule 3.7's `codes.ts`), not an implementation that carries the rule out.
    const verification = [...refs].some(isVerifying)
      ? 'test'
      : /^- Enforced by: review\b/.test(enforced)
        ? 'review'
        : refs.size
          ? 'code'
          : pending.has(number)
            ? 'pending'
            : /\breview\b/.test(enforced)
              ? 'review'
              : null;
    if (!verification) {
      throw new Error(
        `Rule ${number} names no verifying file, is not in Appendix B, and does not say review ` +
          `holds it. Tag the test that verifies it with \`Verifies: Rule ${number}\`, or list it ` +
          'in Appendix B.',
      );
    }
    return {
      uid: ruleUid(number),
      number,
      text,
      references: [...refs].filter(doorstopSees).sort(),
      evidence: [...refs].filter((f) => !doorstopSees(f)).sort(),
      verification,
      surface,
    };
  });
}

/** Surface sections, by number, with their headings and the rules each one cites. */
export function surfaceSections(
  md = read(SURFACE),
): Map<number, { heading: string; cites: Set<string> }> {
  const out = new Map<number, { heading: string; cites: Set<string> }>();
  let current: { heading: string; cites: Set<string> } | null = null;
  let fence = false;
  for (const line of md.split('\n')) {
    if (/^\s*```/.test(line)) fence = !fence;
    if (fence) continue;
    const h = /^## (\d+)\. (.+)$/.exec(line);
    if (h) {
      current = { heading: h[2]!.trim(), cites: new Set() };
      out.set(Number(h[1]), current);
      continue;
    }
    if (/^## /.test(line)) current = null;
    if (current) for (const m of line.matchAll(/\bRule (\d+\.\d+)\b/g)) current.cites.add(m[1]!);
  }
  return out;
}

export function buildSurface(rules: readonly RuleItem[], md = read(SURFACE)): SurfItem[] {
  const sections = surfaceSections(md);
  const known = new Set(rules.map((r) => r.number));
  const links = new Map<number, Set<string>>();
  const add = (s: number, r: string): void => {
    if (!links.has(s)) links.set(s, new Set());
    links.get(s)!.add(r);
  };
  for (const r of rules) for (const s of r.surface) add(s, r.number);
  for (const [s, { cites }] of sections) for (const r of cites) if (known.has(r)) add(s, r);
  return [...links]
    .sort(([a], [b]) => a - b)
    .map(([section, rs]) => {
      const heading = sections.get(section)?.heading;
      if (!heading) throw new Error(`a rule cites surface §${section}, which has no heading`);
      return {
        uid: surfUid(section),
        section,
        heading,
        rules: [...rs].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })),
      };
    });
}

// ─── the files ─────────────────────────────────────────────────────────────────────────────

interface Existing {
  reviewed: string | null;
  links: Map<string, string | null>;
}

function existing(path: string): Existing {
  const none: Existing = { reviewed: null, links: new Map() };
  if (!existsSync(join(ROOT, path))) return none;
  const m = /^---\n([\s\S]*?)\n---\n/.exec(read(path));
  if (!m) return none;
  const front = parseFront(m[1]!) as {
    reviewed?: string | null;
    links?: Record<string, string | null>[];
  };
  const links = new Map<string, string | null>();
  for (const l of front.links ?? []) for (const [k, v] of Object.entries(l)) links.set(k, v);
  return { reviewed: front.reviewed ?? null, links };
}

/**
 * The front matter of a Doorstop item, read without a YAML library: this module runs under vitest
 * on Node as well as under Bun, and the package keeps no dependency for its scripts. It reads the
 * subset Doorstop writes: `key: scalar`, `key:` then `- scalar` items, and `- key: scalar` items
 * with indented `key: scalar` continuation lines (a map per item).
 */
export function parseFront(yaml: string): Record<string, unknown> {
  const scalar = (v: string): unknown => {
    const t = v.trim();
    if (t === 'null' || t === '~' || t === '') return null;
    if (t === 'true' || t === 'false') return t === 'true';
    if (t === '[]') return [];
    if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
    if (t.startsWith('"') && t.endsWith('"')) return JSON.parse(t) as unknown;
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    return t;
  };
  const out: Record<string, unknown> = {};
  let list: unknown[] | null = null;
  let item: Record<string, unknown> | null = null;
  for (const line of yaml.split('\n')) {
    if (!line.trim()) continue;
    const top = /^([\w-]+):(?:\s(.*))?$/.exec(line);
    if (top) {
      item = null;
      if (top[2] === undefined || top[2].trim() === '') {
        list = [];
        out[top[1]!] = list;
      } else {
        list = null;
        out[top[1]!] = scalar(top[2]);
      }
      continue;
    }
    const entry = /^- (.*)$/.exec(line);
    if (entry && list) {
      const kv = /^([^:\s][^:]*):(?:\s(.*))?$/.exec(entry[1]!);
      if (kv) {
        item = { [kv[1]!]: scalar(kv[2] ?? '') };
        list.push(item);
      } else {
        item = null;
        list.push(scalar(entry[1]!));
      }
      continue;
    }
    const cont = /^\s+([\w-]+):(?:\s(.*))?$/.exec(line);
    if (cont && item) item[cont[1]!] = scalar(cont[2] ?? '');
  }
  return out;
}

/** A YAML string as Doorstop writes it: plain when YAML reads it back as the same string. */
const q = (s: string): string =>
  /^[A-Za-z][\w./§ -]*[\w§.]$/.test(s) && !/^(true|false|null|yes|no|on|off)$/i.test(s)
    ? s
    : `'${s.replace(/'/g, "''")}'`;

/** An item as Doorstop writes it: sorted keys, YAML front matter, the text after a blank line. */
function itemFile(front: [string, string][], text: string): string {
  const keys = [...front].sort(([a], [b]) => a.localeCompare(b));
  return `---\n${keys.map(([k, v]) => (v.startsWith('\n') ? `${k}:${v}` : `${k}: ${v}`)).join('\n')}\n---\n\n${text}`;
}

const stamp = (s: string | null | undefined): string => (s ? s : 'null');

/** A level as Doorstop writes it: bare, unless YAML would read it as another number (`8.10`). */
const level = (n: string): string => (/\.\d*0$/.test(n) ? q(n) : n);

export function render(): Map<string, string> {
  const rules = buildRules();
  const surf = buildSurface(rules);
  const files = new Map<string, string>();
  files.set(
    `${RULES_DIR}/.doorstop.yml`,
    "settings:\n  digits: 4\n  itemformat: markdown\n  prefix: RULE\n  sep: '-'\n",
  );
  files.set(
    `${SURF_DIR}/.doorstop.yml`,
    "settings:\n  digits: 3\n  itemformat: markdown\n  parent: RULE\n  prefix: SURF\n  sep: '-'\n",
  );
  for (const r of rules) {
    const path = `${RULES_DIR}/${r.uid}.md`;
    const old = existing(path);
    const refs = r.references.length
      ? '\n' +
        r.references
          .map((f) => `- keyword: ${q(`Rule ${r.number}`)}\n  path: ${f}\n  type: file`)
          .join('\n')
      : ' []';
    files.set(
      path,
      itemFile(
        [
          ['active', 'true'],
          ['derived', 'false'],
          ['level', level(r.number)],
          ['links', '[]'],
          ['normative', 'true'],
          ['ref', "''"],
          ['references', refs],
          ['reviewed', stamp(old.reviewed)],
          ['verification', r.verification],
          ...(r.evidence.length
            ? ([['evidence', '\n' + r.evidence.map((f) => `- ${f}`).join('\n')]] as [
                string,
                string,
              ][])
            : []),
        ],
        r.text,
      ),
    );
  }
  for (const s of surf) {
    const path = `${SURF_DIR}/${s.uid}.md`;
    const old = existing(path);
    const links =
      '\n' + s.rules.map((n) => `- ${ruleUid(n)}: ${stamp(old.links.get(ruleUid(n)))}`).join('\n');
    files.set(
      path,
      itemFile(
        [
          ['active', 'true'],
          ['derived', 'false'],
          ['level', level(String(s.section))],
          ['links', links],
          ['normative', 'true'],
          ['ref', "''"],
          ['reviewed', stamp(old.reviewed)],
          ['source', q(`${SURFACE} §${s.section}`)],
        ],
        // Doorstop's Markdown items carry the header as the text's first heading.
        `# ${s.heading}\n\n${SURFACE} §${s.section}, "${s.heading}": the surface section that explains ${s.rules.map((n) => `Rule ${n}`).join(', ')}.`,
      ),
    );
  }
  return files;
}

/** The items as fields, for a comparison Doorstop's own reformatting cannot disturb. */
export function semantic(text: string): unknown {
  const m = /^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/.exec(text);
  if (!m) return text;
  const front = parseFront(m[1]!) as Record<string, unknown>;
  delete front.reviewed;
  if (Array.isArray(front.links)) {
    front.links = (front.links as Record<string, unknown>[]).map((l) => Object.keys(l)[0]);
  }
  if (front.level !== undefined) front.level = String(front.level);
  return { ...front, text: m[2]!.trimEnd() };
}

function itemsOn(dir: string): string[] {
  return existsSync(join(ROOT, dir))
    ? readdirSync(join(ROOT, dir))
        .filter((f) => f.endsWith('.md') || f === '.doorstop.yml')
        .map((f) => `${dir}/${f}`)
    : [];
}

export function stale(want = render()): string[] {
  const problems: string[] = [];
  for (const [path, text] of want) {
    if (!existsSync(join(ROOT, path))) problems.push(`${path}: missing`);
    else if (
      path.endsWith('.md') &&
      JSON.stringify(semantic(read(path))) !== JSON.stringify(semantic(text))
    )
      problems.push(`${path}: differs from ${path.startsWith(RULES_DIR) ? DESIGN : SURFACE}`);
  }
  for (const path of [...itemsOn(RULES_DIR), ...itemsOn(SURF_DIR)]) {
    if (!want.has(path)) problems.push(`${path}: no longer derived from the Markdown`);
  }
  return problems;
}

if (import.meta.main) {
  const want = render();
  if (process.argv.includes('--check')) {
    const problems = stale(want);
    for (const p of problems) console.log(p);
    if (problems.length)
      console.log('\nreqs/ is stale: run `bun run reqs:sync`, then `doorstop` (reqs/README.md).');
    process.exit(problems.length ? 1 : 0);
  }
  for (const dir of [RULES_DIR, SURF_DIR]) mkdirSync(join(ROOT, dir), { recursive: true });
  for (const path of [...itemsOn(RULES_DIR), ...itemsOn(SURF_DIR)]) {
    if (!want.has(path)) rmSync(join(ROOT, path));
  }
  for (const [path, text] of want) writeFileSync(join(ROOT, path), text);
  console.log(`wrote ${want.size} files under reqs/`);
}
