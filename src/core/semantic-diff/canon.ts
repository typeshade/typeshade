import { typeKey, type ShaderType } from '../ir/types.js';
import { stageOf, type ModuleDecl, type Stmt } from '../ir/nodes.js';

export interface Canon {
  readonly fns: ReadonlyMap<string, string>;
  readonly structs: ReadonlyMap<string, string>;
  readonly consts: ReadonlyMap<string, string>;
  readonly locals: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

export const EMPTY_CANON: Canon = {
  fns: new Map(),
  structs: new Map(),
  consts: new Map(),
  locals: new Map(),
};

function declaredNames(body: readonly Stmt[], acc: Set<string>): void {
  for (const s of body) {
    if (s.s === 'let' || s.s === 'var') acc.add(s.name);
    else if (s.s === 'if') {
      for (const a of s.arms) declaredNames(a.body, acc);
      if (s.elseBody) declaredNames(s.elseBody, acc);
    } else if (s.s === 'for') {
      declaredNames([s.init], acc);
      declaredNames(s.body, acc);
    } else if (s.s === 'switch') {
      for (const c of s.cases) declaredNames(c.body, acc);
      if (s.defaultBody) declaredNames(s.defaultBody, acc);
    }
  }
}

export function buildCanon(m: ModuleDecl): Canon {
  const bindingStructs = new Set<string>();
  for (const b of m.bindings) if (b.type.kind === 'struct') bindingStructs.add(b.type.name);

  const fns = new Map<string, string>();
  let fi = 0;
  for (const f of m.funcs) if (stageOf(f) === undefined) fns.set(f.name, `fn#${fi++}`);

  const structs = new Map<string, string>();
  let si = 0;
  for (const s of m.structs) if (!bindingStructs.has(s.name)) structs.set(s.name, `st#${si++}`);

  const consts = new Map<string, string>();
  let ci = 0;
  for (const c of m.consts) consts.set(c.name, `k#${ci++}`);

  const locals = new Map<string, ReadonlyMap<string, string>>();
  for (const f of m.funcs) {
    const declared = new Set<string>();
    if (stageOf(f) === undefined) for (const p of f.params) declared.add(p.name);
    declaredNames(f.body, declared);
    const scoped = new Map<string, string>();
    let vi = 0;
    for (const name of declared) scoped.set(name, `v#${vi++}`);
    locals.set(f.name, scoped);
  }
  return { fns, structs, consts, locals };
}

export const typeSig = (t: ShaderType, c: Canon): string => typeKey(canonType(t, c));

function canonType(t: ShaderType, c: Canon): ShaderType {
  if (t.kind === 'struct') {
    const to = c.structs.get(t.name);
    return to === undefined ? t : { ...t, name: to };
  }
  if (t.kind === 'array') {
    const elem = canonType(t.elem, c);
    return elem === t.elem ? t : { ...t, elem };
  }
  return t;
}

export const subStructs = (s: string, c: Canon): string =>
  c.structs.size === 0
    ? s
    : s.replace(/struct:([A-Za-z_][A-Za-z0-9_]*)/g, (all, n: string) => {
        const to = c.structs.get(n);
        return to === undefined ? all : `struct:${to}`;
      });
