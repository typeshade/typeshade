import ts from 'typescript';
import type { HostType } from '../../../core/host-values.js';
import { exportsOf } from './exports.js';
import {
  accessorFnName,
  baseClassOf,
  buildsCallerClass,
  emittedMemberName,
  holdsFunction,
  isPrivateName,
  isStaticMember,
  keywordAccessOf,
  returnsThis,
  writtenMemberName,
} from '../class-names.js';
import type { ClassMember, MemberCall, Refused } from '../host-face-contracts.js';
import { REASON } from '../host-face-shared.js';
import { hostTypeOf } from '../host-types.js';
import { abstractBuilderText, methodFnName } from '../lower/class-methods.js';
import type { CollectedStruct } from '../structs.js';
import type { FaceCtx } from './context.js';
import { isFunctionType } from './type-nodes.js';

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some((m) => m.kind === kind) ??
  false;

export function classChain(cls: ts.ClassDeclaration): ts.ClassDeclaration[] {
  const out: ts.ClassDeclaration[] = [];
  let at: ts.ClassDeclaration | undefined = cls;
  while (at !== undefined && !out.includes(at)) {
    out.push(at);
    at = baseClassOf(at);
  }
  return out;
}

const isGenericMember = (f: ts.SignatureDeclaration): boolean =>
  (f.typeParameters?.length ?? 0) > 0 &&
  !f.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === 'this');

export function memberCall(
  fn: string,
  node: ts.SignatureDeclaration | undefined,
  instance: boolean,
  self: boolean,
  c: FaceCtx,
): MemberCall | Refused {
  if (node !== undefined && isGenericMember(node)) return { reason: REASON.generic };
  if (node?.parameters.some((p) => isFunctionType(p.type, c.sf)))
    return { reason: REASON.takesFunction };
  const f = c.byName.get(fn);
  if (f === undefined) return { reason: REASON.notLowered };
  const params: { name: string; type: HostType }[] = [];
  for (const p of instance ? f.params.slice(1) : f.params) {
    if (p.mode === 'inout') return { reason: REASON.reference(p.name) };
    const t = hostTypeOf(p.type, c.structs);
    if ('none' in t) return { reason: `parameter "${p.name}": ${t.none}` };
    if (t.k === 'void') return { reason: `parameter "${p.name}" is void` };
    params.push({ name: p.name, type: t });
  }
  const result = hostTypeOf(f.ret, c.structs);
  if ('none' in result) return { reason: `its result: ${result.none}` };
  const problem = c.reachProblem(f.name);
  if (problem !== undefined) return { reason: problem };
  const object = instance ? f.params[0] : undefined;
  const own =
    object?.type.kind === 'struct' && f.ret.kind === 'struct' && f.ret.name === object.type.name;
  return { fn: f.name, params, result, writes: object?.mode === 'inout', self: self && own };
}

function extendsStruct(
  x: CollectedStruct,
  struct: string,
  byName: ReadonlyMap<string, CollectedStruct>,
): boolean {
  const seen = new Set<string>();
  for (let at = x.bases?.[0]; at !== undefined && !seen.has(at); at = byName.get(at)?.bases?.[0]) {
    if (at === struct) return true;
    seen.add(at);
  }
  return false;
}

function concreteBelow(struct: string, c: FaceCtx): string | undefined {
  const byName = new Map(c.collected.map((x) => [x.decl.name, x]));
  return c.collected.find(
    (x) => x.abstract !== true && x.namespace !== true && extendsStruct(x, struct, byName),
  )?.decl.name;
}

function exportedBelow(struct: string, c: FaceCtx): string | undefined {
  const byName = new Map(c.collected.map((x) => [x.decl.name, x]));
  for (const ref of exportsOf(c.sf)) {
    const decl = ref.decl;
    if (decl === undefined || !ts.isClassDeclaration(decl) || decl.name === undefined) continue;
    if ((decl.typeParameters?.length ?? 0) > 0) continue;
    const x = byName.get(decl.name.text);
    if (x === undefined || x.abstract === true || x.namespace === true) continue;
    if (!extendsStruct(x, struct, byName)) continue;
    if ('none' in hostTypeOf({ kind: 'struct', name: x.decl.name }, c.structs)) continue;
    return ref.name;
  }
  return undefined;
}

export function classMembers(
  name: string,
  decl: ts.ClassDeclaration,
  struct: CollectedStruct,
  c: FaceCtx,
): ClassMember[] {
  const own = struct.decl.name;
  const below = struct.abstract === true ? concreteBelow(own, c) : own;
  const out: ClassMember[] = [];
  const seen = new Set<string>();
  for (const cls of classChain(decl)) {
    for (const m of cls.members) {
      if (m.name === undefined) continue;
      const written = writtenMemberName(m.name);
      if (written === undefined) continue;
      const isStatic = isStaticMember(m);
      const accessor = ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m);
      const holder = ts.isPropertyDeclaration(m) && holdsFunction(m) && !isStatic;
      if (!ts.isMethodDeclaration(m) && !accessor && !holder) continue;
      const abstract = hasModifier(m, ts.SyntaxKind.AbstractKeyword);
      if (ts.isMethodDeclaration(m) && m.body === undefined && !abstract) continue;
      const key = `${isStatic ? 'static ' : ''}${written}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (isPrivateName(written) || keywordAccessOf(m) !== undefined) continue;
      if (abstract && struct.abstract !== true) continue;
      const owner = isStatic ? own : below;
      const isAbstract = abstract && struct.abstract === true;
      if (accessor) {
        const halves = cls.members.filter(
          (x): x is ts.AccessorDeclaration =>
            (ts.isGetAccessorDeclaration(x) || ts.isSetAccessorDeclaration(x)) &&
            isStaticMember(x) === isStatic &&
            writtenMemberName(x.name) === written,
        );
        const parts: { get?: MemberCall; set?: MemberCall } = {};
        let reason: string | undefined;
        for (const h of halves) {
          const half = ts.isGetAccessorDeclaration(h) ? 'get' : 'set';
          const call =
            owner === undefined
              ? { reason: REASON.abstractMember(name, written) }
              : memberCall(accessorFnName(owner, half, written), h, !isStatic, false, c);
          if ('reason' in call) reason ??= call.reason;
          else parts[half] = call;
        }
        out.push({
          kind: 'accessor',
          name: written,
          static: isStatic,
          abstract: isAbstract,
          ...(reason === undefined ? parts : { reason }),
        });
        continue;
      }
      const fn = holder ? (m.initializer as ts.ArrowFunction | ts.FunctionExpression) : m;
      const self = !isStatic && ts.isMethodDeclaration(m) && returnsThis(m.body);
      const builder = isStatic && struct.abstract === true && buildsCallerClass(m);
      const call = builder
        ? { reason: abstractBuilderText(name, written, exportedBelow(own, c)) }
        : owner === undefined
          ? { reason: REASON.abstractMember(name, written) }
          : memberCall(
              methodFnName(owner, emittedMemberName(written)),
              fn as ts.SignatureDeclaration,
              !isStatic,
              self,
              c,
            );
      out.push({ kind: 'method', name: written, static: isStatic, abstract: isAbstract, call });
    }
  }
  return out;
}
