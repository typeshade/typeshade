// Implements: Rule 6.6, Rule 6.8 (docs/language-design.md; traced in reqs/).
import ts from 'typescript';
import type { FuncDecl, StructDecl, StructField } from '../../core/ir/nodes.js';
import { structT, type ShaderType } from '../../core/ir/types.js';
import { checkLocationType } from './builtin-check.js';
import { TS_CODES } from './codes.js';
import { authorTypeText } from './context.js';
import { makeDiagnostic, noteUse } from './diagnostic.js';
import {
  hasRefusedIoParam,
  refuseF64EntryIo,
  type F64IoPlace,
} from './lower/function-signature.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import { stageCallOf } from './stage-call.js';
import { hasRefusedIoAttribute, type CollectedStruct } from './structs.js';

type Param = FuncDecl['params'][number];

const isAttributed = (p: Param): boolean =>
  p.type.kind === 'struct' ||
  p.builtin !== undefined ||
  p.location !== undefined ||
  hasRefusedIoParam(p);

interface Demand {
  readonly location: number;
  readonly where: string;
}

function take(held: Set<number>): number {
  let n = 0;
  while (held.has(n)) n++;
  held.add(n);
  return n;
}

export function entryNode(
  sourceFile: ts.SourceFile,
  name: string,
): ts.FunctionLikeDeclaration | undefined {
  for (const st of sourceFile.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === name && st.body !== undefined) return st;
    const call = stageCallOf(st);
    if (call?.declaration.name.text === name) return call.fn;
  }
  return undefined;
}

function fieldNode(sourceFile: ts.SourceFile, struct: string, field: string): ts.Node | undefined {
  let found: ts.Node | undefined;
  const named = (members: readonly (ts.ClassElement | ts.TypeElement)[]): ts.Node | undefined =>
    members.find(
      (m) =>
        (ts.isPropertyDeclaration(m) || ts.isPropertySignature(m)) &&
        ts.isIdentifier(m.name) &&
        m.name.text === field,
    );
  const visit = (statements: readonly ts.Statement[], prefix: string): void => {
    for (const st of statements) {
      if (found !== undefined) return;
      if (ts.isModuleDeclaration(st) && ts.isIdentifier(st.name)) {
        let body = st.body;
        let name = `${prefix}${st.name.text}_`;
        while (body !== undefined && ts.isModuleDeclaration(body)) {
          name += `${body.name.text}_`;
          body = body.body;
        }
        if (body !== undefined && ts.isModuleBlock(body)) visit(body.statements, name);
        continue;
      }
      if (
        (ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st)) &&
        st.name !== undefined &&
        `${prefix}${st.name.text}` === struct
      )
        found = named(st.members);
      else if (
        ts.isTypeAliasDeclaration(st) &&
        `${prefix}${st.name.text}` === struct &&
        ts.isTypeLiteralNode(st.type)
      )
        found = named(st.type.members);
    }
  };
  visit(sourceFile.statements, '');
  return found;
}

export function giveEntryLocations(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  structs: readonly CollectedStruct[],
  funcs: readonly FuncDecl[],
): void {
  const entries = funcs.filter((f) => f.stage === 'vertex' || f.stage === 'fragment');
  if (entries.length === 0) return;
  const declOf = (type: ShaderType): StructDecl | undefined =>
    type.kind === 'struct' ? structs.find((s) => s.decl.name === type.name)?.decl : undefined;
  const shown = (decl: StructDecl): string => authorTypeText(structT(decl.name));
  const say = (node: ts.Node | undefined, message: string, use?: ts.Node): void => {
    const diagnostic = makeDiagnostic(sourceFile, node, message, TS_CODES.STRUCT_FIELD);
    if (use !== node) noteUse(diagnostic, use, sourceFile);
    diagnostics.push(diagnostic);
  };

  const paramAnchor = (fn: FuncDecl, name: string): ts.Node | undefined => {
    const node = entryNode(sourceFile, fn.name);
    return (
      node?.parameters.find((p) => ts.isIdentifier(p.name) && p.name.text === name) ??
      node?.name ??
      node
    );
  };
  const resultAnchor = (fn: FuncDecl): ts.Node | undefined => {
    const node = entryNode(sourceFile, fn.name);
    return node?.type ?? node?.name ?? node;
  };

  const unfit = new Set<StructField>();
  const judged = new Set<StructField>();
  const fits = (
    type: ShaderType,
    name: string,
    what: string,
    place: F64IoPlace,
    node: ts.Node | undefined,
    use?: ts.Node,
  ): boolean => {
    const at = node ?? sourceFile;
    const before = diagnostics.length;
    const said = (): void => {
      if (use === undefined || use === node) return;
      for (const d of diagnostics.slice(before)) noteUse(d, use, sourceFile);
    };
    if (refuseF64EntryIo(type, what, place, at, sourceFile, diagnostics)) {
      said();
      return false;
    }
    if (type.kind === 'f64') return true;
    checkLocationType(diagnostics, sourceFile, at, name, type);
    said();
    return diagnostics.length === before;
  };
  const open = (
    decl: StructDecl,
    field: StructField,
    stage: string,
    direction: string,
    anchor: ts.Node | undefined,
  ): boolean => {
    if (field.builtin !== undefined || field.location !== undefined) return false;
    if (hasRefusedIoAttribute(field)) return false;
    if (!judged.has(field)) {
      judged.add(field);
      const ok = fits(
        field.type,
        `${shown(decl)}.${field.name}`,
        `Struct "${shown(decl)}" field "${field.name}", a ${stage} ${direction},`,
        'io-struct-field',
        fieldNode(sourceFile, decl.name, field.name) ?? anchor,
        anchor,
      );
      if (!ok) unfit.add(field);
    }
    return !unfit.has(field);
  };

  const demands = new Map<StructField, Demand[]>();
  const home = new Map<StructField, { decl: StructDecl; anchor: ts.Node | undefined }>();
  const demand = (
    decl: StructDecl,
    field: StructField,
    location: number,
    where: string,
    anchor: ts.Node | undefined,
  ): void => {
    if (!home.has(field)) home.set(field, { decl, anchor });
    const list = demands.get(field) ?? [];
    list.push({ location, where });
    demands.set(field, list);
  };
  const given = new Map<Param, number>();

  const numberStruct = (
    decl: StructDecl,
    stage: string,
    where: string,
    anchor: ts.Node | undefined,
  ): void => {
    const held = new Set<number>();
    for (const f of decl.fields) if (f.location !== undefined) held.add(f.location);
    for (const f of decl.fields)
      if (open(decl, f, stage, 'output', anchor)) demand(decl, f, take(held), where, anchor);
  };

  for (const fn of entries) {
    if (fn.stage === 'vertex') {
      const held = new Set<number>();
      for (const p of fn.params) {
        if (p.location !== undefined) held.add(p.location);
        for (const f of declOf(p.type)?.fields ?? [])
          if (f.location !== undefined) held.add(f.location);
      }
      for (const p of fn.params) {
        const decl = declOf(p.type);
        const anchor = paramAnchor(fn, p.name);
        if (decl !== undefined) {
          for (const f of decl.fields)
            if (open(decl, f, 'vertex', 'input', anchor))
              demand(decl, f, take(held), `as an input of "${fn.name}"`, anchor);
          continue;
        }
        if (isAttributed(p)) continue;
        if (fits(p.type, p.name, `Parameter "${p.name}"`, 'attribute', anchor))
          given.set(p, take(held));
      }
    }
    const result = declOf(fn.ret);
    if (result !== undefined)
      numberStruct(result, fn.stage!, `as the result of "${fn.name}"`, resultAnchor(fn));
  }

  const settled = new Map<StructField, number>();
  const refused = new Set<StructField>();
  const settle = (): void => {
    for (const [field, list] of demands) {
      if (settled.has(field) || refused.has(field)) continue;
      const first = list[0]!;
      const other = list.find((d) => d.location !== first.location);
      if (other === undefined) {
        settled.set(field, first.location);
        continue;
      }
      refused.add(field);
      const { decl, anchor } = home.get(field)!;
      say(
        fieldNode(sourceFile, decl.name, field.name) ?? anchor,
        `"${shown(decl)}.${field.name}" has no location and its uses give it ` +
          `${String(first.location)} ${first.where} and ${String(other.location)} ${other.where}: ` +
          `write location<n, T> on it.`,
        anchor,
      );
    }
  };
  settle();

  const locationOf = (f: StructField): number | undefined => f.location ?? settled.get(f);
  const vertexResults: StructDecl[] = [];
  for (const fn of entries) {
    const decl = fn.stage === 'vertex' ? declOf(fn.ret) : undefined;
    if (decl !== undefined && !vertexResults.includes(decl)) vertexResults.push(decl);
  }
  const byName = (name: string): number | { readonly why: string } | undefined => {
    const seen: { location: number; struct: string }[] = [];
    for (const decl of vertexResults) {
      for (const f of decl.fields) {
        if (f.name !== name || f.builtin !== undefined) continue;
        const location = locationOf(f);
        if (location === undefined) return undefined;
        seen.push({ location, struct: shown(decl) });
      }
    }
    if (seen.length === 0) return { why: 'none' };
    const first = seen[0]!;
    const other = seen.find((s) => s.location !== first.location);
    if (other === undefined) return first.location;
    return {
      why:
        `${String(first.location)} in "${first.struct}" and ` +
        `${String(other.location)} in "${other.struct}"`,
    };
  };
  const unlinked = (what: string, name: string, why: string): string =>
    `"${what}" has no location and the vertex results give "${name}" ${why}: ` +
    `write location<n, T> on it.`;
  for (const fn of entries) {
    if (fn.stage !== 'fragment') continue;
    for (const p of fn.params) {
      const decl = declOf(p.type);
      const anchor = paramAnchor(fn, p.name);
      if (decl !== undefined) {
        if (vertexResults.includes(decl)) continue;
        for (const f of decl.fields) {
          if (!open(decl, f, 'fragment', 'input', anchor)) continue;
          if (refused.has(f)) continue;
          const location = byName(f.name);
          if (location === undefined) continue;
          if (typeof location === 'number') {
            demand(decl, f, location, `as an input of "${fn.name}"`, anchor);
            continue;
          }
          if (settled.has(f)) continue;
          refused.add(f);
          say(
            fieldNode(sourceFile, decl.name, f.name) ?? anchor,
            unlinked(`${shown(decl)}.${f.name}`, f.name, location.why),
            anchor,
          );
        }
        continue;
      }
      if (isAttributed(p)) continue;
      if (!fits(p.type, p.name, `Parameter "${p.name}"`, 'varying', anchor)) continue;
      const location = byName(p.name);
      if (location === undefined) continue;
      if (typeof location === 'number') given.set(p, location);
      else say(anchor, unlinked(p.name, p.name, location.why));
    }
  }
  for (const [field, list] of demands) {
    const was = settled.get(field);
    if (was === undefined) continue;
    const other = list.find((d) => d.location !== was);
    if (other === undefined) continue;
    settled.delete(field);
    refused.add(field);
    const { decl, anchor } = home.get(field)!;
    const first = list[0]!;
    say(
      fieldNode(sourceFile, decl.name, field.name) ?? anchor,
      `"${shown(decl)}.${field.name}" has no location and its uses give it ` +
        `${String(first.location)} ${first.where} and ${String(other.location)} ${other.where}: ` +
        `write location<n, T> on it.`,
      anchor,
    );
  }
  settle();

  for (const [field, location] of settled) {
    (field as { location?: number }).location = location;
    (field as { attr?: string }).attr = `@location(${String(location)})`;
  }
  for (const [param, location] of given) (param as { location?: number }).location = location;

  for (const fn of entries) {
    if (fn.stage !== 'fragment') continue;
    const at = new Map<number, string>();
    for (const p of fn.params) {
      const decl = declOf(p.type);
      if (decl !== undefined) {
        const slots = new Map<string, string>();
        for (const f of decl.fields) {
          if (f.location === undefined) continue;
          const slot = `${String(f.location)}:${String(f.blendSrc ?? -1)}`;
          const prior = slots.get(slot);
          if (prior === undefined) {
            slots.set(slot, f.name);
            continue;
          }
          const priorField = decl.fields.find((x) => x.name === prior)!;
          if (!settled.has(f) && !settled.has(priorField)) continue;
          say(
            paramAnchor(fn, p.name),
            `Struct "${shown(decl)}" puts "${prior}" and "${f.name}" both at ` +
              `location<${String(f.location)}, …>; each slot carries one value.`,
          );
        }
        continue;
      }
      if (p.location === undefined) continue;
      const prior = at.get(p.location);
      if (prior === undefined) {
        at.set(p.location, p.name);
        continue;
      }
      const priorParam = fn.params.find((x) => x.name === prior)!;
      if (!given.has(p) && !given.has(priorParam)) continue;
      say(
        paramAnchor(fn, p.name),
        `"${fn.name}" puts "${prior}" and "${p.name}" both at location<` +
          `${String(p.location)}, …>; each slot carries one value.`,
      );
    }
  }
}
