import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { membersOf, topLevel } from '../symbol-anchors/declarations.js';

export interface Decl {
  readonly symbol: string;
  readonly member: string | undefined;
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly members: readonly Decl[];
}

export interface IndexedFile {
  readonly lines: readonly string[];
  readonly decls: readonly Decl[];
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export const sizeOf = (decl: Decl): number => decl.to - decl.from + 1;
export const anchorOf = (decl: Decl): string =>
  decl.member === undefined ? decl.symbol : `${decl.symbol}.${decl.member}`;

function describe(
  source: ts.SourceFile,
  node: ts.Node,
  symbol: string,
  member: string | undefined,
  members: readonly Decl[],
): Decl {
  const start = node.getStart(source);
  return {
    symbol,
    member,
    from: source.getLineAndCharacterOfPosition(start).line + 1,
    to: source.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
    text: source.text.slice(start, node.getEnd()),
    members,
  };
}

function indexSource(source: ts.SourceFile): Decl[] {
  const decls: Decl[] = [];
  for (const [symbol, nodes] of topLevel(source)) {
    if (!IDENTIFIER.test(symbol)) continue;
    const members: Decl[] = [];
    for (const [name, found] of membersOf(nodes)) {
      if (!IDENTIFIER.test(name)) continue;
      for (const node of found) members.push(describe(source, node, symbol, name, []));
    }
    for (const node of nodes) decls.push(describe(source, node, symbol, undefined, members));
  }
  return decls;
}

export class SourceIndex {
  private readonly known = new Map<string, IndexedFile | undefined>();

  constructor(private readonly root: string) {}

  get(file: string): IndexedFile | undefined {
    if (this.known.has(file)) return this.known.get(file);
    const full = join(this.root, file);
    let indexed: IndexedFile | undefined;
    if (existsSync(full) && statSync(full).isFile()) {
      const text = readFileSync(full, 'utf8');
      const lines = text.split('\n');
      if (text.endsWith('\n')) lines.pop();
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      indexed = { lines, decls: indexSource(source) };
    }
    this.known.set(file, indexed);
    return indexed;
  }
}
