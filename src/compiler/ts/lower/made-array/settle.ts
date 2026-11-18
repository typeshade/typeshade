import type ts from 'typescript';
import type { Expr, FuncDecl, Stmt } from '../../../../core/ir/nodes.js';
import { voidT } from '../../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../../source-file.js';
import { TS_CODES } from '../../codes.js';
import { makeDiagnostic } from '../../diagnostic.js';
import { madeLoweringOf, setMadeArray, type MadeLowering } from './registry.js';

const ARITHMETIC: ReadonlySet<string> = new Set(['+', '-', '*', '/', '%']);
const CASTS: ReadonlySet<string> = new Set(['u32', 'i32', 'f32']);

interface Readable {
  readonly values: ReadonlySet<string>;
  readonly arrays: ReadonlySet<string>;
  readonly lets: ReadonlyMap<string, Expr>;
  readonly needed: Set<string>;
}

function hostReadable(e: Expr, r: Readable): boolean {
  switch (e.op) {
    case 'lit':
    case 'constref':
      return true;
    case 'param':
      return r.values.has(e.name);
    case 'member':
      return hostReadable(e.base, r);
    case 'varref': {
      const init = r.lets.get(e.name);
      if (init === undefined) return false;
      r.needed.add(e.name);
      return hostReadable(init, r);
    }
    case 'unop':
      return hostReadable(e.a, r);
    case 'binop':
      return ARITHMETIC.has(e.bop) && hostReadable(e.a, r) && hostReadable(e.b, r);
    case 'construct':
      return e.type.kind === 'scalar' && e.args.length === 1 && hostReadable(e.args[0]!, r);
    case 'call': {
      if (e.fn === 'arrayLength')
        return e.args.length === 1 && e.args[0]!.op === 'param' && r.arrays.has(e.args[0]!.name);
      if (CASTS.has(e.fn)) return e.args.length === 1 && hostReadable(e.args[0]!, r);
      if (e.fn === 'min' || e.fn === 'max') return e.args.every((a) => hostReadable(a, r));
      return false;
    }
    default:
      return false;
  }
}

function withoutResult(body: readonly Stmt[], param: string): Stmt[] {
  return body.map((st): Stmt => {
    switch (st.s) {
      case 'return':
        return st.expr?.op === 'param' && st.expr.name === param
          ? { s: 'return', ...(st.span !== undefined ? { span: st.span } : {}) }
          : st;
      case 'if':
        return {
          ...st,
          arms: st.arms.map((a) => ({ ...a, body: withoutResult(a.body, param) })),
          ...(st.elseBody !== undefined ? { elseBody: withoutResult(st.elseBody, param) } : {}),
        };
      case 'for':
        return { ...st, body: withoutResult(st.body, param) };
      case 'switch':
        return {
          ...st,
          cases: st.cases.map((c) => ({ ...c, body: withoutResult(c.body, param) })),
          ...(st.defaultBody !== undefined
            ? { defaultBody: withoutResult(st.defaultBody, param) }
            : {}),
        };
      default:
        return st;
    }
  });
}

const notKnown = (what: string): string =>
  `${what} reads a value the call does not know before it runs. It reads the value parameters, ` +
  `their components and fields, module constants, the length of an array parameter, number ` +
  `literals, u32, i32 and f32 of these, and top-level consts of these, with +, -, *, /, %, min ` +
  `and max; any other operand is not supported yet.`;

function readable(
  stub: FuncDecl,
  made: MadeLowering,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Readable | undefined {
  const values = new Set<string>();
  const arrays = new Set<string>();
  for (const p of stub.params) {
    if (p.name === made.param) continue;
    if (p.type.kind === 'array' && p.type.size === undefined) arrays.add(p.name);
    else if (p.type.kind !== 'texture' && p.type.kind !== 'collection') values.add(p.name);
  }
  const lets = new Map<string, Expr>();
  for (const st of stub.body) if (st.s === 'let') lets.set(st.name, st.expr);
  const r: Readable = { values, arrays, lets, needed: new Set() };
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
  return r;
}

export function settleMadeArray(
  stub: FuncDecl,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  const made = madeLoweringOf(stub);
  if (made === undefined || stub.ret.kind !== 'array') return;
  const r = readable(stub, made, sourceFile, diagnostics);
  if (r === undefined) return;
  const prelude = stub.body.filter((st) => st.s === 'let' && r.needed.has(st.name));
  (stub as { body: readonly Stmt[] }).body = withoutResult(stub.body, made.param);
  (stub as { ret: FuncDecl['ret'] }).ret = voidT;
  setMadeArray(stub, {
    param: made.param,
    shown: (made.decl.name as ts.Identifier).text,
    element: made.element,
    length: made.length,
    ...(made.fill !== undefined ? { fill: made.fill } : {}),
    prelude,
    form: made.form,
    lengthText: made.lengthText,
  });
}
