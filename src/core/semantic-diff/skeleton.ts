import { stageOf, type Expr, type FuncDecl, type ModuleDecl, type Stmt } from '../ir/nodes.js';
import { typeSig, type Canon } from './canon.js';

export function subExprs(e: Expr): readonly Expr[] {
  switch (e.op) {
    case 'call':
    case 'construct':
      return e.args;
    case 'binop':
    case 'compare':
    case 'logical':
      return [e.a, e.b];
    case 'unop':
      return [e.a];
    case 'member':
      return [e.base];
    case 'index':
      return [e.base, e.idx];
    case 'select':
      return [e.cond, e.ifTrue, e.ifFalse];
    case 'matchExpr':
      return [e.scrutinee, ...e.cases.map(([, v]) => v), e.default];
    default:
      return [];
  }
}

export function exprSig(e: Expr, c: Canon, locals: ReadonlyMap<string, string>): string {
  const t = typeSig(e.type, c);
  const kids = (): string =>
    subExprs(e)
      .map((k) => exprSig(k, c, locals))
      .join(' ');
  switch (e.op) {
    case 'lit':
      return `(lit:${t})`;
    case 'constref':
      return `(const ${c.consts.get(e.name) ?? e.name}:${t})`;
    case 'overrideref':
      return `(override ${e.name}:${t})`;
    case 'externref':
      return `(extern ${e.name}:${t})`;
    case 'param':
    case 'varref':
      return `(${e.op} ${locals.get(e.name) ?? e.name}:${t})`;
    case 'binop':
      return `(${e.bop}:${t} ${kids()})`;
    case 'compare':
      return `(${e.cop}:${t} ${kids()})`;
    case 'logical':
      return `(${e.lop}:${t} ${kids()})`;
    case 'call':
      return `(call ${c.fns.get(e.fn) ?? e.fn}:${t} ${kids()})`;
    case 'member':
      return `(.${e.field}:${t} ${kids()})`;
    case 'matchExpr':
      return `(match:${t} [${e.cases.map(([v]) => v).join(',')}] ${kids()})`;
    default:
      return `(${e.op}:${t} ${kids()})`;
  }
}

function stmtSig(s: Stmt, c: Canon, locals: ReadonlyMap<string, string>): string {
  const E = (e: Expr): string => exprSig(e, c, locals);
  switch (s.s) {
    case 'let':
      return `let ${locals.get(s.name) ?? s.name} = ${E(s.expr)}`;
    case 'var':
      return `var ${locals.get(s.name) ?? s.name}: ${typeSig(s.type, c)}${s.init === undefined ? '' : ' = ' + E(s.init)}`;
    case 'assign':
      return `assign ${E(s.target)} = ${E(s.expr)}`;
    case 'assignOp':
      return `assign${s.bop} ${E(s.target)} = ${E(s.expr)}`;
    case 'return':
      return `return${s.expr === undefined ? '' : ' ' + E(s.expr)}`;
    case 'call':
      return `call ${E(s.expr)}`;
    case 'if':
      return `if arms=${s.arms.length} else=${s.elseBody ? 'y' : 'n'} conds=[${s.arms.map((a) => E(a.cond)).join(' ')}]`;
    case 'for':
      return `for cond=${E(s.cond)}`;
    case 'switch':
      return `switch ${E(s.scrut)} cases=[${s.cases.map((k) => k.values.join('|')).join(',')}] default=${s.defaultBody ? 'y' : 'n'}`;
    case 'placeholder':
      return `placeholder ${s.tag}`;
    case 'raw':
      return `raw wgsl=${s.wgsl === undefined ? 'n' : 'y'} glsl=${s.glsl === undefined ? 'n' : 'y'}`;
    default:
      return s.s;
  }
}

function bodyLines(
  body: readonly Stmt[],
  path: string,
  c: Canon,
  locals: ReadonlyMap<string, string>,
  out: string[],
): void {
  body.forEach((s, i) => {
    const p = `${path}${i}`;
    out.push(`${p} ${stmtSig(s, c, locals)}`);
    if (s.s === 'if') {
      s.arms.forEach((a, ai) => bodyLines(a.body, `${p}.arm${ai}.`, c, locals, out));
      if (s.elseBody) bodyLines(s.elseBody, `${p}.else.`, c, locals, out);
    } else if (s.s === 'for') {
      bodyLines([s.init], `${p}.init.`, c, locals, out);
      bodyLines([s.update], `${p}.update.`, c, locals, out);
      bodyLines(s.body, `${p}.body.`, c, locals, out);
    } else if (s.s === 'switch') {
      s.cases.forEach((k, ki) => bodyLines(k.body, `${p}.case${ki}.`, c, locals, out));
      if (s.defaultBody) bodyLines(s.defaultBody, `${p}.default.`, c, locals, out);
    }
  });
}

function fnHeader(f: FuncDecl, c: Canon, locals: ReadonlyMap<string, string>): string {
  const stage = stageOf(f);
  const params = f.params
    .map(
      (p) =>
        `${stage === undefined ? (locals.get(p.name) ?? p.name) : p.name}:${typeSig(p.type, c)}` +
        `${p.builtin ? '@' + p.builtin : ''}${p.location === undefined ? '' : '@loc' + p.location}`,
    )
    .join(',');
  return `fn ${c.fns.get(f.name) ?? f.name}(${params}) -> ${typeSig(f.ret, c)} stage=${stage ?? '-'}`;
}

export function controlFlowFacts(m: ModuleDecl, c: Canon): string[] {
  const out: string[] = [];
  for (const f of m.funcs) {
    const locals = c.locals.get(f.name) ?? new Map<string, string>();
    const name = c.fns.get(f.name) ?? f.name;
    out.push(fnHeader(f, c, locals));
    const lines: string[] = [];
    bodyLines(f.body, '', c, locals, lines);
    for (const l of lines) out.push(`${name}#${l}`);
  }
  return out;
}
