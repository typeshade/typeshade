// ═══ The author's JSDoc in the host view (change 0108; surface §64) ═══
//
// A host file reads the host view of a shader module, never its source, so the documentation an
// author writes above an export reaches the host only if the view carries it. This file reads that
// documentation and writes it back:
//
//   - `exportDocs` reads the JSDoc blocks (`/** … */`) attached to an exported declaration, and
//     to each member of an `enum` and each field of a struct. A block is text: it is copied as the
//     author wrote it, with its tags (decisions D1 and D2), in source order. A `//` comment and a
//     `/* */` comment are not JSDoc, and a comment inside a body is not attached to anything.
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
import type { LinkedProgram } from './link.js';

/** One JSDoc block as lines. The first line begins with a slash and two stars, and the last ends
 *  with a star and a slash. Each other line has lost the column the block began at, so the block
 *  can be written at any indentation. */
export type DocBlock = readonly string[];

/** The JSDoc of one export, as the author wrote it. */
export interface ExportDocs {
  /** The blocks attached to the declaration, in source order. */
  readonly blocks: readonly DocBlock[];
  /** The blocks attached to each member of an `enum` and each field of a struct, by name. */
  readonly members: ReadonlyMap<string, readonly DocBlock[]>;
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

/** The members an `enum` or a struct declaration lists. */
function membersOf(decl: ts.Node): readonly ts.Node[] {
  if (ts.isEnumDeclaration(decl) || ts.isClassDeclaration(decl) || ts.isInterfaceDeclaration(decl))
    return decl.members;
  if (ts.isTypeAliasDeclaration(decl) && ts.isTypeLiteralNode(decl.type)) return decl.type.members;
  return [];
}

/** The name a member is written under, when it is a plain one. */
function memberName(member: ts.Node): string | undefined {
  const name = (member as ts.NamedDeclaration).name;
  return name !== undefined &&
    (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
    ? name.text
    : undefined;
}

/** The declaration the author wrote for `decl`, a declaration of the face source, and the file
 *  that holds it. For a linked module that is the file the declaration came from. */
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

/** The JSDoc of the export that the declaration `decl` of `face` is, or `undefined` when the
 *  author wrote none. `linked` is the linked program `face` is the source of, when the module
 *  imports another. */
export function exportDocs(
  decl: ts.Node,
  face: ts.SourceFile,
  linked?: LinkedProgram,
): ExportDocs | undefined {
  const written = writtenDeclaration(decl, face, linked);
  if (written === undefined) return undefined;
  const { node, sf } = written;
  const blocks = ts.isVariableDeclaration(node) ? variableBlocks(node, sf) : blocksAbove(node, sf);
  const members = new Map<string, DocBlock[]>();
  for (const member of membersOf(node)) {
    const name = memberName(member);
    if (name === undefined) continue;
    const above = blocksAbove(member, sf);
    if (above.length > 0) members.set(name, above);
  }
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
