import ts from 'typescript';
import {
  attributeArgumentsOf,
  attributeDecoratorsOf,
  isAttributeType,
  typeDecoratorsOf,
} from './attribute-types.js';
import type { StructDecl, StructField } from '../../core/ir/nodes.js';
import type { ShaderType } from '../../core/ir/types.js';
import { boolT, f32T, structT, typeKey as typeKeyOf } from '../../core/ir/types.js';
import {
  decidedType,
  inferenceConflict,
  useInferenceActive,
  type InferredValue,
} from './use-inference.js';
import { isIntegerLiteralTree } from './lit-coerce.js';
import { hasNoWrittenType } from './abstract-const.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import { isUntypedBuiltin } from './builtin-type-form.js';
import {
  aliasTargetsOf,
  declaredTypeNamesOf,
  lookupTypeName,
  mapTsTypeToShaderType,
  refuseTypeName,
  setRefusedGenerics,
  undeclaredTypeName,
  writesRefusedType,
} from './type-map.js';
import {
  baseClassOf,
  emittedMemberName,
  holdsFunction,
  isPrivateName,
  isReadonlyMember,
  isStaticMember,
  keywordAccessOf,
  memberDeclarationInChain,
  staticThisClass,
  writtenMemberName,
  type KeywordAccess,
} from './class-names.js';
import { recordDeclaration, type DeclaredSymbolSink } from './symbols.js';
import { declaresEntry, stageCallOf } from './stage-call.js';
import { TS_CODES } from './codes.js';
import { newTargetOf } from './lower/new-target.js';
import { makeDiagnostic, noteUse } from './diagnostic.js';
import {
  readIoAttributes,
  checkAttributeName,
  checkBuiltinName,
  checkBuiltinType,
  checkLocationType,
  hasInvariantDecorator,
  interpolateDecoratorArg,
} from './builtin-check.js';
import {
  applyMixins,
  isMixinDeclaration,
  isMixinHeritage,
  mixedMembers,
  mixinShown,
  returnedClass,
  type MixinApplication,
} from './mixins.js';
import { pushTypeArguments } from './generics.js';
import {
  authorTypeText,
  programFileOf,
  useWrittenStructs,
  writtenText,
  type StructOrigin,
} from './context.js';
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
  namespaceClassAround,
  qualifiedParts,
  refuseNamespaceStatement,
} from './namespaces.js';
import { markOmittableField, optionalInner } from './optional.js';
import { optionalFieldType } from './structs/optional-field.js';
import { constructedArrayType, isArrayConstructor } from './lower/array-constructor/field-type.js';

const refusedIoFields = new WeakSet<StructField>();

export function hasRefusedIoAttribute(field: StructField): boolean {
  return refusedIoFields.has(field);
}

export type StructSpelling = 'class' | 'interface' | 'type';

export type CollectedStruct = {
  readonly decl: StructDecl;
  readonly packing: 'wgsl';
  readonly spelling: StructSpelling;
  readonly members?: ClassMembers;
  readonly namespace?: true;
  readonly bases?: readonly string[];
  readonly binding?: ReadonlyMap<string, ShaderType>;
  readonly abstract?: true;
  readonly classNode?: ts.ClassDeclaration;
  readonly privateFields?: ReadonlyMap<string, PrivateField>;
  readonly withheld?: ReadonlySet<string>;
  readonly withheldFunctions?: ReadonlySet<string>;
  readonly readonlyFields?: ReadonlyMap<string, ts.ClassLikeDeclaration>;
  readonly restrictedFields?: ReadonlyMap<string, RestrictedField>;
  readonly staticHolder?: string;
};

export interface RestrictedField {
  readonly access: KeywordAccess;
  readonly owner: ts.ClassLikeDeclaration;
}

export interface PrivateField {
  readonly written: string;
  readonly owner: ts.ClassLikeDeclaration;
}

export const emittedStructDecls = (structs: readonly CollectedStruct[]): StructDecl[] =>
  structs.filter((s) => !s.namespace).map((s) => s.decl);

export interface FieldInit {
  readonly name: string;
  readonly type: ShaderType;
  readonly init: ts.Expression;
}

export interface ClassMembers {
  readonly node: ts.ClassDeclaration;
  readonly methods: readonly ts.MethodDeclaration[];
  readonly accessors: readonly ts.AccessorDeclaration[];
  readonly ctor: ts.ConstructorDeclaration | undefined;
  readonly fieldInits: readonly FieldInit[];
  readonly paramProps: readonly string[];
}

type Candidate = {
  readonly name: string;
  readonly nameNode: ts.Identifier;
  readonly members: readonly ts.TypeElement[];
  readonly spelling: 'interface' | 'type';
  readonly generic: boolean;
  readonly heritage: readonly ts.HeritageClause[] | undefined;
};

export function collectStructs(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  symbols?: DeclaredSymbolSink,
): CollectedStruct[] {
  const genericParams = genericClasses(sourceFile);
  const instances = writtenInstances(
    sourceFile,
    genericParams,
    (node) => mapTsTypeToShaderType(node, sourceFile, undefined),
    diagnostics,
  );
  useWrittenStructs(classStructs(sourceFile, genericParams, instances));
  const candidates = collectCandidates(sourceFile);
  const reachable = reachableCandidates(sourceFile, candidates);
  const refusedGenerics = refuseGenericsOf(sourceFile, candidates);
  const out: CollectedStruct[] = [];
  const declared = new Set<string>();
  const nodeOf = new Map<string, ts.Node>();

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
    withheld: ReadonlySet<string> = klass?.withheld ?? new Set(),
  ): void => {
    const fromClass =
      klass === undefined
        ? withheld.size > 0
          ? { withheld }
          : {}
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
        makeDiagnostic(sourceFile, node, duplicateStructMessage(name), TS_CODES.DUPLICATE_SYMBOL),
      );
      return;
    }
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
    if (fields.length === 0 && bases.length === 0 && (spelling !== 'class' || withheld.size > 0)) {
      if (withheld.size > 0 && diagnostics.length === before) refuseTypeName(sourceFile, name);
      if (diagnostics.length === before && withheld.size === 0) {
        diagnostics.push(
          diag(
            sourceFile,
            node,
            `Struct "${authorTypeText(structT(name))}" has no fields. WGSL requires a struct to ` +
              `declare at least one member, so an empty one cannot be emitted.` +
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

  reportUnusedDuplicates(sourceFile, reachable, diagnostics);
  const seen: { stmt: ts.Statement; prefix: string }[] = [];
  eachNamespaceStatement(sourceFile.statements, sourceFile, [], (stmt, prefix) => {
    seen.push({ stmt, prefix });
  });
  const said = new Set<ts.Node>();
  const checked = new Set<ts.ClassLikeDeclaration>();
  const refusedFunctions = new Map<string, ReadonlySet<string>>();
  const checkMembers = (cls: ts.ClassLikeDeclaration): void => {
    if (checked.has(cls)) return;
    checked.add(cls);
    for (const { at, message } of memberShapeSentences(cls)) {
      said.add(at);
      diagnostics.push(classDiag(sourceFile, at, message));
    }
  };
  for (const { stmt, prefix } of seen) {
    if (ts.isFunctionDeclaration(stmt) && isMixinDeclaration(stmt)) {
      const body = returnedClass(stmt);
      if (body !== undefined) checkMembers(body);
      continue;
    }
    const candidate = candidateOf(stmt);
    if (candidate) {
      if (prefix !== '') {
        refuseNamespaceStatement(stmt, prefix, sourceFile, diagnostics);
        continue;
      }
      if (candidate.generic) {
        if (refusedGenerics.has(candidate.name)) {
          const refusal = diag(sourceFile, candidate.nameNode, genericCandidateMessage(candidate));
          noteTypeUses([refusal], stmt, candidate.name, sourceFile);
          diagnostics.push(refusal);
        }
        continue;
      }
      if (!reachable.has(candidate.name)) {
        for (const member of candidate.members) {
          if (ts.isPropertySignature(member)) checkUncollectedIo(member, sourceFile, diagnostics);
        }
        if (exportsDeclaration(sourceFile, stmt, candidate.name))
          checkUnusedExportedIo(candidate, sourceFile, diagnostics);
        continue;
      }
      const heritage = basesOf(candidate.name, candidate.heritage, sourceFile, diagnostics);
      if (heritage === undefined) continue;
      const before = diagnostics.length;
      recordDeclaration(symbols, sourceFile, candidate.nameNode, {
        name: candidate.name,
        kind: 'struct',
        type: structT(candidate.name),
      });
      const withheld = new Set<string>();
      add(
        candidate.name,
        candidate.nameNode,
        signatureFields(
          candidate.members,
          candidate.name,
          sourceFile,
          diagnostics,
          symbols,
          withheld,
        ),
        candidate.spelling,
        before,
        undefined,
        undefined,
        heritage.bases,
        undefined,
        undefined,
        undefined,
        withheld,
      );
      if (diagnostics.length > before)
        noteTypeUses(diagnostics.slice(before), stmt, candidate.name, sourceFile);
      continue;
    }
    if (!ts.isClassDeclaration(stmt) || !stmt.name) continue;
    checkMembers(stmt);
    const declared = stmt.name;
    const written = prefix === '' ? declared.text : namespaceMemberName(prefix, declared.text);
    const cases: readonly StructInstance[] = genericParams.has(written)
      ? (instances.get(written) ?? [])
      : [{ name: written, binding: undefined }];
    if (cases.length === 0) {
      const parameters = new Set((stmt.typeParameters ?? []).map((p) => p.name.text));
      for (const member of stmt.members) {
        if (ts.isPropertyDeclaration(member) && !isStaticMember(member) && !holdsFunction(member)) {
          checkUncollectedIo(member, sourceFile, diagnostics, parameters);
        }
      }
    }
    for (const instance of cases) {
      const structName = instance.name;
      const shownName = authorTypeText(structT(structName));
      const unbind = pushTypeArguments(instance.binding);
      try {
        recordDeclaration(symbols, sourceFile, stmt.name, {
          name: structName,
          kind: 'struct',
          type: structT(structName),
        });
        for (const d of stmt.modifiers ?? []) {
          if (!ts.isDecorator(d)) continue;
          checkAttributeName(diagnostics, sourceFile, d, 'a class');
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
        const heritage = basesOf(structName, stmt.heritageClauses, sourceFile, diagnostics);
        if (heritage === undefined) continue;
        for (const body of heritage.bodies) checkMembers(body);
        const bases = heritage.bases;
        const isAbstract =
          (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword) ?? false) ||
          undefined;
        const before = diagnostics.length;
        const fields: StructField[] = [];
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
        const functionNames = new Map<string, string>();
        const withheldFunctions = new Set<string>();
        const refused = new Set<string>();
        let sentences = 0;
        const sayOnce = (at: ts.Node, message: string): void => {
          if (said.has(at)) return;
          said.add(at);
          sentences++;
          diagnostics.push(classDiag(sourceFile, at, message));
        };
        const ownerOf = (member: ts.ClassElement): string =>
          writtenOwner(member.parent as ts.ClassLikeDeclaration);
        const shownMember = (
          member: ts.ClassElement,
          name: string,
          half?: 'get' | 'set',
        ): string => {
          const kind = `${isStaticMember(member) ? 'static ' : ''}${half ? `${half}ter ` : ''}`;
          return `${kind === '' ? '' : `the ${kind}`}"${ownerOf(member)}.${name}"`;
        };
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
          refused.add(suffix);
          sayOnce(
            at,
            prior === shownAs
              ? twice
              : `${prior.replace(/^the/, 'The')} and ${shownAs} would be emitted under one ` +
                  `name. Rename one of them.`,
          );
          return false;
        };
        const withholdAbstract = (member: ts.ClassElement, name: string): void => {
          if (abstractRefusal(member, name)?.withhold === true) {
            refused.add(emittedMemberName(name));
          }
        };
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
                ? `Field "${written}" is declared twice on "${shownName}"; a struct has one ` +
                    `member of a name.`
                : `"${shownName}" declares "${prior}" and "${written}", which would both be the ` +
                    `struct member "${emitted}": a private name is emitted without its "#". ` +
                    `Rename one of them.`,
            ),
          );
          return false;
        };
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
        for (const member of mixedMembers(
          heritage.bodies,
          stmt.members,
          sourceFile,
          diagnostics,
          shownName,
        )) {
          if (ts.isConstructorDeclaration(member)) {
            if (!member.body) continue;
            if (ctor !== undefined) continue;
            ctor = member;
            for (const p of member.parameters) {
              if (!ts.isParameterPropertyDeclaration(p, member)) continue;
              const field = parameterPropertyField(p, shownName, sourceFile, diagnostics);
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
            const memberName = writtenMemberName(member.name);
            if (!member.body) {
              if (memberName !== undefined) withholdAbstract(member, memberName);
              continue;
            }
            const isStatic = isStaticMember(member);
            if (isStatic) staticFunctions++;
            if (memberName === undefined) {
              diagnostics.push(memberNameDiag(sourceFile, member, structName));
              continue;
            }
            const shownAs = shownMember(member, memberName);
            const twice = twoBodies(ownerOf(member), memberName);
            if (!claimFunction(emittedMemberName(memberName), shownAs, member.name, twice))
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
          if (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
            const memberName = writtenMemberName(member.name);
            if (!member.body) {
              if (memberName !== undefined) withholdAbstract(member, memberName);
              continue;
            }
            const isStatic = isStaticMember(member);
            if (isStatic) staticFunctions++;
            if (memberName === undefined) {
              diagnostics.push(memberNameDiag(sourceFile, member, structName));
              continue;
            }
            const half = ts.isGetAccessorDeclaration(member) ? 'get' : 'set';
            const shownAs = shownMember(member, memberName, half);
            const twice = twoHalves(ownerOf(member), memberName, half);
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
            diagnostics.push(memberNameDiag(sourceFile, member, structName));
            continue;
          }
          if (holdsFunction(member)) {
            const fn = member.initializer as ts.ArrowFunction | ts.FunctionExpression;
            const why = functionFieldRefusal(member, fn, structName, memberName);
            if (why !== undefined) {
              diagnostics.push(classDiag(sourceFile, why.at, why.message));
              withheldFunctions.add(emittedMemberName(memberName));
              continue;
            }
            const twice = twoBodies(ownerOf(member), memberName);
            const shownAs = shownMember(member, memberName);
            if (!claimFunction(emittedMemberName(memberName), shownAs, member.name, twice))
              continue;
            if (!claimKind(memberName, 'method', member.name, memberName)) continue;
            methods.push(methodOfField(member, fn));
            continue;
          }
          if (isStaticMember(member)) {
            if (!claimKind(`static ${memberName}`, 'field', member.name, memberName)) continue;
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
          let unknownAttribute = false;
          for (const d of attributeDecoratorsOf(member)) {
            if (checkAttributeName(diagnostics, sourceFile, d, 'a struct field'))
              unknownAttribute = true;
            const text = d.getText(sourceFile);
            if (/@align/.test(text)) {
              diagnostics.push(diag(sourceFile, d, `@align on a field is not applied.`));
            }
          }
          const projected =
            member.type !== undefined &&
            member.initializer !== undefined &&
            isIntegerLiteralTree(member.initializer) &&
            hasNoWrittenType(member, sourceFile);
          const mapped =
            member.type && !projected
              ? (mapTsTypeToShaderType(member.type, sourceFile, diagnostics) ??
                (writesRefusedType(member.type, sourceFile) ||
                isUntypedBuiltin(member.type, sourceFile)
                  ? undefined
                  : structT(writtenText(member.type))))
              : member.initializer !== undefined
                ? (inferredFieldType(
                    member,
                    structName,
                    emittedMemberName(memberName),
                    sourceFile,
                    diagnostics,
                  ) ?? initializerType(member.initializer, sourceFile))
                : undefined;
          const type = optionalFieldType(
            mapped,
            member.questionToken,
            memberName,
            shownName,
            sourceFile,
            diagnostics,
          );
          if (type !== undefined && member.questionToken !== undefined) {
            markOmittableField(sourceFile, structName, emittedMemberName(memberName));
          }
          if (!type) {
            withheld.add(emittedMemberName(memberName));
            if (member.type === undefined && mapped === undefined) {
              diagnostics.push(
                diag(
                  sourceFile,
                  member.name,
                  member.initializer === undefined
                    ? `Field "${memberName}" on "${shownName}" needs a type: write "${memberName}: T".`
                    : `Field "${memberName}" on "${shownName}" needs a type, which ` +
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
          setEntryAttributes(field, member, type, sourceFile, diagnostics, unknownAttribute);
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
        const isNamespace =
          fields.length === 0 &&
          staticFunctions + staticFields > 0 &&
          [...methods, ...accessors].every(isStaticMember) &&
          ctor === undefined
            ? (true as const)
            : undefined;
        add(
          structName,
          declared,
          fields,
          'class',
          before + sentences,
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
        refusedFunctions.set(structName, refused);
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
          refusedFunctions.set(written, refused);
        }
      } finally {
        unbind();
      }
    }
  }
  const inherited = applyInheritance(
    out.map((s): CollectedStruct => {
      const more = refusedFunctions.get(s.decl.name);
      if (more === undefined || more.size === 0) return s;
      return { ...s, withheld: new Set([...(s.withheld ?? []), ...more]) };
    }),
    sourceFile,
    nodeOf,
    diagnostics,
  );
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
  return refuseStructCycles(
    withUnimplementedAbstracts(promoteClassValues(inherited, sourceFile), sourceFile, diagnostics),
    candidates,
    reachable,
    nodeOf,
    sourceFile,
    diagnostics,
  );
}

function heldStructs(t: ShaderType): string[] {
  if (t.kind === 'array') return heldStructs(t.elem);
  if (t.kind !== 'struct') return [];
  const inner = optionalInner(t);
  return inner === undefined ? [t.name] : heldStructs(inner);
}

function exportedNamesOf(sourceFile: ts.SourceFile): Set<string> {
  const out = new Set<string>();
  for (const stmt of sourceFile.statements) {
    if (
      (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) &&
      stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    )
      out.add(stmt.name.text);
    if (
      ts.isExportDeclaration(stmt) &&
      stmt.moduleSpecifier === undefined &&
      stmt.exportClause !== undefined &&
      ts.isNamedExports(stmt.exportClause)
    ) {
      for (const e of stmt.exportClause.elements) out.add((e.propertyName ?? e.name).text);
    }
  }
  return out;
}

// Why: Tint refuses a struct that holds itself, `cyclic dependency found: 'R' -> 'R'`
// (measured in headless Chromium 156 on 2026-11-10, Rule 13.3).
function refuseStructCycles(
  structs: CollectedStruct[],
  candidates: ReadonlyMap<string, Candidate>,
  reachable: ReadonlySet<string>,
  nodeOf: ReadonlyMap<string, ts.Node>,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): CollectedStruct[] {
  const collected = new Map(structs.map((s) => [s.decl.name, s]));
  const exported = exportedNamesOf(sourceFile);
  const uncollected = new Map<string, readonly StructField[]>();
  const fieldsOf = (name: string): readonly StructField[] => {
    const struct = collected.get(name);
    if (struct !== undefined) return struct.decl.fields;
    const known = uncollected.get(name);
    if (known !== undefined) return known;
    const candidate = candidates.get(name);
    if (candidate === undefined || candidate.generic) return [];
    const fields: StructField[] = [];
    uncollected.set(name, fields);
    for (const member of candidate.members) {
      if (!ts.isPropertySignature(member) || !ts.isIdentifier(member.name)) continue;
      const type = mapTsTypeToShaderType(member.type, sourceFile, []);
      if (type !== undefined) fields.push({ name: member.name.text, type });
    }
    return fields;
  };
  const checked = [
    ...structs.map((s) => s.decl.name),
    ...[...candidates.keys()].filter((name) => !reachable.has(name) && exported.has(name)),
  ];
  const roots = new Set<string>();
  const reach = (name: string): void => {
    if (roots.has(name) || (!collected.has(name) && !candidates.has(name))) return;
    roots.add(name);
    for (const field of fieldsOf(name)) heldStructs(field.type).forEach(reach);
  };
  checked.forEach(reach);
  const positionOf = (name: string): number =>
    (nodeOf.get(name) ?? candidates.get(name)?.nameNode)?.getStart(sourceFile) ?? 0;
  const order = [...roots].sort((a, b) => positionOf(a) - positionOf(b));
  const fileIndex = new Map<string, number>();
  const fileOf = (name: string): number => {
    let at = fileIndex.get(name);
    if (at === undefined) {
      const node = nodeOf.get(name) ?? candidates.get(name)?.nameNode;
      fileIndex.set(name, (at = node === undefined ? 0 : programFileOf(node)));
    }
    return at;
  };
  interface Edge {
    readonly from: string;
    readonly field: string;
    readonly to: string;
  }
  const keyOf = (from: string, field: string): string => `${from}\u0000${field}`;
  const edgesOf = (name: string, cuts: ReadonlySet<string>): Edge[] =>
    fieldsOf(name).flatMap((field) =>
      cuts.has(keyOf(name, field.name))
        ? []
        : heldStructs(field.type)
            .filter((to) => roots.has(to))
            .map((to) => ({ from: name, field: field.name, to })),
    );
  const cycleThrough = (start: string, cuts: ReadonlySet<string>): Edge[] | undefined => {
    const seen = new Set<string>([start]);
    const path: Edge[] = [];
    const find = (name: string): boolean => {
      for (const edge of edgesOf(name, cuts)) {
        path.push(edge);
        if (edge.to === start) return true;
        if (!seen.has(edge.to)) {
          seen.add(edge.to);
          if (find(edge.to)) return true;
        }
        path.pop();
      }
      return false;
    };
    return find(start) ? path : undefined;
  };
  const ownCuts = (file: number): { cycle: Edge[]; at: number }[] => {
    const cuts = new Set<string>();
    const out: { cycle: Edge[]; at: number }[] = [];
    for (const start of order) {
      if (fileOf(start) !== file) continue;
      for (let cycle = cycleThrough(start, cuts); cycle; cycle = cycleThrough(start, cuts)) {
        let at = cycle.length - 1;
        while (at > 0 && fileOf(cycle[at]!.from) !== file) at--;
        cuts.add(keyOf(cycle[at]!.from, cycle[at]!.field));
        out.push({ cycle, at });
      }
    }
    return out;
  };
  const onCycle = (edge: Edge, cuts: ReadonlySet<string>): boolean => {
    const seen = new Set<string>();
    const reaches = (name: string): boolean => {
      if (name === edge.from) return true;
      if (seen.has(name)) return false;
      seen.add(name);
      return edgesOf(name, cuts).some((e) => reaches(e.to));
    };
    return reaches(edge.to);
  };

  const cut = new Map<string, Set<string>>();
  const shownStruct = (name: string): string => authorTypeText(structT(name));
  const report = (cycle: readonly Edge[], at: number): void => {
    const { from: name, field, to: held } = cycle[at]!;
    const path = [...cycle.slice(at + 1), ...cycle.slice(0, at + 1)].map((e) => e.from);
    const written = collected.get(name)?.privateFields?.get(field)?.written ?? field;
    const root = shownStruct(held);
    diagnostics.push(
      diag(
        sourceFile,
        fieldNodeOf(name, field, collected, candidates) ?? nodeOf.get(name) ?? sourceFile,
        `Field "${shownStruct(name)}.${written}" makes "${root}" contain itself, through ` +
          `${[...path, held].map((n) => `"${shownStruct(n)}"`).join(' -> ')}. A struct has a ` +
          `fixed size, so it cannot hold itself: hold an index into an array of "${root}" ` +
          `instead, or remove the field.`,
      ),
    );
    let fields = cut.get(name);
    if (fields === undefined) cut.set(name, (fields = new Set()));
    fields.add(field);
  };
  const applied = new Set<string>();
  const files = [...new Set(order.map(fileOf))].sort((a, b) => a - b);
  for (const file of files) {
    for (const { cycle, at } of ownCuts(file)) {
      const edge = cycle[at]!;
      if (file !== 0 && !onCycle(edge, applied)) continue;
      applied.add(keyOf(edge.from, edge.field));
      report(cycle, at);
    }
  }
  if (cut.size === 0) return structs;
  return structs.map((s) => {
    const fields = cut.get(s.decl.name);
    if (fields === undefined) return s;
    return {
      ...s,
      decl: { ...s.decl, fields: s.decl.fields.filter((f) => !fields.has(f.name)) },
      withheld: new Set([...(s.withheld ?? []), ...fields]),
    };
  });
}

function fieldNodeOf(
  name: string,
  field: string,
  collected: ReadonlyMap<string, CollectedStruct>,
  candidates: ReadonlyMap<string, Candidate>,
  seen: Set<string> = new Set(),
): ts.Node | undefined {
  if (seen.has(name)) return undefined;
  seen.add(name);
  const struct = collected.get(name);
  const written = struct?.privateFields?.get(field)?.written ?? field;
  const named = (n: ts.PropertyName | ts.BindingName | undefined): boolean =>
    n !== undefined && (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) && n.text === written;
  const cls = struct?.classNode;
  if (cls !== undefined) {
    for (const member of cls.members) {
      if (ts.isPropertyDeclaration(member) && named(member.name)) return member;
      if (ts.isConstructorDeclaration(member)) {
        const param = member.parameters.find(
          (p) => ts.getModifiers(p)?.length !== undefined && named(p.name),
        );
        if (param !== undefined) return param;
      }
    }
  }
  const candidate = candidates.get(name);
  const member = candidate?.members.find((m) => ts.isPropertySignature(m) && named(m.name));
  if (member !== undefined) return member;
  for (const base of struct?.bases ?? []) {
    const found = fieldNodeOf(base, field, collected, candidates, seen);
    if (found !== undefined) return found;
  }
  return undefined;
}

function promoteClassValues(
  structs: readonly CollectedStruct[],
  sourceFile: ts.SourceFile,
): CollectedStruct[] {
  const used = new Set<string>();
  const walk = (node: ts.Node): void => {
    if (ts.isTypeReferenceNode(node)) {
      const type = mapTsTypeToShaderType(node, sourceFile, undefined);
      if (type?.kind === 'struct') used.add(type.name);
    }
    if (ts.isNewExpression(node)) {
      const target = newTargetOf(node, sourceFile);
      if (target.kind === 'class') {
        used.add(newInstanceName(node, target.flat, sourceFile) ?? target.flat);
      } else if (node.expression.kind === ts.SyntaxKind.ThisKeyword) {
        const cls = staticThisClass(node.expression);
        for (const s of structs) if (s.classNode === cls && !s.staticHolder) used.add(s.decl.name);
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sourceFile);
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of structs) {
      if (!used.has(s.decl.name) && s.bases?.some((base) => used.has(base))) {
        used.add(s.decl.name);
        changed = true;
      }
    }
  }
  return structs.map((s) => {
    if (!s.namespace || !used.has(s.decl.name)) return s;
    const { namespace: _namespace, ...value } = s;
    return value;
  });
}

function classDiag(sf: ts.SourceFile, node: ts.Node, message: string): TsCompilerDiagnostic {
  return makeDiagnostic(sf, node, message, TS_CODES.CLASS_MEMBER);
}

const a = (kind: string): string => (/^[aeiou]/.test(kind) ? `an ${kind}` : `a ${kind}`);

type OverrideKind = 'field' | 'field that holds a function' | 'method' | 'accessor';

function overrideKindOf(d: ts.ClassElement | ts.ParameterDeclaration): OverrideKind | undefined {
  if (ts.isParameter(d)) return 'field';
  if (ts.isPropertyDeclaration(d))
    return holdsFunction(d) ? 'field that holds a function' : 'field';
  if (ts.isMethodDeclaration(d)) return 'method';
  if (ts.isGetAccessorDeclaration(d) || ts.isSetAccessorDeclaration(d)) return 'accessor';
  return undefined;
}

// Why: TypeScript refuses TS2423, TS2425 and TS2426 between a method and a property or an
// accessor, TS2610 and TS2611 between a property and an accessor, and TS2416 between a field of a
// shader type and a function.
function mayOverride(mine: OverrideKind, theirs: OverrideKind, abstract: boolean): boolean {
  if (mine === theirs) return true;
  if (mine === 'field that holds a function' && theirs === 'method') return true;
  return abstract && mine === 'field' && theirs === 'accessor';
}

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

function writtenOwner(cls: ts.ClassLikeDeclaration): string {
  return ts.isClassExpression(cls) ? mixinShown(cls) : (cls.name?.text ?? '');
}

function wholeClassName(cls: ts.ClassLikeDeclaration): string {
  return ts.isClassDeclaration(cls) ? qualifiedParts(cls).join('.') : writtenOwner(cls);
}

const isAbstractNode = (n: ts.Node): boolean =>
  (ts.getCombinedModifierFlags(n as ts.Declaration) & ts.ModifierFlags.Abstract) !== 0;

const bodiesOf = (
  cls: ts.ClassLikeDeclaration,
  member: ts.ClassElement,
  name: string,
): ts.ClassElement[] =>
  cls.members.filter(
    (m) =>
      m.kind === member.kind &&
      (m as ts.FunctionLikeDeclaration).body !== undefined &&
      m.name !== undefined &&
      writtenMemberName(m.name) === name &&
      isStaticMember(m) === isStaticMember(member),
  );

const twoBodies = (owner: string, name: string): string =>
  `"${owner}.${name}" has two bodies; a method has one body, with overload signatures above it ` +
  `for each shape it takes.`;

const twoHalves = (owner: string, name: string, half: 'get' | 'set'): string =>
  `"${owner}.${name}" has two ${half}ters; an accessor has one body.`;

function abstractRefusal(
  member: ts.ClassElement,
  name: string,
): { message: string; withhold: boolean } | undefined {
  if (!isAbstractNode(member)) return undefined;
  const cls = member.parent as ts.ClassLikeDeclaration;
  const owner = writtenOwner(cls);
  const abstract = !ts.isClassExpression(cls) && isAbstractNode(cls);
  const field = ts.isPropertyDeclaration(member);
  const body = field ? member.initializer : (member as ts.FunctionLikeDeclaration).body;
  if (body !== undefined) {
    const plain = field && !holdsFunction(member);
    const or =
      abstract && (plain || !field)
        ? `, or remove the ${plain ? 'initializer' : 'body'} and let each class that extends ` +
          `"${owner}" write it.`
        : '.';
    return {
      message:
        `"${owner}.${name}" is abstract and has ${plain ? 'an initializer' : 'a body'}; remove ` +
        `"abstract"${or}`,
      withhold: false,
    };
  }
  if (field) return undefined;
  const written = bodiesOf(cls, member, name).find((m) => !isAbstractNode(m));
  if (ts.isMethodDeclaration(member) && written !== undefined) {
    return {
      message:
        `A signature of "${owner}.${name}" is abstract, and its body is not; ` +
        (member.pos < written.pos ? `remove "abstract".` : `remove the signature.`),
      withhold: false,
    };
  }
  if (abstract) return undefined;
  return {
    message: ts.isClassExpression(cls)
      ? `"${owner}.${name}" is abstract, and the class a mixin returns cannot be; remove ` +
        `"abstract" and give "${name}" a body.`
      : `"${owner}.${name}" is abstract, and "${owner}" is not; mark "${owner}" abstract, or ` +
        `remove "abstract" and give "${name}" a body.`,
    withhold: true,
  };
}

function memberShapeSentences(cls: ts.ClassLikeDeclaration): { at: ts.Node; message: string }[] {
  const owner = writtenOwner(cls);
  const out: { at: ts.Node; message: string }[] = [];
  const withBody = new Set<string>();
  const signed = new Set<string>();
  let ctor = false;
  for (const member of cls.members) {
    if (ts.isConstructorDeclaration(member)) {
      if (member.body === undefined) continue;
      if (ctor) {
        out.push({
          at: member,
          message:
            `"${wholeClassName(cls)}" declares two constructors; a shader function has ` +
            `one body.`,
        });
      }
      ctor = true;
      continue;
    }
    const name = member.name === undefined ? undefined : writtenMemberName(member.name);
    if (name === undefined) continue;
    const key = `${isStaticMember(member) ? 'static ' : ''}${name}`;
    const refusal = abstractRefusal(member, name);
    const body = ts.isPropertyDeclaration(member)
      ? member.initializer
      : (member as ts.FunctionLikeDeclaration).body;
    if (refusal !== undefined && (body !== undefined || !signed.has(key))) {
      if (body === undefined) signed.add(key);
      out.push({ at: member.name ?? member, message: refusal.message });
    }
    const kind = ts.isMethodDeclaration(member)
      ? 'method'
      : ts.isGetAccessorDeclaration(member)
        ? 'get'
        : ts.isSetAccessorDeclaration(member)
          ? 'set'
          : ts.isPropertyDeclaration(member) && holdsFunction(member) && !isStaticMember(member)
            ? 'method'
            : undefined;
    if (kind === undefined || body === undefined || member.name === undefined) continue;
    const slot = `${kind} ${key}`;
    if (!withBody.has(slot)) {
      withBody.add(slot);
      continue;
    }
    out.push({
      at: member.name,
      message: kind === 'method' ? twoBodies(owner, name) : twoHalves(owner, name, kind),
    });
  }
  return out;
}

function withUnimplementedAbstracts(
  structs: readonly CollectedStruct[],
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): CollectedStruct[] {
  const missing = new Map<ts.ClassDeclaration, Set<string>>();
  const check = (node: ts.ClassDeclaration): void => {
    if (node.name === undefined || isAbstractNode(node) || missing.has(node)) return;
    const cls = node.name.text;
    const names = new Set<string>();
    const owners = new Set<string>();
    const seen = new Set<ts.ClassDeclaration>([node]);
    let above = baseClassOf(node);
    while (above !== undefined && !seen.has(above)) {
      seen.add(above);
      for (const m of above.members) {
        if (!ts.isMethodDeclaration(m) && !ts.isAccessor(m)) continue;
        const name = writtenMemberName(m.name);
        if (name === undefined || names.has(name) || m.body !== undefined) continue;
        const nearest = memberDeclarationInChain(node, name, false);
        if (nearest === undefined || !isAbstractNode(nearest) || nearest.parent === node) continue;
        if (!ts.isClassElement(nearest) || !isAbstractNode(nearest.parent)) continue;
        if (bodiesOf(nearest.parent as ts.ClassLikeDeclaration, nearest, name).length > 0) continue;
        names.add(name);
        owners.add((nearest.parent as ts.ClassDeclaration).name?.text ?? '');
      }
      above = baseClassOf(above);
    }
    missing.set(node, names);
    if (names.size === 0) return;
    const list = (xs: Set<string>): string =>
      [...xs]
        .map((x) => `"${x}"`)
        .join(', ')
        .replace(/, ([^,]*)$/, ' and $1');
    diagnostics.push(
      classDiag(
        sourceFile,
        node.name,
        `"${cls}" does not implement ${list(names)}, which ${list(owners)} ` +
          `${owners.size === 1 ? 'declares' : 'declare'} abstract; write ` +
          `${names.size === 1 ? list(names) : 'each'} in "${cls}".`,
      ),
    );
  };
  for (const s of structs) if (s.classNode !== undefined) check(s.classNode);
  return structs.map((s): CollectedStruct => {
    const names = s.classNode === undefined ? undefined : missing.get(s.classNode);
    if (names === undefined || names.size === 0) return s;
    return {
      ...s,
      withheld: new Set([...(s.withheld ?? []), ...[...names].map(emittedMemberName)]),
    };
  });
}

const inferredFields = new WeakMap<ts.SourceFile, Map<string, InferredValue>>();

function inferredFieldType(
  member: ts.PropertyDeclaration,
  structName: string,
  field: string,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): ShaderType | undefined {
  if (!useInferenceActive(sourceFile) || member.initializer === undefined) return undefined;
  if (!isIntegerLiteralTree(member.initializer)) return undefined;
  const conflict = inferenceConflict(sourceFile, member);
  if (conflict !== undefined && !diagnostics.some((d) => d.message === conflict)) {
    diagnostics.push(makeDiagnostic(sourceFile, member.name, conflict, TS_CODES.TYPE_MISMATCH));
  }
  const type = decidedType(sourceFile, member);
  const value: InferredValue = {
    decl: member,
    key: member,
    name: member.name.getText(sourceFile),
    written: member.initializer.getText(sourceFile).replace(/\s+/g, ' '),
    ...(type !== undefined ? { type } : {}),
  };
  let table = inferredFields.get(sourceFile);
  if (table === undefined) inferredFields.set(sourceFile, (table = new Map()));
  table.set(`${structName}.${field}`, value);
  return type ?? f32T;
}

export function inferredFieldOf(
  sourceFile: ts.SourceFile,
  structName: string,
  field: string,
): InferredValue | undefined {
  return inferredFields.get(sourceFile)?.get(`${structName}.${field}`);
}

export function initializerType(init: ts.Expression, sourceFile: ts.SourceFile) {
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
  if (isArrayConstructor(e)) return constructedArrayType(e, sourceFile, initializerType);
  if (ts.isNewExpression(e) && ts.isIdentifier(e.expression)) {
    return structT(newInstanceName(e, e.expression.text, sourceFile) ?? e.expression.text);
  }
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.typeArguments === undefined) {
    return lookupTypeName(e.expression.text);
  }
  return undefined;
}

function parameterPropertyField(
  p: ts.ParameterDeclaration,
  owner: string,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): StructField | undefined {
  if (!ts.isIdentifier(p.name)) return undefined;
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
  if (p.type === undefined) return undefined;
  const mapped = mapTsTypeToShaderType(p.type, sourceFile, undefined);
  const type = optionalFieldType(mapped, p.questionToken, name, owner, sourceFile, diagnostics);
  if (type === undefined) return undefined;
  if (p.questionToken !== undefined) markOmittableField(sourceFile, owner, name);
  return { name, type };
}

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

function duplicateStructMessage(name: string): string {
  return (
    `Struct "${authorTypeText(structT(name))}" is declared more than once. A class, an ` +
    `interface and a type alias are three spellings of one struct, not declarations that ` +
    `merge — TypeScript would merge two interfaces, and the merged layout would disagree ` +
    `with this one at every use site.`
  );
}

function reportUnusedDuplicates(
  sourceFile: ts.SourceFile,
  reachable: ReadonlySet<string>,
  diagnostics: TsCompilerDiagnostic[],
): void {
  const byName = new Map<string, { nameNode: ts.Identifier; candidate: boolean }[]>();
  for (const stmt of sourceFile.statements) {
    const candidate = candidateOf(stmt);
    const decl = candidate
      ? { name: candidate.name, nameNode: candidate.nameNode, candidate: true }
      : ts.isClassDeclaration(stmt) && stmt.name
        ? { name: stmt.name.text, nameNode: stmt.name, candidate: false }
        : undefined;
    if (!decl || reachable.has(decl.name)) continue;
    byName.set(decl.name, [...(byName.get(decl.name) ?? []), decl]);
  }
  for (const [name, decls] of byName) {
    if (decls.length < 2 || !decls.some((d) => d.candidate)) continue;
    for (const d of decls.slice(1)) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          d.nameNode,
          duplicateStructMessage(name),
          TS_CODES.DUPLICATE_SYMBOL,
        ),
      );
    }
  }
}

export function noteRefusedGenerics(sourceFile: ts.SourceFile): void {
  refuseGenericsOf(sourceFile, collectCandidates(sourceFile));
}

function refuseGenericsOf(
  sourceFile: ts.SourceFile,
  candidates: ReadonlyMap<string, Candidate>,
): ReadonlySet<string> {
  const reached = reachableCandidates(sourceFile, candidates, aliasTargetsOf(sourceFile));
  const names = new Set(
    [...candidates.values()].filter((c) => c.generic && reached.has(c.name)).map((c) => c.name),
  );
  setRefusedGenerics(sourceFile, names);
  return names;
}

function genericCandidateMessage(candidate: Candidate): string {
  const declaration = candidate.nameNode.parent as
    ts.InterfaceDeclaration | ts.TypeAliasDeclaration;
  const params = (declaration.typeParameters ?? []).map((p) => p.getText()).join(', ');
  const fields = candidate.members
    .filter(ts.isPropertySignature)
    .map((m) =>
      m.type === undefined ? m.name.getText() : `${m.name.getText()}: ${m.type.getText()}`,
    );
  const body =
    fields.length === 0
      ? '…'
      : fields.length > 3
        ? `${fields.slice(0, 2).join('; ')}; …`
        : fields.join('; ');
  const what = candidate.spelling === 'interface' ? 'a generic interface' : 'a generic type alias';
  return (
    `"${candidate.name}" is ${what}; a generic struct is written as a class, ` +
    `class ${candidate.name}<${params}> { ${body} } (surface §32).`
  );
}

function collectCandidates(sourceFile: ts.SourceFile): Map<string, Candidate> {
  const out = new Map<string, Candidate>();
  for (const stmt of sourceFile.statements) {
    const candidate = candidateOf(stmt);
    if (candidate && !out.has(candidate.name)) out.set(candidate.name, candidate);
  }
  return out;
}

function eachTypeName(node: ts.Node, f: (name: string) => void): void {
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) f(node.typeName.text);
  node.forEachChild((child) => {
    if (ts.isTypeParameterDeclaration(child)) return;
    eachTypeName(child, f);
  });
}

function reachableCandidates(
  sourceFile: ts.SourceFile,
  candidates: ReadonlyMap<string, Candidate>,
  aliases?: ReadonlyMap<string, ts.TypeNode>,
): Set<string> {
  const reachable = new Set<string>();
  const pending: string[] = [];
  const followed = new Set<string>();
  const see = (name: string): void => {
    const target = aliases?.get(name);
    if (target !== undefined && !followed.has(name)) {
      followed.add(name);
      eachTypeName(target, see);
    }
    if (!candidates.has(name) || reachable.has(name)) return;
    reachable.add(name);
    pending.push(name);
  };
  for (const stmt of sourceFile.statements) {
    if (ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)) continue;
    eachTypeName(stmt, see);
  }
  for (const stmt of sourceFile.statements) {
    if (!ts.isClassDeclaration(stmt)) continue;
    eachHeritageName(stmt.heritageClauses, see);
  }
  for (const names of entryResultLiterals(sourceFile)) {
    for (const candidate of candidates.values()) {
      const fields = candidate.members.flatMap((m) =>
        ts.isPropertySignature(m) && ts.isIdentifier(m.name) ? [m.name.text] : [],
      );
      if (
        fields.length === candidate.members.length &&
        fields.length === names.size &&
        fields.every((f) => names.has(f))
      )
        see(candidate.name);
    }
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

function entryResultLiterals(sourceFile: ts.SourceFile): Set<string>[] {
  const out: Set<string>[] = [];
  const entries: ts.FunctionLikeDeclaration[] = [];
  const visitStatements = (statements: readonly ts.Statement[]): void => {
    for (const stmt of statements) {
      const sc = stageCallOf(stmt);
      if (sc !== undefined && declaresEntry(sc.callee)) entries.push(sc.fn);
      else if (
        ts.isFunctionDeclaration(stmt) &&
        (stmt.modifiers ?? [])
          .filter(ts.isDecorator)
          .some((d) => /^@(vertex|fragment|compute)\b/.test(d.getText(sourceFile)))
      )
        entries.push(stmt);
      else if (
        ts.isModuleDeclaration(stmt) &&
        stmt.body !== undefined &&
        ts.isModuleBlock(stmt.body)
      )
        visitStatements(stmt.body.statements);
    }
  };
  visitStatements(sourceFile.statements);
  for (const fn of entries) {
    if (fn.type !== undefined || fn.body === undefined) continue;
    const returned = (value: ts.Expression): void => {
      let e: ts.Expression = value;
      while (ts.isParenthesizedExpression(e)) e = e.expression;
      if (!ts.isObjectLiteralExpression(e)) return;
      const names = e.properties.map((p) =>
        (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
        ts.isIdentifier(p.name)
          ? p.name.text
          : undefined,
      );
      if (names.every((n) => n !== undefined)) out.push(new Set(names as string[]));
    };
    const walk = (node: ts.Node): void => {
      if (ts.isFunctionLike(node) || ts.isClassLike(node)) return;
      if (ts.isReturnStatement(node) && node.expression !== undefined) returned(node.expression);
      ts.forEachChild(node, walk);
    };
    if (ts.isBlock(fn.body)) ts.forEachChild(fn.body, walk);
    else returned(fn.body);
  }
  return out;
}

function eachHeritageName(
  clauses: readonly ts.HeritageClause[] | undefined,
  f: (name: string) => void,
): void {
  for (const h of clauses ?? []) {
    if (h.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    for (const type of h.types) if (ts.isIdentifier(type.expression)) f(type.expression.text);
  }
}

function basesOf(
  name: string,
  clauses: readonly ts.HeritageClause[] | undefined,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): MixinApplication | undefined {
  const extendsClause = clauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword);
  if (!extendsClause) return { bases: [], bodies: [] };
  const shown = authorTypeText(structT(name));
  const out: string[] = [];
  const bodies: ts.ClassExpression[] = [];
  for (const type of extendsClause.types) {
    if (type.typeArguments && type.typeArguments.length > 0) {
      const instance = ts.isIdentifier(type.expression)
        ? genericStructName(type.expression.text, type.typeArguments, sourceFile)
        : undefined;
      if (instance === undefined) {
        diagnostics.push(
          diag(
            sourceFile,
            type,
            `"${shown}" extends "${type.getText(sourceFile)}", which names no layout. A base has ` +
              `to be a class this file declares, at type arguments it can resolve.`,
          ),
        );
        return undefined;
      }
      out.push(instance);
      continue;
    }
    if (isMixinHeritage(type.expression, sourceFile)) {
      const applied = applyMixins(shown, type.expression, sourceFile, diagnostics);
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
          `"${shown}" extends an expression. A base has to be a declared class or interface ` +
            `here, or a mixin: a call to a function of this file whose body is one ` +
            `"return class … { … }".`,
        ),
      );
      return undefined;
    }
    if (undeclaredTypeName(type, sourceFile) !== undefined) continue;
    out.push(namespaceClassAround(type, type.expression.text) ?? type.expression.text);
  }
  return { bases: out, bodies };
}

function classStructs(
  sourceFile: ts.SourceFile,
  genericParams: ReadonlyMap<string, unknown>,
  instances: ReadonlyMap<string, readonly StructInstance[]>,
): StructOrigin[] {
  const out: StructOrigin[] = [];
  eachNamespaceStatement(sourceFile.statements, sourceFile, [], (stmt, prefix) => {
    if (!ts.isClassDeclaration(stmt) || !stmt.name) return;
    const written = prefix === '' ? stmt.name.text : namespaceMemberName(prefix, stmt.name.text);
    const cases: readonly StructInstance[] = genericParams.has(written)
      ? (instances.get(written) ?? [])
      : [{ name: written, binding: undefined }];
    for (const c of cases) {
      out.push({
        decl: { name: c.name },
        classNode: stmt,
        ...(c.binding !== undefined ? { binding: c.binding } : {}),
      });
    }
  });
  return out;
}

function applyInheritance(
  structs: readonly CollectedStruct[],
  sourceFile: ts.SourceFile,
  nodeOf: ReadonlyMap<string, ts.Node>,
  diagnostics: TsCompilerDiagnostic[],
): CollectedStruct[] {
  const byName = new Map(structs.map((s) => [s.decl.name, s]));
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
  const refusedBase = new Set<string>();
  const baseRefusedWhereWritten = (struct: CollectedStruct): boolean => {
    const clause = struct.classNode?.heritageClauses?.find(
      (h) => h.token === ts.SyntaxKind.ExtendsKeyword,
    );
    if (clause === undefined) return false;
    const [start, end] = [clause.getStart(sourceFile), clause.getEnd()];
    return diagnostics.some(
      (d) =>
        d.category === 'error' &&
        d.fileName === sourceFile.fileName &&
        d.start >= start &&
        d.start < end,
    );
  };
  const shown = (n: string): string => authorTypeText(structT(n));
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
          `"${shown(name)}" extends itself, through ${[
            ...onStack.slice(onStack.indexOf(name)),
            name,
          ]
            .map((n) => `"${shown(n)}"`)
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
      if (prior.private !== undefined || priv !== undefined) {
        if (prior.private?.owner === priv?.owner) return;
        withheld.add(f.name);
        diagnostics.push(
          diag(
            sourceFile,
            at(name),
            `"${shown(prior.from)}" declares "${prior.private?.written ?? f.name}" and ` +
              `"${shown(from)}" declares "${priv?.written ?? f.name}", which would both be the ` +
              `struct member "${f.name}": a private name is emitted without its "#". Rename one ` +
              `of them.`,
          ),
        );
        return;
      }
      if (typeKeyOf(prior.field.type) === typeKeyOf(f.type)) return;
      diagnostics.push(
        diag(
          sourceFile,
          at(name),
          `"${shown(from)}" declares "${f.name}" as ${authorTypeText(f.type)}, and ` +
            `"${shown(prior.from)}" declares it as ${authorTypeText(prior.field.type)}. A struct ` +
            `has one layout, so a field cannot change type on the way down.`,
        ),
      );
    };
    for (const base of struct.bases ?? []) {
      if (!byName.has(base) && baseRefusedWhereWritten(struct)) {
        refusedBase.add(name);
        continue;
      }
      if (!byName.has(base)) {
        diagnostics.push(
          diag(
            sourceFile,
            at(name),
            `"${shown(name)}" extends "${shown(base)}", which this file does not declare as a ` +
              `struct. A base has to be a class or an interface whose fields are shader types.`,
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
  for (const s of out) {
    if (
      s.spelling === 'class' ||
      s.namespace ||
      s.decl.fields.length > 0 ||
      (s.bases ?? []).length === 0
    )
      continue;
    if (refusedBase.has(s.decl.name)) continue;
    diagnostics.push(
      diag(
        sourceFile,
        at(s.decl.name),
        `Struct "${shown(s.decl.name)}" has no fields, and neither has what it extends. WGSL ` +
          `requires a struct to declare at least one member.`,
      ),
    );
  }
  return out;
}

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
  return undefined;
}

function runsAsStatement(body: ts.Expression): boolean {
  let e = body;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (ts.isPostfixUnaryExpression(e)) return true;
  if (ts.isPrefixUnaryExpression(e)) {
    return (
      e.operator === ts.SyntaxKind.PlusPlusToken || e.operator === ts.SyntaxKind.MinusMinusToken
    );
  }
  return (
    ts.isBinaryExpression(e) &&
    e.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    e.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  );
}

function methodOfField(
  member: ts.PropertyDeclaration,
  fn: ts.ArrowFunction | ts.FunctionExpression,
): ts.MethodDeclaration {
  const setParent = (node: ts.Node, parent: ts.Node): void => {
    (node as { parent: ts.Node }).parent = parent;
  };
  let body: ts.Block;
  if (ts.isBlock(fn.body)) body = fn.body;
  else {
    const stmt =
      (fn.type === undefined || fn.type.kind === ts.SyntaxKind.VoidKeyword) &&
      runsAsStatement(fn.body)
        ? ts.factory.createExpressionStatement(fn.body)
        : ts.factory.createReturnStatement(fn.body);
    ts.setTextRange(stmt, fn.body);
    body = ts.setTextRange(ts.factory.createBlock([stmt], true), fn.body);
    setParent(stmt, body);
  }
  const modifiers = [
    ...(ts.getModifiers(member) ?? []).filter(
      (m) =>
        m.kind === ts.SyntaxKind.PublicKeyword ||
        m.kind === ts.SyntaxKind.PrivateKeyword ||
        m.kind === ts.SyntaxKind.ProtectedKeyword ||
        m.kind === ts.SyntaxKind.OverrideKeyword,
    ),
    ...(ts.getModifiers(fn) ?? []).filter((m) => m.kind === ts.SyntaxKind.AsyncKeyword),
  ];
  const method = ts.setTextRange(
    ts.factory.createMethodDeclaration(
      modifiers,
      ts.isFunctionExpression(fn) ? fn.asteriskToken : undefined,
      member.name,
      undefined,
      undefined,
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
    `Field names on "${authorTypeText(structT(owner))}" must be plain identifiers: a WGSL struct ` +
      `member has no other spelling, and a quoted or computed name would not reach the emitted ` +
      `layout.`,
  );
}

function signatureFields(
  members: readonly ts.TypeElement[],
  owner: string,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  symbols?: DeclaredSymbolSink,
  withheld?: Set<string>,
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
    const mapped = member.type
      ? (mapTsTypeToShaderType(member.type, sourceFile, diagnostics) ??
        (writesRefusedType(member.type, sourceFile) || isUntypedBuiltin(member.type, sourceFile)
          ? undefined
          : structT(writtenText(member.type))))
      : undefined;
    const type = optionalFieldType(
      mapped,
      member.questionToken,
      member.name.text,
      owner,
      sourceFile,
      diagnostics,
    );
    if (!type) {
      if (member.type !== undefined) withheld?.add(member.name.text);
      continue;
    }
    if (member.questionToken !== undefined) markOmittableField(sourceFile, owner, member.name.text);
    const field: StructField = { name: member.name.text, type };
    let unknownAttribute = false;
    for (const d of typeDecoratorsOf(member))
      if (checkAttributeName(diagnostics, sourceFile, d, 'a struct field')) unknownAttribute = true;
    setEntryAttributes(field, member, type, sourceFile, diagnostics, unknownAttribute);
    fields.push(field);
    recordDeclaration(symbols, sourceFile, member.name, {
      name: member.name.text,
      kind: 'field',
      type,
      struct: owner,
    });
  }
  return fields;
}

function checkUncollectedIo(
  member: ts.PropertyDeclaration | ts.PropertySignature,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  parameters: ReadonlySet<string> = new Set(),
): void {
  let type = member.type;
  while (isAttributeType(type)) {
    const name = (type.typeName as ts.Identifier).text;
    if (declaredTypeNamesOf(sourceFile).has(name) || parameters.has(name)) return;
    const argument = type.typeArguments?.[0];
    if ((name === 'builtin' || name === 'location') && argument !== undefined) {
      let dependent = false;
      eachTypeName(argument, (name) => {
        if (parameters.has(name)) dependent = true;
      });
      if (dependent) return;
    }
    type = attributeArgumentsOf(type).value;
  }
  const decos = attributeDecoratorsOf(member);
  const io = readIoAttributes(diagnostics, sourceFile, decos);
  if (
    io.invalid ||
    (io.builtin !== undefined &&
      !checkBuiltinName(diagnostics, sourceFile, io.builtin.argNode, io.builtin.name))
  ) {
    readFieldOptions(member, decos, sourceFile, diagnostics);
  }
}

function readFieldOptions(
  member: ts.PropertyDeclaration | ts.PropertySignature,
  decos: readonly ts.Decorator[],
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): { interpolate: string | undefined; blendSrc: number | undefined } {
  const interpolate = interpolateDecoratorArg(diagnostics, sourceFile, decos);
  const blendSrc = numberDecorator(member, 'blend_src');
  if (blendSrc !== undefined && blendSrc !== 0 && blendSrc !== 1) {
    diagnostics.push(
      diag(
        sourceFile,
        member,
        `blend_src takes 0 or 1 — the two sources a dual-source blend mixes — not ${String(blendSrc)}.`,
      ),
    );
  }
  return { interpolate, blendSrc };
}

function noteTypeUses(
  said: readonly TsCompilerDiagnostic[],
  stmt: ts.Statement,
  name: string,
  sourceFile: ts.SourceFile,
): void {
  const uses: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (node === stmt) return;
    if (
      ts.isTypeReferenceNode(node) &&
      ts.isIdentifier(node.typeName) &&
      node.typeName.text === name
    )
      uses.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  for (const d of said) for (const use of [...uses].reverse()) noteUse(d, use, sourceFile);
}

function exportsDeclaration(sourceFile: ts.SourceFile, stmt: ts.Statement, name: string): boolean {
  if (
    (ts.getModifiers(stmt as ts.HasModifiers) ?? []).some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword,
    )
  )
    return true;
  return sourceFile.statements.some(
    (st) =>
      ts.isExportDeclaration(st) &&
      st.moduleSpecifier === undefined &&
      st.exportClause !== undefined &&
      ts.isNamedExports(st.exportClause) &&
      st.exportClause.elements.some((el) => (el.propertyName ?? el.name).text === name),
  );
}

const INTERPOLATE_PLACE = 'The interpolate option belongs on a location<…> field:';
const INVARIANT_PLACE = 'The invariant option belongs on builtin<"position">:';

function checkUnusedExportedIo(
  candidate: Candidate,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  if ((candidate.heritage?.length ?? 0) > 0) return;
  const said: TsCompilerDiagnostic[] = [];
  const fields = signatureFields(candidate.members, candidate.name, sourceFile, said);
  if (
    fields.length !== candidate.members.length ||
    said.some(
      (d) => !d.message.startsWith(INTERPOLATE_PLACE) && !d.message.startsWith(INVARIANT_PLACE),
    )
  )
    return;
  checkLocationSlots(said, sourceFile, candidate.nameNode, candidate.name, fields);
  diagnostics.push(...said);
}

function setEntryAttributes(
  field: StructField,
  member: ts.PropertyDeclaration | ts.PropertySignature,
  type: ShaderType,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  unknownAttribute: boolean,
): void {
  const decos = attributeDecoratorsOf(member);
  const io = readIoAttributes(diagnostics, sourceFile, decos);
  const { interpolate, blendSrc } = readFieldOptions(member, decos, sourceFile, diagnostics);
  if (io.invalid) {
    refusedIoFields.add(field);
    return;
  }
  const loc = io.location;
  const builtinArg = io.builtin;
  const builtin =
    builtinArg && checkBuiltinName(diagnostics, sourceFile, builtinArg.argNode, builtinArg.name)
      ? builtinArg.name
      : undefined;
  if (loc === undefined && !builtin && (builtinArg !== undefined || unknownAttribute))
    refusedIoFields.add(field);
  if (builtin) {
    checkBuiltinType(diagnostics, sourceFile, builtinArg!.argNode, builtin, type);
  }
  const invariant = hasInvariantDecorator(decos);
  if (interpolate !== undefined && loc === undefined && !hasRefusedIoAttribute(field)) {
    diagnostics.push(
      diag(
        sourceFile,
        member,
        `${INTERPOLATE_PLACE} it says how a VARYING is ` +
          `interpolated, and a builtin<…> carries its own rule.`,
      ),
    );
  }
  if (invariant && builtin !== 'position' && !hasRefusedIoAttribute(field)) {
    diagnostics.push(
      diag(
        sourceFile,
        member,
        `${INVARIANT_PLACE} it is WGSL's promise that this ` +
          `position is computed the same way in two pipelines, and no other output ` +
          `has that meaning.`,
      ),
    );
  }
  if (loc !== undefined) (field as { location?: number }).location = loc;
  if (builtin) (field as { builtin?: string }).builtin = builtin;
  if (interpolate !== undefined && loc !== undefined) {
    (field as { interpolate?: string }).interpolate = interpolate.slice('@interpolate('.length, -1);
  }
  const extra =
    (invariant && builtin === 'position' ? '@invariant ' : '') +
    (blendSrc !== undefined ? `@blend_src(${String(blendSrc)}) ` : '') +
    (interpolate !== undefined && loc !== undefined ? `${interpolate} ` : '');
  if (builtin) (field as { attr?: string }).attr = `${extra}@builtin(${builtin})`.trim();
  else if (loc !== undefined)
    (field as { attr?: string }).attr = `@location(${loc}) ${extra}`.trim();
  if (blendSrc !== undefined) (field as { blendSrc?: number }).blendSrc = blendSrc;
}

function numberDecorator(node: ts.Node, name: string): number | undefined {
  for (const d of attributeDecoratorsOf(node)) {
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

// Why: WGSL refuses two members at one `@location` ("must not contain two entries with the same
// location value"); a dual-source pair at one location with `@blend_src` 0 and 1 is the one
// shape it allows.
function checkLocationSlots(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node | undefined,
  structName: string,
  fields: readonly StructField[],
): void {
  const at = node ?? sourceFile;
  const shown = authorTypeText(structT(structName));
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
          `Struct "${shown}" puts "${prev}" and "${field.name}" both at ` +
            `location<${String(field.location)}, …` +
            `${field.blendSrc !== undefined ? `, { blend_src: ${String(field.blendSrc)} }` : ''}>; ` +
            `each slot carries one value.`,
          TS_CODES.STRUCT_FIELD,
        ),
      );
    } else atLocation.set(slot, field.name);
    checkLocationType(
      diagnostics,
      sourceFile,
      at,
      `${shown}.${field.name}`,
      field.type,
      field.interpolate,
    );
  }
  // Why: WGSL requires a struct that declares one `@blend_src` to declare both. This is stated
  // from the specification: the gate's adapter has no `dual-source-blending` feature, so Tint
  // refuses the extension before it reaches the rule.
  if (blendSources.size === 1) {
    const only = [...blendSources][0]!;
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        at,
        `Struct "${shown}" declares { blend_src: ${String(only)} } and not ` +
          `{ blend_src: ${String(1 - only)} }; a dual-source blend mixes two colours, so both sit ` +
          `at the same location<…>.`,
        TS_CODES.STRUCT_FIELD,
      ),
    );
  }
}
