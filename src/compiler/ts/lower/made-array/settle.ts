// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
import type ts from 'typescript';
import type { Expr, FuncDecl, Stmt } from '../../../../core/ir/nodes.js';
import { u32T, voidT } from '../../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../../source-file.js';
import { TS_CODES } from '../../codes.js';
import { makeDiagnostic } from '../../diagnostic.js';
import { lengthFromHost } from './length.js';
import { madeLoweringOf, nodesSaidOnce, setMadeArray, type MadeLowering } from './registry.js';
import { hostReadable, notKnown, readersOf, type Readable } from './readable.js';
import { grownCapacity } from './capacity.js';

function withoutResult(body: readonly Stmt[], param: string, result?: Expr): Stmt[] {
  const inner = (b: readonly Stmt[]): Stmt[] => withoutResult(b, param, result);
  return body.map((st): Stmt => {
    switch (st.s) {
      case 'return':
        return st.expr?.op === 'param' && st.expr.name === param
          ? {
              s: 'return',
              ...(result !== undefined ? { expr: result } : {}),
              ...(st.span !== undefined ? { span: st.span } : {}),
            }
          : st;
      case 'if':
        return {
          ...st,
          arms: st.arms.map((a) => ({ ...a, body: inner(a.body) })),
          ...(st.elseBody !== undefined ? { elseBody: inner(st.elseBody) } : {}),
        };
      case 'for':
        return { ...st, body: inner(st.body) };
      case 'switch':
        return {
          ...st,
          cases: st.cases.map((c) => ({ ...c, body: inner(c.body) })),
          ...(st.defaultBody !== undefined ? { defaultBody: inner(st.defaultBody) } : {}),
        };
      default:
        return st;
    }
  });
}

function readable(
  stub: FuncDecl,
  made: MadeLowering,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): { readonly r: Readable; readonly length: Expr } | undefined {
  const r = readersOf(stub, made.param);
  if (made.grown === true) {
    const length = grownCapacity(stub, made, r, sourceFile, diagnostics);
    return length === undefined ? undefined : { r, length };
  }
  if (!hostReadable(made.length, r)) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        made.lengthNode,
        notKnown(`"${made.form}" takes its length from "${made.lengthText}", which`),
        TS_CODES.UNSUPPORTED,
      ),
    );
    return undefined;
  }
  if (made.fill !== undefined && !hostReadable(made.fill, r)) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        made.fillNode,
        notKnown(`The value "${made.form}" fills its array with`),
        TS_CODES.UNSUPPORTED,
      ),
    );
    return undefined;
  }
  return { r, length: made.length };
}

function quietRepeats(
  stub: FuncDecl,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  for (const node of nodesSaidOnce(stub)) {
    const start = node.getStart(sourceFile);
    const at = diagnostics.flatMap((d, i) => (d.start === start ? [i] : []));
    for (const i of at.slice(1).reverse()) diagnostics.splice(i, 1);
  }
}

export function settleMadeArray(
  stub: FuncDecl,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  quietRepeats(stub, sourceFile, diagnostics);
  const made = madeLoweringOf(stub);
  if (made === undefined || stub.ret.kind !== 'array') return;
  const read = readable(stub, made, sourceFile, diagnostics);
  if (read === undefined) return;
  const prelude = stub.body.filter((st) => st.s === 'let' && read.r.needed.has(st.name));
  const param = stub.params.find((p) => p.name === made.param)!;
  const pushed: Expr | undefined =
    made.grown === true
      ? {
          op: 'call',
          type: u32T,
          fn: 'pushCount',
          args: [{ op: 'param', type: param.type, name: param.name }],
        }
      : undefined;
  (stub as { body: readonly Stmt[] }).body = withoutResult(stub.body, made.param, pushed);
  (stub as { ret: FuncDecl['ret'] }).ret = pushed === undefined ? voidT : u32T;
  const count = lengthFromHost(stub, made.param);
  setMadeArray(stub, {
    param: made.param,
    count,
    shown: (made.decl.name as ts.Identifier).text,
    element: made.element,
    length: read.length,
    ...(made.fill !== undefined ? { fill: made.fill } : {}),
    ...(made.grown === true ? { grown: true as const } : {}),
    prelude,
    form: made.form,
    lengthText: made.lengthText,
  });
}
