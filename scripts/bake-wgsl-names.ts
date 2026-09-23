// ═══ The WGSL name fixture — every name the specification itself spells ═══
//
// WHAT IT IS. `src/core/spec-conformance/fixtures/wgsl-names.json` is the set of names WGSL
// predeclares: built-in functions, predeclared types and type-generators, built-in values,
// attributes, keywords, reserved words, and the two extension lists. Each list records the
// `{#section-id}` of the specification section it was read from, so a reviewer can check a row
// against the spec without guessing where it came from.
//
// WHY IT EXISTS. The `"use typeshade"` surface is WGSL builtins, WGSL types and ordinary
// TypeScript — nothing else. The surface-names test reads this fixture and holds every
// author-facing spelling this package introduces against it: a name that is not in the fixture
// is not a WGSL name, so it is a TypeShade invention and has to be justified or removed. That
// rule was written after a pair of internal f64 helpers reached the author surface; a checked-in
// list of the real WGSL names is what makes the rule mechanical instead of a matter of taste.
//
// WHY A FIXTURE AND NOT A FETCH. The suite must be offline and deterministic. A test that
// downloaded `index.bs` would go red without a network and would silently change what it asserts
// whenever the WGSL editors land a commit. The fixture is a dated snapshot identified by
// `specCommit`; this script is how it is refreshed, so "regenerate it" is a command rather than
// a paragraph.
//
// TO REGENERATE (from the package root):
//
//   git clone --depth 1 https://github.com/gpuweb/gpuweb ../gpuweb
//   bun scripts/bake-wgsl-names.ts ../gpuweb      # or: WGSL_SPEC=<path> bun run bake:wgsl-names
//
// The path is a gpuweb/gpuweb checkout, not a file: the script reads `wgsl/index.bs` and
// `wgsl/wgsl.reserved.plain` from it and takes `specCommit` from `git rev-parse HEAD`.
//
// WHAT TO CHECK AFTER A REFRESH. The script prints one line per list and refuses to write when
// a self-check fails, so a silent parse regression cannot land:
//   * the counts move by as much as the spec's own changelog says they should, and no more;
//   * `textureSample`, `atomicCompareExchangeWeak`, `quantizeToF16`, `workgroupUniformLoad` and
//     `subgroupAdd` are in `builtinFunctions`, and the spec's example functions (`vs_main`,
//     `foo`) are not — the sentinels below pin exactly that;
//   * the names DECLARED in the built-in functions section and the names that have a section of
//     their own there are the same set — two independent readings of the same prose, which is
//     what makes this parser trustworthy without a hand-maintained expected list;
//   * `reservedWords` matches `wgsl.reserved.plain` line for line (146 at the baked commit).
// Then run `bun run test src/core/spec-conformance/` and claim every name the suite names as new.
//
// SPEC MARKUP NOTES (why the parsing is what it is, not a plain grep):
//   * A built-in function is declared in three different shapes: an `<xmp highlight=wgsl>` inside
//     a `<table class='data builtin'>` (most of them), an `<xmp>` inside a plain
//     `<table class='data'>` (every texture overload), and a bare ```wgsl fence at section level
//     (the atomics, `atomicStoreMin` and `atomicStoreMax`). Only declaration contexts are read;
//     the spec's `<div class='example'>` blocks inside the same section define `foo`, `bar`,
//     `main` and `num_point_lights`, which are not built-ins.
//   * `bitcast`, `bufferView` and `bufferArrayView` are only ever written with an explicit
//     template list (`fn bitcast<T>(…)`), so the declaration pattern has to accept `<` as well
//     as `(` after the name.
//   * The zero-value and structure constructors are written over metavariables (`fn T()`,
//     `fn S(…)`). Every predeclared WGSL name starts with a lowercase letter and the spec's
//     metavariables are single capitals, so that is the filter.
//   * The built-in value summary table uses `rowspan` to give `position`, `sample_mask`,
//     `subgroup_invocation_id` and `subgroup_size` two stage/direction rows each, which is the
//     only place the spec states that `position` is a vertex output AND a fragment input. The
//     per-value sections below the table state one stage each and would lose that, so the
//     summary table is parsed with its spans expanded.
//   * Enable-extension names are defined backticked (`` <dfn dfn-for="extension">`f16`</dfn> ``)
//     and language-extension names bare (`<dfn for="language_extension">subgroup_id</dfn>`).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'src', 'core', 'spec-conformance', 'fixtures', 'wgsl-names.json');
const REPO = 'https://github.com/gpuweb/gpuweb';

/** A checkout beside the package is the convention here; `WGSL_SPEC` or argv[2] overrides it. */
const specPath = process.argv[2] ?? process.env['WGSL_SPEC'] ?? join(ROOT, '..', 'gpuweb');

// ─── Bikeshed text ───

/** Bikeshed cell or list text to the plain name it spells. `[=built-in values/position=]` is
 *  `position`, `[[WebGPU#shader-f16|"shader-f16"]]` is `"shader-f16"`, `vec4&lt;f32&gt;` is
 *  `vec4<f32>`. Autolink targets carry the qualifier before the `/` and the display text after
 *  the `|`, which is the part a reader sees and the part a name list wants. */
function plain(text: string): string {
  return text
    .replace(/\[=[^=|\]]*\|([^=\]]*)=\]/g, '$1')
    .replace(/\[=[^=\]]*\/([^=\]]*)=\]/g, '$1')
    .replace(/\[=([^=\]]*)=\]/g, '$1')
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\{\{[^}/]*\/([^}]*)\}\}/g, '$1')
    .replace(/\{\{([^}]*)\}\}/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&le;/g, '<=')
    .replace(/&equals;/g, '=')
    .replace(/&amp;/g, '&')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Sections ───

/** The half-open line range of the section with this `{#id}`, up to the next heading at the
 *  same level or shallower. `# Built-in Functions #` therefore carries its 20 subsections with
 *  it, and `#### Built-in Inputs and Outputs ####` carries the per-value `#####` sections. */
function sectionRange(lines: readonly string[], id: string): { start: number; end: number } {
  const open = new RegExp(`^(#{1,6}) .*\\{#${id}\\}\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    const m = open.exec(lines[i] ?? '');
    if (m === null) continue;
    const level = (m[1] ?? '').length;
    const close = new RegExp(`^#{1,${String(level)}} `);
    for (let j = i + 1; j < lines.length; j++) {
      if (close.test(lines[j] ?? '')) return { start: i, end: j };
    }
    return { start: i, end: lines.length };
  }
  throw new Error(`section {#${id}} not found in the spec source`);
}

// ─── Tables ───

/** One HTML-ish table of `index.bs`, with `rowspan` expanded so every row has every column.
 *  Bikeshed tables omit `</td>` and `</tr>` entirely and wrap cells over many lines, so the
 *  split is on the opening tags. Header rows are dropped; the header only fixes the width. */
function parseTable(block: string): string[][] {
  const width = (/<thead>([\s\S]*?)<\/thead>/.exec(block)?.[1]?.match(/<th\b/g) ?? []).length;
  const body = block.replace(/<thead>[\s\S]*?<\/thead>/g, '');
  const rows: string[][] = [];
  const pending = new Map<number, { text: string; left: number }>();
  for (const chunk of body.split(/<tr\b/).slice(1)) {
    const cells = chunk
      .split(/<td\b/)
      .slice(1)
      .map((cell) => {
        const gt = cell.indexOf('>');
        const attrs = gt < 0 ? '' : cell.slice(0, gt);
        const span = /rowspan\s*=\s*"?(\d+)"?/.exec(attrs);
        return { text: plain(gt < 0 ? cell : cell.slice(gt + 1)), span: Number(span?.[1] ?? '1') };
      });
    const row: string[] = [];
    let col = 0;
    let next = 0;
    while (col < Math.max(width, cells.length) || next < cells.length) {
      const held = pending.get(col);
      if (held !== undefined && held.left > 0) {
        row[col] = held.text;
        held.left -= 1;
        col += 1;
        continue;
      }
      const cell = cells[next];
      if (cell === undefined) break;
      row[col] = cell.text;
      if (cell.span > 1) pending.set(col, { text: cell.text, left: cell.span - 1 });
      next += 1;
      col += 1;
    }
    rows.push(row);
  }
  return rows;
}

/** Every name that has its own `### `name` ###` section under `# Built-in Functions #`. This is
 *  an INDEPENDENT reading of the same section — headings, not declarations — and the two must
 *  agree exactly. They do at the baked commit (169 each), which is what makes the declaration
 *  parsing above trustworthy without a hand-maintained expected list. */
function builtinFunctionHeadings(lines: readonly string[]): string[] {
  const { start, end } = sectionRange(lines, 'builtin-functions');
  const names = new Set<string>();
  for (let i = start; i < end; i++) {
    // `### `abs` (signed) ###` — the parenthesised overload note is part of the heading text.
    const m = /^#{2,6} `(\w+)`[^#]*#{2,6} \{#[\w-]+\}\s*$/.exec(lines[i] ?? '');
    if (m !== null) names.add(m[1] ?? '');
  }
  return [...names].sort();
}

/** The table whose `<caption>` contains this text, as one string. */
function tableWithCaption(block: string, caption: string): string {
  for (const t of block.split(/<table\b/).slice(1)) {
    const end = t.indexOf('</table>');
    const text = end < 0 ? t : t.slice(0, end);
    if (new RegExp(`<caption>[^<]*${caption}`).test(text)) return text;
  }
  throw new Error(`table with caption ${caption} not found`);
}

// ─── The lists ───

/** Every built-in function name declared in `# Built-in Functions #`. See the SPEC MARKUP NOTES
 *  above: declarations live in table cells and in section-level ```wgsl fences, and everything
 *  else in the section is example or pseudocode text. */
function builtinFunctions(lines: readonly string[]): string[] {
  const { start, end } = sectionRange(lines, 'builtin-functions');
  const names = new Set<string>();
  let inTable = false;
  let inFence = false;
  let divDepth = 0;
  for (let i = start; i < end; i++) {
    const raw = lines[i] ?? '';
    const line = raw.trim();
    if (/^```wgsl/.test(line)) {
      inFence = true;
      continue;
    }
    if (inFence && line === '```') {
      inFence = false;
      continue;
    }
    if (/<table\b/.test(line)) inTable = true;
    divDepth += (line.match(/<div\b/g) ?? []).length - (line.match(/<\/div>/g) ?? []).length;
    // A fence inside a `<div>` is an example or an "operation of X as a function" rewrite, which
    // re-declares the built-in it explains; only a fence at section level is the declaration.
    if (inTable || (inFence && divDepth === 0)) {
      for (const m of raw.matchAll(/\bfn\s+([A-Za-z_]\w*)\s*[<(]/g)) {
        const name = m[1] ?? '';
        if (/^[a-z]/.test(name)) names.add(name);
      }
    }
    if (inTable && /<\/table>/.test(line)) inTable = false;
  }
  return [...names].sort();
}

/** The predeclared spellable types (a bullet list) and the predeclared type-generators (the
 *  first column of the table that follows them). */
function predeclared(lines: readonly string[]): { types: string[]; generators: string[] } {
  const { start, end } = sectionRange(lines, 'predeclared-types');
  const block = lines.slice(start, end).join('\n');
  const intro = block.slice(0, block.indexOf('<table'));
  const types = [...intro.matchAll(/^\* (\[=[^\n]*=\])\s*$/gm)].map((m) => plain(m[1] ?? ''));
  const generators = parseTable(tableWithCaption(block, 'Predeclared type generators'))
    .map((row) => row[0] ?? '')
    .filter((name) => name !== '');
  return { types: types.sort(), generators: generators.sort() };
}

interface BuiltinValue {
  readonly name: string;
  /** One entry per stage the value is available in; `position` has two. */
  readonly stages: readonly { readonly stage: string; readonly direction: string }[];
  readonly type: string;
  /** The extension the value needs, `''` when it is always available. */
  readonly extension: string;
}

/** The built-in value summary table: name, stage, direction, type, extension. */
function builtinValues(lines: readonly string[]): BuiltinValue[] {
  const { start, end } = sectionRange(lines, 'builtin-inputs-outputs');
  const block = lines.slice(start, end).join('\n');
  const rows = parseTable(tableWithCaption(block, 'Built-in input and output values'));
  const byName = new Map<
    string,
    { stages: { stage: string; direction: string }[]; type: string; extension: string }
  >();
  for (const row of rows) {
    const name = row[0] ?? '';
    if (name === '') continue;
    const entry = byName.get(name) ?? { stages: [], type: row[3] ?? '', extension: row[4] ?? '' };
    entry.stages.push({ stage: row[1] ?? '', direction: row[2] ?? '' });
    byName.set(name, entry);
  }
  return [...byName.entries()]
    .map(([name, e]) => ({ name, stages: e.stages, type: e.type, extension: e.extension }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Every attribute that has its own section under `# Attributes #`, including the three shader
 *  stage attributes, whose sections are one level deeper but carry the same `-attr` id. */
function attributes(lines: readonly string[]): string[] {
  const { start, end } = sectionRange(lines, 'attributes');
  const names = new Set<string>();
  for (let i = start; i < end; i++) {
    const m = /^#{2,6} `(\w+)` #{2,6} \{#[\w-]+-attr\}\s*$/.exec(lines[i] ?? '');
    if (m !== null) names.add(m[1] ?? '');
  }
  return [...names].sort();
}

/** The keyword summary bullet list. */
function keywords(lines: readonly string[]): string[] {
  const { start, end } = sectionRange(lines, 'keyword-summary');
  const block = lines.slice(start, end).join('\n');
  return [...block.matchAll(/<dfn for=syntax_kw[^>]*>`(\w+)`<\/dfn>/g)]
    .map((m) => m[1] ?? '')
    .sort();
}

/** The names defined in one extension table. Enable-extensions are defined backticked and
 *  language extensions bare, so the backticks are optional in the pattern. */
function extensions(lines: readonly string[], id: string, dfnFor: string): string[] {
  const { start, end } = sectionRange(lines, id);
  const block = lines.slice(start, end).join('\n');
  const dfn = new RegExp(`<dfn[^>]*\\bd?f?n?-?for="${dfnFor}"[^>]*>\`?(\\w+)\`?</dfn>`, 'g');
  return [...block.matchAll(dfn)].map((m) => m[1] ?? '').sort();
}

// ─── Bake ───

if (!existsSync(join(specPath, 'wgsl', 'index.bs'))) {
  console.error(
    `no WGSL spec source at ${specPath}\n` +
      `usage: bun scripts/bake-wgsl-names.ts <gpuweb checkout>\n` +
      `  git clone --depth 1 ${REPO} ${join(ROOT, '..', 'gpuweb')}`,
  );
  process.exit(1);
}

const lines = readFileSync(join(specPath, 'wgsl', 'index.bs'), 'utf8').split('\n');
const reservedWords = readFileSync(join(specPath, 'wgsl', 'wgsl.reserved.plain'), 'utf8')
  .split('\n')
  .map((w) => w.trim())
  .filter((w) => w !== '');
const specCommit = execFileSync('git', ['-C', specPath, 'rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();

const fns = builtinFunctions(lines);
const { types, generators } = predeclared(lines);
const values = builtinValues(lines);

// Self-check. A parse that loses the declaration shapes, or that starts eating the spec's
// example functions, fails HERE rather than in a fixture nobody re-reads.
const present = [
  'textureSample',
  'atomicCompareExchangeWeak',
  'quantizeToF16',
  'workgroupUniformLoad',
  'subgroupAdd',
  'bitcast',
  'atomicStoreMin',
  'array',
  'vec4',
  'mat2x3',
  'f32',
] as const;
const absent = ['vs_main', 'fs_main', 'foo', 'bar', 'main', 'T', 'S'] as const;
const headings = builtinFunctionHeadings(lines);
const problems = [
  ...present.filter((n) => !fns.includes(n)).map((n) => `builtinFunctions is missing ${n}`),
  ...absent.filter((n) => fns.includes(n)).map((n) => `builtinFunctions wrongly contains ${n}`),
  // The two independent readings of the same section must agree. When they stop agreeing the
  // spec has grown a markup shape this script does not know about, and the right answer is to
  // look at the named name in `index.bs`, not to relax the check.
  ...fns
    .filter((n) => !headings.includes(n))
    .map((n) => `${n} is declared in the section but has no section of its own`),
  ...headings
    .filter((n) => !fns.includes(n))
    .map((n) => `${n} has a section of its own but no declaration this script can read`),
  ...(values.some((v) => v.name === 'position' && v.stages.length === 2)
    ? []
    : ['builtinValues lost the rowspan on position (vertex output and fragment input)']),
  ...(reservedWords.length > 0 ? [] : ['wgsl.reserved.plain read as empty']),
];
if (problems.length > 0) {
  console.error(`${OUT} NOT written:\n${problems.map((p) => `  ${p}`).join('\n')}`);
  process.exit(1);
}

const attrs = attributes(lines);
const kws = keywords(lines);
const enableExtensions = extensions(lines, 'enable-extensions-sec', 'extension');
const languageExtensions = extensions(lines, 'language-extensions-sec', 'language_extension');

// Every list is written in one literal, in a fixed key order and over sorted names, so a re-bake
// of an unchanged spec produces a byte-identical file and `git diff` stays a review tool.
const out = {
  specRepository: REPO,
  specCommit,
  generator: 'scripts/bake-wgsl-names.ts',
  builtinFunctions: { section: 'builtin-functions', count: fns.length, names: fns },
  predeclaredTypes: { section: 'predeclared-types', count: types.length, names: types },
  typeGenerators: { section: 'predeclared-types', count: generators.length, names: generators },
  builtinValues: { section: 'builtin-inputs-outputs', count: values.length, values },
  attributes: { section: 'attributes', count: attrs.length, names: attrs },
  keywords: { section: 'keyword-summary', count: kws.length, names: kws },
  reservedWords: {
    section: 'reserved-words',
    source: 'wgsl/wgsl.reserved.plain',
    count: reservedWords.length,
    names: reservedWords,
  },
  enableExtensions: {
    section: 'enable-extensions-sec',
    count: enableExtensions.length,
    names: enableExtensions,
  },
  languageExtensions: {
    section: 'language-extensions-sec',
    count: languageExtensions.length,
    names: languageExtensions,
  },
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
for (const [key, list] of Object.entries(out)) {
  if (typeof list === 'object' && 'count' in list) {
    console.log(`${String(list.count).padStart(4)}  ${key}  (§${list.section})`);
  }
}
console.log(`→ ${OUT} at gpuweb ${specCommit.slice(0, 12)}`);
