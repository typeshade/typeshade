// ═══ The author's JSDoc in the host view (change 0108; surface §64) ═══
//
// A host file reads the host view of a shader module, never its source, so the documentation an
// author writes above an export reaches the host only if the view carries it. This file reads that
// documentation and writes it back:
//
//   - `exportDocs` reads the JSDoc blocks (`/** … */`) attached to an exported declaration, and
//     to each member of an `enum`, each field of a struct and each member of a class: its
//     constructor, a method, each half of an accessor and a static member (item 4 of the change).
//     A block is text: it is copied as the author wrote it, with its tags (decisions D1 and D2), in
//     source order. A `//` comment and a `/* */` comment are not JSDoc, and a comment inside a
//     body is not attached to anything. A method or a constructor with no body is an overload
//     signature and is not read: the face reads the implementation.
//   - `commentLines` writes the comment above an export: the author's blocks, and where the view
//     has a sentence of its own, that sentence at the end of the last block after one empty
//     comment line. The editor's hover shows the last block, so it reads the author's words first
//     and the contract second.
//
// A module that imports is linked into one source before it is lowered (Rule 3.9), and the linker
// copies each statement from its first token on, so the linked source has no JSDoc above a
// statement. The blocks are read from the file that declared the export, which
// `LinkedProgram.map` finds from a position of the linked source.

import ts from 'typescript';
import { emittedMemberName, isStaticMember } from './class-names.js';
import type { LinkedProgram } from './link.js';

/** One JSDoc block as lines. The first line begins with a slash and two stars, and the last ends
 *  with a star and a slash. Each other line has lost the column the block began at, so the block
 *  can be written at any indentation. */
export type DocBlock = readonly string[];

/** The JSDoc of one export, as the author wrote it. */
export interface ExportDocs {
  /** The blocks attached to the declaration, in source order. */
  readonly blocks: readonly DocBlock[];
  /** The blocks attached to each member of an `enum`, each field of a struct and each member of a
   *  class. A member goes by `memberKey`, which is its name for an enum member, a field and an
   *  instance method (for a field with a private name `#x`, `x`), and the constructor of a class by
   *  `CONSTRUCTOR`. */
  readonly members: ReadonlyMap<string, readonly DocBlock[]>;
}

/** The key of a class's constructor in `ExportDocs.members`. A class has no field of that name. */
export const CONSTRUCTOR = 'constructor';

/** The key under which `ExportDocs.members` keeps the blocks of a member: its name; for a static
 *  member `static ` before it; and for one half of an accessor `get ` or `set ` before the name,
 *  so the two halves keep a comment of their own. */
export function memberKey(
  name: string,
  { isStatic = false, half }: { readonly isStatic?: boolean; readonly half?: 'get' | 'set' } = {},
): string {
  return `${isStatic ? 'static ' : ''}${half === undefined ? '' : `${half} `}${name}`;
}

const STAR = 0x2a;
const SLASH = 0x2f;

/** Whether the comment is a JSDoc block: a block comment that begins with a slash and two stars,
 *  and that is not the empty comment of a slash, two stars and a slash. */
const isJsDoc = (text: string, c: ts.CommentRange): boolean =>
  c.kind === ts.SyntaxKind.MultiLineCommentTrivia &&
  text.charCodeAt(c.pos + 2) === STAR &&
  text.charCodeAt(c.pos + 3) !== SLASH;

/** `line` without the first `column` characters, when they are blanks. */
function dedent(line: string, column: number): string {
  let n = 0;
  while (n < column && (line[n] === ' ' || line[n] === '\t')) n++;
  return line.slice(n);
}

/** The JSDoc blocks TypeScript attaches to `node`: the comments of that kind between the previous
 *  token and the node's first token. A line break of any kind is one line break, so the same
 *  source gives the same view on every platform. */
function blocksAbove(node: ts.Node, sf: ts.SourceFile): DocBlock[] {
  const text = sf.text;
  // A variable declaration also owns a comment that follows the keyword on its line.
  const comments = [
    ...(ts.isVariableDeclaration(node) ? (ts.getTrailingCommentRanges(text, node.pos) ?? []) : []),
    ...(ts.getLeadingCommentRanges(text, node.pos) ?? []),
  ];
  return comments
    .filter((c) => c.end <= node.end && isJsDoc(text, c))
    .map((c) => {
      const column = sf.getLineAndCharacterOfPosition(c.pos).character;
      return text
        .slice(c.pos, c.end)
        .split(/\r\n|\r|\n/)
        .map((line, i) => (i === 0 ? line : dedent(line, column)));
    });
}

/** The blocks of an exported variable: those above its statement, which TypeScript attaches to
 *  the first declarator of the statement, then those above the declarator itself. */
function variableBlocks(d: ts.VariableDeclaration, sf: ts.SourceFile): DocBlock[] {
  const list = d.parent;
  if (!ts.isVariableDeclarationList(list)) return blocksAbove(d, sf);
  const statement = list.parent;
  const above =
    ts.isVariableStatement(statement) && list.declarations[0] === d
      ? blocksAbove(statement, sf)
      : [];
  return [...above, ...blocksAbove(d, sf)];
}

/** Whether `member` is one the view may write with the author's comment: a member of an `enum`, a
 *  field of a struct, and of a class its constructor, a method, each half of an accessor and a
 *  field, a static one among them (item 4 of the change). A constructor or a method with no body
 *  is an overload signature, which the face does not read; an abstract method has no body and is
 *  the member. Which of these the view declares is the printer's: a static field is no member of
 *  an exported class there (surface §26). */
function carriesComment(member: ts.Node): boolean {
  if (ts.isConstructorDeclaration(member) || ts.isMethodDeclaration(member))
    return (
      member.body !== undefined ||
      (ts.getModifiers(member) ?? []).some((m) => m.kind === ts.SyntaxKind.AbstractKeyword)
    );
  return (
    ts.isEnumMember(member) ||
    ts.isPropertySignature(member) ||
    ts.isPropertyDeclaration(member) ||
    ts.isGetAccessorDeclaration(member) ||
    ts.isSetAccessorDeclaration(member)
  );
}

/** The members of an `enum`, a struct or a class declaration that the view may write with a
 *  comment. */
function membersOf(decl: ts.Node): readonly ts.Node[] {
  if (ts.isEnumDeclaration(decl) || ts.isClassDeclaration(decl) || ts.isInterfaceDeclaration(decl))
    return decl.members.filter(carriesComment);
  if (ts.isTypeAliasDeclaration(decl) && ts.isTypeLiteralNode(decl.type))
    return decl.type.members.filter(carriesComment);
  return [];
}

/** The names the `extends` clause of a class or an interface writes. */
function basesOf(decl: ts.Node): string[] {
  if (!ts.isClassDeclaration(decl) && !ts.isInterfaceDeclaration(decl)) return [];
  return (decl.heritageClauses ?? [])
    .filter((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
    .flatMap((clause) => clause.types.map((type) => type.expression))
    .filter(ts.isIdentifier)
    .map((name) => name.text);
}

/** The name a member is written under, when it is a plain one. A field with a private name `#x` is
 *  the field `x` of the struct (Rule 8.12), and the view declares it `private x` (surface §26), so
 *  it goes by `x`, the name its line is written with. No other member with a private name is in
 *  the view: the face leaves out a method or an accessor of that kind. */
function memberName(member: ts.Node): string | undefined {
  const name = (member as ts.NamedDeclaration).name;
  if (name === undefined) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return ts.isPrivateIdentifier(name) && ts.isPropertyDeclaration(member)
    ? emittedMemberName(name.text)
    : undefined;
}

/** The key `member` is kept under in `ExportDocs.members`, or `undefined` when it has no plain
 *  name. A member of an `enum`, a field of a struct and an instance field or method of a class go
 *  by their names, as before, and a field with a private name `#x` by `x`. */
function keyOf(member: ts.Node): string | undefined {
  if (ts.isConstructorDeclaration(member)) return CONSTRUCTOR;
  const name = memberName(member);
  if (name === undefined) return undefined;
  const half = ts.isGetAccessorDeclaration(member)
    ? 'get'
    : ts.isSetAccessorDeclaration(member)
      ? 'set'
      : undefined;
  return memberKey(name, {
    isStatic: isStaticMember(member),
    ...(half !== undefined ? { half } : {}),
  });
}

/** The declaration that the author wrote for `decl`, a declaration of the face source, with the
 *  file that holds it. For a linked module, that is the declaration in the file it came from. */
function writtenDeclaration(
  decl: ts.Node,
  face: ts.SourceFile,
  linked: LinkedProgram | undefined,
): { readonly node: ts.Node; readonly sf: ts.SourceFile } | undefined {
  if (linked === undefined) return { node: decl, sf: face };
  const at = linked.map(decl.getStart(face), decl.getEnd());
  if (at === undefined) return undefined;
  const sf = at.file.sourceFile;
  // The linker may have taken the `export` off the statement, so the offset can be inside it.
  const statement = sf.statements.find((s) => s.getStart(sf) <= at.start && at.start < s.getEnd());
  if (statement === undefined) return undefined;
  if (!ts.isVariableStatement(statement)) return { node: statement, sf };
  const declarator = statement.declarationList.declarations.find(
    (d) => d.getStart(sf) <= at.start && at.start < d.getEnd(),
  );
  return declarator === undefined ? undefined : { node: declarator, sf };
}

/** The blocks above each member of `decl`, a declaration of `face`. A struct holds the fields of
 *  the base it extends, and a class the members of the classes above it, so a member with no block
 *  of its own takes the blocks of the member of that name in a base, as TypeScript's hover does.
 *  The constructor is the exception: a class that has a constructor of its own takes no comment
 *  from the constructor of a base, which another set of parameters documents. `declared` finds a
 *  base by its name in `face`. */
function memberDocs(
  decl: ts.Node,
  face: ts.SourceFile,
  declared: ReadonlyMap<string, ts.Node>,
  linked: LinkedProgram | undefined,
  seen: Set<ts.Node>,
): Map<string, DocBlock[]> {
  const members = new Map<string, DocBlock[]>();
  const written = seen.has(decl) ? undefined : writtenDeclaration(decl, face, linked);
  if (written === undefined) return members;
  seen.add(decl);
  const own = membersOf(written.node);
  const ownConstructor = own.some(ts.isConstructorDeclaration);
  for (const member of own) {
    const key = keyOf(member);
    if (key === undefined) continue;
    const above = blocksAbove(member, written.sf);
    if (above.length > 0) members.set(key, above);
  }
  for (const base of basesOf(decl)) {
    const baseDecl = declared.get(base);
    if (baseDecl === undefined) continue;
    for (const [key, above] of memberDocs(baseDecl, face, declared, linked, seen))
      if (!members.has(key) && !(key === CONSTRUCTOR && ownConstructor)) members.set(key, above);
  }
  return members;
}

/** The JSDoc of the export that the declaration `decl` of `face` is, or `undefined` when the
 *  author wrote none. `declared` holds the top-level declarations of `face` by name, and `linked`
 *  is the linked program `face` is the source of, when the module imports another. */
export function exportDocs(
  decl: ts.Node,
  face: ts.SourceFile,
  declared: ReadonlyMap<string, ts.Node>,
  linked?: LinkedProgram,
): ExportDocs | undefined {
  const written = writtenDeclaration(decl, face, linked);
  if (written === undefined) return undefined;
  const { node, sf } = written;
  const blocks = ts.isVariableDeclaration(node) ? variableBlocks(node, sf) : blocksAbove(node, sf);
  const members = memberDocs(decl, face, declared, linked, new Set());
  return blocks.length === 0 && members.size === 0 ? undefined : { blocks, members };
}

/** `block` with `sentence` at its end, after one empty comment line. The author's lines stay as
 *  written: only the end of the block moves below the sentence. */
function withSentence(block: DocBlock, sentence: string): DocBlock {
  const kept = [...block.slice(0, -1), block[block.length - 1]!.replace(/\s*\*\/$/, '')];
  if (kept[kept.length - 1]!.trim() === '') kept.pop();
  // The opening alone, or an empty comment line, already separates the sentence from the words.
  const separated = /^\s*(\/\*\*|\*)?\s*$/.test(kept[kept.length - 1]!);
  return [...kept, ...(separated ? [] : [' *']), ` * ${sentence}`, ' */'];
}

/** The lines of the comment above an export, written at `indent`: each of the author's `blocks`,
 *  and the view's own `sentence` at the end of the last one. With no block the comment is the
 *  sentence on one line, and with neither it is empty. */
export function commentLines(
  blocks: readonly DocBlock[],
  sentence?: string,
  indent = '',
): string[] {
  if (blocks.length === 0) return sentence === undefined ? [] : [`${indent}/** ${sentence} */`];
  const last = blocks[blocks.length - 1]!;
  const shown =
    sentence === undefined ? blocks : [...blocks.slice(0, -1), withSentence(last, sentence)];
  return shown.flatMap((block) => block.map((line) => indent + line));
}
