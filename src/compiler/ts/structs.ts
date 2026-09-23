import ts from 'typescript';
import type { StructDecl, StructField } from '../../core/ir/nodes.js';
import type { ShaderType } from '../../core/ir/types.js';
import { boolT, f32T, structT, typeKey as typeKeyOf } from '../../core/ir/types.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import { lookupTypeName, mapTsTypeToShaderType } from './type-map.js';
import {
  baseClassOf,
  emittedMemberName,
  holdsFunction,
  isPrivateName,
  isReadonlyMember,
  isStaticMember,
  keywordAccessOf,
  memberDeclarationInChain,
  writtenMemberName,
  type KeywordAccess,
} from './class-names.js';
import { recordDeclaration, type DeclaredSymbolSink } from './symbols.js';
import { TS_CODES } from './codes.js';
import { makeDiagnostic } from './diagnostic.js';
import {
  builtinDecoratorArg,
  checkAttributeName,
  checkBuiltinName,
  checkBuiltinType,
  checkLocationType,
  hasInvariantDecorator,
  interpolateDecoratorArg,
} from './builtin-check.js';
import { applyMixins, isMixinHeritage, mixedMembers, type MixinApplication } from './mixins.js';
import { pushTypeArguments } from './generics.js';
import {
  genericClasses,
  genericStructName,
  newInstanceName,
  writtenInstances,
  type StructInstance,
} from './generic-structs.js';
import {
  eachNamespaceStatement,
  namespaceMemberName,
  refuseNamespaceStatement,
} from './namespaces.js';

/** Which of the three spellings declared a struct. Only a `class` can carry a field
 *  decorator, so a diagnostic that asks for `@builtin` or `@location` has to know: on the
 *  other two the author cannot comply without changing the declaration itself. */
export type StructSpelling = 'class' | 'interface' | 'type';

export type CollectedStruct = {
  readonly decl: StructDecl;
  readonly packing: 'wgsl';
  readonly spelling: StructSpelling;
  /** A `class`'s methods, constructor and field initializers (#86); absent on the other two
   *  spellings and on a class that declares none. */
  readonly members?: ClassMembers;
  /** A class whose members are all static (roadmap 0.3 item T3, #92): a namespace of
   *  functions and constants rather than a value type. It is collected so `Util.half(x)`
   *  resolves and its statics become functions, and it is NOT emitted, because it has no
   *  fields and WGSL has no empty struct. */
  readonly namespace?: true;
  /** The names this declaration extends, in the order written (roadmap 0.3 item T5, #92).
   *  Their fields stand ahead of this one's, base first, which is what makes a derived struct
   *  a superset of its base rather than a different shape. An interface may extend several. */
  readonly bases?: readonly string[];
  /** What this collection's type parameters are bound to, for a generic class (roadmap 0.3
   *  item T9, #92). `Pair_f32` carries `T -> f32`, and its methods are parsed and lowered with
   *  that in force, since their signatures and bodies are written in terms of `T`. Absent on
   *  every class that is not generic. */
  readonly binding?: ReadonlyMap<string, ShaderType>;
  /** An `abstract class`: a base to inherit from and never a value. Its struct is emitted, so
   *  a derived one can be described in terms of it, and its method bodies are lowered into
   *  each concrete class that inherits them rather than into a function of its own — an
   *  abstract method has no body for such a function to call. */
  readonly abstract?: true;
  /** The class declaration this struct was collected from; absent on an interface and a type
   *  alias. A private name (`#x`) is checked against it, since what may name one is decided by
   *  which class body the access is written in (Rule 8.12). */
  readonly classNode?: ts.ClassDeclaration;
  /** Each field under its emitted name, with the name it was written under when that differs:
   *  a private field `#count` is the member `count` (Rule 8.12). Base fields included once the
   *  chain is spliced in, so a lookup of `#count` on a derived struct finds its base's. */
  readonly privateFields?: ReadonlyMap<string, PrivateField>;
  /** Fields the class writes and the struct does not carry, by the member they would be: one
   *  refused where it is declared (no type, `?`, a name another field already takes). A read of
   *  one says nothing more, since its declaration already said why (Rule 12.4). */
  readonly withheld?: ReadonlySet<string>;
  /** The functions the class declared that lost their emitted name to another member, by what
   *  follows `Cls_` in it (`step` for a refused `#step` beside `step`): the pair was reported,
   *  and a call that would have reached the one refused says nothing more (Rule 12.4). */
  readonly withheldFunctions?: ReadonlySet<string>;
  /** The `readonly` fields, by emitted name, with the class that declares each: only that
   *  class's constructor may assign one (Rule 8.14), which is TypeScript's rule. */
  readonly readonlyFields?: ReadonlyMap<string, ts.ClassLikeDeclaration>;
  /** The fields declared `private` or `protected`, by emitted name, with the class that
   *  declares each (Rule 8.15). */
  readonly restrictedFields?: ReadonlyMap<string, RestrictedField>;
  /** For a generic class's instance, the name its statics are emitted under: the class's own,
   *  `Pair` for `Pair_f32`, since a static is one per class and not one per instance (T9). */
  readonly staticHolder?: string;
};

/** A field declared with `private` or `protected`, and the class that declares it. */
export interface RestrictedField {
  readonly access: KeywordAccess;
  readonly owner: ts.ClassLikeDeclaration;
}

/** A field written under a private name, and the class whose body may name it (Rule 8.12). */
export interface PrivateField {
  readonly written: string;
  readonly owner: ts.ClassLikeDeclaration;
}

/** The structs a module emits: every collected one but the static-only classes, which are
 *  namespaces of functions and have no layout. One helper, because four callers build a
 *  module out of the collected list and all four must leave the same ones out. */
export const emittedStructDecls = (structs: readonly CollectedStruct[]): StructDecl[] =>
  structs.filter((s) => !s.namespace).map((s) => s.decl);

/** A field declared with an initializer, `hits: u32 = 0`: what a constructor assigns before
 *  its own body runs, and what `new P()` gives a class with no constructor. */
export interface FieldInit {
  readonly name: string;
  readonly type: ShaderType;
  readonly init: ts.Expression;
}

/** What a class declares beyond its fields (#86). Each method becomes a function whose first
 *  parameter is the struct (`Ray_at(self_: Ray, t: f32)`), a static one a function with no
 *  receiver, and the constructor `Ray_new(...)`, which starts from the zero struct. */
export interface ClassMembers {
  readonly node: ts.ClassDeclaration;
  readonly methods: readonly ts.MethodDeclaration[];
  /** Getters and setters, each half a function of the module (Rule 8.11). */
  readonly accessors: readonly ts.AccessorDeclaration[];
  readonly ctor: ts.ConstructorDeclaration | undefined;
  readonly fieldInits: readonly FieldInit[];
  /** The constructor's parameter properties, `constructor(public x: f32)`, in order: each is a
   *  field, assigned from its parameter as the constructor starts (Rule 8.14). */
  readonly paramProps: readonly string[];
}

/** An `interface X { … }` or a `type X = { … }` — the two spellings that are collected only
 *  when something refers to them (see {@link collectStructs}). */
type Candidate = {
  readonly name: string;
  readonly nameNode: ts.Identifier;
  readonly members: readonly ts.TypeElement[];
  readonly spelling: 'interface' | 'type';
  readonly generic: boolean;
  readonly heritage: readonly ts.HeritageClause[] | undefined;
};

/** Every struct the file declares, in source order, whichever of the three spellings the
 *  author used. A `class` is the only one that can carry per-field metadata, because
 *  TypeScript decorators cannot appear on a type-literal or interface member; `type X = { … }`
 *  and `interface X { … }` are the plain-data spellings §2 of the surface document names, and
 *  produce the same {@link StructDecl} a class with no field decorators does.
 *
 *  A class is collected whether or not anything refers to it, exactly as before. An interface
 *  or an object-type alias is collected only when its name is USED as a struct — see
 *  {@link reachableCandidates}. That gate is what keeps this addition additive: a
 *  `"use typeshade"` file may hold host-shaped declarations that are not shader types at all
 *  (`type P = { seed: number }`, `{ cb: () => f32 }`), and before this they were simply
 *  invisible. Collecting every declaration would turn each of them into a type error and
 *  would put an unreferenced shape into the emitted WGSL. */
export function collectStructs(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  symbols?: DeclaredSymbolSink,
): CollectedStruct[] {
  // Which classes are generic, and which sets of type arguments the file writes them with
  // (roadmap 0.3 item T9, #92). Read before the walk below, because a generic class is
  // collected once per set and the walk emits them all.
  const genericParams = genericClasses(sourceFile);
  const instances = writtenInstances(
    sourceFile,
    genericParams,
    (node) => mapTsTypeToShaderType(node, sourceFile, undefined),
    diagnostics,
  );
  const candidates = collectCandidates(sourceFile);
  const reachable = reachableCandidates(sourceFile, candidates);
  const out: CollectedStruct[] = [];
  const declared = new Set<string>();
  /** Where to anchor a diagnostic about a struct's inheritance, which is reported after the
   *  walk and so no longer has the declaration in hand. */
  const nodeOf = new Map<string, ts.Node>();

  /** Records one struct, or says why it is not one. `before` is the diagnostic count from
   *  before the members were walked, so an empty field list is only reported when nothing
   *  else already explained it. */
  const add = (
    name: string,
    node: ts.Node,
    fields: StructField[],
    spelling: StructSpelling,
    before: number,
    members?: ClassMembers,
    isNamespace?: true,
    bases: readonly string[] = [],
    isAbstract?: true,
    binding?: ReadonlyMap<string, ShaderType>,
    klass?: {
      node: ts.ClassDeclaration;
      privateFields: ReadonlyMap<string, PrivateField>;
      withheld: ReadonlySet<string>;
      withheldFunctions: ReadonlySet<string>;
      readonlyFields: ReadonlyMap<string, ts.ClassLikeDeclaration>;
      restrictedFields: ReadonlyMap<string, RestrictedField>;
      staticHolder?: string;
    },
  ): void => {
    const fromClass =
      klass === undefined
        ? {}
        : {
            classNode: klass.node,
            ...(klass.staticHolder !== undefined ? { staticHolder: klass.staticHolder } : {}),
            ...(klass.privateFields.size > 0 ? { privateFields: klass.privateFields } : {}),
            ...(klass.withheld.size > 0 ? { withheld: klass.withheld } : {}),
            ...(klass.withheldFunctions.size > 0
              ? { withheldFunctions: klass.withheldFunctions }
              : {}),
            ...(klass.readonlyFields.size > 0 ? { readonlyFields: klass.readonlyFields } : {}),
            ...(klass.restrictedFields.size > 0
              ? { restrictedFields: klass.restrictedFields }
              : {}),
          };
    if (declared.has(name)) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          node,
          `Struct "${name}" is declared more than once. A class, an interface and a type alias ` +
            `are three spellings of one struct, not declarations that merge — TypeScript would ` +
            `merge two interfaces, and the merged layout would disagree with this one at every ` +
            `use site.`,
          TS_CODES.DUPLICATE_SYMBOL,
        ),
      );
      return;
    }
    // A class whose members are all static is a namespace of functions and constants, not a
    // value type, so the empty-struct rule does not reach it (T3, #92). Registered so that
    // `Util.half(x)` resolves and `collectClassFunctions` walks its statics; left out of the
    // emitted structs by `emittedStructDecls`.
    if (fields.length === 0 && isNamespace) {
      declared.add(name);
      out.push({
        decl: { name, fields },
        packing: 'wgsl',
        spelling,
        namespace: true,
        ...(bases.length > 0 ? { bases } : {}),
        ...(members !== undefined ? { members } : {}),
        ...(binding !== undefined ? { binding } : {}),
        ...fromClass,
      });
      return;
    }
    // A declaration with a base gets its fields from `applyInheritance`, which reports an
    // empty one once what it extends is known (T5, #92).
    if (fields.length === 0 && bases.length === 0) {
      if (diagnostics.length === before) {
        diagnostics.push(
          diag(
            sourceFile,
            node,
            `Struct "${name}" has no fields. WGSL requires a struct to declare at least one ` +
              `member, so an empty one cannot be emitted.` +
              (members !== undefined && (members.methods.length > 0 || members.accessors.length > 0)
                ? ` A class holding only functions is not a struct; write them as functions.`
                : ''),
          ),
        );
      }
      return;
    }
    declared.add(name);
    nodeOf.set(name, node);
    out.push({
      decl: { name, fields },
      packing: 'wgsl',
      spelling,
      ...(members !== undefined ? { members } : {}),
      ...(bases.length > 0 ? { bases } : {}),
      ...(isAbstract ? { abstract: isAbstract } : {}),
      ...(binding !== undefined ? { binding } : {}),
      ...fromClass,
    });
  };

  // A class inside a `namespace` is the struct `Ns_P`, the same flattening a function and a
  // constant already take (#107). The walk below visits the file's own statements and each
  // namespace body, so one loop serves both; `prefix` is '' at the top level, where the struct
  // keeps the name it was written under.
  const seen: { stmt: ts.Statement; prefix: string }[] = [];
  eachNamespaceStatement(sourceFile.statements, sourceFile, [], (stmt, prefix) => {
    seen.push({ stmt, prefix });
  });
  for (const { stmt, prefix } of seen) {
    const candidate = candidateOf(stmt);
    if (candidate) {
      if (prefix !== '') {
        // An interface or a type alias inside a namespace is collected by REACHABILITY rather
        // than by declaration, so flattening its name is a separate step; refused for now, with
        // the same sentence every other namespace member had.
        refuseNamespaceStatement(stmt, prefix, sourceFile, diagnostics);
        continue;
      }
      if (!reachable.has(candidate.name)) continue;
      if (candidate.generic) {
        diagnostics.push(
          diag(
            sourceFile,
            candidate.nameNode,
            `"${candidate.name}" takes type parameters. A TypeShade struct is one concrete ` +
              `layout, so a generic declaration has no single set of field types to emit.`,
          ),
        );
        continue;
      }
      const heritage = basesOf(candidate.name, candidate.heritage, sourceFile, diagnostics);
      if (heritage === undefined) continue;
      const before = diagnostics.length;
      // An interface and a type alias are two of the three spellings of one struct, and the
      // emitters spell all three the same way — so their names have to reach the declared-symbol
      // table too, or a check that reads it sees a `class` field and not the `interface` field
      // beside it (issue #103: `interface S { half: f32 }` is the uniform block ANGLE refuses).
      recordDeclaration(symbols, sourceFile, candidate.nameNode, {
        name: candidate.name,
        kind: 'struct',
        type: structT(candidate.name),
      });
      add(
        candidate.name,
        candidate.nameNode,
        signatureFields(candidate.members, candidate.name, sourceFile, diagnostics, symbols),
        candidate.spelling,
        before,
        undefined,
        undefined,
        heritage.bases,
      );
      continue;
    }
    if (!ts.isClassDeclaration(stmt) || !stmt.name) continue;
    const declared = stmt.name;
    const written = prefix === '' ? declared.text : namespaceMemberName(prefix, declared.text);
    // A generic class is collected once per set of type arguments the file writes it with
    // (roadmap 0.3 item T9, #92): `Pair<f32>` and `Pair<vec3>` are the structs `Pair_f32` and
    // `Pair_vec3`, each with its own methods. A class with no type parameters has exactly one
    // collection, under its own name and with nothing bound, which is what every class had
    // before; a generic one nothing writes has none, and emits nothing.
    const cases: readonly StructInstance[] = genericParams.has(written)
      ? (instances.get(written) ?? [])
      : [{ name: written, binding: undefined }];
    for (const instance of cases) {
      const structName = instance.name;
      // Imperative rather than a callback: the body below `continue`s, and a callback would
      // make that cross a function boundary. A `continue` here skips this INSTANCE, which is
      // what a member the walk refuses should do.
      const unbind = pushTypeArguments(instance.binding);
      try {
        recordDeclaration(symbols, sourceFile, stmt.name, {
          name: structName,
          kind: 'struct',
          type: structT(structName),
        });
        for (const d of stmt.modifiers ?? []) {
          if (!ts.isDecorator(d)) continue;
          checkAttributeName(diagnostics, sourceFile, d);
          const text = d.getText(sourceFile);
          if (/@std140/.test(text) || /@align/.test(text)) {
            diagnostics.push(
              diag(sourceFile, d, `${text.split('(')[0]} on a class is not applied.`),
            );
          }
          if (/@compute|@vertex|@fragment/.test(text)) {
            diagnostics.push(diag(sourceFile, d, `${text} does not belong on a data class.`));
          }
        }
        // A class `extends` puts the base's fields ahead of its own, just as an interface one does
        // (T5, #92); `implements` carries no layout and is left alone.
        const heritage = basesOf(structName, stmt.heritageClauses, sourceFile, diagnostics);
        if (heritage === undefined) continue;
        const bases = heritage.bases;
        const isAbstract =
          (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword) ?? false) ||
          undefined;
        const before = diagnostics.length;
        const fields: StructField[] = [];
        // Static members seen, which is what decides whether a fieldless class is a namespace of
        // functions (T3) or the empty struct WGSL has no form for.
        let staticFunctions = 0;
        let staticFields = 0;
        const methods: ts.MethodDeclaration[] = [];
        const accessors: ts.AccessorDeclaration[] = [];
        const fieldInits: FieldInit[] = [];
        const paramProps: string[] = [];
        const privateFields = new Map<string, PrivateField>();
        const withheld = new Set<string>();
        const readonlyFields = new Map<string, ts.ClassLikeDeclaration>();
        const restrictedFields = new Map<string, RestrictedField>();
        let ctor: ts.ConstructorDeclaration | undefined;
        // Every function the class emits, by what follows `Cls_` in its name, with the member it
        // was written as. Two members can reach one name in ways TypeScript keeps apart: `#step`
        // and `step` are both `Cls_step` once the `#` is gone, and the getter `x` is `Cls_get_x`,
        // which a method `get_x` would be too (Rule 8.11, Rule 8.12).
        const functionNames = new Map<string, string>();
        const withheldFunctions = new Set<string>();
        const claimFunction = (
          suffix: string,
          shownAs: string,
          at: ts.Node,
          twice: string,
        ): boolean => {
          const prior = functionNames.get(suffix);
          if (prior === undefined) {
            functionNames.set(suffix, shownAs);
            return true;
          }
          withheldFunctions.add(suffix);
          diagnostics.push(
            classDiag(
              sourceFile,
              at,
              prior === shownAs
                ? twice
                : `"${structName}.${prior}" and "${structName}.${shownAs}" would both be the ` +
                    `function "${structName}_${suffix}". Rename one of them.`,
            ),
          );
          return false;
        };
        // Every field by the member it is emitted as, with the name it was written under: `#n`
        // and `n` are one struct member `n`, which TypeScript counts as two (Rule 8.12).
        const fieldNames = new Map<string, string>();
        const staticFieldNames = new Map<string, string>();
        const claimField = (written: string, at: ts.Node): boolean => {
          const emitted = emittedMemberName(written);
          const prior = fieldNames.get(emitted);
          if (prior === undefined) {
            fieldNames.set(emitted, written);
            return true;
          }
          withheld.add(emitted);
          diagnostics.push(
            diag(
              sourceFile,
              at,
              prior === written
                ? `Field "${written}" is declared twice on "${structName}"; a struct has one ` +
                    `member of a name.`
                : `"${structName}" declares "${prior}" and "${written}", which would both be the ` +
                    `struct member "${emitted}": a private name is emitted without its "#". ` +
                    `Rename one of them.`,
            ),
          );
          return false;
        };
        // What each written name is on this class, `static ` ahead of a static one: a field, a
        // method or an accessor. TypeScript refuses one name as two kinds (TS2300), and here the
        // lowering of `o.x` would have to guess which the author meant.
        const kinds = new Map<string, 'field' | 'method' | 'accessor'>();
        const claimKind = (
          key: string,
          kind: 'field' | 'method' | 'accessor',
          at: ts.Node,
          written: string,
        ): boolean => {
          const prior = kinds.get(key);
          if (prior === undefined || prior === kind) {
            kinds.set(key, kind);
            return true;
          }
          diagnostics.push(
            classDiag(
              sourceFile,
              at,
              `"${structName}.${written}" is declared as ${a(prior)} and as ${a(kind)}; a class ` +
                `member has one kind. Rename one of them.`,
            ),
          );
          return false;
        };
        // A mixin's members are this class's, ahead of its own and behind its base's, which is the
        // order TypeScript's own mixin produces (T8, #92). A member this class declares under the
        // same name is an override and wins, silently, the way a subclass member does.
        for (const member of mixedMembers(
          heritage.bodies,
          stmt.members,
          sourceFile,
          diagnostics,
          structName,
        )) {
          // A method, a constructor and a static function are functions of the module (#86), the
          // shapes below are what the surface does not take, each with its fix.
          if (ts.isConstructorDeclaration(member)) {
            if (!member.body) continue; // an overload signature; the body is the declaration
            if (ctor !== undefined) {
              diagnostics.push(
                classDiag(
                  sourceFile,
                  member,
                  `"${structName}" declares two constructors; a shader function has one body.`,
                ),
              );
              continue;
            }
            ctor = member;
            // A parameter property is a field, declared where the constructor stands, and the
            // constructor assigns it from its parameter before anything else (Rule 8.14).
            for (const p of member.parameters) {
              if (!ts.isParameterPropertyDeclaration(p, member)) continue;
              const field = parameterPropertyField(p, structName, sourceFile, diagnostics);
              if (field === undefined) {
                if (ts.isIdentifier(p.name)) withheld.add(p.name.text);
                continue;
              }
              if (!claimField(field.name, p.name)) continue;
              if (!claimKind(field.name, 'field', p.name, field.name)) continue;
              fields.push(field);
              paramProps.push(field.name);
              if (isReadonlyMember(p)) readonlyFields.set(field.name, member.parent);
              const access = keywordAccessOf(p);
              if (access !== undefined) {
                restrictedFields.set(field.name, { access, owner: member.parent });
              }
              recordDeclaration(symbols, sourceFile, p.name, {
                name: field.name,
                kind: 'field',
                type: field.type,
                struct: structName,
              });
            }
            continue;
          }
          if (ts.isMethodDeclaration(member)) {
            if (!member.body) continue; // an overload signature
            const isStatic = isStaticMember(member);
            if (isStatic) staticFunctions++;
            const memberName = writtenMemberName(member.name);
            if (memberName === undefined) {
              diagnostics.push(memberNameDiag(sourceFile, member, structName));
              continue;
            }
            const twice =
              `"${structName}.${memberName}" is declared twice; a method has one body ` +
              `and no overloads.`;
            if (!claimFunction(emittedMemberName(memberName), memberName, member.name, twice))
              continue;
            if (
              !claimKind(
                `${isStatic ? 'static ' : ''}${memberName}`,
                'method',
                member.name,
                memberName,
              )
            )
              continue;
            methods.push(member);
            continue;
          }
          // A getter and a setter are two functions of the module, `Cls_get_x` and `Cls_set_x`
          // (Rule 8.11); `o.x` calls the one and `o.x = v` the other.
          if (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
            if (!member.body) continue; // an abstract accessor: the class that implements it has the body
            const isStatic = isStaticMember(member);
            if (isStatic) staticFunctions++;
            const memberName = writtenMemberName(member.name);
            if (memberName === undefined) {
              diagnostics.push(memberNameDiag(sourceFile, member, structName));
              continue;
            }
            const half = ts.isGetAccessorDeclaration(member) ? 'get' : 'set';
            const shownAs = `${isStatic ? 'static ' : ''}${half} ${memberName}`;
            const twice = `"${structName}.${memberName}" has two ${half}ters; an accessor has one body.`;
            if (
              !claimFunction(
                `${half}_${emittedMemberName(memberName)}`,
                shownAs,
                member.name,
                twice,
              )
            )
              continue;
            if (
              !claimKind(
                `${isStatic ? 'static ' : ''}${memberName}`,
                'accessor',
                member.name,
                memberName,
              )
            )
              continue;
            accessors.push(member);
            continue;
          }
          // A static block runs once, when the class is evaluated. It was passed over in silence,
          // so a static field it assigned kept the value its declaration wrote.
          if (ts.isClassStaticBlockDeclaration(member)) {
            diagnostics.push(
              classDiag(
                sourceFile,
                member,
                `A static block runs when the class is defined, and a shader has no such moment. ` +
                  `Give each static field its value where it is declared.`,
              ),
            );
            continue;
          }
          if (ts.isIndexSignatureDeclaration(member)) {
            diagnostics.push(
              classDiag(
                sourceFile,
                member,
                `An index signature has no layout; a struct is exactly the fields written here.`,
              ),
            );
            continue;
          }
          if (!ts.isPropertyDeclaration(member)) continue;
          const memberName = writtenMemberName(member.name);
          if (memberName === undefined) {
            diagnostics.push(memberNameDiag(sourceFile, member, stmt.name.text));
            continue;
          }
          // The same rule an interface member already had: a struct field is always present in
          // the buffer the host fills, so `y?: f32` describes a layout WGSL has no form for.
          // Measured before this: a class took the `?` and emitted the field as required, with no
          // diagnostic, so the three spellings of one struct disagreed about it silently.
          if (member.questionToken) {
            withheld.add(emittedMemberName(memberName));
            diagnostics.push(
              diag(
                sourceFile,
                member,
                `Optional field "${memberName}?" on "${structName}" is not supported: a ` +
                  `struct field is always present in the buffer the host fills.`,
              ),
            );
            continue;
          }
          // A static field is a module constant named `Cls_Field` (T3, #92); `module-const.ts`
          // collects and folds it, exactly as it does a top-level `const`. Before this it was
          // refused, and the fix it named was to write the const by hand. One the file writes is
          // a module variable instead, which `module-vars.ts` collects (Rule 8.13).
          // A field that holds a function is a method (Rule 8.16), a static one included.
          if (holdsFunction(member)) {
            const fn = member.initializer as ts.ArrowFunction | ts.FunctionExpression;
            const why = functionFieldRefusal(member, fn, structName, memberName);
            if (why !== undefined) {
              diagnostics.push(classDiag(sourceFile, why.at, why.message));
              continue;
            }
            const twice =
              `"${structName}.${memberName}" is declared twice; a method has one body ` +
              `and no overloads.`;
            if (!claimFunction(emittedMemberName(memberName), memberName, member.name, twice))
              continue;
            if (!claimKind(memberName, 'method', member.name, memberName)) continue;
            methods.push(methodOfField(member, fn));
            continue;
          }
          if (isStaticMember(member)) {
            if (!claimKind(`static ${memberName}`, 'field', member.name, memberName)) continue;
            // `static #n` and `static n` would be one module constant, `Cls_n` (Rule 8.12).
            const emitted = emittedMemberName(memberName);
            const prior = staticFieldNames.get(emitted);
            if (prior !== undefined && prior !== memberName) {
              diagnostics.push(
                classDiag(
                  sourceFile,
                  member.name,
                  `"${structName}.${prior}" and "${structName}.${memberName}" would both be the ` +
                    `module constant "${structName}_${emitted}": a private name is emitted ` +
                    `without its "#". Rename one of them.`,
                ),
              );
              continue;
            }
            staticFieldNames.set(emitted, memberName);
            staticFields++;
            continue;
          }
          for (const d of member.modifiers ?? []) {
            if (!ts.isDecorator(d)) continue;
            checkAttributeName(diagnostics, sourceFile, d);
            const text = d.getText(sourceFile);
            if (/@align/.test(text)) {
              diagnostics.push(diag(sourceFile, d, `@align on a field is not applied.`));
            }
          }
          // A field written without a type takes the one its initializer names (Rule 8.14):
          // `hits = 0` is an f32 by Rule 5.1's reading of a bare number, `on = false` a bool,
          // `v = vec3(0.)` and `p = new P()` the type they build. Before this such a field was
          // dropped from the struct with no diagnostic, and every read of it said it did not
          // exist.
          const type = member.type
            ? (mapTsTypeToShaderType(member.type, sourceFile, diagnostics) ??
              structT(member.type.getText(sourceFile)))
            : member.initializer !== undefined
              ? initializerType(member.initializer, sourceFile)
              : undefined;
          if (!type) {
            withheld.add(emittedMemberName(memberName));
            if (member.type === undefined) {
              diagnostics.push(
                diag(
                  sourceFile,
                  member.name,
                  member.initializer === undefined
                    ? `Field "${memberName}" on "${structName}" needs a type: write "${memberName}: T".`
                    : `Field "${memberName}" on "${structName}" needs a type, which ` +
                        `"${member.initializer.getText(sourceFile)}" does not name. Write ` +
                        `"${memberName}: T = ...".`,
                ),
              );
            }
            continue;
          }
          if (!claimField(memberName, member.name)) continue;
          if (!claimKind(memberName, 'field', member.name, memberName)) continue;
          if (isPrivateName(memberName)) {
            privateFields.set(emittedMemberName(memberName), {
              written: memberName,
              owner: member.parent,
            });
          }
          if (isReadonlyMember(member))
            readonlyFields.set(emittedMemberName(memberName), member.parent);
          const access = keywordAccessOf(member);
          if (access !== undefined) {
            restrictedFields.set(emittedMemberName(memberName), { access, owner: member.parent });
          }
          const field: StructField = { name: emittedMemberName(memberName), type };
          const loc = numberDecorator(member, 'location');
          const decos = ts.canHaveDecorators(member) ? (ts.getDecorators(member) ?? []) : [];
          const builtinArg = builtinDecoratorArg(decos);
          const builtin =
            builtinArg &&
            checkBuiltinName(diagnostics, sourceFile, builtinArg.argNode, builtinArg.name)
              ? builtinArg.name
              : undefined;
          // The TYPE rule is checked here, at the declaration, and not only where the struct
          // is used as entry IO (`lower/function.ts`): the capability a `@builtin(...)` id
          // derives is read off `m.structs` whatever the struct is used for, so a struct that
          // declares `@builtin("clip_distances")` and is never an entry parameter emitted the
          // directive and the field with no diagnostic at all.
          if (builtin) {
            checkBuiltinType(diagnostics, sourceFile, builtinArg!.argNode, builtin, type);
          }
          // The entry-IO attributes (§53). `@interpolate` rides a `@location`; `@invariant`
          // rides `@builtin("position")`, the one output WGSL lets it steady; `@blend_src`
          // rides a `@location(0)` fragment output and derives a capability. Each is checked
          // where it is written, so the message names the line rather than the emitted text.
          const interpolate = interpolateDecoratorArg(diagnostics, sourceFile, decos);
          const invariant = hasInvariantDecorator(decos);
          const blendSrc = numberDecorator(member, 'blend_src');
          if (interpolate !== undefined && loc === undefined) {
            diagnostics.push(
              diag(
                sourceFile,
                member,
                `@interpolate belongs on a @location field: it says how a VARYING is ` +
                  `interpolated, and a @builtin carries its own rule.`,
              ),
            );
          }
          if (invariant && builtin !== 'position') {
            diagnostics.push(
              diag(
                sourceFile,
                member,
                `@invariant belongs on @builtin("position"): it is WGSL's promise that this ` +
                  `position is computed the same way in two pipelines, and no other output ` +
                  `has that meaning.`,
              ),
            );
          }
          if (blendSrc !== undefined && blendSrc !== 0 && blendSrc !== 1) {
            diagnostics.push(
              diag(
                sourceFile,
                member,
                `@blend_src takes 0 or 1 — the two sources a dual-source blend mixes — ` +
                  `not ${String(blendSrc)}.`,
              ),
            );
          }
          if (loc !== undefined) (field as { location?: number }).location = loc;
          if (builtin) (field as { builtin?: string }).builtin = builtin;
          if (interpolate !== undefined && loc !== undefined) {
            // The WHOLE argument list, `flat` or `linear, centroid` — the GLSL writer needs
            // the sampling as well as the type, and storing only the type silently dropped
            // the `centroid` half.
            (field as { interpolate?: string }).interpolate = interpolate.slice(
              '@interpolate('.length,
              -1,
            );
          }
          const extra =
            (invariant && builtin === 'position' ? '@invariant ' : '') +
            (blendSrc !== undefined ? `@blend_src(${String(blendSrc)}) ` : '') +
            (interpolate !== undefined && loc !== undefined ? `${interpolate} ` : '');
          if (builtin) (field as { attr?: string }).attr = `${extra}@builtin(${builtin})`.trim();
          else if (loc !== undefined)
            (field as { attr?: string }).attr = `@location(${loc}) ${extra}`.trim();
          if (blendSrc !== undefined) (field as { blendSrc?: number }).blendSrc = blendSrc;
          fields.push(field);
          if (member.initializer !== undefined) {
            fieldInits.push({ name: field.name, type: field.type, init: member.initializer });
          }
          recordDeclaration(symbols, sourceFile, member.name, {
            name: field.name,
            kind: 'field',
            type: field.type,
            struct: structName,
          });
        }
        const members: ClassMembers | undefined =
          methods.length > 0 || accessors.length > 0 || ctor !== undefined || fieldInits.length > 0
            ? { node: stmt, methods, accessors, ctor, fieldInits, paramProps }
            : undefined;
        // Every member static and no field: a namespace (T3). An instance method or a constructor
        // needs a receiver, so a class that declares one keeps the empty-struct refusal and its
        // "write them as functions" fix. One with a base keeps the base, and is a struct after all
        // when the base has fields (`applyInheritance`): `class Derived extends Base { static J =
        // 1. }` lost its base, and every static it inherits, as a namespace (Rule 8.13).
        const isNamespace =
          fields.length === 0 &&
          staticFunctions + staticFields > 0 &&
          methods.length + accessors.length === staticFunctions &&
          ctor === undefined
            ? (true as const)
            : undefined;
        add(
          structName,
          declared,
          fields,
          'class',
          before,
          members,
          isNamespace,
          bases,
          isAbstract,
          instance.binding,
          {
            node: stmt,
            privateFields,
            withheld,
            withheldFunctions,
            readonlyFields,
            restrictedFields,
            ...(instance.binding !== undefined ? { staticHolder: written } : {}),
          },
        );
        // A static of a generic class cannot mention the class's type parameters — TypeScript
        // refuses that outright (TS2302) — so it is ONE function, not one per instance. It is
        // carried by a fieldless collection under the class's own name, which is the shape a
        // class of only statics already takes (T3, #92); that is what makes `Op.unit()` resolve
        // while `Op` itself names no layout. Emitted from the first instance, so a class the
        // file writes at three types still contributes each static once.
        if (instance === cases[0] && genericParams.has(written) && staticFunctions > 0) {
          add(
            written,
            declared,
            [],
            'class',
            diagnostics.length,
            members && {
              node: members.node,
              methods: members.methods.filter(isStaticMember),
              accessors: members.accessors.filter(isStaticMember),
              ctor: undefined,
              fieldInits: [],
              paramProps: [],
            },
            true,
            [],
            undefined,
            undefined,
            {
              node: stmt,
              privateFields: new Map(),
              withheld: new Set(),
              withheldFunctions: new Set(),
              readonlyFields: new Map(),
              restrictedFields: new Map(),
            },
          );
        }
      } finally {
        unbind();
      }
    }
  }
  const inherited = applyInheritance(out, sourceFile, nodeOf, diagnostics);
  // Struct-WIDE, so it belongs here and not in the per-entry walk: the same struct is a
  // vertex output and a fragment input, and raising a slot collision or a bool varying from
  // there printed one mistake twice, word for word (§53). `function.ts` keeps the checks that
  // read the STAGE, which genuinely differ between the two uses.
  //
  // AFTER `applyInheritance`, because a base's fields are spliced in there: `class VsOut
  // extends Base` with `@location(0)` on each side is one struct with two members at one slot,
  // and checking the class's own fields alone walked straight past it (Tint:
  // `'@location(0)' appears multiple times`).
  for (const s of inherited) {
    checkLocationSlots(
      diagnostics,
      sourceFile,
      nodeOf.get(s.decl.name),
      s.decl.name,
      s.decl.fields,
    );
  }
  checkOverrideKinds(sourceFile, diagnostics);
  return inherited;
}

function classDiag(sf: ts.SourceFile, node: ts.Node, message: string): TsCompilerDiagnostic {
  return makeDiagnostic(sf, node, message, TS_CODES.CLASS_MEMBER);
}

/** `a field`, `a method`, `an accessor`. */
const a = (kind: string): string => (/^[aeiou]/.test(kind) ? `an ${kind}` : `a ${kind}`);

/** What TypeScript tells a class member apart as where a class that extends declares it again:
 *  a field (a parameter property is one), a field that holds a function (a method here, Rule
 *  8.16, and a property to TypeScript), a method, or an accessor. */
type OverrideKind = 'field' | 'field that holds a function' | 'method' | 'accessor';

function overrideKindOf(d: ts.ClassElement | ts.ParameterDeclaration): OverrideKind | undefined {
  if (ts.isParameter(d)) return 'field';
  if (ts.isPropertyDeclaration(d))
    return holdsFunction(d) ? 'field that holds a function' : 'field';
  if (ts.isMethodDeclaration(d)) return 'method';
  if (ts.isGetAccessorDeclaration(d) || ts.isSetAccessorDeclaration(d)) return 'accessor';
  return undefined;
}

/** Whether TypeScript lets a member of kind `mine` stand where the class above declares one of
 *  kind `theirs`: the same kind, a property over a method, and a field over an abstract accessor.
 *  It refuses the rest: TS2423, TS2425 and TS2426 between a method and a property or an
 *  accessor, TS2610 and TS2611 between a property and an accessor, and TS2416 between a field of
 *  a shader type and a function. An accessor over an abstract field is the one TypeScript takes
 *  and this does not (see `checkOverrideKinds`). */
function mayOverride(mine: OverrideKind, theirs: OverrideKind, abstract: boolean): boolean {
  if (mine === theirs) return true;
  if (mine === 'field that holds a function' && theirs === 'method') return true;
  return abstract && mine === 'field' && theirs === 'accessor';
}

/** A member a class that extends declares again as another kind than the class above declares
 *  it, and `super.f` where the `f` above is a field that holds a function, which is the object's
 *  own (TS2855): what TypeScript refuses, and what would otherwise compile to one class's member
 *  where TypeScript's object holds the other's (Rule 8.16). Read off each declaration once, so a
 *  generic class says it once however many instances the file writes. */
function checkOverrideKinds(sourceFile: ts.SourceFile, diagnostics: TsCompilerDiagnostic[]): void {
  const ownerOf = (d: ts.ClassElement | ts.ParameterDeclaration): string => {
    const cls = ts.isParameter(d) ? d.parent.parent : d.parent;
    return ts.isClassLike(cls) && cls.name !== undefined ? cls.name.text : '';
  };
  const visit = (node: ts.Node): void => {
    ts.forEachChild(node, visit);
    if (!ts.isClassDeclaration(node) || node.name === undefined) return;
    const base = baseClassOf(node);
    if (base === undefined) return;
    const cls = node.name.text;
    const said = new Set<string>();
    const check = (name: string, mine: OverrideKind, at: ts.Node): void => {
      if (said.has(name) || isPrivateName(name)) return;
      const prior = memberDeclarationInChain(base, name, false);
      const theirs = prior === undefined ? undefined : overrideKindOf(prior);
      if (prior === undefined || theirs === undefined) return;
      const abstract =
        (ts.getCombinedModifierFlags(prior as ts.Declaration) & ts.ModifierFlags.Abstract) !== 0;
      if (mayOverride(mine, theirs, abstract)) return;
      said.add(name);
      const owner = ownerOf(prior);
      // TypeScript takes an accessor over an abstract field, which it emits nothing for. Here
      // the field is a member of every struct below it, and a body the base wrote would read
      // that member, never the accessor: 0 where TypeScript computes the getter's value.
      const type = ts.isPropertyDeclaration(prior) ? prior.type?.getText(sourceFile) : undefined;
      diagnostics.push(
        classDiag(
          sourceFile,
          at,
          abstract && mine === 'accessor' && theirs === 'field'
            ? `"${cls}.${name}" is an accessor, and the "${owner}.${name}" it overrides is an ` +
                `abstract field, which every struct below "${owner}" holds as a member, so a ` +
                `read of it would never reach the accessor. Declare it in "${owner}" as ` +
                `"abstract get ${name}(): ${type ?? 'T'}".`
            : `"${cls}.${name}" is ${a(mine)}, and the "${owner}.${name}" it overrides is ` +
                `${a(theirs)}; TypeScript refuses an override of another kind. Declare it as ` +
                `${a(theirs)}, or rename it.`,
        ),
      );
    };
    for (const m of node.members) {
      if (ts.isConstructorDeclaration(m)) {
        for (const p of m.parameters) {
          if (ts.isIdentifier(p.name) && ts.isParameterPropertyDeclaration(p, m)) {
            check(p.name.text, 'field', p.name);
          }
        }
        continue;
      }
      if (m.name === undefined || isStaticMember(m)) continue;
      const name = writtenMemberName(m.name);
      const mine = overrideKindOf(m);
      if (name !== undefined && mine !== undefined) check(name, mine, m.name);
    }
    // `super` in an instance member's body, an arrow function's included; a nested class and a
    // `function` have a `super` of their own, or none.
    const walk = (n: ts.Node): void => {
      if (ts.isClassLike(n) || ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n)) return;
      if (ts.isPropertyAccessExpression(n) && n.expression.kind === ts.SyntaxKind.SuperKeyword) {
        const name = n.name.text;
        const prior = memberDeclarationInChain(base, name, false);
        if (prior !== undefined && ts.isPropertyDeclaration(prior) && holdsFunction(prior)) {
          diagnostics.push(
            classDiag(
              sourceFile,
              n,
              `"super.${name}" names a field that holds a function, and a field is the object's ` +
                `own, which "super" does not reach. Declare "${ownerOf(prior)}.${name}" as a ` +
                `method, or write "this.${name}".`,
            ),
          );
        }
      }
      ts.forEachChild(n, walk);
    };
    for (const m of node.members) if (!isStaticMember(m)) ts.forEachChild(m, walk);
  };
  visit(sourceFile);
}

/** The type a field written without one takes from its initializer, or `undefined` when the
 *  initializer does not name one (Rule 8.14). Read off the syntax, since no scope exists yet to
 *  lower it in: a bare number is an `f32` (Rule 5.1, the reading `let n = 0` gets), `true` and
 *  `false` a `bool`, `new P()` the struct it builds, and a type's own constructor, `vec3(0.)` or
 *  `u32(1)`, that type. A call to anything else could return anything, so it is not guessed at. */
function initializerType(init: ts.Expression, sourceFile: ts.SourceFile): ShaderType | undefined {
  let e = init;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (
    ts.isPrefixUnaryExpression(e) &&
    (e.operator === ts.SyntaxKind.MinusToken || e.operator === ts.SyntaxKind.PlusToken)
  ) {
    e = e.operand;
  }
  if (ts.isNumericLiteral(e)) return f32T;
  if (e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword) return boolT;
  if (ts.isNewExpression(e) && ts.isIdentifier(e.expression)) {
    return structT(newInstanceName(e, e.expression.text, sourceFile) ?? e.expression.text);
  }
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.typeArguments === undefined) {
    return lookupTypeName(e.expression.text);
  }
  return undefined;
}

/** The field a constructor's parameter property declares (Rule 8.14), or `undefined` when it
 *  declares none this surface can lay out. A parameter whose annotation does not map says so at
 *  the parameter, where the constructor's signature is read; saying it here as well would be
 *  the one mistake twice (Rule 12.4). */
function parameterPropertyField(
  p: ts.ParameterDeclaration,
  owner: string,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): StructField | undefined {
  if (!ts.isIdentifier(p.name)) return undefined; // TypeScript's own TS1187
  const name = p.name.text;
  const decorated = ts.canHaveDecorators(p) ? (ts.getDecorators(p) ?? []) : [];
  if (decorated.length > 0) {
    diagnostics.push(
      classDiag(
        sourceFile,
        decorated[0]!,
        `A decorator on the parameter property "${name}" decorates the parameter, not the ` +
          `field. Declare "${name}" as a field of "${owner}" to give it one.`,
      ),
    );
    return undefined;
  }
  if (p.questionToken) {
    diagnostics.push(
      diag(
        sourceFile,
        p,
        `Optional field "${name}?" on "${owner}" is not supported: a struct field is always ` +
          `present in the buffer the host fills.`,
      ),
    );
    return undefined;
  }
  if (p.type === undefined) return undefined;
  const type = mapTsTypeToShaderType(p.type, sourceFile, undefined);
  if (type === undefined) return undefined;
  return { name, type };
}

/** The interface / object-type-alias declaration a statement is, or undefined. Generic ones
 *  are candidates too: whether they deserve a diagnostic depends on whether anything refers
 *  to them, which is not known here. */
function candidateOf(stmt: ts.Statement): Candidate | undefined {
  if (ts.isInterfaceDeclaration(stmt)) {
    return {
      name: stmt.name.text,
      nameNode: stmt.name,
      members: stmt.members,
      spelling: 'interface',
      generic: (stmt.typeParameters?.length ?? 0) > 0,
      heritage: stmt.heritageClauses,
    };
  }
  if (ts.isTypeAliasDeclaration(stmt) && ts.isTypeLiteralNode(stmt.type)) {
    return {
      name: stmt.name.text,
      nameNode: stmt.name,
      members: stmt.type.members,
      spelling: 'type',
      generic: (stmt.typeParameters?.length ?? 0) > 0,
      heritage: undefined,
    };
  }
  return undefined;
}

function collectCandidates(sourceFile: ts.SourceFile): Map<string, Candidate> {
  const out = new Map<string, Candidate>();
  for (const stmt of sourceFile.statements) {
    const candidate = candidateOf(stmt);
    // First declaration wins the map slot; a second one of the same name is reported by `add`.
    if (candidate && !out.has(candidate.name)) out.set(candidate.name, candidate);
  }
  return out;
}

/** Every type name mentioned anywhere under `node`, including type arguments, so
 *  `uniform<Camera>` and `storage<array<P>>` both yield their element name. */
function eachTypeName(node: ts.Node, f: (name: string) => void): void {
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) f(node.typeName.text);
  node.forEachChild((child) => {
    // A type parameter's constraint and default describe what an argument may be, and no
    // value has them: `<T extends HasArea>` names a contract, which an interface with methods
    // is (Rule 6.9). The type the parameter is bound to is what a call consumes.
    if (ts.isTypeParameterDeclaration(child)) return;
    eachTypeName(child, f);
  });
}

/** The candidate names a program actually USES as a struct.
 *
 *  The roots are the places a type is CONSUMED: a `declare` binding's `uniform<T>` /
 *  `storage<T>` argument, a parameter or return annotation, a local annotation, a class
 *  field's type, a module const's annotation. From there it closes over the fields of the
 *  candidates already reached, so a struct referenced only as another struct's field is found
 *  too. A name nothing consumes stays exactly as invisible as it was before interfaces and
 *  aliases were collected at all.
 *
 *  What is NOT a root is another TYPE DECLARATION. `type Params = Config` mentions `Config`
 *  and consumes nothing, and rooting on it made a dead alias enough to pull a host-shaped
 *  `Config` into the collector: `type Config = { seed: number }` next to an unused
 *  `type Params = Config` compiles on main and reported TS8002 here. The same went for
 *  `Config[]`, `Config | undefined` and `Readonly<Config>` — every way a declaration can name
 *  a type without a value ever having it. */
function reachableCandidates(
  sourceFile: ts.SourceFile,
  candidates: ReadonlyMap<string, Candidate>,
): Set<string> {
  const reachable = new Set<string>();
  const pending: string[] = [];
  const see = (name: string): void => {
    if (!candidates.has(name) || reachable.has(name)) return;
    reachable.add(name);
    pending.push(name);
  };
  for (const stmt of sourceFile.statements) {
    // Every type DECLARATION is skipped, not just the candidates: an alias or an interface
    // that mentions a name is describing a type, not using one, and a chain of dead aliases
    // must not make a candidate reachable. A candidate's own members are walked below,
    // through the fixpoint, and only once something has actually reached it.
    if (ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)) continue;
    eachTypeName(stmt, see);
  }
  // A class is always collected, and a base it names must be too: an `extends` clause holds an
  // expression rather than a type node, so the walk above does not see it (T5, #92).
  for (const stmt of sourceFile.statements) {
    if (!ts.isClassDeclaration(stmt)) continue;
    eachHeritageName(stmt.heritageClauses, see);
  }
  while (pending.length > 0) {
    const candidate = candidates.get(pending.pop()!);
    if (!candidate) continue;
    for (const member of candidate.members) {
      if (ts.isPropertySignature(member) && member.type) eachTypeName(member.type, see);
    }
    eachHeritageName(candidate.heritage, see);
  }
  return reachable;
}

/** The names an `extends` clause writes. `implements` is left alone: it carries no layout, so
 *  an interface named only there is not a struct this file has to collect. */
function eachHeritageName(
  clauses: readonly ts.HeritageClause[] | undefined,
  f: (name: string) => void,
): void {
  for (const h of clauses ?? []) {
    if (h.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    for (const type of h.types) if (ts.isIdentifier(type.expression)) f(type.expression.text);
  }
}

/** What an `extends` clause comes to, or `undefined` after reporting one this cannot follow
 *  (roadmap 0.3 item T5, #92). `implements` carries no layout and is left alone, as before.
 *
 *  A base written with type arguments is the instance struct they name: `extends Box<f32>`
 *  inherits from `Box_f32`, which the same walk that found the annotation collected (T9, #92).
 *  A base that is a CALL is the mixin pattern, and is run rather than refused (T8) — see
 *  `mixins.ts` for what running it means. */
function basesOf(
  name: string,
  clauses: readonly ts.HeritageClause[] | undefined,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): MixinApplication | undefined {
  const extendsClause = clauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword);
  if (!extendsClause) return { bases: [], bodies: [] };
  const out: string[] = [];
  const bodies: ts.ClassExpression[] = [];
  for (const type of extendsClause.types) {
    if (type.typeArguments && type.typeArguments.length > 0) {
      // `class Small extends Box<f32>` inherits from the instance, not from the generic class:
      // `Box_f32` is a layout and `Box` is not one (T9, #92). Before that item a base with type
      // arguments was refused outright, with "one declaration per argument set" as the reason —
      // which is exactly what this now is.
      const instance = ts.isIdentifier(type.expression)
        ? genericStructName(type.expression.text, type.typeArguments, sourceFile)
        : undefined;
      if (instance === undefined) {
        diagnostics.push(
          diag(
            sourceFile,
            type,
            `"${name}" extends "${type.getText(sourceFile)}", which names no layout. A base has ` +
              `to be a class this file declares, at type arguments it can resolve.`,
          ),
        );
        return undefined;
      }
      out.push(instance);
      continue;
    }
    if (isMixinHeritage(type.expression, sourceFile)) {
      const applied = applyMixins(name, type.expression, sourceFile, diagnostics);
      if (applied === undefined) return undefined;
      out.push(...applied.bases);
      bodies.push(...applied.bodies);
      continue;
    }
    if (!ts.isIdentifier(type.expression)) {
      diagnostics.push(
        diag(
          sourceFile,
          type,
          `"${name}" extends an expression. A base has to be a declared class or interface ` +
            `here, or a mixin: a call to a function of this file whose body is one ` +
            `"return class … { … }".`,
        ),
      );
      return undefined;
    }
    out.push(type.expression.text);
  }
  return { bases: out, bodies };
}

/** Splice each struct's bases into it, base fields first (roadmap 0.3 item T5, #92). Runs
 *  after the whole file is collected, because TypeScript lets a derived declaration stand
 *  above its base, and resolves depth first so a chain of three inherits the whole prefix.
 *
 *  A field the derived redeclares with the base's type is the same field and keeps the base's
 *  place, which is TypeScript's own rule; one that redeclares it with a different type is
 *  refused, since a struct has one layout and two use sites would disagree about it. */
function applyInheritance(
  structs: readonly CollectedStruct[],
  sourceFile: ts.SourceFile,
  nodeOf: ReadonlyMap<string, ts.Node>,
  diagnostics: TsCompilerDiagnostic[],
): CollectedStruct[] {
  const byName = new Map(structs.map((s) => [s.decl.name, s]));
  /** A struct's fields once its chain is spliced in, and which of them are private (Rule 8.12). */
  interface Resolved {
    readonly fields: readonly StructField[];
    readonly privates: ReadonlyMap<string, PrivateField>;
    readonly withheld: ReadonlySet<string>;
    readonly readonlyFields: ReadonlyMap<string, ts.ClassLikeDeclaration>;
    readonly restrictedFields: ReadonlyMap<string, RestrictedField>;
  }
  const done = new Map<string, Resolved>();
  const onStack: string[] = [];
  const at = (n: string): ts.Node => nodeOf.get(n) ?? sourceFile;
  const ownOf = (s: CollectedStruct): Resolved => ({
    fields: s.decl.fields,
    privates: s.privateFields ?? new Map(),
    withheld: s.withheld ?? new Set(),
    readonlyFields: s.readonlyFields ?? new Map(),
    restrictedFields: s.restrictedFields ?? new Map(),
  });

  const resolve = (name: string): Resolved => {
    const cached = done.get(name);
    if (cached) return cached;
    const struct = byName.get(name);
    if (!struct) {
      return {
        fields: [],
        privates: new Map(),
        withheld: new Set(),
        readonlyFields: new Map(),
        restrictedFields: new Map(),
      };
    }
    if (onStack.includes(name)) {
      diagnostics.push(
        diag(
          sourceFile,
          at(name),
          `"${name}" extends itself, through ${[...onStack.slice(onStack.indexOf(name)), name]
            .map((n) => `"${n}"`)
            .join(' -> ')}. A struct cannot contain its own fields.`,
        ),
      );
      done.set(name, ownOf(struct));
      return ownOf(struct);
    }
    onStack.push(name);
    const fields: StructField[] = [];
    const privates = new Map<string, PrivateField>();
    const withheld = new Set<string>(struct.withheld ?? []);
    const readonlyFields = new Map<string, ts.ClassLikeDeclaration>();
    const restrictedFields = new Map<string, RestrictedField>();
    const seen = new Map<
      string,
      { field: StructField; from: string; private: PrivateField | undefined }
    >();
    const put = (f: StructField, from: string, priv: PrivateField | undefined): void => {
      const prior = seen.get(f.name);
      if (prior === undefined) {
        seen.set(f.name, { field: f, from, private: priv });
        fields.push(f);
        if (priv !== undefined) privates.set(f.name, priv);
        return;
      }
      // A private field is its class's own: a derived class may declare the same `#n` again,
      // or a plain `n`, and TypeScript keeps the two apart. Here both would be the member `n`.
      if (prior.private !== undefined || priv !== undefined) {
        if (prior.private?.owner === priv?.owner) return;
        withheld.add(f.name);
        diagnostics.push(
          diag(
            sourceFile,
            at(name),
            `"${prior.from}" declares "${prior.private?.written ?? f.name}" and "${from}" ` +
              `declares "${priv?.written ?? f.name}", which would both be the struct member ` +
              `"${f.name}": a private name is emitted without its "#". Rename one of them.`,
          ),
        );
        return;
      }
      if (typeKeyOf(prior.field.type) === typeKeyOf(f.type)) return;
      diagnostics.push(
        diag(
          sourceFile,
          at(name),
          `"${from}" declares "${f.name}" as ${typeKeyOf(f.type)}, and "${prior.from}" declares ` +
            `it as ${typeKeyOf(prior.field.type)}. A struct has one layout, so a field cannot ` +
            `change type on the way down.`,
        ),
      );
    };
    for (const base of struct.bases ?? []) {
      if (!byName.has(base)) {
        diagnostics.push(
          diag(
            sourceFile,
            at(name),
            `"${name}" extends "${base}", which this file does not declare as a struct. A base ` +
              `has to be a class or an interface whose fields are shader types.`,
          ),
        );
        continue;
      }
      const above = resolve(base);
      for (const w of above.withheld) withheld.add(w);
      for (const [f, cls] of above.readonlyFields) readonlyFields.set(f, cls);
      for (const [f, r] of above.restrictedFields) restrictedFields.set(f, r);
      for (const f of above.fields) put(f, base, above.privates.get(f.name));
    }
    for (const f of struct.decl.fields) put(f, name, struct.privateFields?.get(f.name));
    for (const [f, cls] of struct.readonlyFields ?? []) readonlyFields.set(f, cls);
    // A field the class declares again takes the class's own modifier: `limit: f32 = 5.` over a
    // base's `protected limit` makes it public, as TypeScript allows (Rule 8.15).
    for (const f of struct.decl.fields) {
      if (!(struct.restrictedFields?.has(f.name) ?? false)) restrictedFields.delete(f.name);
    }
    for (const [f, r] of struct.restrictedFields ?? []) restrictedFields.set(f, r);
    onStack.pop();
    const resolved = { fields, privates, withheld, readonlyFields, restrictedFields };
    done.set(name, resolved);
    return resolved;
  };

  const out = structs.map((s): CollectedStruct => {
    const { fields, privates, withheld, readonlyFields, restrictedFields } = resolve(s.decl.name);
    if (fields === s.decl.fields) return s;
    // A class of statics alone that extends a struct is a struct: it has its base's fields, and
    // `new` builds one (Rule 8.13). Over a chain of such classes it stays a namespace.
    const { namespace: _namespace, ...rest } = s;
    return {
      ...(fields.length > 0 ? rest : s),
      decl: { ...s.decl, fields },
      ...(privates.size > 0 ? { privateFields: privates } : {}),
      ...(withheld.size > 0 ? { withheld } : {}),
      ...(readonlyFields.size > 0 ? { readonlyFields } : {}),
      ...(restrictedFields.size > 0 ? { restrictedFields } : {}),
    };
  });
  // The empty-struct rule is checked here for a declaration with a base, since what it
  // inherits is only known now.
  for (const s of out) {
    if (s.namespace || s.decl.fields.length > 0 || (s.bases ?? []).length === 0) continue;
    diagnostics.push(
      diag(
        sourceFile,
        at(s.decl.name),
        `Struct "${s.decl.name}" has no fields, and neither has what it extends. WGSL requires ` +
          `a struct to declare at least one member.`,
      ),
    );
  }
  return out;
}

/** Why the function a field holds cannot be a method, with the fix; undefined when it can. */
function functionFieldRefusal(
  member: ts.PropertyDeclaration,
  fn: ts.ArrowFunction | ts.FunctionExpression,
  structName: string,
  memberName: string,
): { at: ts.Node; message: string } | undefined {
  const shown = `${structName}.${memberName}`;
  if (isStaticMember(member)) {
    return {
      at: member,
      message:
        `A static field holding a function is a static method: write ` +
        `"static ${memberName}(...) { ... }".`,
    };
  }
  if ((fn.typeParameters?.length ?? 0) > 0) {
    return {
      at: fn,
      message:
        `"${shown}" takes type parameters, and a method does not; write it as a generic ` +
        `function of the module.`,
    };
  }
  // The sentence a method of the same shape gets.
  if (
    (ts.isFunctionExpression(fn) && fn.asteriskToken !== undefined) ||
    fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
  ) {
    return { at: fn, message: `"${shown}" is a plain method or nothing: no async, no generator.` };
  }
  if (!ts.isBlock(fn.body) && fn.type === undefined) {
    return {
      at: fn,
      message:
        `"${shown}" returns a value straight away, so it needs a return type: write ` +
        `"(x: f32): f32 => ...".`,
    };
  }
  return undefined;
}

/** The method a field that holds a function is: the field's name and modifiers, the function's
 *  parameters, return type and body, an expression body being a `return` of it. Its nodes are
 *  the source's own, so what is said about them is said where they are written. */
function methodOfField(
  member: ts.PropertyDeclaration,
  fn: ts.ArrowFunction | ts.FunctionExpression,
): ts.MethodDeclaration {
  const setParent = (node: ts.Node, parent: ts.Node): void => {
    (node as { parent: ts.Node }).parent = parent;
  };
  // Only the nodes made here are given a parent. The author's own keep theirs: the language
  // service hands the compiler the tree TypeScript's checker binds, whose name lookup walks up
  // those pointers, and a body moved under a method the binder never saw loses its
  // parameters (TS2304 "Cannot find name 'p'" on every read of one).
  let body: ts.Block;
  if (ts.isBlock(fn.body)) body = fn.body;
  else {
    const ret = ts.setTextRange(ts.factory.createReturnStatement(fn.body), fn.body);
    body = ts.setTextRange(ts.factory.createBlock([ret], true), fn.body);
    setParent(ret, body);
  }
  const modifiers = (ts.getModifiers(member) ?? []).filter(
    (m) =>
      m.kind === ts.SyntaxKind.PublicKeyword ||
      m.kind === ts.SyntaxKind.PrivateKeyword ||
      m.kind === ts.SyntaxKind.ProtectedKeyword ||
      m.kind === ts.SyntaxKind.OverrideKeyword,
  );
  const method = ts.setTextRange(
    ts.factory.createMethodDeclaration(
      modifiers,
      undefined,
      member.name,
      undefined,
      undefined,
      // `function (this: A)` types `this`; it is not a parameter anything passes.
      ts.factory.createNodeArray(
        fn.parameters.filter(
          (p, i) => !(i === 0 && ts.isIdentifier(p.name) && p.name.text === 'this'),
        ),
      ),
      fn.type,
      body,
    ),
    member,
  );
  setParent(method, member.parent);
  if (body !== fn.body) setParent(body, method);
  return method;
}

function memberNameDiag(
  sourceFile: ts.SourceFile,
  member: ts.Node,
  owner: string,
): TsCompilerDiagnostic {
  return diag(
    sourceFile,
    member,
    `Field names on "${owner}" must be plain identifiers: a WGSL struct member has no other ` +
      `spelling, and a quoted or computed name would not reach the emitted layout.`,
  );
}

/** The fields of a `type X = { … }` or an `interface X { … }`. The member list is the field
 *  list: no decorator can reach a type-literal or interface member, so there is no
 *  `@location` / `@builtin` / `@align` handling here and a struct that needs per-field
 *  metadata (entry I/O in particular) stays a class. The shapes that would otherwise lose
 *  meaning on the way to a WGSL struct — a method, a call or index signature, an optional
 *  member, a quoted name — are named rather than dropped. */
function signatureFields(
  members: readonly ts.TypeElement[],
  owner: string,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  symbols?: DeclaredSymbolSink,
): StructField[] {
  const fields: StructField[] = [];
  for (const member of members) {
    if (ts.isMethodSignature(member)) {
      diagnostics.push(
        diag(
          sourceFile,
          member,
          `"${owner}" declares a method, so it is a contract a class implements and not a ` +
            `value a shader holds: take the class that implements it, or a type parameter it ` +
            `constrains, "<T extends ${owner}>(v: T)".`,
        ),
      );
      continue;
    }
    if (ts.isCallSignatureDeclaration(member) || ts.isConstructSignatureDeclaration(member)) {
      diagnostics.push(
        diag(
          sourceFile,
          member,
          `Data type "${owner}" cannot be callable or constructable — a struct is data, and a ` +
            `signature has no layout.`,
        ),
      );
      continue;
    }
    if (ts.isIndexSignatureDeclaration(member)) {
      diagnostics.push(
        diag(
          sourceFile,
          member,
          `Data type "${owner}" cannot have an index signature. Use array<T, N> for a field of many.`,
        ),
      );
      continue;
    }
    if (!ts.isPropertySignature(member)) continue;
    if (!ts.isIdentifier(member.name)) {
      diagnostics.push(memberNameDiag(sourceFile, member, owner));
      continue;
    }
    if (member.questionToken) {
      diagnostics.push(
        diag(
          sourceFile,
          member,
          `Optional field "${member.name.text}?" on "${owner}" is not supported: a struct field ` +
            `is always present in the buffer the host fills.`,
        ),
      );
      continue;
    }
    const type = member.type
      ? (mapTsTypeToShaderType(member.type, sourceFile, diagnostics) ??
        structT(member.type.getText(sourceFile)))
      : undefined;
    if (!type) continue;
    fields.push({ name: member.name.text, type });
    recordDeclaration(symbols, sourceFile, member.name, {
      name: member.name.text,
      kind: 'field',
      type,
      struct: owner,
    });
  }
  return fields;
}

function numberDecorator(node: ts.Node, name: string): number | undefined {
  for (const d of ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : []) {
    if (!ts.isCallExpression(d.expression)) continue;
    if (!ts.isIdentifier(d.expression.expression) || d.expression.expression.text !== name)
      continue;
    const a = d.expression.arguments[0];
    if (a && ts.isNumericLiteral(a)) return Number(a.text);
  }
  return undefined;
}

function diag(sf: ts.SourceFile, node: ts.Node, message: string): TsCompilerDiagnostic {
  return makeDiagnostic(sf, node, message, TS_CODES.STRUCT_FIELD);
}

/** Two entry-IO rules that read the struct alone, checked once per declaration.
 *
 *  A slot collision — two members at one `@location` — is refused by WGSL outright ("must not
 *  contain two entries with the same location value") and was emitted here with no diagnostic.
 *  The one shape that puts two members at one location on purpose is a DUAL-SOURCE pair,
 *  `@location(0) @blend_src(0)` beside `@location(0) @blend_src(1)`, so the slot is the
 *  location AND the blend source.
 *
 *  A `@location` carries a value between stages, which WGSL restricts to a numeric scalar or a
 *  numeric vector; {@link checkLocationType} owns that wording. */
function checkLocationSlots(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node | undefined,
  structName: string,
  fields: readonly StructField[],
): void {
  const at = node ?? sourceFile;
  const atLocation = new Map<string, string>();
  const blendSources = new Set<number>();
  for (const field of fields) {
    if (field.location === undefined) continue;
    if (field.blendSrc !== undefined) blendSources.add(field.blendSrc);
    const slot = `${String(field.location)}:${String(field.blendSrc ?? -1)}`;
    const prev = atLocation.get(slot);
    if (prev !== undefined) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          at,
          `Struct "${structName}" puts "${prev}" and "${field.name}" both at ` +
            `@location(${String(field.location)})` +
            `${field.blendSrc !== undefined ? ` @blend_src(${String(field.blendSrc)})` : ''}; ` +
            `each slot carries one value.`,
          TS_CODES.STRUCT_FIELD,
        ),
      );
    } else atLocation.set(slot, field.name);
    checkLocationType(
      diagnostics,
      sourceFile,
      at,
      `${structName}.${field.name}`,
      field.type,
      field.interpolate,
    );
  }
  // A dual-source blend mixes TWO colours, so `@blend_src` comes as a pair: WGSL requires
  // that a struct declaring one declares both, at the same `@location`. One alone emitted
  // `enable dual_source_blending;` and a single source, which is not a shape the pipeline
  // has. Stated from the spec rather than measured: the gate's adapter has no
  // `dual-source-blending` feature, so Tint answers `extension 'dual_source_blending' is not
  // allowed in the current environment` before it reaches the rule.
  if (blendSources.size === 1) {
    const only = [...blendSources][0]!;
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        at,
        `Struct "${structName}" declares @blend_src(${String(only)}) and not ` +
          `@blend_src(${String(1 - only)}); a dual-source blend mixes two colours, so both sit ` +
          `at the same @location.`,
        TS_CODES.STRUCT_FIELD,
      ),
    );
  }
}
