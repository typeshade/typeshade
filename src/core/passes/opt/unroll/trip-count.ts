import type { CmpOp, Expr, ModuleDecl, ShaderType, Stmt } from '../../../ir/index.js';

export type ForStmt = Extract<Stmt, { s: 'for' }>;

export const MAX_TRIP = 8;
const MAX_SIMULATED_STEPS = 1024;

export type IntConsts = ReadonlyMap<string, number>;
export const NO_CONSTS: IntConsts = new Map();

function knownNumber(e: Expr, consts: IntConsts = NO_CONSTS): number | undefined {
  if (e.op === 'lit' && typeof e.value === 'number') return e.value;
  if (e.op === 'unop' && e.a.op === 'lit' && typeof e.a.value === 'number') return -e.a.value;
  if (e.op === 'constref') return consts.get(e.name);
  return undefined;
}

const isIntegerScalar = (t: ShaderType): t is ShaderType & { kind: 'scalar' } =>
  t.kind === 'scalar' && (t.scalar === 'i32' || t.scalar === 'u32');

export function intConsts(m: ModuleDecl): IntConsts {
  const out = new Map<string, number>();
  for (const c of m.consts) {
    if (!isIntegerScalar(c.type)) continue;
    const sameOnEveryBackend =
      c.valueExpr === undefined
        ? c.wgslValue === c.cpuValue
          ? c.wgslValue
          : undefined
        : c.valueExpr.op === 'lit' && typeof c.valueExpr.value === 'number'
          ? c.valueExpr.value
          : undefined;
    if (sameOnEveryBackend !== undefined && Number.isInteger(sameOnEveryBackend))
      out.set(c.name, sameOnEveryBackend);
  }
  return out;
}

const isCounter = (e: Expr, counter: string): boolean => e.op === 'varref' && e.name === counter;

function withOperandsSwapped(cop: CmpOp): CmpOp {
  switch (cop) {
    case '<':
      return '>';
    case '>':
      return '<';
    case '<=':
      return '>=';
    case '>=':
      return '<=';
    default:
      return cop;
  }
}

function holds(cop: CmpOp, v: number, bound: number): boolean {
  switch (cop) {
    case '<':
      return v < bound;
    case '>':
      return v > bound;
    case '<=':
      return v <= bound;
    case '>=':
      return v >= bound;
    case '==':
      return v === bound;
    case '!=':
      return v !== bound;
  }
}

function counterAgainstConstant(
  cond: Expr,
  counter: string,
  consts: IntConsts,
): { cop: CmpOp; bound: number } | undefined {
  if (cond.op !== 'compare') return undefined;
  if (isCounter(cond.a, counter)) {
    const bound = knownNumber(cond.b, consts);
    return bound === undefined ? undefined : { cop: cond.cop, bound };
  }
  if (isCounter(cond.b, counter)) {
    const bound = knownNumber(cond.a, consts);
    return bound === undefined ? undefined : { cop: withOperandsSwapped(cond.cop), bound };
  }
  return undefined;
}

function signedConstantStep(update: Stmt, counter: string): number | undefined {
  if (update.s === 'assignOp') {
    if (!isCounter(update.target, counter)) return undefined;
    const c = knownNumber(update.expr);
    if (c === undefined) return undefined;
    if (update.bop === '+') return c;
    if (update.bop === '-') return -c;
    return undefined;
  }
  if (update.s === 'assign') {
    if (!isCounter(update.target, counter)) return undefined;
    const e = update.expr;
    if (e.op !== 'binop') return undefined;
    if (e.bop === '+') {
      if (isCounter(e.a, counter)) return knownNumber(e.b);
      if (isCounter(e.b, counter)) return knownNumber(e.a);
      return undefined;
    }
    if (e.bop === '-' && isCounter(e.a, counter)) {
      const c = knownNumber(e.b);
      return c === undefined ? undefined : -c;
    }
    return undefined;
  }
  return undefined;
}

interface LoopInfo {
  name: string;
  type: ShaderType;
  seq: readonly number[];
}

export function analyzeLoop(
  s: ForStmt,
  maxTrip = MAX_TRIP,
  consts: IntConsts = NO_CONSTS,
): LoopInfo | undefined {
  if (s.init.s !== 'var' || s.init.init === undefined) return undefined;
  const type = s.init.type;
  // Why: an f32 counter can run one more or one fewer time on f32 hardware than on the f64
  // oracle, so only an integer counter has one trip count on every target.
  if (!isIntegerScalar(type)) return undefined;
  const name = s.init.name;
  const start = knownNumber(s.init.init, consts);
  if (start === undefined) return undefined;
  const cond = counterAgainstConstant(s.cond, name, consts);
  if (cond === undefined) return undefined;
  const step = signedConstantStep(s.update, name);
  if (step === undefined || step === 0) return undefined;

  const lowest = type.scalar === 'u32' ? 0 : -0x80000000;
  const highest = type.scalar === 'u32' ? 0xffffffff : 0x7fffffff;
  const seq: number[] = [];
  let v = start;
  for (let simulated = 0; simulated < MAX_SIMULATED_STEPS; simulated++) {
    const wrapsOnHardware = v < lowest || v > highest;
    if (wrapsOnHardware) return undefined;
    if (!holds(cond.cop, v, cond.bound)) return { name, type, seq };
    seq.push(v);
    if (seq.length > maxTrip) return undefined;
    v += step;
  }
  return undefined;
}
