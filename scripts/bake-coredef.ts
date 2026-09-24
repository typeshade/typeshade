// ═══ The whole `core.def` fixture — Tint's overload table, every row (0017) ═══
//
// WHAT IT IS. `src/core/builtins/coredef.ts` is every overload of Tint's
// intrinsic table (`core.def`): each builtin function (`fn`), value constructor (`ctor`),
// conversion (`conv`) and operator (`op`), with its type parameters and the constraint each
// ranges over, and every type matcher (`match fiu32_f16: f32 | i32 | u32 | f16`) a constraint
// names. `src/core/spec-conformance/coredef-overloads.test.ts` forces every row to be claimed,
// and holds each SUPPORTED one to the compiler and the editor on the same witness.
//
// WHY A MODULE AND NOT A JSON FIXTURE. The table is read at run time: the editor's builtin
// declarations are generated from it (`src/language-service/builtin-signatures.ts`), and the
// compiler's builtin types are to be. A module ships with the package, as `package.json`'s
// `files` keeps `spec-conformance/fixtures/` out of it; the texture fixture is the suite's alone.
//
// WHY. Proposal 0017: a builtin's type rules were written three times by hand, in the
// compiler's result types, its argument table and the editor's declarations. This fixture is
// the one table they are to be derived from. The texture rows were baked first
// (`bake-coredef-textures.ts`, whose "WHY TINT'S TABLE AND NOT THE SPEC PROSE" applies here
// unchanged); this is the rest of the file, from the same snapshot.
//
// TO REGENERATE (from the package root):
//
//   curl -sSL https://raw.githubusercontent.com/google/dawn/main/src/tint/lang/core/core.def \
//     -o /tmp/core.def
//   bun scripts/bake-coredef.ts /tmp/core.def
//   bun scripts/bake-coredef-textures.ts /tmp/core.def
//
// Bake both from one download: the suite checks that the two fixtures carry the same sha256.
// Then run `bun run test src/core/spec-conformance/` and claim every row the suite names as new.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'src', 'core', 'builtins', 'coredef.ts');
const URL = 'https://raw.githubusercontent.com/google/dawn/main/src/tint/lang/core/core.def';

/** One overload. `signature` is the key the suite claims against. */
interface Row {
  readonly kind: 'fn' | 'ctor' | 'conv' | 'op';
  readonly name: string;
  /** The `@stage(...)` list, empty when the overload is legal in every stage. */
  readonly stages: readonly string[];
  /** The type parameters, from `implicit(...)` and a constructor's own `<...>`, and the
   *  constraint each ranges over (`num`, a matcher, or `''` for any type). */
  readonly implicit: Readonly<Record<string, string>>;
  readonly params: readonly { readonly name: string; readonly type: string }[];
  /** `''` for an overload that returns nothing. */
  readonly ret: string;
  readonly signature: string;
}

/** Split on the commas at depth zero, so `vec<N, T>` stays one type. */
function splitTop(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '<' || c === '(' || c === '[') depth++;
    else if (c === '>' || c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      out.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  out.push(inner.slice(start));
  return out.map((s) => s.trim()).filter((s) => s !== '');
}

/** `@test_value(2) low: T` to `{ name: 'low', type: 'T' }`; an unnamed parameter is named by
 *  its position. Attributes on a parameter say how Tint tests it, not what it takes. */
function param(text: string, index: number): { name: string; type: string } {
  const t = text.replace(/@\w+(\([^)]*\))?/g, '').trim();
  const colon = t.indexOf(':');
  if (colon < 0) return { name: `p${String(index)}`, type: t };
  return { name: t.slice(0, colon).trim(), type: t.slice(colon + 1).trim() };
}

function constraints(list: string, into: Record<string, string>): void {
  for (const part of splitTop(list)) {
    const colon = part.indexOf(':');
    if (colon < 0) into[part.trim()] = '';
    else into[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
  }
}

const DECL = /(?:^|\s)(fn|ctor|conv|op)\s+/;

function parse(def: string): Row[] {
  const lines = def.split('\n');
  const rows: Row[] = [];
  let attrs: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').replace(/\/\/.*$/, '').trim();
    if (line === '') {
      attrs = [];
      continue;
    }
    const decl = DECL.exec(line);
    if (decl === null) {
      if (line.startsWith('@') || line.startsWith('implicit')) attrs.push(line);
      else attrs = [];
      continue;
    }
    const kind = decl[1] as Row['kind'];
    const at = decl.index + decl[0].length;
    let text = line;
    const depth = (s: string): number => s.split('(').length - s.split(')').length;
    // Read until the declaration's own parentheses balance: a signature may wrap.
    while ((depth(text.slice(at)) > 0 || !text.slice(at).includes('(')) && i + 1 < lines.length) {
      text += ' ' + (lines[++i] ?? '').replace(/\/\/.*$/, '').trim();
    }
    const head = attrs.join(' ') + ' ' + text.slice(0, at);
    attrs = [];
    const rest = text.slice(at);
    const open = rest.indexOf('(');
    const nameAndTemplate = rest.slice(0, open).trim();
    const implicit: Record<string, string> = {};
    const implicitAttr = /implicit\(([^)]*)\)/.exec(head);
    if (implicitAttr !== null) constraints(implicitAttr[1] ?? '', implicit);
    let name = nameAndTemplate;
    const lt = kind === 'op' ? -1 : nameAndTemplate.indexOf('<');
    if (lt >= 0) {
      name = nameAndTemplate.slice(0, lt).trim();
      constraints(nameAndTemplate.slice(lt + 1, nameAndTemplate.lastIndexOf('>')), implicit);
    }
    let d = 0;
    let close = open;
    for (let j = open; j < rest.length; j++) {
      if (rest[j] === '(') d++;
      else if (rest[j] === ')' && --d === 0) {
        close = j;
        break;
      }
    }
    const params = splitTop(rest.slice(open + 1, close)).map(param);
    const arrow = rest.slice(close + 1).trim();
    const ret = arrow.startsWith('->') ? arrow.slice(2).trim() : '';
    const stageAttr = /@stage\(([^)]*)\)/.exec(head);
    const stages =
      stageAttr === null
        ? []
        : (stageAttr[1] ?? '').split(',').map((s) => s.trim().replace(/"/g, ''));
    // The constraints are part of the key: `conv vec2<T: f32, U: scalar_no_f32>` and its
    // `T: i32` sibling differ only there.
    const template = Object.entries(implicit)
      .map(([k, c]) => (c === '' ? k : `${k}: ${c}`))
      .join(', ');
    const signature = `${kind} ${name}${template === '' ? '' : `<${template}>`}(${params.map((p) => p.type).join(', ')})${ret === '' ? '' : ` -> ${ret}`}`;
    rows.push({ kind, name, stages, implicit, params, ret, signature });
  }
  return rows;
}

/** Every `match name: a | b | c`, the alternatives in order; a matcher may wrap. */
function parseMatchers(def: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const text = def.replace(/\/\/[^\n]*/g, '');
  for (const m of text.matchAll(/^match\s+(\w+)\s*\n?\s*:\s*([^\n]+(?:\n\s*\|[^\n]+)*)/gm)) {
    out[m[1] ?? ''] = (m[2] ?? '')
      .split('|')
      .map((s) => s.trim())
      .filter((s) => s !== '');
  }
  return out;
}

const path = process.argv[2];
if (path === undefined) {
  console.error(
    `usage: bun scripts/bake-coredef.ts <core.def>\n  curl -sSL ${URL} -o /tmp/core.def`,
  );
  process.exit(1);
}
const def = readFileSync(path, 'utf8');
const rows = parse(def).sort((a, b) => a.signature.localeCompare(b.signature));
const duplicates = rows.filter((r, i) => i > 0 && rows[i - 1]?.signature === r.signature);
if (duplicates.length > 0) {
  console.error(`duplicate signatures:\n${duplicates.map((d) => `  ${d.signature}`).join('\n')}`);
  process.exit(1);
}
const matchers = parseMatchers(def);
// Self-checks, so a parse regression cannot land silently: a row of each kind the file has,
// sentinels of each, and every constraint a row names is a matcher, `num`, or empty.
const count = (k: Row['kind']): number => rows.filter((r) => r.kind === k).length;
const sentinels = [
  'fn dot<N: num, T: fiu32_f16>(vec<N, T>, vec<N, T>) -> T',
  'fn arrayLength<T, AS: workgroup_uniform_storage, A: access>(ptr<AS, runtime_array<T>, A>) -> u32',
  'ctor vec3<T: scalar>(vec3<T>) -> vec3<T>',
];
const missing = sentinels.filter((s) => !rows.some((r) => r.signature === s));
if (!rows.some((r) => r.kind === 'op' && r.name === '*' && r.ret === 'vec<R, T>'))
  missing.push('op *');
// A constraint is a matcher, an enum (`access`), `num`, or a type the file declares, bare
// (`T: f32`) or applied (`vec<N, fiu32>`): its head identifier must be one of those.
const declaredNames = new Set([
  ...Object.keys(matchers),
  ...[...def.matchAll(/^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:type|enum)\s+(\w+)/gm)].map(
    (m) => m[1] ?? '',
  ),
  // An enum the file imports (`import "src/tint/lang/core/access.def"`) is named for its file.
  ...[...def.matchAll(/^import\s+"[^"]*\/(\w+)\.def"/gm)].map((m) => m[1] ?? ''),
  'num',
]);
const unknown = rows.flatMap((r) =>
  Object.values(r.implicit).filter(
    (c) => c !== '' && !declaredNames.has(/^\w+/.exec(c)?.[0] ?? ''),
  ),
);
if (count('fn') < 400 || count('ctor') < 60 || count('conv') < 15 || count('op') < 50) {
  console.error(
    `too few rows: fn ${count('fn')}, ctor ${count('ctor')}, conv ${count('conv')}, op ${count('op')}`,
  );
  process.exit(1);
}
if (missing.length > 0 || unknown.length > 0) {
  console.error(
    `sentinels missing: ${missing.join('; ')}\nunknown constraints: ${[...new Set(unknown)].join(', ')}`,
  );
  process.exit(1);
}
const sha256 = createHash('sha256').update(def).digest('hex');
const previous = existsSync(OUT)
  ? /"sha256": "([0-9a-f]+)",\n "baked": "([0-9-]+)"/.exec(readFileSync(OUT, 'utf8'))
  : null;
const baked =
  previous !== null && previous[1] === sha256
    ? (previous[2] ?? '')
    : new Date().toISOString().slice(0, 10);
const headFields = { source: URL, sha256, baked, generator: 'scripts/bake-coredef.ts' };
const head = Object.entries(headFields)
  .map(([k, v]) => ` ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
  .join('\n');
const matcherBody = Object.entries(matchers)
  .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
  .join(',\n');
const rowBody = rows.map((r) => `  ${JSON.stringify(r)}`).join(',\n');
// One row per line, so a re-bake reviews as the rows it moved. Generated: prettier and eslint
// leave it alone (`.prettierignore`, the eslint config's ignores).
writeFileSync(
  OUT,
  `// GENERATED by scripts/bake-coredef.ts from Tint's core.def. Do not edit: re-bake.\n` +
    `import type { CoreDefTable } from './coredef-types.js';\n\n` +
    `export const COREDEF: CoreDefTable = {\n${head}\n "matchers": {\n${matcherBody}\n },\n "rows": [\n${rowBody}\n ]\n};\n`,
);
console.log(
  `${String(rows.length)} overloads (fn ${count('fn')}, ctor ${count('ctor')}, conv ${count('conv')}, op ${count('op')}), ${String(Object.keys(matchers).length)} matchers → ${OUT}`,
);
