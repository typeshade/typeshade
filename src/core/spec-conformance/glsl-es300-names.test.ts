// ═══ GLSL ES 3.00: the names the capability coverage reads, held to the specification text ═══
//
// WHAT THIS IS. `fixtures/glsl-es300-names.json` is the GLSL ES 3.00 vocabulary that proposal 0059
// (`changes/0059-capability-coverage.md`, "The sources", the GLSL ES 3.00 row) reads: the built-in
// functions of section 8, the built-in variables of sections 7.1 to 7.4, the types of section 4.1
// and the qualifiers of sections 4.3 to 4.7. It also holds the preprocessor of sections 3.4 and 3.5
// and the statements of section 6, which table C of docs/capability-coverage.md names.
//
// WHERE IT WAS READ FROM. The text of The OpenGL ES Shading Language, Language Version 3.00,
// Document Revision 6 (29 January 2016). The PDF is GLSL_ES_Specification_3.00.pdf, at
// `specs/es/3.0/` in KhronosGroup/OpenGL-Registry, as it stood at commit
// 6af574a14089ccfee87efe230ebcdd8742859813. Its text was extracted with `pdftotext -layout` and
// read on 2026-10-12. The Khronos registry site answered HTTP 403 that day, so the PDF came from
// the repository's raw file instead.
//
// WHY A FIXTURE. The test reads a checked-in file, never the network. A test that fetched the
// specification would fail offline and would change whenever the registry did. The fixture gives
// the same bytes on every run, and a change to it is a diff a reviewer reads.
//
// WHAT IT HOLDS. The section 8 names are the set `GLSL_ES300_BUILTIN_FUNCTIONS` in
// `src/core/reserved-words.ts`. The two are one authority in two copies, so they are held equal in
// both directions. The statements and the preprocessor are held to literal rows in this file, so a
// rename or a changed kind fails. The other lists are held to their own counts, to their section
// prefixes and to rows the text fixes. Each check is also run on a doctored list, so a check that
// cannot fail is found before it is trusted (AGENTS.md#gate-discipline).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import { GLSL_ES300_BUILTIN_FUNCTIONS } from '../reserved-words.js';

// ── The GLSL ES 3.00 vocabulary, as transcribed ──

interface NameList<E> {
  section: string;
  count: number;
  entries: readonly E[];
}
interface GlslNames {
  specRepository: string;
  specCommit: string;
  specFile: string;
  language: string;
  documentRevision: number;
  read: string;
  generator: string;
  notes: string;
  builtinFunctions: NameList<{ name: string; section: string }>;
  builtinVariables: NameList<{
    name: string;
    section: string;
    stage: 'vertex' | 'fragment' | 'both';
    direction: 'in' | 'out' | 'const' | 'uniform';
  }>;
  types: NameList<{
    name: string;
    section: string;
    family: 'void' | 'scalar' | 'vector' | 'matrix' | 'sampler' | 'struct' | 'array';
  }>;
  qualifiers: NameList<{
    name: string;
    section: string;
    kind: 'storage' | 'layout' | 'interpolation' | 'parameter' | 'precision' | 'invariance';
  }>;
  statements: NameList<{
    name: string;
    section: string;
    kind: 'selection' | 'iteration' | 'jump' | 'function';
  }>;
  preprocessor: NameList<{
    name: string;
    section: string;
    kind: 'directive' | 'operator' | 'macro';
  }>;
}

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'glsl-es300-names.json');
const glsl = JSON.parse(readFileSync(FIXTURE, 'utf8')) as GlslNames;

/** One row of any list: the fields the duplicate check reads. */
interface Row {
  readonly name: string;
  readonly section: string;
  readonly kind?: string;
}

/** Each list, with the section its header names, the prefix every row's section must carry, and
 *  the count the specification text gives it. A change of a count literal is a reviewed
 *  transcription change: the list was read again from the text, and the literal moves with it.
 *  A hand edit of the entries alone fails here, and so does an edit of the count alone. */
const LISTS: readonly {
  label: string;
  list: NameList<Row>;
  section: string;
  prefix: RegExp;
  count: number;
}[] = [
  {
    label: 'builtinFunctions',
    list: glsl.builtinFunctions,
    section: '8',
    prefix: /^8\.\d/,
    count: 89,
  },
  {
    label: 'builtinVariables',
    list: glsl.builtinVariables,
    section: '7',
    prefix: /^7\.\d/,
    count: 20,
  },
  { label: 'types', list: glsl.types, section: '4.1', prefix: /^4\.1\.\d/, count: 46 },
  {
    label: 'qualifiers',
    list: glsl.qualifiers,
    section: '4.3-4.7',
    prefix: /^4\.[3-7](\.|$)/,
    count: 23,
  },
  { label: 'statements', list: glsl.statements, section: '6', prefix: /^6\.\d/, count: 12 },
  {
    label: 'preprocessor',
    list: glsl.preprocessor,
    section: '3.4-3.5',
    prefix: /^3\.[45](\.|$)/,
    count: 19,
  },
];

/** The header fields the test pins: the specification commit and the day the text was read. */
type Provenance = Pick<
  GlslNames,
  'specRepository' | 'specCommit' | 'specFile' | 'language' | 'documentRevision' | 'read'
>;
const PINNED: Provenance = {
  specRepository: 'https://github.com/KhronosGroup/OpenGL-Registry',
  specCommit: '6af574a14089ccfee87efe230ebcdd8742859813',
  specFile: 'specs/es/3.0/GLSL_ES_Specification_3.00.pdf',
  language: 'GLSL ES 3.00',
  documentRevision: 6,
  read: '2026-10-12',
};

/** The statements of section 6, as the text names them. A rename or a changed kind fails here. */
const STATEMENTS: readonly Row[] = [
  { name: 'if', section: '6.2', kind: 'selection' },
  { name: 'if-else', section: '6.2', kind: 'selection' },
  { name: 'switch', section: '6.2', kind: 'selection' },
  { name: 'case', section: '6.2', kind: 'selection' },
  { name: 'default', section: '6.2', kind: 'selection' },
  { name: 'for', section: '6.3', kind: 'iteration' },
  { name: 'while', section: '6.3', kind: 'iteration' },
  { name: 'do', section: '6.3', kind: 'iteration' },
  { name: 'continue', section: '6.4', kind: 'jump' },
  { name: 'break', section: '6.4', kind: 'jump' },
  { name: 'return', section: '6.4', kind: 'jump' },
  { name: 'discard', section: '6.4', kind: 'jump' },
];

/** The preprocessor of sections 3.4 and 3.5, as the text names them. A rename or a changed kind
 *  fails here. */
const PREPROCESSOR: readonly Row[] = [
  { name: '#version', section: '3.4', kind: 'directive' },
  { name: '#', section: '3.5', kind: 'directive' },
  { name: '#define', section: '3.5', kind: 'directive' },
  { name: '#undef', section: '3.5', kind: 'directive' },
  { name: '#if', section: '3.5', kind: 'directive' },
  { name: '#ifdef', section: '3.5', kind: 'directive' },
  { name: '#ifndef', section: '3.5', kind: 'directive' },
  { name: '#else', section: '3.5', kind: 'directive' },
  { name: '#elif', section: '3.5', kind: 'directive' },
  { name: '#endif', section: '3.5', kind: 'directive' },
  { name: '#error', section: '3.5', kind: 'directive' },
  { name: '#pragma', section: '3.5', kind: 'directive' },
  { name: '#extension', section: '3.5', kind: 'directive' },
  { name: '#line', section: '3.5', kind: 'directive' },
  { name: 'defined', section: '3.5', kind: 'operator' },
  { name: '__LINE__', section: '3.5', kind: 'macro' },
  { name: '__FILE__', section: '3.5', kind: 'macro' },
  { name: '__VERSION__', section: '3.5', kind: 'macro' },
  { name: 'GL_ES', section: '3.5', kind: 'macro' },
];

const fixtureFunctionNames = (): string[] => glsl.builtinFunctions.entries.map((e) => e.name);

interface NameDiff {
  missing: string[];
  extra: string[];
}

/** The comparison the function check runs. `missing` holds the names the set has and the list
 *  lacks; `extra` holds the names the list has and the set lacks. Both are sorted. */
function compareNames(expected: ReadonlySet<string>, actual: readonly string[]): NameDiff {
  const got = new Set(actual);
  return {
    missing: [...expected].filter((n) => !got.has(n)).sort(),
    extra: [...got].filter((n) => !expected.has(n)).sort(),
  };
}

/** Compares two subsection numbers segment by segment, so 4.3.9 comes before 4.4 and 4.1.7.1
 *  before 4.1.8. A plain string compare would put 4.10 before 4.2. */
function compareSections(a: string, b: string): number {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The keys of the rows that repeat a (name, section, kind) triple. */
function duplicateKeys(rows: readonly Row[]): string[] {
  const seen = new Set<string>();
  const repeated: string[] = [];
  for (const r of rows) {
    const key = [r.name, r.section, r.kind ?? ''].join(' | ');
    if (seen.has(key)) repeated.push(key);
    seen.add(key);
  }
  return repeated;
}

/** The names that appear more than once in a list, whatever their section. */
function repeatedNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  return names.filter((n) => {
    const again = seen.has(n);
    seen.add(n);
    return again;
  });
}

/** The names of the rows whose section does not start with the list's prefix. */
function outsideSection(rows: readonly Row[], prefix: RegExp): string[] {
  return rows.filter((r) => !prefix.test(r.section)).map((r) => r.name);
}

/** The names of the rows that sort before the row above them, by section. */
function outOfOrder(rows: readonly Row[]): string[] {
  return rows.flatMap((row, i) => {
    const before = rows[i - 1];
    return before && compareSections(before.section, row.section) > 0 ? [row.name] : [];
  });
}

const find = <E extends { name: string }>(list: NameList<E>, name: string): E | undefined =>
  list.entries.find((e) => e.name === name);

/** The header of a list: its section and count against the text, and its count against its
 *  entries. Each problem is one line. */
function headerProblems(
  list: { section: string; count: number; entries: readonly unknown[] },
  section: string,
  count: number,
): string[] {
  const problems: string[] = [];
  if (list.section !== section) problems.push(`section ${list.section}, text ${section}`);
  if (list.count !== count) problems.push(`count ${list.count}, text ${count}`);
  if (list.count !== list.entries.length) {
    problems.push(`count ${list.count}, entries ${list.entries.length}`);
  }
  return problems;
}

/** The provenance fields whose value differs from the pinned value. */
function provenanceMisses(header: Provenance): (keyof Provenance)[] {
  return (Object.keys(PINNED) as (keyof Provenance)[]).filter((k) => header[k] !== PINNED[k]);
}

/** The names of the rows whose field takes a value the header does not name. */
function fieldProblems(
  rows: readonly { name: string; [field: string]: string }[],
  field: string,
  allowed: readonly string[],
): string[] {
  return rows.filter((r) => !allowed.includes(r[field])).map((r) => r.name);
}

/** A row the specification text fixes: the list that must hold it, and the row as the text gives
 *  it. */
interface Sentinel {
  readonly list: NameList<{ readonly name: string }>;
  readonly row: { readonly name: string; readonly [field: string]: string };
}

const SENTINELS: readonly Sentinel[] = [
  {
    list: glsl.builtinVariables,
    row: { name: 'gl_PointSize', section: '7.1', stage: 'vertex', direction: 'out' },
  },
  {
    list: glsl.builtinVariables,
    row: { name: 'gl_FragDepth', section: '7.2', stage: 'fragment', direction: 'out' },
  },
  {
    list: glsl.builtinVariables,
    row: { name: 'gl_MaxDrawBuffers', section: '7.3', stage: 'both', direction: 'const' },
  },
  {
    list: glsl.types,
    row: { name: 'sampler2DArrayShadow', section: '4.1.7.1', family: 'sampler' },
  },
  { list: glsl.qualifiers, row: { name: 'layout', section: '4.3.8', kind: 'layout' } },
  { list: glsl.qualifiers, row: { name: 'centroid in', section: '4.3.4', kind: 'storage' } },
  { list: glsl.qualifiers, row: { name: 'flat', section: '4.3.9', kind: 'interpolation' } },
  { list: glsl.qualifiers, row: { name: 'std140', section: '4.3.8.3', kind: 'layout' } },
  { list: glsl.builtinFunctions, row: { name: 'texelFetchOffset', section: '8.8' } },
  { list: glsl.statements, row: { name: 'do', section: '6.3', kind: 'iteration' } },
  { list: glsl.statements, row: { name: 'discard', section: '6.4', kind: 'jump' } },
  { list: glsl.statements, row: { name: 'switch', section: '6.2', kind: 'selection' } },
  { list: glsl.preprocessor, row: { name: '#extension', section: '3.5', kind: 'directive' } },
  { list: glsl.preprocessor, row: { name: '#version', section: '3.4', kind: 'directive' } },
  { list: glsl.preprocessor, row: { name: 'GL_ES', section: '3.5', kind: 'macro' } },
];

/** The sentinel rows that the list does not hold as the text gives them, each with what the list
 *  holds. */
function sentinelMisses(
  sentinels: readonly Sentinel[],
): { name: string; found: unknown; expected: unknown }[] {
  return sentinels.flatMap(({ list, row }) => {
    const found = find(list, row.name);
    return isDeepStrictEqual(found, row) ? [] : [{ name: row.name, found, expected: row }];
  });
}

describe('GLSL ES 3.00 names (fixtures/glsl-es300-names.json)', () => {
  it('section 8 holds exactly the names of GLSL_ES300_BUILTIN_FUNCTIONS, in both directions', () => {
    expect(
      compareNames(GLSL_ES300_BUILTIN_FUNCTIONS, fixtureFunctionNames()),
      'missing: in GLSL_ES300_BUILTIN_FUNCTIONS, not in section 8 of the fixture. ' +
        'extra: in section 8 of the fixture, not in GLSL_ES300_BUILTIN_FUNCTIONS.',
    ).toEqual({ missing: [], extra: [] });
    // Equal sets of 89 distinct names: the header pins the count of 89 entries, and this line pins
    // that no section 8 name repeats, so the set has 89 members.
    expect(repeatedNames(fixtureFunctionNames()), 'section 8 names that repeat').toEqual([]);
  });

  it('provenance: the header names the pinned specification and the day it was read', () => {
    expect(provenanceMisses(glsl), 'fields that differ from the pinned values').toEqual([]);
  });

  for (const { label, list, section, prefix, count } of LISTS) {
    it(`${label}: the header holds section ${section} and count ${count}, and no entry repeats`, () => {
      expect(headerProblems(list, section, count), label).toEqual([]);
      expect(duplicateKeys(list.entries), label).toEqual([]);
    });

    it(`${label}: every section sits under the list section, and the rows are sorted by it`, () => {
      expect(
        outsideSection(list.entries, prefix),
        `${label}: rows outside section ${section}`,
      ).toEqual([]);
      expect(outOfOrder(list.entries), `${label}: rows out of section order`).toEqual([]);
    });
  }

  it('every field takes a value the header names', () => {
    expect([
      ...fieldProblems(glsl.builtinVariables.entries, 'stage', ['vertex', 'fragment', 'both']),
      ...fieldProblems(glsl.builtinVariables.entries, 'direction', [
        'in',
        'out',
        'const',
        'uniform',
      ]),
      ...fieldProblems(glsl.types.entries, 'family', [
        'void',
        'scalar',
        'vector',
        'matrix',
        'sampler',
        'struct',
        'array',
      ]),
      ...fieldProblems(glsl.qualifiers.entries, 'kind', [
        'storage',
        'layout',
        'interpolation',
        'parameter',
        'precision',
        'invariance',
      ]),
      ...fieldProblems(glsl.statements.entries, 'kind', [
        'selection',
        'iteration',
        'jump',
        'function',
      ]),
      ...fieldProblems(glsl.preprocessor.entries, 'kind', ['directive', 'operator', 'macro']),
    ]).toEqual([]);
  });

  it('sentinel rows: the specification text fixes each of these, in its list', () => {
    expect(sentinelMisses(SENTINELS)).toEqual([]);
  });

  it('statements and preprocessor: each list is the literal list, with the name, section and kind of each row', () => {
    expect(glsl.statements.entries).toEqual(STATEMENTS);
    expect(glsl.preprocessor.entries).toEqual(PREPROCESSOR);
  });

  it('prove the instrument: a doctored list reports the removed name missing and the added name extra', () => {
    // One name removed (texelFetch), one name added (textureGather, a function of a later version).
    const doctored = fixtureFunctionNames()
      .filter((n) => n !== 'texelFetch')
      .concat('textureGather');
    expect(compareNames(GLSL_ES300_BUILTIN_FUNCTIONS, doctored)).toEqual({
      missing: ['texelFetch'],
      extra: ['textureGather'],
    });
  });

  it('prove the instrument: a section 8 name repeated under a second section is reported', () => {
    expect(repeatedNames(fixtureFunctionNames())).toEqual([]);
    expect(repeatedNames([...fixtureFunctionNames(), 'abs'])).toEqual(['abs']);
  });

  it('prove the instrument: a provenance field that differs from the pinned value is reported', () => {
    expect(provenanceMisses(glsl)).toEqual([]);
    expect(provenanceMisses({ ...glsl, specCommit: 'abc' })).toEqual(['specCommit']);
    expect(provenanceMisses({ ...glsl, read: '2026-10-13' })).toEqual(['read']);
  });

  it('prove the instrument: a list header whose section or count differs from the text is reported', () => {
    expect(headerProblems(glsl.types, '4.1', 46)).toEqual([]);
    expect(headerProblems({ ...glsl.types, count: 45 }, '4.1', 46)).toEqual([
      'count 45, text 46',
      'count 45, entries 46',
    ]);
    expect(headerProblems({ ...glsl.types, section: '4.2' }, '4.1', 46)).toEqual([
      'section 4.2, text 4.1',
    ]);
    expect(
      headerProblems({ ...glsl.types, entries: glsl.types.entries.slice(1) }, '4.1', 46),
    ).toEqual(['count 46, entries 45']);
  });

  it('prove the instrument: a repeated row is reported, and one name under two kinds is not', () => {
    const repeated: Row[] = [
      { name: 'flat', section: '4.3.9', kind: 'interpolation' },
      { name: 'flat', section: '4.3.9', kind: 'interpolation' },
    ];
    expect(duplicateKeys(repeated)).toEqual(['flat | 4.3.9 | interpolation']);
    // `in` is a storage qualifier of 4.3.4 and a parameter qualifier of 4.4: two rows, no repeat.
    const twoKinds: Row[] = [
      { name: 'in', section: '4.3.4', kind: 'storage' },
      { name: 'in', section: '4.4', kind: 'parameter' },
    ];
    expect(duplicateKeys(twoKinds)).toEqual([]);
  });

  it('prove the instrument: a row that sorts before its predecessor is reported', () => {
    // Read as strings, "4.10" sorts before "4.2", so this list would pass. The segment compare
    // puts 4.10 after 4.2, so the row that follows 4.10 is out of order.
    expect(compareSections('4.10', '4.2')).toBeGreaterThan(0);
    expect(compareSections('4.3.9', '4.4')).toBeLessThan(0);
    const rows: Row[] = [
      { name: 'late', section: '4.10' },
      { name: 'early', section: '4.2' },
    ];
    expect(outOfOrder(rows)).toEqual(['early']);
  });

  it('prove the instrument: a row outside its list section is reported', () => {
    const rows: Row[] = [
      { name: 'gl_PointSize', section: '7.1' },
      { name: 'texelFetch', section: '8.8' },
    ];
    expect(outsideSection(rows, /^8\.\d/)).toEqual(['gl_PointSize']);
  });

  it('prove the instrument: a field value the header does not name is reported', () => {
    const rows = [
      { name: 'gl_PointSize', section: '7.1', stage: 'compute', direction: 'out' },
      { name: 'gl_FragDepth', section: '7.2', stage: 'fragment', direction: 'out' },
    ];
    expect(fieldProblems(rows, 'stage', ['vertex', 'fragment', 'both'])).toEqual(['gl_PointSize']);
    expect(fieldProblems(rows, 'direction', ['in', 'out', 'const', 'uniform'])).toEqual([]);
  });

  it('prove the instrument: a sentinel row the list holds differently, or lacks, is reported', () => {
    const fragDepth = { name: 'gl_FragDepth', section: '7.2', stage: 'fragment', direction: 'out' };
    const moved = glsl.builtinVariables.entries.map((e) =>
      e.name === 'gl_FragDepth' ? { ...e, section: '7.1' } : e,
    );
    const dropped = glsl.types.entries.filter((e) => e.name !== 'sampler2DArrayShadow');
    expect(sentinelMisses([{ list: glsl.builtinVariables, row: fragDepth }])).toEqual([]);
    expect(
      sentinelMisses([{ list: { ...glsl.builtinVariables, entries: moved }, row: fragDepth }]).map(
        (m) => m.name,
      ),
    ).toEqual(['gl_FragDepth']);
    expect(
      sentinelMisses([
        {
          list: { ...glsl.types, entries: dropped },
          row: { name: 'sampler2DArrayShadow', section: '4.1.7.1', family: 'sampler' },
        },
      ]).map((m) => m.name),
    ).toEqual(['sampler2DArrayShadow']);
  });

  it('prove the instrument: a renamed statement, a changed kind or a changed section is not the literal list', () => {
    expect(glsl.statements.entries).toEqual(STATEMENTS);
    expect(
      glsl.statements.entries.map((e) => (e.name === 'do' ? { ...e, name: 'dowhile' } : e)),
    ).not.toEqual(STATEMENTS);
    expect(
      glsl.statements.entries.map((e) => (e.name === 'discard' ? { ...e, kind: 'selection' } : e)),
    ).not.toEqual(STATEMENTS);
    expect(
      glsl.preprocessor.entries.map((e) =>
        e.name === '#extension' ? { ...e, section: '3.4' } : e,
      ),
    ).not.toEqual(PREPROCESSOR);
  });
});
