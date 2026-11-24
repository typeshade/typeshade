import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import ts from 'typescript';
import { isMergeable, membersOf, testCalls, topLevel, type Declarations } from './declarations.js';
import { isTestPath, type Anchor } from './grammar.js';

export type FailureKind =
  | 'file-missing'
  | 'not-typescript'
  | 'symbol-not-found'
  | 'symbol-ambiguous'
  | 'member-not-found'
  | 'member-ambiguous'
  | 'needle-not-found'
  | 'anchor-form';

export interface Found {
  readonly ok: true;
  readonly file: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly needleLine?: number;
}

export interface Failed {
  readonly ok: false;
  readonly kind: FailureKind;
  readonly message: string;
}

export type Resolution = Found | Failed;

const fail = (kind: FailureKind, message: string): Failed => ({ ok: false, kind, message });

interface Located {
  readonly source: ts.SourceFile;
  readonly file: string;
  readonly nodes: readonly ts.Node[];
}

const REEXPORT_DEPTH = 8;

export class AnchorResolver {
  private readonly parsed = new Map<string, ts.SourceFile | undefined>();

  constructor(private readonly root: string) {}

  private load(file: string): ts.SourceFile | undefined {
    if (this.parsed.has(file)) return this.parsed.get(file);
    const full = join(this.root, file);
    const source =
      existsSync(full) && statSync(full).isFile()
        ? ts.createSourceFile(file, readFileSync(full, 'utf8'), ts.ScriptTarget.Latest, true)
        : undefined;
    this.parsed.set(file, source);
    return source;
  }

  private moduleFile(from: string, specifier: string): string | undefined {
    if (!specifier.startsWith('.')) return undefined;
    const base = posix.join(posix.dirname(from), specifier).replace(/\.js$/, '');
    return [`${base}.ts`, `${base}/index.ts`].find((file) => this.load(file) !== undefined);
  }

  private locate(file: string, symbol: string, depth: number): Located | Failed {
    const source = this.load(file);
    if (source === undefined) return fail('file-missing', `${file} does not exist`);
    const own = topLevel(source).get(symbol);
    if (own) return { source, file, nodes: own };
    if (depth >= REEXPORT_DEPTH) {
      return fail('symbol-not-found', `${file} re-exports ${symbol} through too many files`);
    }
    return this.followReexports(source, file, symbol, depth);
  }

  private followReexports(
    source: ts.SourceFile,
    file: string,
    symbol: string,
    depth: number,
  ): Located | Failed {
    const stars: string[] = [];
    for (const statement of source.statements) {
      if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier === undefined) continue;
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const target = this.moduleFile(file, statement.moduleSpecifier.text);
      if (statement.exportClause === undefined) {
        if (target !== undefined) stars.push(target);
      } else if (ts.isNamedExports(statement.exportClause)) {
        const element = statement.exportClause.elements.find((one) => one.name.text === symbol);
        if (element === undefined) continue;
        if (target === undefined) {
          return fail(
            'file-missing',
            `${file} re-exports ${symbol} from ${statement.moduleSpecifier.text}, which does not resolve to a file`,
          );
        }
        return this.locate(target, (element.propertyName ?? element.name).text, depth + 1);
      }
    }
    const hits: Located[] = [];
    for (const target of stars) {
      const hit = this.locate(target, symbol, depth + 1);
      if (!('ok' in hit)) hits.push(hit);
    }
    if (hits.length === 1) return hits[0]!;
    if (hits.length > 1) {
      return fail(
        'symbol-ambiguous',
        `${file} re-exports ${symbol} from ${hits.map((hit) => hit.file).join(' and ')}`,
      );
    }
    return fail('symbol-not-found', `${file} declares no top-level ${symbol}`);
  }

  private span(nodes: readonly ts.Node[], source: ts.SourceFile): { from: number; to: number } {
    return {
      from: Math.min(...nodes.map((node) => node.getStart(source))),
      to: Math.max(...nodes.map((node) => node.getEnd())),
    };
  }

  private line(source: ts.SourceFile, position: number): number {
    return source.getLineAndCharacterOfPosition(position).line + 1;
  }

  private finish(
    file: string,
    source: ts.SourceFile,
    nodes: readonly ts.Node[],
    anchor: Anchor,
  ): Resolution {
    const { from, to } = this.span(nodes, source);
    const found = {
      ok: true as const,
      file,
      startLine: this.line(source, from),
      endLine: this.line(source, to),
    };
    if (anchor.needle === undefined) return found;
    const at = source.text.slice(from, to).indexOf(anchor.needle);
    if (at < 0) {
      return fail(
        'needle-not-found',
        `the text of ${anchor.text.split('~')[0]} in ${file} does not hold "${anchor.needle}"`,
      );
    }
    return { ...found, needleLine: this.line(source, from + at) };
  }

  private pick(
    nodes: Declarations,
    name: string,
    kind: 'symbol' | 'member',
    where: string,
  ): readonly ts.Node[] | Failed {
    const own = nodes.get(name);
    if (own === undefined) {
      return fail(
        `${kind}-not-found`,
        `${where} has no ${kind === 'symbol' ? 'top-level ' : 'member '}${name}`,
      );
    }
    if (own.length > 1 && !isMergeable(own)) {
      return fail(`${kind}-ambiguous`, `${where} declares ${name} ${own.length} times`);
    }
    return own;
  }

  private titled(file: string, anchor: Anchor): Resolution {
    const source = this.load(file);
    if (source === undefined) return fail('file-missing', `${file} does not exist`);
    const call = testCalls(source).find((one) => one.title.includes(anchor.needle ?? ''));
    if (call === undefined) {
      return fail('needle-not-found', `no test or suite title in ${file} holds "${anchor.needle}"`);
    }
    return this.finish(file, source, [call.node], { text: anchor.text });
  }

  resolve(path: string, anchor: Anchor): Resolution {
    if (!path.endsWith('.ts')) {
      return fail('not-typescript', `${path} is not a .ts file; an anchor needs one`);
    }
    if (!existsSync(join(this.root, path))) {
      const directory = path.replace(/\.ts$/, '');
      const hint =
        existsSync(join(this.root, directory)) && statSync(join(this.root, directory)).isDirectory()
          ? `; ${directory}/ exists, but the resolver does not guess a file in it`
          : '';
      return fail('file-missing', `${path} does not exist${hint}`);
    }
    const title = anchor.symbol === undefined;
    if (title !== isTestPath(path)) {
      return fail(
        'anchor-form',
        title
          ? `${path} is not a test file, so an anchor needs a symbol: "${anchor.text}"`
          : `${path} is a test file, so an anchor is a quoted title: "${anchor.text}"`,
      );
    }
    if (title) return this.titled(path, anchor);
    const located = this.locate(path, anchor.symbol!, 0);
    if ('ok' in located) return located;
    const nodes = this.pick(
      new Map([[anchor.symbol!, located.nodes]]),
      anchor.symbol!,
      'symbol',
      located.file,
    );
    if ('ok' in nodes) return nodes;
    if (anchor.member === undefined)
      return this.finish(located.file, located.source, nodes, anchor);
    const member = this.pick(
      membersOf(nodes),
      anchor.member,
      'member',
      `${located.file}#${anchor.symbol}`,
    );
    if ('ok' in member) return member;
    return this.finish(located.file, located.source, member, anchor);
  }
}
