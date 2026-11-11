// Implements: Rule 6.6, Rule 6.8 (docs/language-design.md; traced in reqs/).
//
// The location of a user-defined input or output that writes none (change 0135, decision D2.1).
//
// An entry input or output that carries no `builtin<…>` is a user-defined input or output. The
// compiler gives it its location, unless `location<n, T>` writes one, and a written `n` is
// always the location. Where the value stands decides how it is numbered:
//
//   a vertex entry's parameter, or a field of one     the lowest number no written location of
//                                                     that entry holds, in declaration order
//   a field of a struct a vertex entry returns        the lowest number no written location of
//                                                     that struct holds, in declaration order
//   a fragment entry's input: a bare parameter, or    the location the field of the same name
//   a field of a struct no vertex entry returns       has in the vertex results of the program
//   a fragment entry's result, or a field of it       the lowest number no written location of
//                                                     that entry holds, in declaration order
//
// A fragment input that is a field of the struct a vertex entry returns has that struct's
// locations. A bare fragment result is location 0 (`parseSignature`), and a compute entry has
// no user-defined input (`parseParams`, `checkStructBuiltinFields`).
//
// The pass runs once every entry is lowered, since a fragment input reads the vertex results.
// It writes the location into the IR's struct field and parameter, the two places a written
// `location<n, T>` already fills, so the writers, `reflect()` and the manifest read one
// location whether it was written or given (Rules 6.8 and 11.10).
//
// A struct has one set of locations in the emitted module. When two places a struct stands in
// would give one field two numbers, the field is refused (`TS8010`), and the author writes
// `location<n, T>` on it.
import ts from 'typescript';
import type { FuncDecl, StructDecl, StructField } from '../../core/ir/nodes.js';
import { structT, type ShaderType } from '../../core/ir/types.js';
import { checkLocationType } from './builtin-check.js';
import { TS_CODES } from './codes.js';
import { authorTypeText } from './context.js';
import { makeDiagnostic, noteUse } from './diagnostic.js';
import { hasRefusedIoParam, refuseF64EntryIo, type F64IoPlace } from './lower/function.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import { stageCallOf } from './stage-call.js';
import { hasRefusedIoAttribute, type CollectedStruct } from './structs.js';

type Param = FuncDecl['params'][number];

/** Whether a parameter is no user-defined value that takes a location: a struct of values, a
 *  built-in value, one that writes its location, or one whose attribute was refused. */
const isAttributed = (p: Param): boolean =>
  p.type.kind === 'struct' ||
  p.builtin !== undefined ||
  p.location !== undefined ||
  hasRefusedIoParam(p);

/** One number a place gives a struct's field, and the place, as a sentence names it. */
interface Demand {
  readonly location: number;
  readonly where: string;
}

/** The lowest number `held` does not hold, which `held` then holds. */
function take(held: Set<number>): number {
  let n = 0;
  while (held.has(n)) n++;
  held.add(n);
  return n;
}

/** The function an entry is declared as, at the top of the file. The language service reads it
 *  too, to find the entry a hovered parameter or name belongs to (Rule 12.7). */
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

/** The declaration of field `field` of the struct `struct` in `sourceFile`, where the file
 *  declares it. */
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

/**
 * Gives every user-defined input and output of the vertex and fragment entries in `funcs` that
 * writes no location its location (Rule 6.6, change 0135), in the struct fields of `structs`
 * and in the entries' parameters, and reports what cannot take one:
 *
 * - a type no value between stages has, `TS8003` in the sentence a `location<n, bool>` has, and
 *   an emulated double, `TS8056`, as on a written location;
 * - a fragment input whose name no vertex result has, or two give different locations,
 *   `TS8010`;
 * - a field that two places of its struct give two numbers, `TS8010`;
 * - a location a fragment input takes by its name that another input of the entry holds,
 *   `TS8010`, in the sentence two written locations have.
 */
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
  /** Reports `message` at `node`. `use` is the entry's parameter or result that makes the
   *  refusal one, where `node` is a field's declaration: a program that imports the struct
   *  reports it there, in the file it starts from (#1186). */
  const say = (node: ts.Node | undefined, message: string, use?: ts.Node): void => {
    const diagnostic = makeDiagnostic(sourceFile, node, message, TS_CODES.STRUCT_FIELD);
    if (use !== node) noteUse(diagnostic, use, sourceFile);
    diagnostics.push(diagnostic);
  };

  /** Where a diagnostic about an entry's parameter, or about its result, stands. */
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

  // A field that cannot take a location, reported once however many entries use its struct.
  const unfit = new Set<StructField>();
  const judged = new Set<StructField>();
  /** Whether a value of `type` can stand at a location; reports it once when it cannot. */
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
  /** Whether `field` of `decl` is a user-defined value that writes no location and can take
   *  one. `anchor` is the use the struct stands in, where the file does not declare the field. */
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

  /** A struct numbered in its own scope: a vertex result, or a fragment result. */
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

  // The first three rows: each place numbers what stands in it, by its own scope.
  for (const fn of entries) {
    if (fn.stage === 'vertex') {
      // A vertex attribute: the scope is the entry, across its parameters and their fields.
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

  // One struct, one set of locations: a field two places number differently is refused.
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

  // The fourth row: a fragment input takes the location its name has in the vertex results.
  const locationOf = (f: StructField): number | undefined => f.location ?? settled.get(f);
  const vertexResults: StructDecl[] = [];
  for (const fn of entries) {
    const decl = fn.stage === 'vertex' ? declOf(fn.ret) : undefined;
    if (decl !== undefined && !vertexResults.includes(decl)) vertexResults.push(decl);
  }
  /** The location the vertex results give `name`: one number, or why there is none. */
  const byName = (name: string): number | { readonly why: string } | undefined => {
    const seen: { location: number; struct: string }[] = [];
    for (const decl of vertexResults) {
      for (const f of decl.fields) {
        if (f.name !== name || f.builtin !== undefined) continue;
        const location = locationOf(f);
        // A field that was refused has said why; its reader says nothing more (Rule 12.4).
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
        // The struct a vertex entry returns has that struct's locations.
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
  // A field settled before the fragment inputs keeps its number; one that a fragment input
  // then numbers differently is refused above the same way.
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

  // The IR carries the location where a written one stands.
  for (const [field, location] of settled) {
    (field as { location?: number }).location = location;
    (field as { attr?: string }).attr = `@location(${String(location)})`;
  }
  for (const [param, location] of given) (param as { location?: number }).location = location;

  // A location a fragment input took by its name may be one another input of the entry wrote.
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
