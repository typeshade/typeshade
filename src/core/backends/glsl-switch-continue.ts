// ANGLE/D3D11 accepts a GLSL switch continue at link time, then fails its dynamic
// HLSL pixel executable with X3708 at draw time. Keep the original for headers:
// a loop-local flag skips the remainder of this iteration through ordinary if
// blocks. No new loop/switch changes the owner of an existing break.
import { boolT, type Expr, type FuncDecl, type ModuleDecl, type Stmt } from '../ir/index.js';
import { eachStmtExpr } from '../ir/visit.js';

interface Loop {
  flag?: string;
}
interface Body {
  body: readonly Stmt[];
  continues: boolean;
}

/** Legalize typed continues beneath switches, on the final GLSL IR only. @internal */
export function lowerSwitchContinues(m: ModuleDecl): ModuleDecl {
  // The final spelling/plugin stages have run. Include every identifier, even in
  // raw text and module declarations, before minting deterministic private locals.
  const taken = new Set<string>();
  const seen = new WeakSet<object>();
  const names = (value: unknown): void => {
    if (typeof value === 'string') {
      for (const word of value.matchAll(/[A-Za-z_][A-Za-z_0-9]*/g)) taken.add(word[0]);
    } else if (value !== null && typeof value === 'object' && !seen.has(value)) {
      seen.add(value);
      for (const child of Object.values(value)) names(child);
    }
  };
  names(m);
  let next = 0;
  const fresh = (): string => {
    let name: string;
    do name = `_switchContinue${next++}`;
    while (taken.has(name));
    taken.add(name);
    return name;
  };
  const literal = (value: boolean): Expr => ({ op: 'lit', type: boolT, value });
  const flag = (loop: Loop): Expr => ({ op: 'varref', type: boolT, name: loop.flag! });
  const lowerFn = (f: FuncDecl): FuncDecl => {
    let raw = false;
    const scan = (s: Stmt): void => {
      if (s.s === 'raw') raw = true;
      eachStmtExpr(s, () => {}, scan);
    };
    for (const s of f.body) scan(s);
    // Raw control flow is opaque; preserve the escape hatch rather than guessing.
    if (raw) return f;
    let changed = false;
    const body = (input: readonly Stmt[], loop: Loop | undefined, switches: number): Body => {
      const out: Stmt[] = [];
      for (let i = 0; i < input.length; i++) {
        const s = input[i]!;
        let rewritten = s;
        let continues = false;
        if (s.s === 'continue' && loop !== undefined && switches > 0) {
          loop.flag ??= fresh();
          rewritten = { ...s, s: 'assign', target: flag(loop), expr: literal(true) };
          continues = true;
          changed = true;
        } else if (s.s === 'for') {
          const inner: Loop = {};
          const lowered = body(s.body, inner, switches);
          rewritten = {
            ...s,
            body:
              inner.flag === undefined
                ? lowered.body
                : [
                    { s: 'var', name: inner.flag, type: boolT, init: literal(false) },
                    ...lowered.body,
                  ],
          };
          // An inner loop's flag belongs to that loop, never to this list's loop.
        } else if (s.s === 'if') {
          const arms = s.arms.map((arm) => {
            const lowered = body(arm.body, loop, switches);
            continues ||= lowered.continues;
            return { ...arm, body: lowered.body };
          });
          const otherwise = s.elseBody === undefined ? undefined : body(s.elseBody, loop, switches);
          continues ||= otherwise?.continues ?? false;
          rewritten = { ...s, arms, ...(otherwise ? { elseBody: otherwise.body } : {}) };
        } else if (s.s === 'switch') {
          const cases = s.cases.map((c) => {
            const lowered = body(c.body, loop, switches + 1);
            continues ||= lowered.continues;
            return { ...c, body: lowered.body };
          });
          const otherwise =
            s.defaultBody === undefined ? undefined : body(s.defaultBody, loop, switches + 1);
          continues ||= otherwise?.continues ?? false;
          rewritten = { ...s, cases, ...(otherwise ? { defaultBody: otherwise.body } : {}) };
        }
        out.push(rewritten);
        if (continues) {
          if (i + 1 < input.length) {
            // Move the WHOLE suffix, including declarations and all later uses,
            // together. Conditions/RHS expressions are never hoisted or copied.
            out.push({
              s: 'if',
              arms: [
                {
                  cond: {
                    op: 'compare',
                    cop: '==',
                    type: boolT,
                    a: flag(loop!),
                    b: literal(false),
                  },
                  body: body(input.slice(i + 1), loop, switches).body,
                },
              ],
            });
          }
          return { body: out, continues: true };
        }
      }
      return { body: out, continues: false };
    };
    const lowered = body(f.body, undefined, 0);
    return changed ? { ...f, body: lowered.body } : f;
  };
  const funcs = m.funcs.map(lowerFn);
  return funcs.every((f, i) => f === m.funcs[i]) ? m : { ...m, funcs };
}
