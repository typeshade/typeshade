// ═══ The late rename: one target's emitted names, applied to the lowered module ═══
// Implements: Rule 3.2, Rule 3.3, Rule 9.5 (docs/language-design.md; traced in reqs/).
//
// Proposal 0070, section 4. `spellModule` rewrites every name a plan renames, and every reference to
// it, in a lowered module whose names are still the authored ones. It runs first in the writer's
// assembly (WGSL) or right after `lowerForBackend` (GLSL), so no optimizer or lowering pass reads a
// spelling it must not see. A plan with no rename returns the module itself. The authored module is
// never changed: every node on a path to a rename is rebuilt.
//
// Helper functions are renamed here as well as by the early pass (`renameFunctions`): a helper's
// spelling is never a key of the plan after the early pass, so the second rename does nothing.

import type { Expr, FuncDecl, ModuleDecl, ShaderType, Stmt } from '../ir/index.js';
import { stageOf } from '../ir/index.js';
import { mapChildren, mapStmtExpr } from '../ir/visit.js';
import { UnsupportedFeatureError } from '../backend.js';
import { collectLocals, bodyHasRaw } from './opt/expr-utils.js';
import type { SpellTarget, TargetSpellings } from '../spelling-plan.js';
import { spellsNothing } from '../spelling-plan.js';

/** Where a name is read: the function's locals and parameters, and whether it is an entry. */
interface Scope {
  readonly locals: ReadonlySet<string>;
  readonly params: ReadonlySet<string>;
  readonly entry: boolean;
}

const NO_SCOPE: Scope = { locals: new Set(), params: new Set(), entry: false };

/** The lowered module `m` with every renamed declaration and reference spelled as `t` says.
 *  Identity when `t` renames nothing, or when `m` holds no name `t` renames. */
export function spellModule(m: ModuleDecl, t: TargetSpellings, target: SpellTarget): ModuleDecl {
  if (spellsNothing(t)) return m;
  for (const f of m.funcs) {
    if (!bodyHasRaw(f.body)) continue;
    const [kind, name, emitted] = firstRename(t);
    throw new UnsupportedFeatureError(
      `${target}: a raw statement is present and ${kind} '${name}' needs the spelling '${emitted}'; raw text cannot be rewritten`,
    );
  }

  const hostStructs = t.hostStructs;
  const renameType = (ty: ShaderType): ShaderType => {
    if (ty.kind === 'struct') {
      const to = t.structs.get(ty.name);
      return to === undefined ? ty : { ...ty, name: to };
    }
    if (ty.kind === 'array') {
      const elem = renameType(ty.elem);
      const size = ty.sizeOverride === undefined ? undefined : t.overrides.get(ty.sizeOverride);
      if (elem === ty.elem && size === undefined) return ty;
      return {
        ...ty,
        elem,
        ...(size === undefined ? {} : { sizeOverride: size }),
      };
    }
    return ty;
  };

  // A variable read, in a scope: a local is left alone; a parameter of an entry follows the
  // member table; a helper's parameter is left alone; anything else is a binding or a module var.
  const varName = (name: string, sc: Scope): string | undefined => {
    if (sc.locals.has(name)) return undefined;
    if (sc.params.has(name)) return sc.entry ? t.members.get(name) : undefined;
    return t.bindings.get(name) ?? t.vars.get(name);
  };

  const spellExpr = (e: Expr, sc: Scope, memo: Map<Expr, Expr>): Expr => {
    const seen = memo.get(e);
    if (seen !== undefined) return seen;
    const kids = mapChildren(e, (c) => spellExpr(c, sc, memo));
    let out: Expr = kids;
    switch (e.op) {
      case 'constref':
        out = withName(kids, t.consts.get(e.name));
        break;
      case 'overrideref':
        out = withName(kids, t.overrides.get(e.name));
        break;
      case 'varref':
        out = withName(kids, varName(e.name, sc));
        break;
      case 'param':
        out = sc.entry ? withName(kids, t.members.get(e.name)) : kids;
        break;
      case 'call':
        if (e.declRef !== undefined) {
          const to = t.funcs.get(e.fn) ?? t.entries.get(e.fn);
          out = to === undefined || kids.op !== 'call' ? kids : { ...kids, fn: to };
        }
        break;
      case 'member':
        if (e.base.type.kind === 'struct' && !hostStructs.has(e.base.type.name)) {
          const to = t.members.get(e.field);
          out = to === undefined || kids.op !== 'member' ? kids : { ...kids, field: to };
        }
        break;
      default:
        break;
    }
    const type = renameType(e.type);
    if (type !== e.type) out = { ...out, type } as Expr;
    memo.set(e, out);
    return out;
  };

  const spellStmt = (s: Stmt, sc: Scope, memo: Map<Expr, Expr>): Stmt => {
    const rebuilt = mapStmtExpr(
      s,
      (e) => spellExpr(e, sc, memo),
      (inner) => spellStmt(inner, sc, memo),
    );
    if (rebuilt.s !== 'var') return rebuilt;
    const type = renameType(rebuilt.type);
    return type === rebuilt.type ? rebuilt : { ...rebuilt, type };
  };

  const spellFunc = (f: FuncDecl): FuncDecl => {
    const entry = stageOf(f) !== undefined;
    const locals = new Set<string>();
    collectLocals(f.body, locals);
    const sc: Scope = { locals, params: new Set(f.params.map((p) => p.name)), entry };
    const memo = new Map<Expr, Expr>();
    const name = (entry ? t.entries.get(f.name) : t.funcs.get(f.name)) ?? f.name;
    const params = f.params.map((p) => {
      const pname = entry ? (t.members.get(p.name) ?? p.name) : p.name;
      const ptype = renameType(p.type);
      return pname === p.name && ptype === p.type ? p : { ...p, name: pname, type: ptype };
    });
    const body = f.body.map((s) => spellStmt(s, sc, memo));
    const ret = renameType(f.ret);
    const attrs = f.attrs?.map(workgroupAttr);
    const unchanged =
      name === f.name &&
      ret === f.ret &&
      params.every((p, k) => p === f.params[k]) &&
      body.every((s, k) => s === f.body[k]) &&
      (attrs === undefined || attrs.every((a, k) => a === f.attrs![k]));
    if (unchanged) return f;
    return {
      ...f,
      name,
      params,
      ret,
      body,
      ...(attrs === undefined ? {} : { attrs }),
    };
  };

  // `@workgroup_size(TILE, WG_Y)` names constants and overrides in its text. The text is spelled
  // here; the host keeps the authored names in `workgroupSizeOverrides`, which is not rewritten.
  const workgroupAttr = (attr: string): string => {
    const open = '@workgroup_size(';
    if (!attr.startsWith(open) || !attr.endsWith(')')) return attr;
    let changed = false;
    const parts = attr
      .slice(open.length, -1)
      .split(',')
      .map((part) => {
        const id = part.trim();
        const to = t.consts.get(id) ?? t.overrides.get(id);
        if (to === undefined || to === id) return part;
        changed = true;
        return part.replace(id, to);
      });
    return changed ? `${open}${parts.join(',')})` : attr;
  };

  const spellConst = (c: ModuleDecl['consts'][number]): ModuleDecl['consts'][number] => {
    const name = t.consts.get(c.name) ?? c.name;
    const type = renameType(c.type);
    const valueExpr =
      c.valueExpr === undefined ? undefined : spellExpr(c.valueExpr, NO_SCOPE, new Map());
    if (name === c.name && type === c.type && valueExpr === c.valueExpr) return c;
    return {
      ...c,
      name,
      type,
      ...(valueExpr === undefined ? {} : { valueExpr }),
    };
  };

  const spellStruct = (s: ModuleDecl['structs'][number]) => {
    const host = hostStructs.has(s.name);
    const name = host ? s.name : (t.structs.get(s.name) ?? s.name);
    const fields = s.fields.map((f) => {
      const fname = host ? f.name : (t.members.get(f.name) ?? f.name);
      const ftype = renameType(f.type);
      return fname === f.name && ftype === f.type ? f : { ...f, name: fname, type: ftype };
    });
    if (name === s.name && fields.every((f, k) => f === s.fields[k])) return s;
    return { ...s, name, fields };
  };

  const funcs = m.funcs.map(spellFunc);
  const consts = m.consts.map(spellConst);
  const structs = m.structs.map(spellStruct);
  const vars = m.vars?.map((v) => {
    const name = t.vars.get(v.name) ?? v.name;
    const type = renameType(v.type);
    const init = v.init === undefined ? undefined : spellExpr(v.init, NO_SCOPE, new Map());
    if (name === v.name && type === v.type && init === v.init) return v;
    return { ...v, name, type, ...(init === undefined ? {} : { init }) };
  });
  const bindings = m.bindings.map((b) => {
    const name = b.owner === 'host' ? b.name : (t.bindings.get(b.name) ?? b.name);
    const type = renameType(b.type);
    return name === b.name && type === b.type ? b : { ...b, name, type };
  });
  const overrides = m.overrides?.map((o) => {
    const name = t.overrides.get(o.name) ?? o.name;
    const type = renameType(o.type);
    return name === o.name && type === o.type ? o : { ...o, name, type };
  });
  const externs = m.externs?.map((x) => {
    const type = renameType(x.type);
    return type === x.type ? x : { ...x, type };
  });

  const same = <T>(a: readonly T[], b: readonly T[]): boolean =>
    a.length === b.length && a.every((x, k) => x === b[k]);
  const out: ModuleDecl = {
    ...m,
    funcs,
    consts,
    structs,
    bindings,
    ...(vars === undefined ? {} : { vars }),
    ...(overrides === undefined ? {} : { overrides }),
    ...(externs === undefined ? {} : { externs }),
  };
  const changed =
    !same(funcs, m.funcs) ||
    !same(consts, m.consts) ||
    !same(structs, m.structs) ||
    !same(bindings, m.bindings) ||
    (vars !== undefined && !same(vars, m.vars ?? [])) ||
    (overrides !== undefined && !same(overrides, m.overrides ?? [])) ||
    (externs !== undefined && !same(externs, m.externs ?? []));
  if (!changed) return m;
  assertDistinct(out, t, target);
  return out;
}

/** `e` with `name` set to `to`, unless `to` is undefined or is already `name`. */
function withName(e: Expr, to: string | undefined): Expr {
  if (to === undefined || !('name' in e) || e.name === to) return e;
  return { ...e, name: to } as Expr;
}

/** The first rename of `t`, in the order the plan lists its kinds, for a diagnostic. */
function firstRename(t: TargetSpellings): [string, string, string] {
  const kinds: [string, ReadonlyMap<string, string>][] = [
    ['helper function', t.funcs],
    ['entry point', t.entries],
    ['constant', t.consts],
    ['module variable', t.vars],
    ['binding', t.bindings],
    ['override', t.overrides],
    ['struct', t.structs],
    ['field', t.members],
  ];
  for (const [kind, map] of kinds) {
    const first = map.entries().next();
    if (!first.done) return [kind, first.value[0], first.value[1]];
  }
  return ['name', '', ''];
}

/** A lowered module must not declare two things under one name, and no local may take the
 *  spelling of a renamed name: a pass that mints a name the plan did not see would collide with it.
 *  Loud, never silent (Proposal 0070, section 2.4). */
function assertDistinct(m: ModuleDecl, t: TargetSpellings, target: SpellTarget): void {
  const emitted = new Map<string, string>();
  for (const map of [
    t.funcs,
    t.entries,
    t.consts,
    t.vars,
    t.bindings,
    t.overrides,
    t.structs,
    t.members,
  ])
    for (const [authored, spelled] of map) emitted.set(spelled, authored);

  // A local never carries a plan spelling: the plan avoids every authored local. A helper's
  // parameter is never spelled either. An entry's parameter may carry one: it is the member spelling.
  for (const f of m.funcs) {
    const locals = new Set<string>();
    collectLocals(f.body, locals);
    const params = stageOf(f) === undefined ? f.params.map((p) => p.name) : [];
    for (const n of [...locals, ...params]) {
      const authored = emitted.get(n);
      if (authored === undefined) continue;
      throw new UnsupportedFeatureError(
        `${target}: spelling '${authored}' as '${n}' collides with a generated name in '${f.name}'; rename the author's name`,
      );
    }
  }

  const scope = [
    ...m.funcs.map((f) => f.name),
    ...m.consts.map((c) => c.name),
    ...m.bindings.map((b) => b.name),
    ...(m.overrides ?? []).map((o) => o.name),
    ...(m.vars ?? []).map((v) => v.name),
    ...m.structs.map((s) => s.name),
    ...(m.externs ?? []).map((x) => x.name),
  ];
  const seen = new Set<string>();
  for (const name of scope) {
    if (!seen.has(name)) {
      seen.add(name);
      continue;
    }
    const authored = emitted.get(name);
    throw new UnsupportedFeatureError(
      authored === undefined
        ? `${target}: '${name}' is declared twice in the lowered module`
        : `${target}: spelling '${authored}' as '${name}' collides with a declaration of the same name`,
    );
  }
}
