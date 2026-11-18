import ts from 'typescript';
import type { Expr, FuncDecl, Stmt } from '../../../../core/ir/nodes.js';
import type { ShaderType } from '../../../../core/ir/types.js';
import { boolT, i32T } from '../../../../core/ir/types.js';
import { TS_CODES } from '../../codes.js';
import { fillArray } from '../../array-ops.js';
import { logicalTypeKey as typeKey } from '../../optional.js';
import { spanOf } from '../../span.js';
import { push } from '../array-methods.js';
import { declarationOf } from '../closures.js';
import { liftWritten } from '../function-args.js';
import { captureArguments } from '../local-functions.js';
import { constantLength, type Lowering } from './lower.js';
import { constructedLength, shortText, unparenthesized } from './form.js';

const lit = (type: ShaderType, value: number): Expr => ({ op: 'lit', type, value });

function countedLoop(counter: string, n: number, body: Stmt[]): Stmt {
  const i: Expr = { op: 'varref', type: i32T, name: counter };
  return {
    s: 'for',
    init: { s: 'var', name: counter, type: i32T, init: lit(i32T, 0) },
    cond: { op: 'compare', type: boolT, cop: '<', a: i, b: lit(i32T, n) },
    update: {
      s: 'assign',
      target: i,
      expr: { op: 'binop', type: i32T, bop: '+', a: i, b: lit(i32T, 1) },
    },
    body,
  };
}

function filledBody(
  taken: ReadonlySet<string>,
  type: ShaderType,
  n: number,
  value: (i: Expr) => Expr,
): Stmt[] {
  const fresh = (base: string): string => {
    let name = base;
    for (let k = 1; taken.has(name); k++) name = `${base}_${String(k)}`;
    return name;
  };
  const out = fresh('out');
  const counter = fresh('i');
  const elem = type.kind === 'array' ? type.elem : type;
  const at: Expr = { op: 'varref', type, name: out };
  const i: Expr = { op: 'varref', type: i32T, name: counter };
  return [
    { s: 'var', name: out, type },
    countedLoop(counter, n, [
      { s: 'assign', target: { op: 'index', type: elem, base: at, idx: i }, expr: value(i) },
    ]),
    { s: 'return', expr: at },
  ];
}

function repeatable(e: Expr): boolean {
  switch (e.op) {
    case 'lit':
    case 'varref':
    case 'param':
    case 'constref':
      return true;
    case 'construct':
      return e.args.every(repeatable);
    case 'unop':
      return repeatable(e.a);
    case 'binop':
      return repeatable(e.a) && repeatable(e.b);
    default:
      return false;
  }
}

export function repeatedValue(
  elem: ShaderType,
  n: number,
  value: Expr,
  call: ts.CallExpression,
  { sourceFile, scope }: Lowering,
): Expr | undefined {
  if (repeatable(value) || scope.owner() === undefined) return fillArray(elem, n, value);
  const type: ShaderType = { kind: 'array', elem, size: n };
  const built = scope.buildFunction(
    ['array', 'new-fill', typeKey(type)].join('|'),
    'array_fill',
    `new Array(${String(n)}).fill`,
    [],
    (name): FuncDecl => ({
      name,
      params: [{ name: 'v', type: elem }],
      ret: type,
      body: filledBody(new Set(['v']), type, n, () => ({ op: 'param', type: elem, name: 'v' })),
    }),
  );
  if (built === undefined) return undefined;
  const span = spanOf(sourceFile, call);
  return { op: 'call', type, fn: built.name, args: [value], declRef: built, span };
}

function readsParameter(fn: ts.ArrowFunction | ts.FunctionExpression, at: number): boolean {
  const param = fn.parameters[at];
  if (param === undefined || !ts.isIdentifier(param.name)) return false;
  const visit = (node: ts.Node): boolean =>
    (ts.isIdentifier(node) &&
      node.text === param.name.getText() &&
      declarationOf(node) === param) ||
    (ts.forEachChild(node, visit) ?? false);
  return fn.body !== undefined && visit(fn.body);
}

export function lowerFrom(call: ts.CallExpression, at: Lowering): Expr | undefined {
  const { sourceFile, scope, diagnostics } = at;
  const written = shortText(call);
  const refuse = (node: ts.Node, message: string): undefined =>
    push(diagnostics, sourceFile, node, message, TS_CODES.UNSUPPORTED);
  const length = constructedLength(call);
  if (length === undefined || call.arguments.length > 2) {
    return refuse(
      call,
      `"${written}" is not supported yet: Array.from builds an array here from ` +
        `{ length: N } and a function, with a constant N.`,
    );
  }
  const handed = call.arguments[1];
  if (handed === undefined) {
    return refuse(
      call,
      `"${written}" makes an array of undefined values in JavaScript, and an undefined element ` +
        `is not supported yet. Hand it a function: Array.from({ length: N }, (_, i) => …).`,
    );
  }
  const fn = unparenthesized(handed);
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) {
    return refuse(
      handed,
      `"${written}" hands over "${shortText(handed)}", and a function handed to Array.from is ` +
        `supported yet only as an arrow function written in the call: (_, i) => ….`,
    );
  }
  if (fn.parameters.length > 2) {
    return refuse(
      fn.parameters[2]!,
      `Array.from hands its function two arguments, undefined and the index, so ` +
        `"${shortText(fn.parameters[2]!)}" would be undefined, which is not supported yet.`,
    );
  }
  if (readsParameter(fn, 0)) {
    return refuse(
      fn.parameters[0]!,
      `"${shortText(fn.parameters[0]!)}" is undefined, as Array.from passes it, and reading it ` +
        `is not supported yet. Read the index, the second parameter: (_, i) => ….`,
    );
  }
  if (scope.owner() === undefined) {
    return refuse(
      call,
      `"${written}" runs its function for each element, which is not supported yet outside a ` +
        `function's body (at module scope or in a field's initializer). Build it inside the ` +
        `function that needs it.`,
    );
  }
  const n = constantLength(call, length, at);
  if (n === undefined) return undefined;
  const own = fn.parameters.length;
  const shape = {
    params: [i32T, i32T].slice(0, own),
    ret: undefined,
    text: `(value: undefined, index: i32) => …`,
  };
  const f = liftWritten(fn, shape, 'f', scope, sourceFile, diagnostics);
  if (f === undefined || !scope.calleeReady(f, fn, sourceFile, diagnostics)) return undefined;
  if (f.ret.kind === 'void') {
    return push(
      diagnostics,
      sourceFile,
      handed,
      `The function "${written}" is handed returns nothing, so there is no element to build: ` +
        `return one from it.`,
      TS_CODES.TYPE_MISMATCH,
    );
  }
  const keys = scope.capturesOf(f.name);
  const caps = f.params.slice(0, keys.length).map((p) => ({ ...p }));
  const type: ShaderType = { kind: 'array', elem: f.ret, size: n };
  const built = scope.buildFunction(
    ['array', 'from', f.name, String(n)].join('|'),
    `array_from_${f.name}`,
    'Array.from',
    keys,
    (name): FuncDecl => ({
      name,
      params: caps,
      ret: type,
      body: filledBody(new Set(caps.map((p) => p.name)), type, n, (i) => ({
        op: 'call',
        type: f.ret,
        fn: f.name,
        args: [
          ...caps.map((p): Expr => ({ op: 'param', type: p.type, name: p.name })),
          ...[lit(i32T, 0), i].slice(0, own),
        ],
        declRef: f,
      })),
    }),
  );
  if (built === undefined) return undefined;
  const leading = captureArguments(built, 'Array.from', call, sourceFile, scope, diagnostics);
  if (leading === undefined) return undefined;
  return {
    op: 'call',
    type,
    fn: built.name,
    args: leading,
    declRef: built,
    span: spanOf(sourceFile, call),
  };
}
