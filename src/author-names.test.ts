// ═══ The author-facing name set is a COMMITTED artifact: a name joins or leaves the language in a diff ═══
//
// WHAT THIS IS FOR. docs/language-design.md §2.1 defines an author-facing name as a name a
// `"use typeshade"` file can write and the compiler will accept, and makes the set of them exactly
// the set the ambient library (`SHADE_DTS`) declares. `surface-names.test.ts` asks where each of
// those names comes from. Nothing asked how many there are: the library declared 108 names on
// 2026-09-20 and 199 on 2026-11-09, and no diff in between showed the set as a whole. A name
// arrived inside a generator, an intrinsic table or a JSDoc block, and a reviewer saw a code
// change, not a wider language.
//
// So the set is baked into `src/__api__/author-names.md`, as `api-surface.test.ts` bakes the
// package exports into `src/__api__/surface.md`. This test fails when the library and the
// snapshot disagree, and names each added and removed name. `scripts/changes.ts` reads the
// snapshot on both sides of a diff: a name that the snapshot gains is a criterion that needs an
// accepted proposal listing the name under `names:` (changes/README.md). A name that the
// snapshot loses needs no proposal, since a smaller language is the direction the owner asked for
// on 2026-11-09; the removal still shows in the snapshot's diff and in the report of
// `scripts/changes.ts`, so a reviewer sees it.
//
// WHAT COUNTS AS A NAME. The reader takes, from the parsed library:
//
//   1. every top-level declaration (function, interface, type alias, class, enum, variable,
//      namespace and a namespace's members), as `surface-names.test.ts` reads them; overloads
//      collapse to one name;
//   2. every member of a standard object the library restates (`Math`, `console`), written
//      `Math.fround`: §2.1 names "a member of a standard object such as `Math`" an author-facing
//      name, and a member is where `random` once arrived unseen (#181);
//   3. every array method `ArrayOps` picks from `Array`, written `Array.prototype.map`.
//
// It does not list the members of the vector, matrix and texture interfaces (`xy`, `xxyz`, ...):
// those are generated from WGSL's swizzle and member rules by `SUPPORTED_TYPE_NAMES`, and a vector
// type itself is a name of item 1.
//
// RE-BAKE (an intentional change to the set): update the snapshot alongside the code change —
//   bun run bake:author-names
// — and commit the diff. An added name also needs its accepted proposal (`names:`).

import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { SHADE_DTS } from './language-service/ambient.js';
import { authorNames } from '../scripts/changes.js';

const SNAPSHOT = join(dirname(fileURLToPath(import.meta.url)), '__api__', 'author-names.md');
const REBAKE = 'bun run bake:author-names';
const UPDATE = process.env.UPDATE_AUTHOR_NAMES === '1';

/** The standard objects whose members are author-facing names, by the variable that declares
 *  each one in the library. */
const STANDARD_OBJECTS: readonly string[] = ['Math', 'console'];

interface Names {
  readonly declared: readonly string[];
  readonly members: readonly string[];
}

/** Every author-facing name `dts` declares, by the three items in the header. */
function readNames(dts: string): Names {
  const source = ts.createSourceFile('shade.d.ts', dts, ts.ScriptTarget.Latest, true);
  const declared = new Set<string>();
  const interfaces = new Map<string, ts.InterfaceDeclaration>();
  const objectTypes = new Map<string, string>();
  let arrayOps: ts.TypeNode | undefined;
  const walk = (parent: ts.Node): void => {
    ts.forEachChild(parent, (node) => {
      if (ts.isFunctionDeclaration(node) && node.name) declared.add(node.name.text);
      else if (ts.isInterfaceDeclaration(node)) {
        declared.add(node.name.text);
        interfaces.set(node.name.text, node);
      } else if (ts.isTypeAliasDeclaration(node)) {
        declared.add(node.name.text);
        if (node.name.text === 'ArrayOps') arrayOps = node.type;
      } else if (ts.isClassDeclaration(node) && node.name) declared.add(node.name.text);
      else if (ts.isEnumDeclaration(node)) declared.add(node.name.text);
      else if (ts.isVariableStatement(node)) {
        for (const d of node.declarationList.declarations) {
          if (!ts.isIdentifier(d.name)) continue;
          declared.add(d.name.text);
          if (d.type && ts.isTypeReferenceNode(d.type) && ts.isIdentifier(d.type.typeName))
            objectTypes.set(d.name.text, d.type.typeName.text);
        }
      } else if (ts.isModuleDeclaration(node)) {
        declared.add(node.name.getText(source));
        if (node.body && ts.isModuleBlock(node.body)) walk(node.body);
      }
    });
  };
  walk(source);

  const members = new Set<string>();
  for (const object of STANDARD_OBJECTS) {
    const shape = interfaces.get(objectTypes.get(object) ?? '');
    for (const member of shape?.members ?? []) {
      if (member.name && ts.isIdentifier(member.name)) members.add(`${object}.${member.name.text}`);
    }
  }
  const literals = arrayOps && ts.isUnionTypeNode(arrayOps) ? arrayOps.types : [arrayOps];
  for (const t of literals) {
    if (t && ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal))
      members.add(`Array.prototype.${t.literal.text}`);
  }
  return { declared: [...declared].sort(), members: [...members].sort() };
}

function render(names: Names): string {
  return [
    '# typeshade — author-facing names',
    '',
    'GENERATED FILE — do not hand-edit. Re-bake with `' + REBAKE + '` and commit the diff.',
    '',
    'Every name a `"use typeshade"` file can write (docs/language-design.md §2.1): the names the',
    'ambient library (`SHADE_DTS`) declares, the members of the standard objects it restates, and',
    'the array methods `ArrayOps` picks. `src/author-names.test.ts` fails when this file and the',
    'library disagree. `scripts/changes.ts` reads this file on both sides of a diff: a name it',
    'gains needs an accepted proposal that lists the name under `names:` (changes/README.md).',
    '',
    `## Declared names — ${names.declared.length}`,
    '',
    '```',
    ...names.declared,
    '```',
    '',
    `## Members of standard objects — ${names.members.length}`,
    '',
    '```',
    ...names.members,
    '```',
    '',
  ].join('\n');
}

const names = readNames(SHADE_DTS);

// ── the arms ────────────────────────────────────────────────────────────────────────────
// S1 runs first and holds the quantity the reader moves. A reader that finds nothing renders an
// empty list, the re-bake writes it, and the comparison then passes over a surface it cannot see.

describe('the author-facing name set (docs/language-design.md §2.1)', () => {
  it('S1: the reader finds a plausible number of names of each kind', () => {
    expect(names.declared.length).toBeGreaterThan(150);
    expect(names.members.filter((n) => n.startsWith('Math.')).length).toBeGreaterThan(30);
    expect(names.members.filter((n) => n.startsWith('console.')).length).toBeGreaterThan(4);
    expect(names.members.filter((n) => n.startsWith('Array.prototype.')).length).toBeGreaterThan(8);
  });

  it('S2: the reader finds a known name of each kind', () => {
    for (const n of ['abs', 'vec4', 'f64', 'texture_2d', 'Math', 'console'])
      expect(names.declared, n).toContain(n);
    for (const n of ['Math.fround', 'Math.PI', 'console.log', 'Array.prototype.map'])
      expect(names.members, n).toContain(n);
  });

  it('S3: a name planted in a copy of the library is read, at the top level and as a member', () => {
    const planted = readNames(
      `${SHADE_DTS}\ndeclare function plantedName(x: f32): f32\n`.replace(
        /^interface MathObject \{$/m,
        'interface MathObject {\n  plantedMember(x: f32): f32',
      ),
    );
    expect(planted.declared).toContain('plantedName');
    expect(planted.members).toContain('Math.plantedMember');
  });

  it('the parser of scripts/changes.ts reads back every name the snapshot lists', () => {
    expect([...authorNames(render(names))].sort()).toEqual(
      [...names.declared, ...names.members].sort(),
    );
  });

  it('matches the committed snapshot', () => {
    const fresh = render(names);
    if (UPDATE) {
      mkdirSync(dirname(SNAPSHOT), { recursive: true });
      writeFileSync(SNAPSHOT, fresh);
      return;
    }
    let committed = '';
    try {
      committed = readFileSync(SNAPSHOT, 'utf8').replace(/\r\n/g, '\n');
    } catch {
      // A missing snapshot is a difference of every name; the message below says how to bake it.
    }
    const before = authorNames(committed);
    const after = authorNames(fresh);
    const added = [...after].filter((n) => !before.has(n));
    const removed = [...before].filter((n) => !after.has(n));
    expect(
      fresh,
      'the set of author-facing names changed' +
        (added.length ? `; added: ${added.join(', ')}` : '') +
        (removed.length ? `; removed: ${removed.join(', ')}` : '') +
        '. If that was intended, re-bake with `' +
        REBAKE +
        '` and commit the diff. An added name also needs an accepted proposal that lists it ' +
        'under `names:` (changes/README.md); `scripts/changes.ts` checks this on the pull request.',
    ).toBe(committed);
  });
});
