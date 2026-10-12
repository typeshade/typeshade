// ═══ The WebGL extension fixture — every extension the Khronos WebGL registry lists ═══
//
// WHAT IT IS. `src/core/spec-conformance/fixtures/webgl-extensions.json` holds one row per WebGL
// extension of the registry: each `extensions/<NAME>/extension.xml`, each proposal under
// `extensions/proposals/` and each rejected extension under `extensions/rejected/`. A row gives
// the registry status, the number the registry assigns, the WebGL versions the registry lists,
// the extension's status in WebGL 2, the IDL interface the registry defines and the file the row
// was read from.
//
// WHY IT EXISTS. `lib.dom.d.ts` declares only the WebGL extensions TypeScript has typed. The
// capability coverage table of `changes/0059-capability-coverage.md` must name every WebGL
// extension. Proposal 0059, Unresolved decisions, item 3, takes the list from the registry, baked
// at a fixed commit with the read date recorded, and not from memory.
//
// WHY A FIXTURE AND NOT A FETCH. The suite must be offline and deterministic. The registry site,
// https://registry.khronos.org/webgl/extensions/, answered HTTP 403 when this fixture was first
// baked, so the bake reads a checkout of the GitHub repository instead. The fixture names the
// commit it read, that commit's date and the date of the read. A refresh is then a reviewed diff
// of this file, and a change in what the suite asserts shows in review.
//
// TO REGENERATE (from the package root):
//
//   git clone --depth 1 https://github.com/KhronosGroup/WebGL ../webgl
//   bun scripts/bake-webgl-extensions.ts ../webgl --read <YYYY-MM-DD>
//   # or: bun run bake:webgl-extensions ../webgl --read <YYYY-MM-DD>
//
// The path is a KhronosGroup/WebGL checkout, not a file. `--read` is the date the registry was
// read, not the date of the commit. The script takes `registryCommit` from `git rev-parse HEAD`
// and `registryCommitDate` from `git log -1 --format=%cI` in that checkout. Both run through
// `execFileSync` with an argument array, so no shell reads the path. A git failure throws before
// anything is written. The output is a function of the checkout and the `--read` date alone.
//
// THE FIELDS.
//   status      The name of the root element of `extension.xml`:
//                 `<ratified>`   ratified
//                 `<extension>`  community-approved (the root of most extensions, not ratified)
//                 `<draft>`      draft
//                 `<proposal>`   proposal, under extensions/proposals/
//                 `<rejected>`   rejected, under extensions/rejected/
//   number      The `<number>` element as an integer when it holds one, else null. Some proposals
//               and rejected extensions hold a placeholder there (`NN`, `XYZ`, `k`), so their
//               field is null.
//   webgl       The `version` of each `<api>` child of `<depends>`, in document order. A version
//               is kept as written: a proposal names `1.0.2`.
//   webgl2      The extension's status in WebGL 2, from the markers of `<depends>` for version 2.0.
//               The checks run in this order, and the first that holds gives the value:
//                 removed    a `<removed version="2.0"/>`
//                 subsumed   a `<subsumed version="2.0" by="…"/>`, covered by another extension
//                 core       a `<core version="2.0">`, promoted into the core API
//                 applies    an `<api version="2.0"/>`, written against WebGL 2.0
//                 inherits   no marker above, and an `<api version="1.x"/>`: written against
//                            WebGL 1.0 only. The registry renders that as "Written against the
//                            WebGL 1.0 specification" (`extensions/extension.xsl`), so the
//                            extension is available on WebGL 2 by the registry's convention.
//                 no         given only by `NO_WEBGL2` below, never by a marker.
//               A `<depends>` with no `<api>` version and no marker throws, and nothing is written.
//               No `<depends>` holds two of `removed`, `subsumed`, `core` and `applies` at the
//               baked commit. The order in which `webgl2Of` checks those four decides no value
//               there. No self-check pins that order among them: swapping it changes no row. The
//               place of `inherits` does decide values. 18 rows have an `<api version="1.x"/>` and
//               one of those four markers. `webgl2Of` gives each the value of its marker. Checking
//               `inherits` first would give them `inherits`. In that case the sentinels
//               `OES_vertex_array_object` (core), `OES_texture_float` (removed),
//               `WEBGL_color_buffer_float` (subsumed) and `WEBGL_texture_source_iframe` (applies)
//               of `WEBGL2_SENTINELS` fail the bake. Checked 2026-10-12.
//   interface   The IDL interface named after the extension (`interface <NAME>`), else the first
//               `interface` the `<idl>` element declares, else null. Most extensions declare one
//               interface; some also declare the object type their methods return.
//   path        The file the row was read from, relative to the checkout.
//
// THE 'no' EXCEPTIONS (`NO_WEBGL2`). No marker says that an extension is not on WebGL 2. The
// registry says so in prose, so the script names each such extension with the lines that say it.
// At bake time the script reads those lines, checks that the phrase is on them, and throws when the
// markers would give any value other than `inherits`. A stale entry cannot override a marker.
//   * EXT_disjoint_timer_query, extension.xml lines 42-43: "only on WebGL 1.0 contexts. See the
//     EXT_disjoint_timer_query_webgl2 extension for how it is exposed on WebGL 2.0 contexts."
//     Line 413, a change note, says the document "only applies to WebGL 1.0" (the same fact).
// The search of 2026-10-12 covered every `extensions/*/extension.xml` except the template, for
// "WebGL 1.0 contexts", "WebGL 2.0 contexts", "WebGL 1" and "WebGL 2" prose, "only on/in WebGL",
// "not … in WebGL 2", "removed/replaced/instead … WebGL", and the marker-free phrase "2.0 contexts".
// Those hits are not `no`: EXT_color_buffer_half_float (lines 50, 112 and 201) is exposed on WebGL
// 2.0 contexts (its 2016 change note at line 193 says "Subsumed", but no marker says so, and the
// 2020 change note at line 201 re-exposes it); EXT_float_blend (line 35) applies to both WebGL 1.0
// and 2.0 contexts; EXT_texture_filter_anisotropic (line 24) adds WebGL 2 entry points. These are
// `inherits`. OVR_multiview2 (lines 60, 237) and EXT_texture_norm16 (line 64) are `applies`.
//
// REGISTRY MARKUP NOTES (why the reading is what it is, not a plain grep):
//   * `extensions/template/` is the authoring template, not an extension. Its `extension.xml`
//     describes a placeholder named `OES_foo_bar`. `NOT_EXTENSIONS` excludes it from the scan of
//     `extensions/`, and a self-check fails if a row is named `template`. The script also skips
//     `extensions/schematron/` (rules, no `extension.xml`) and the two group directories.
//   * Comments are removed before any tag is read. The template's comments name the tags it
//     documents, so a tag read from the raw text would be read twice.
//   * `<core>`, `<removed>` and `<subsumed>` are children of `<depends>`, beside `<api>`, and not
//     of `<api>`. `<ext>` children name other extensions; the fixture does not record them.
//   * The `<name>` element equals the directory name in every file. A file where it does not is
//     an error, because the directory name is the row's name.
//
// WHAT TO CHECK AFTER A REFRESH. The script prints one line per group and refuses to write when
// a self-check fails, so a silent parse regression cannot land:
//   * At the baked commit, `extensions/` holds 57 extensions (18 ratified, 35 community-approved,
//     4 draft), `extensions/proposals/` holds 5 and `extensions/rejected/` holds 15: 77 rows.
//     The template is not one of the 57.
//   * The six sentinels of `SENTINELS` are present. `OES_sample_variables` is community-approved, not
//     ratified: its root element is `<extension>`, and its history says it was promoted to
//     community approved. The eight `webgl2` sentinels (`WEBGL2_SENTINELS`) hold their values,
//     and every `webgl2` value is one of the six in `WEBGL2_VALUES`.
//   * Read the diff of the fixture as a reviewer reads a registry change. A status that moves, a
//     `webgl2` value that moves or a row that disappears each needs a reason in the record.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'src', 'core', 'spec-conformance', 'fixtures', 'webgl-extensions.json');
const REPO = 'https://github.com/KhronosGroup/WebGL';
const READ_FROM =
  'the GitHub mirror; https://registry.khronos.org/webgl/extensions/ answered HTTP 403 on 2026-10-12';
const USAGE =
  'usage: bun scripts/bake-webgl-extensions.ts <KhronosGroup/WebGL checkout> --read <YYYY-MM-DD>';

// ─── Arguments ───

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { read: { type: 'string' } },
});
const checkout = positionals[0];
const read = values.read;

/** A `YYYY-MM-DD` date that names a real day. */
function isDay(text: string | undefined): text is string {
  if (text === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const day = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === text;
}

if (checkout === undefined || !isDay(read)) {
  console.error(USAGE);
  process.exit(1);
}

// ─── Types ───

type Status = 'ratified' | 'community-approved' | 'draft' | 'proposal' | 'rejected';

/** The six values of `webgl2`, in the order of the header. The type is derived from this list. */
const WEBGL2_VALUES = ['applies', 'inherits', 'core', 'subsumed', 'removed', 'no'] as const;
type Webgl2Status = (typeof WEBGL2_VALUES)[number];

/** Extensions the registry says are not exposed on WebGL 2.0 contexts, by prose. `phrase` must
 *  appear on `lines` (1-based, inclusive) of the raw `extension.xml`, or the bake throws. */
const NO_WEBGL2: readonly {
  readonly name: string;
  readonly lines: readonly [number, number];
  readonly phrase: string;
}[] = [{ name: 'EXT_disjoint_timer_query', lines: [42, 43], phrase: 'only on WebGL 1.0 contexts' }];

interface Entry {
  readonly name: string;
  readonly status: Status;
  readonly number: number | null;
  readonly webgl: string[];
  readonly webgl2: Webgl2Status;
  readonly interface: string | null;
  readonly path: string;
}

/** The root element of `extension.xml` names the status. */
const STATUS_OF_ROOT = new Map<string, Status>([
  ['ratified', 'ratified'],
  ['extension', 'community-approved'],
  ['draft', 'draft'],
  ['proposal', 'proposal'],
  ['rejected', 'rejected'],
]);

/** Each registry directory holds its own statuses. A file under the wrong directory is a defect. */
const GROUPS: { readonly dir: string; readonly statuses: readonly Status[] }[] = [
  { dir: 'extensions', statuses: ['ratified', 'community-approved', 'draft'] },
  { dir: 'extensions/proposals', statuses: ['proposal'] },
  { dir: 'extensions/rejected', statuses: ['rejected'] },
];

/** Directories under `extensions/` that hold no extension of their own. The template's
 *  `extension.xml` is a placeholder, and `schematron/` holds rules and no `extension.xml`. */
const NOT_EXTENSIONS = new Set(['proposals', 'rejected', 'schematron', 'template']);

// ─── Reading the registry ───

/** The file without its XML declaration and without comments. */
function plainXml(xml: string): string {
  return xml.replace(/<\?xml[^>]*\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
}

/** The trimmed text of the first `<tag>` element, or undefined when the file has none. */
function element(body: string, tag: string): string | undefined {
  return new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(body)?.[1]?.trim();
}

/** Every `<depends>` block of the file, joined. A file has one; a second one is still read. */
function dependsOf(body: string): string {
  return [...body.matchAll(/<depends>([\s\S]*?)<\/depends>/g)].map((m) => m[1] ?? '').join('\n');
}

/** The WebGL 2 status from the markers of `<depends>` for version 2.0. The order of the checks
 *  decides when several hold: removed, subsumed, core, applies. `inherits` needs an `<api>` of
 *  version 1.x and no 2.0 marker. Undefined when neither holds. `no` is never returned here. */
function webgl2Of(depends: string): Webgl2Status | undefined {
  const marks = new Set(
    [...depends.matchAll(/<(api|core|removed|subsumed)\b[^>]*\bversion="2\.0"/g)].map(
      (m) => m[1] ?? '',
    ),
  );
  if (marks.has('removed')) return 'removed';
  if (marks.has('subsumed')) return 'subsumed';
  if (marks.has('core')) return 'core';
  if (marks.has('api')) return 'applies';
  if (/<api\b[^>]*\bversion="1\./.test(depends)) return 'inherits';
  return undefined;
}

/** Whether `phrase` appears on the 1-based, inclusive `lines` of the raw file, spaces normalised. */
function linesSay(xml: string, [from, to]: readonly [number, number], phrase: string): boolean {
  return xml
    .split('\n')
    .slice(from - 1, to)
    .join(' ')
    .replace(/\s+/g, ' ')
    .includes(phrase);
}

/** The interface named after the extension, else the first one the `<idl>` element declares. */
function interfaceOf(body: string, name: string): string | null {
  const idl = /<idl\b[^>]*>([\s\S]*?)<\/idl>/.exec(body)?.[1];
  if (idl === undefined) return null;
  const declared = [...idl.matchAll(/\binterface\s+(\w+)/g)].map((m) => m[1] ?? '');
  return declared.includes(name) ? name : (declared[0] ?? null);
}

/** One `extension.xml` as a row. It throws, and nothing is written, when a field it needs is
 *  absent: a missing root, an unknown root, a `<name>` that is not the directory name, no
 *  `<depends>` or no WebGL 2 status. It also throws when `NO_WEBGL2` names a row whose markers do
 *  not say `inherits`, or whose cited lines do not say the phrase. The self-checks below handle
 *  what it can read but may not accept (an empty `webgl` list). */
function parseExtension(xml: string, name: string, path: string): Entry {
  const body = plainXml(xml);
  const root = /^\s*<([A-Za-z][\w-]*)[\s>/]/.exec(body)?.[1];
  const status = root === undefined ? undefined : STATUS_OF_ROOT.get(root);
  if (status === undefined) throw new Error(`${path}: unknown root element ${root ?? '(none)'}`);
  const declaredName = element(body, 'name');
  if (declaredName !== name) {
    throw new Error(
      `${path}: <name> is ${declaredName ?? '(none)'}, not the directory name ${name}`,
    );
  }
  const depends = dependsOf(body);
  if (depends === '') throw new Error(`${path}: no <depends> element`);
  const marked = webgl2Of(depends);
  if (marked === undefined) throw new Error(`${path}: <depends> names no WebGL version`);
  const exception = NO_WEBGL2.find((x) => x.name === name);
  let webgl2: Webgl2Status = marked;
  if (exception !== undefined) {
    if (marked !== 'inherits') {
      throw new Error(`${path}: listed in NO_WEBGL2, but its <depends> gives ${marked}`);
    }
    if (!linesSay(xml, exception.lines, exception.phrase)) {
      throw new Error(
        `${path}: lines ${exception.lines.join('-')} do not say "${exception.phrase}"`,
      );
    }
    webgl2 = 'no';
  }
  const number = element(body, 'number');
  return {
    name,
    status,
    number: number !== undefined && /^\d+$/.test(number) ? Number(number) : null,
    webgl: [...depends.matchAll(/<api\b[^>]*\bversion="([^"]+)"/g)].map((m) => m[1] ?? ''),
    webgl2,
    interface: interfaceOf(body, name),
    path,
  };
}

/** The names of the subdirectories of one directory of the checkout, sorted. */
function subdirectories(dir: string): string[] {
  return readdirSync(join(checkout, dir), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

// ─── Bake ───

/** A checkout's HEAD and its commit date. `execFileSync` throws on a non-zero exit. */
function git(...args: string[]): string {
  return execFileSync('git', ['-C', checkout, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

const registryCommit = git('rev-parse', 'HEAD');
const registryCommitDate = git('log', '-1', '--format=%cI');

const rows: { readonly dir: string; readonly entry: Entry }[] = [];
const problems: string[] = [];

for (const group of GROUPS) {
  const found =
    group.dir === 'extensions'
      ? subdirectories(group.dir).filter((n) => !NOT_EXTENSIONS.has(n))
      : subdirectories(group.dir);
  for (const name of found) {
    const path = `${group.dir}/${name}/extension.xml`;
    if (!existsSync(join(checkout, path))) {
      problems.push(`${group.dir}/${name} holds no extension.xml`);
      continue;
    }
    const entry = parseExtension(readFileSync(join(checkout, path), 'utf8'), name, path);
    rows.push({ dir: group.dir, entry });
    if (!group.statuses.includes(entry.status)) {
      problems.push(`${path} has status ${entry.status}, which ${group.dir}/ does not hold`);
    }
    if (entry.webgl.length === 0) problems.push(`${path} names no <api> version`);
  }
}

const entries = rows
  .map((r) => r.entry)
  .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
const names = entries.map((e) => e.name);

// Self-check. A parse that loses a field, or that reads the registry under another status, fails
// HERE rather than in a fixture nobody re-reads.
const SENTINELS = [
  'OES_sample_variables',
  'WEBGL_provoking_vertex',
  'WEBGL_clip_cull_distance',
  'OVR_multiview2',
  'EXT_texture_mirror_clamp_to_edge',
  'EXT_color_buffer_float',
];
const NAME = /^[A-Z]+_[A-Za-z0-9_]+$/;
const registryCount = rows.filter((r) => r.dir === 'extensions').length;
if (registryCount < 50) {
  problems.push(`only ${registryCount} extensions under extensions/; at least 50 expected`);
}
for (const sentinel of SENTINELS) {
  if (!names.includes(sentinel)) problems.push(`sentinel ${sentinel} is missing`);
}
// The `webgl2` sentinels. Each one is an extension whose value the header argues for.
// They cover the `no` exception, the two `inherits` cases, a `core`, a `removed`, a `subsumed`
// and two `applies`. One of the two `applies` is a rejected extension (`extensions/rejected/`).
const WEBGL2_SENTINELS: readonly (readonly [string, Webgl2Status])[] = [
  ['EXT_disjoint_timer_query', 'no'],
  ['WEBGL_lose_context', 'inherits'],
  ['EXT_texture_filter_anisotropic', 'inherits'],
  ['OES_vertex_array_object', 'core'],
  ['OES_texture_float', 'removed'],
  ['WEBGL_color_buffer_float', 'subsumed'],
  ['OES_sample_variables', 'applies'],
  ['WEBGL_texture_source_iframe', 'applies'],
];
for (const [name, value] of WEBGL2_SENTINELS) {
  const row = entries.find((e) => e.name === name);
  if (row?.webgl2 !== value) {
    problems.push(`${name} should have webgl2 ${value}, has ${row?.webgl2 ?? 'no row'}`);
  }
}
for (const entry of entries) {
  if (!WEBGL2_VALUES.includes(entry.webgl2)) {
    problems.push(`${entry.name} has webgl2 ${entry.webgl2}, not one of the six values`);
  }
}
for (const exception of NO_WEBGL2) {
  if (!names.includes(exception.name)) problems.push(`NO_WEBGL2 names ${exception.name}, no row`);
}
if (names.includes('template'))
  problems.push('template is a row; extensions/template/ is no extension');
for (const entry of entries) {
  if (!NAME.test(entry.name)) problems.push(`${entry.name} does not match ${NAME.source}`);
}
if (new Set(names).size !== names.length) problems.push('a name appears in two rows');
if (!/^[0-9a-f]{40}$/.test(registryCommit))
  problems.push(`HEAD is not a commit: ${registryCommit}`);
if (!/^\d{4}-\d{2}-\d{2}T/.test(registryCommitDate)) {
  problems.push(`commit date is not ISO 8601: ${registryCommitDate}`);
}
if (problems.length > 0) {
  console.error(`${OUT} NOT written:\n${problems.map((p) => `  ${p}`).join('\n')}`);
  process.exit(1);
}

// Every row is written in one literal, in a fixed key order and over sorted names, so a re-bake of
// an unchanged registry produces a byte-identical file and `git diff` stays a review tool.
const out = {
  registryRepository: REPO,
  registryCommit,
  registryCommitDate,
  read,
  readFrom: READ_FROM,
  generator: 'scripts/bake-webgl-extensions.ts',
  count: entries.length,
  extensions: entries,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
for (const group of GROUPS) {
  const members = rows.filter((r) => r.dir === group.dir).map((r) => r.entry);
  const byStatus = group.statuses
    .map((s) => `${s} ${members.filter((m) => m.status === s).length}`)
    .join(', ');
  console.log(`${String(members.length).padStart(4)}  ${group.dir}/  (${byStatus})`);
}
console.log(`→ ${OUT} at WebGL ${registryCommit.slice(0, 12)}, read ${read}`);
