// ═══ An array's methods: map, forEach, some, every and reduce (Rule 8.18, surface §63) ═══
//
// `xs.map(f)` is ECMAScript's own method, and a shader has no function value to hand it. It
// needs none: every call names the function it hands over, by its name or as an arrow function
// written there, as a call of a function that takes a function does (Rule 8.18). So each call
// becomes a call of a function of the module, made for the array's type and that function: a
// counted loop over the indices that calls it (Rule 7.5), `array_map_sq(xs)`. A method call is
// an expression and a loop is a statement; a call stands wherever a call may, in an argument,
// on the right of `&&` or in a loop's condition, where a loop written in place could not. Every
// target and the CPU oracle run such a function already, and the IR gains no node.
//
// THE ARRAY IS READ AS IT GOES, as TypeScript reads it:
//
//   - a module variable, a module constant or a binding is read in place;
//   - a variable the function handed over captures is read through the parameter the loop takes
//     for it, which is the one the function writes through when it writes it: one variable, one
//     reference (Rule 8.18);
//   - any other array is passed by value, since nothing can write it while the loop runs.
//
// An index on the way to the array (`cells[k].xs`) is read once, before the loop, as TypeScript
// reads the receiver once.

import ts from 'typescript';
import type { Expr, FuncDecl, Stmt } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { boolT, i32T, typeKey, u32T, voidT } from '../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { THIS_CAPTURE, type CaptureKey, type LoweringScope } from '../context.js';
import { makeDiagnostic } from '../diagnostic.js';
import { TS_CODES, type TsCode } from '../codes.js';
import { namesInScope, unknownNameRemedy } from '../unknown-names.js';
import { lowerScalarCast } from '../numeric.js';
import { retargetDeclaredIntLit } from '../lit-coerce.js';
import { mapTsTypeToShaderType } from '../type-map.js';
import { spanOf } from '../span.js';
import { lowerExpression } from './expression.js';
import { captureArguments } from './local-functions.js';
import { declarationOf } from './closures.js';
import { misfit, type FunctionShape } from './function-types.js';

type Method = 'map' | 'forEach' | 'some' | 'every' | 'reduce';

/** The five methods of `Array.prototype` an array has here, and the name the function each one
 *  is handed is lifted under when it is written in the call: `fs_f`, `fs_p`. */
const METHODS: ReadonlyMap<string, string> = new Map([
  ['map', 'f'],
  ['forEach', 'f'],
  ['some', 'p'],
  ['every', 'p'],
  ['reduce', 'f'],
]);

/** Whether `name` is one of the five methods an array has (surface §63). */
export const isArrayMethod = (name: string): boolean => METHODS.has(name);

/** The sentence for a method of `Array.prototype` an array does not have here. */
export const otherArrayMethod = (name: string): string =>
  `".${name}" is not one of an array's methods here, which are map, forEach, some, every and ` +
  `reduce. An array's length is fixed, so a search, a copy or a change of length is a loop: ` +
  `"for (const x of xs) { … }".`;

function push(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: TsCode,
): undefined {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code));
  return undefined;
}

/** A type as an author writes it: `array<f32, 4>`, where the IR's key is `array<f32,4>`. */
function typeText(t: ShaderType): string {
  return t.kind === 'array'
    ? `array<${typeText(t.elem)}${t.size === undefined ? '' : `, ${String(t.size)}`}>`
    : typeKey(t);
}

/** `e` without the parentheses around it. */
function bare(e: ts.Expression): ts.Expression {
  let x = e;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  return x;
}

/** The variable a field or element path starts from in the source, as a capture names it:
 *  `this` in a method, or the declaration of a local or a parameter. */
function rootKey(e: ts.Expression, scope: LoweringScope): CaptureKey | undefined {
  let x = bare(e);
  while (ts.isPropertyAccessExpression(x) || ts.isElementAccessExpression(x)) {
    x = bare(x.expression);
  }
  if (x.kind === ts.SyntaxKind.ThisKeyword) {
    return scope.resolve('this') !== undefined ? THIS_CAPTURE : undefined;
  }
  return ts.isIdentifier(x) ? declarationOf(x) : undefined;
}

/** The name, a field or element path to one, that `e` reads: its root, or undefined when `e`
 *  is any other expression. */
function pathRoot(e: Expr): Expr | undefined {
  switch (e.op) {
    case 'varref':
    case 'param':
    case 'constref':
      return e;
    case 'member':
    case 'index':
      return pathRoot(e.base);
    default:
      return undefined;
  }
}

/** `e`, a path, with its root replaced by `root` and each index that is not a literal by a
 *  parameter, recorded in `hoisted` in the order TypeScript reads them. */
function rebase(
  e: Expr,
  root: Expr,
  fresh: (base: string) => string,
  hoisted: { name: string; type: ShaderType; arg: Expr }[],
): Expr {
  switch (e.op) {
    case 'member':
      return { ...e, base: rebase(e.base, root, fresh, hoisted) };
    case 'index': {
      const base = rebase(e.base, root, fresh, hoisted);
      if (e.idx.op === 'lit') return { ...e, base };
      const name = fresh('at');
      hoisted.push({ name, type: e.idx.type, arg: e.idx });
      return { ...e, base, idx: { op: 'param', type: e.idx.type, name } };
    }
    default:
      return root;
  }
}

/**
 * `xs.map(f)`, `xs.forEach(f)`, `xs.some(p)`, `xs.every(p)` and `xs.reduce(f, init)` on an
 * array (Rule 8.18, surface §63): a call of the function of the module made for the array's
 * type and the function handed over. `recv` is the receiver, lowered once by the caller.
 * Undefined, having said why, for a call this cannot make.
 */
export function lowerArrayMethod(
  node: ts.CallExpression,
  callee: ts.PropertyAccessExpression,
  recv: Expr,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const method = callee.name.text as Method;
  const hint = METHODS.get(method)!;
  const written = callee.expression.getText(sourceFile);
  const recvText = written.length > 40 ? 'the array' : written;
  const shown = `${written.length > 40 ? 'xs' : written}.${method}`;
  if (recv.type.kind !== 'array') {
    return push(
      diagnostics,
      sourceFile,
      callee.name,
      `"${recvText}" is a ${typeText(recv.type)}, and ".${method}" is a method of an array.`,
      TS_CODES.TYPE_MISMATCH,
    );
  }
  const arrayType = recv.type;
  const elem = arrayType.elem;
  const size = arrayType.size;
  const args = node.arguments;
  if (args.length === 0) {
    return push(
      diagnostics,
      sourceFile,
      node,
      `"${shown}" takes a function: hand one over by its name, or write it here as an arrow ` +
        `function.`,
      TS_CODES.ARITY_MISMATCH,
    );
  }
  if (method !== 'reduce' && args.length > 1) {
    return push(
      diagnostics,
      sourceFile,
      args[1]!,
      `"${shown}" takes one argument here, the function. A second one, "thisArg", says what ` +
        `"this" is inside a function written with "function", and an arrow function reads the ` +
        `"this" around it already.`,
      TS_CODES.ARITY_MISMATCH,
    );
  }
  if (method === 'reduce' && args.length > 2) {
    return push(
      diagnostics,
      sourceFile,
      args[2]!,
      `"${shown}" takes a function and the value to start from, and this call passes ` +
        `${String(args.length)} arguments.`,
      TS_CODES.ARITY_MISMATCH,
    );
  }
  if (method === 'map' && size === undefined) {
    return push(
      diagnostics,
      sourceFile,
      node,
      `"${shown}" would build an array as long as "${recvText}", which has no size before the ` +
        `host binds it, and an array with none exists only in storage. Run "${recvText}.forEach(…)" ` +
        `instead and store each value into a storage binding.`,
      TS_CODES.UNSUPPORTED,
    );
  }
  const init = method === 'reduce' ? args[1] : undefined;
  // An `array<T, N>` has one element or more (type-map.ts refuses `N` of 0), so only an array
  // with no size may be empty.
  if (method === 'reduce' && init === undefined && size === undefined) {
    return push(
      diagnostics,
      sourceFile,
      node,
      `"${shown}" with no value to start from starts from the first element, and "${recvText}" ` +
        `may have none: TypeScript throws a TypeError there, and a shader cannot throw. Hand it ` +
        `the value to start from, "${recvText}.reduce(f, 0.)".`,
      TS_CODES.ARITY_MISMATCH,
    );
  }
  if (scope.owner() === undefined) {
    return push(
      diagnostics,
      sourceFile,
      node,
      `"${shown}" runs a function for each element, which a function's body does: call it ` +
        `inside the function that needs its value.`,
      TS_CODES.UNSUPPORTED,
    );
  }

  // ── What the function is handed: the value, its index and the array, and for `reduce` the
  //    running value first. `index` is an i32, the type an unannotated counter has (Rule 7.5).
  const fixed = size !== undefined;
  const full: ShaderType[] = [elem, i32T, ...(fixed ? [arrayType] : [])];
  const names = ['value', 'index', 'array'];
  let acc: ShaderType | undefined;
  let initExpr: Expr | undefined;
  const fnNode = bare(args[0]!);
  const arrow = ts.isArrowFunction(fnNode) || ts.isFunctionExpression(fnNode) ? fnNode : undefined;
  if (method === 'reduce') {
    // The running value's type: what the function's first parameter says where it says it, then
    // what the value to start from is, then the element's.
    const firstParam = arrow?.parameters[0];
    if (firstParam?.type !== undefined) {
      acc = mapTsTypeToShaderType(firstParam.type, sourceFile, diagnostics);
      if (acc === undefined) return undefined;
    } else if (arrow === undefined && ts.isIdentifier(fnNode)) {
      const named = scope.resolveCallee(fnNode.text);
      const captured = named === undefined ? 0 : scope.capturesOf(named.name).length;
      acc = named?.params[captured]?.type;
    }
    if (init !== undefined) {
      const lowered = lowerExpression(init, sourceFile, scope, diagnostics, acc);
      if (lowered === undefined) return undefined;
      initExpr = acc === undefined ? lowered : retargetDeclaredIntLit(lowered, init, acc);
      if (acc === undefined) acc = initExpr.type;
      if (typeKey(initExpr.type) !== typeKey(acc)) {
        return push(
          diagnostics,
          sourceFile,
          init,
          `"${shown}" starts from "${init.getText(sourceFile)}", a ${typeText(initExpr.type)}, ` +
            `and its function takes a ${typeText(acc)} for the running value.`,
          TS_CODES.TYPE_MISMATCH,
        );
      }
    }
    acc ??= elem;
    full.unshift(acc);
    names.unshift('acc');
  }
  const ret: ShaderType | undefined =
    method === 'some' || method === 'every'
      ? boolT
      : method === 'forEach'
        ? voidT
        : method === 'reduce'
          ? acc
          : undefined;
  const text = (n: number): string =>
    `(${full
      .slice(0, n)
      .map((t, i) => `${names[i]!}: ${typeText(t)}`)
      .join(', ')}) => ${ret === undefined ? '…' : typeText(ret)}`;
  const shapeOf = (n: number): FunctionShape => ({
    params: full.slice(0, n),
    ret,
    text: text(n),
  });

  // ── The function handed over.
  let f: FuncDecl | undefined;
  if (arrow !== undefined) {
    const n = arrow.parameters.length;
    if (!fixed && n > full.length) {
      return push(
        diagnostics,
        sourceFile,
        arrow.parameters[full.length]!,
        `"${recvText}" has no size before the host binds it, and a function cannot take an ` +
          `array with none: read "${recvText}" by its name inside the function instead.`,
        TS_CODES.UNSUPPORTED,
      );
    }
    // As many of the arguments as it takes: one it leaves off is one the loop does not pass.
    f = scope.liftArgument(arrow, shapeOf(Math.min(n, full.length)), hint, sourceFile, diagnostics);
    // One whose body did not lower says nothing it returns, and said why already (Rule 12.4).
    if (f === undefined || !scope.calleeReady(f, arrow, sourceFile, diagnostics)) return undefined;
  } else if (ts.isIdentifier(fnNode)) {
    f = namedFunction(
      fnNode,
      full.length,
      shapeOf,
      shown,
      hint,
      fixed,
      recvText,
      sourceFile,
      scope,
      diagnostics,
    );
    if (f === undefined) return undefined;
  } else {
    return push(
      diagnostics,
      sourceFile,
      args[0]!,
      `"${hint}" of "${shown}" takes a function, which a call hands over by its name or as an ` +
        `arrow function written there; "${args[0]!.getText(sourceFile)}" would choose one at run ` +
        `time, and a shader has no function value to choose with.`,
      TS_CODES.UNSUPPORTED,
    );
  }
  const keys = scope.capturesOf(f.name);
  const own = f.params.length - keys.length;
  if (method === 'map' && f.ret.kind === 'void') {
    return push(
      diagnostics,
      sourceFile,
      args[0]!,
      `The function "${shown}" is handed returns nothing, so there is no element to build: ` +
        `return one from it, or call "${recvText}.forEach(…)" to run it for each element.`,
      TS_CODES.TYPE_MISMATCH,
    );
  }

  // ── How the loop reads the array.
  const root = pathRoot(recv);
  // A `const` that copies a binding by its bare name (`const a = data`) is the binding, in
  // TypeScript and in what the front end reads through it (#46): the loop reads the binding.
  let rootBinding =
    root !== undefined && root.op === 'varref' ? scope.resolveIr(root.name) : undefined;
  let globalRoot = root;
  for (let hops = 0; rootBinding?.kind === 'local' && !rootBinding.mutable && hops < 8; hops++) {
    const to = rootBinding.aliasOf;
    if (to === undefined) break;
    rootBinding = scope.resolveIr(to);
    globalRoot = { op: 'varref', type: root!.type, name: to };
  }
  const isGlobal = (b: typeof rootBinding): boolean =>
    b?.kind === 'binding' || b?.kind === 'modvar' || b?.kind === 'module';
  const global = root !== undefined && (root.op === 'constref' || isGlobal(rootBinding));
  const key = root !== undefined && !global ? rootKey(callee.expression, scope) : undefined;
  const sharedAt = key === undefined ? -1 : keys.indexOf(key);
  if (!fixed && !global) {
    // A runtime-sized array is a binding's, or a local that copies one, and is read in place.
    return push(
      diagnostics,
      sourceFile,
      callee.expression,
      `"${recvText}" has no size before the host binds it, so the loop reads it where it is ` +
        `bound: call "${method}" on the binding by its own name.`,
      TS_CODES.UNSUPPORTED,
    );
  }

  const capParams = f.params.slice(0, keys.length).map((p) => ({ ...p }));
  const taken = new Set(capParams.map((p) => p.name));
  const fresh = (base: string): string => {
    let name = base;
    for (let n = 1; taken.has(name); n++) name = `${base}_${String(n)}`;
    taken.add(name);
    return name;
  };
  const hoisted: { name: string; type: ShaderType; arg: Expr }[] = [];
  let byValue: { name: string; arg: Expr } | undefined;
  let arrayIn: Expr;
  let reading: string;
  if (global) {
    arrayIn = rebase(recv, globalRoot!, fresh, hoisted);
    reading = `global:${pathKey(arrayIn)}`;
  } else if (sharedAt >= 0) {
    const through = capParams[sharedAt]!;
    arrayIn = rebase(recv, { op: 'param', type: through.type, name: through.name }, fresh, hoisted);
    reading = `shared:${String(sharedAt)}:${pathKey(arrayIn)}`;
  } else {
    const x = bare(callee.expression);
    const name = fresh(ts.isIdentifier(x) ? x.text : 'xs');
    byValue = { name, arg: recv };
    arrayIn = { op: 'param', type: arrayType, name };
    reading = 'value';
  }
  const initName = initExpr === undefined ? undefined : fresh('init');
  const counter = fresh('i');
  const outName = method === 'map' ? fresh('out') : undefined;
  const accName = method === 'reduce' ? fresh('acc') : undefined;

  const built = scope.buildFunction(
    [
      'array',
      method,
      typeKey(arrayType),
      f.name,
      reading,
      acc === undefined ? '-' : typeKey(acc),
      initExpr === undefined ? 'first' : 'init',
    ].join('|'),
    `array_${method}_${f.name}`,
    shown,
    keys,
    (name) =>
      loopFunction(name, method, f!, own, capParams, arrayIn, arrayType, {
        byValue: byValue?.name,
        hoisted,
        initName,
        acc,
        counter,
        outName,
        accName,
      }),
  );
  if (built === undefined) return undefined;
  const leading = captureArguments(built, shown, node, sourceFile, scope, diagnostics);
  if (leading === undefined) return undefined;
  return {
    op: 'call',
    type: built.ret,
    fn: built.name,
    args: [
      ...leading,
      ...(byValue === undefined ? [] : [byValue.arg]),
      ...hoisted.map((h) => h.arg),
      ...(initExpr === undefined ? [] : [initExpr]),
    ],
    declRef: built,
    span: spanOf(sourceFile, node),
  };
}

/** What a path reads, for the key of the function made for it: `data`, `cells[?].xs`. */
function pathKey(e: Expr): string {
  switch (e.op) {
    case 'varref':
    case 'param':
    case 'constref':
      return e.name;
    case 'member':
      return `${pathKey(e.base)}.${e.field}`;
    case 'index':
      return `${pathKey(e.base)}[${e.idx.op === 'lit' ? String(e.idx.value) : '?'}]`;
    default:
      return '?';
  }
}

/** A function the file declares, handed over by its name: it takes the first of the arguments
 *  the loop passes, as many as it declares, of their types. TypeScript lets a function take
 *  fewer than a method passes, and the loop passes it only those. */
function namedFunction(
  x: ts.Identifier,
  most: number,
  shapeOf: (n: number) => FunctionShape,
  shown: string,
  hint: string,
  fixed: boolean,
  recvText: string,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): FuncDecl | undefined {
  const decl = scope.resolveCallee(x.text);
  if (decl === undefined) {
    // A declaration that was refused already said why.
    if (scope.declarationRefused(x.text)) return undefined;
    // A name nothing declares is an unknown name like any other, so its remedy comes first
    // (Rule 12.1): TypeShade's spelling of a GLSL or HLSL name, or the function it is spelled
    // like. With neither, the sentence says how to hand one over.
    const remedy = unknownNameRemedy(x.text, namesInScope(x, 'callee'));
    const message = scope.isGenericFunction(x.text)
      ? `"${x.text}" is generic, and which of its instances to hand to "${shown}" is written ` +
        `nowhere; write an arrow function that calls it here: "(…) => ${x.text}(…)".`
      : scope.resolve(x.text) !== undefined
        ? `"${x.text}" is a value, and "${shown}" takes a function: hand one over by its name, ` +
          `or write it here as an arrow function.`
        : remedy !== undefined
          ? `"${x.text}" is no function this file declares, and "${shown}" takes one. ${remedy}`
          : `"${x.text}" is no function this file declares, and "${shown}" takes one: hand over ` +
            `one the file declares, or write an arrow function that calls it here, ` +
            `"(…) => ${x.text}(…)".`;
    return push(diagnostics, sourceFile, x, message, TS_CODES.TYPE_MISMATCH);
  }
  if (decl.stage !== undefined) {
    return push(
      diagnostics,
      sourceFile,
      x,
      `"${x.text}" is a ${decl.stage} entry point, which the pipeline invokes and no call may; ` +
        `move its body into a function both can call.`,
      TS_CODES.UNSUPPORTED,
    );
  }
  // What it captures is read where the call runs it (Rule 8.17), and what it returns, when it
  // writes no return type, is its body's to say (Rule 8.19).
  if (captureArguments(decl, x.text, x, sourceFile, scope, diagnostics) === undefined) {
    return undefined;
  }
  if (!scope.calleeReady(decl, x, sourceFile, diagnostics)) return undefined;
  const own = decl.params.slice(scope.capturesOf(decl.name).length).map((p) => p.type);
  if (own.length > most) {
    return push(
      diagnostics,
      sourceFile,
      x,
      !fixed && own.length === most + 1
        ? `"${x.text}" takes the array as well, and "${recvText}" has no size before the host ` +
            `binds it: a function cannot take an array with none. Read "${recvText}" by its ` +
            `name inside it instead.`
        : `"${x.text}" takes ${String(own.length)} argument(s), and "${shown}" passes at most ` +
            `${String(most)}.`,
      TS_CODES.TYPE_MISMATCH,
    );
  }
  const why = misfit(own, decl.ret, shapeOf(own.length));
  if (why !== undefined) {
    return push(
      diagnostics,
      sourceFile,
      x,
      `"${x.text}" ${why}, so it cannot be "${hint}" of "${shown}".`,
      TS_CODES.TYPE_MISMATCH,
    );
  }
  return decl;
}

/** The loop a method's call runs: the function of the module made for it. */
function loopFunction(
  name: string,
  method: Method,
  f: FuncDecl,
  own: number,
  capParams: FuncDecl['params'][number][],
  arrayIn: Expr,
  arrayType: ShaderType & { kind: 'array' },
  o: {
    readonly byValue: string | undefined;
    readonly hoisted: readonly { name: string; type: ShaderType }[];
    readonly initName: string | undefined;
    readonly acc: ShaderType | undefined;
    readonly counter: string;
    readonly outName: string | undefined;
    readonly accName: string | undefined;
  },
): FuncDecl {
  const elem = arrayType.elem;
  const lit = (type: ShaderType, value: number | boolean): Expr => ({ op: 'lit', type, value });
  const i: Expr = { op: 'varref', type: i32T, name: o.counter };
  const bound: Expr =
    arrayType.size !== undefined
      ? lit(i32T, arrayType.size)
      : (lowerScalarCast('i32', {
          op: 'call',
          type: u32T,
          fn: 'arrayLength',
          args: [arrayIn],
        }) as Expr);
  const at = (idx: Expr): Expr => ({ op: 'index', type: elem, base: arrayIn, idx });
  const caps: Expr[] = capParams.map((p) => ({ op: 'param', type: p.type, name: p.name }));
  const call = (passed: readonly Expr[]): Expr => ({
    op: 'call',
    type: f.ret,
    fn: f.name,
    args: [...caps, ...passed.slice(0, own)],
    declRef: f,
  });
  const loop = (from: number, body: Stmt[]): Stmt => ({
    s: 'for',
    init: { s: 'var', name: o.counter, type: i32T, init: lit(i32T, from) },
    cond: { op: 'compare', type: boolT, cop: '<', a: i, b: bound },
    update: {
      s: 'assign',
      target: i,
      expr: { op: 'binop', type: i32T, bop: '+', a: i, b: lit(i32T, 1) },
    },
    body,
  });
  const passed = [at(i), i, ...(arrayType.size !== undefined ? [arrayIn] : [])];
  let ret: ShaderType;
  let body: Stmt[];
  switch (method) {
    case 'map': {
      const outType: ShaderType = { kind: 'array', elem: f.ret, size: arrayType.size };
      const out: Expr = { op: 'varref', type: outType, name: o.outName! };
      ret = outType;
      body = [
        { s: 'var', name: o.outName!, type: outType },
        loop(0, [
          {
            s: 'assign',
            target: { op: 'index', type: f.ret, base: out, idx: i },
            expr: call(passed),
          },
        ]),
        { s: 'return', expr: out },
      ];
      break;
    }
    case 'forEach':
      ret = voidT;
      body = [loop(0, [{ s: 'call', expr: call(passed) }])];
      break;
    case 'some':
    case 'every': {
      // `some` stops at the first element that passes, `every` at the first that fails.
      const stopsOn = method === 'some';
      const test = call(passed);
      ret = boolT;
      body = [
        loop(0, [
          {
            s: 'if',
            arms: [
              {
                cond: stopsOn
                  ? test
                  : { op: 'compare', type: boolT, cop: '==', a: test, b: lit(boolT, false) },
                body: [{ s: 'return', expr: lit(boolT, stopsOn) }],
              },
            ],
          },
        ]),
        { s: 'return', expr: lit(boolT, !stopsOn) },
      ];
      break;
    }
    case 'reduce': {
      const acc: Expr = { op: 'varref', type: o.acc!, name: o.accName! };
      const start: Expr =
        o.initName === undefined
          ? at(lit(i32T, 0))
          : { op: 'param', type: o.acc!, name: o.initName };
      ret = o.acc!;
      body = [
        { s: 'var', name: o.accName!, type: o.acc!, init: start },
        loop(o.initName === undefined ? 1 : 0, [
          { s: 'assign', target: acc, expr: call([acc, ...passed]) },
        ]),
        { s: 'return', expr: acc },
      ];
      break;
    }
  }
  return {
    name,
    params: [
      ...capParams,
      ...(o.byValue === undefined ? [] : [{ name: o.byValue, type: arrayType as ShaderType }]),
      ...o.hoisted.map((h) => ({ name: h.name, type: h.type })),
      ...(o.initName === undefined ? [] : [{ name: o.initName, type: o.acc! }]),
    ],
    ret,
    body,
  };
}
