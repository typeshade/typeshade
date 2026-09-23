import type { Stmt, FuncDecl, ModuleDecl } from '../../../ir/index.js';
import type { LintRule } from '../engine.js';

// Every name a body BINDS: the params, and every `let` / `var` anywhere inside it, `for`
// inits included. The IR has no scope ids — a binding is its name, function-wide (the premise
// no-shadowed-local guards) — so one flat set is the whole scope model.
function eachBoundName(s: Stmt, onName: (name: string) => void): void {
  switch (s.s) {
    case 'let':
    case 'var':
      onName(s.name);
      break;
    case 'if':
      for (const arm of s.arms) for (const b of arm.body) eachBoundName(b, onName);
      if (s.elseBody) for (const b of s.elseBody) eachBoundName(b, onName);
      break;
    case 'for':
      eachBoundName(s.init, onName);
      eachBoundName(s.update, onName);
      for (const b of s.body) eachBoundName(b, onName);
      break;
    case 'switch':
      for (const c of s.cases) for (const b of c.body) eachBoundName(b, onName);
      if (s.defaultBody) for (const b of s.defaultBody) eachBoundName(b, onName);
      break;
    default:
      break;
  }
}

// A `raw` statement carries verbatim target text, which may declare anything under any name.
// A function holding one has no readable scope, so it is skipped whole rather than guessed at.
function hasRaw(body: readonly Stmt[]): boolean {
  return body.some((s) => {
    if (s.s === 'raw') return true;
    if (s.s === 'if') return s.arms.some((a) => hasRaw(a.body)) || hasRaw(s.elseBody ?? []);
    if (s.s === 'for') return hasRaw(s.body);
    if (s.s === 'switch') return s.cases.some((c) => hasRaw(c.body)) || hasRaw(s.defaultBody ?? []);
    return false;
  });
}

function moduleLevelNames(m: ModuleDecl): Set<string> {
  const names = new Set<string>();
  for (const b of m.bindings) names.add(b.name);
  for (const c of m.consts) names.add(c.name);
  for (const e of m.externs ?? []) names.add(e.name);
  for (const o of m.overrides ?? []) names.add(o.name);
  return names;
}

/** A variable a function reads that nothing declares — the missing `uses:` entry.
 *
 *  `module({ funcs: [fs] })` assembles only what it is handed. A `fs` that reads
 *  `U.field.time` reads the uniform through the handle's own access node, and if `U` is not in
 *  `uses:` the module carries no `var<uniform>` and no struct for it. Nothing downstream
 *  notices: `validate` passes, both writers emit, and the first word of it is the driver
 *  rejecting an undeclared identifier at pipeline creation — or, for a name the host happens
 *  to inject, a silently wrong read.
 *
 *  The rule resolves every `varref` in a body against the names something declares: the
 *  function's own params and `let`/`var` bindings, and the module's bindings, constants,
 *  externs and overrides. A `varref` left over is the missing declaration, and the message
 *  names the handle to add.
 *
 *  It is LINT-ONLY, deliberately — `passes/validate.ts`'s charter keeps name resolution out of
 *  the emit-time ruleset, because a composer injects consts and uniforms as raw target text
 *  referenced by plain name and no name rule can tell such an injection from a typo. This rule
 *  narrows toward the authored case as far as a name rule can (a `constref` is never reported,
 *  since that is the injection shape the charter names, and a function holding a `raw`
 *  statement is skipped whole), and stays where a false positive costs a reader one line of
 *  `diagnose()` output rather than a failed emit.
 */
export const usesDeclared: LintRule = {
  id: 'uses-declared',
  description:
    'a variable a function reads that no declaration in the module or the function binds — usually a handle missing from module({ uses })',
  severity: 'error',
  category: 'correctness',
  create: (ctx) => {
    let bound: Set<string> | undefined;
    const reported = new Set<string>();
    return {
      Func(f: FuncDecl) {
        if (hasRaw(f.body)) {
          bound = undefined;
          return;
        }
        const names = moduleLevelNames(ctx.module);
        for (const p of f.params) names.add(p.name);
        for (const s of f.body) eachBoundName(s, (n) => names.add(n));
        bound = names;
      },
      Expr(e, f) {
        if (bound === undefined || e.op !== 'varref' || bound.has(e.name)) return;
        const key = `${f.name}:${e.name}`;
        if (reported.has(key)) return;
        reported.add(key);
        ctx.report(
          `fn '${f.name}' reads '${e.name}', which nothing declares — add the handle that owns it to module({ uses: [...] }), or declare it in the body`,
          { fn: f.name, node: e, code: 'SD0114' },
        );
      },
    };
  },
};
