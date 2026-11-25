// Implements: Rule 6.1, Rule 6.2 (docs/language-design.md; traced in reqs/).

import ts from 'typescript';
import type { BindingDecl, StructDecl } from '../../core/ir/nodes.js';
import { structT, type ShaderType } from '../../core/ir/types.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import { mapTsTypeToShaderType, HANDLE_TYPE_NAMES, writesRefusedType } from './type-map.js';
import { atomicWithin } from './lower/atomics.js';
import { inferredStorageAccess } from './storage-access.js';
import { recordDeclaration, type DeclaredSymbolSink } from './symbols.js';
import { authorTypeText, recordCallFormBinding, recordRecoveredBinding } from './context.js';
import { refuseOptionalAt, type StructLookup } from './optional.js';
import { isOverrideType } from './overrides.js';
import { TS_CODES } from './codes.js';
import { makeDiagnostic } from './diagnostic.js';
import {
  classDeclarationIn,
  classInFile,
  exportedByList,
  hostResourceOf,
} from './host-resource.js';
import { twoRowStd140Reason } from '../../core/std140.js';

// Why: WGSL gives a storage buffer read and read_write only; `write` is a storage texture's.
export const STORAGE_BUFFER_ACCESS = ['read', 'read_write'] as const;

export type StorageBufferAccess = (typeof STORAGE_BUFFER_ACCESS)[number];

export function isResourceCall(expr: ts.Expression): expr is ts.CallExpression {
  return (
    ts.isCallExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    (expr.expression.text === 'uniform' || expr.expression.text === 'storage')
  );
}

export function collectBindings(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  symbols?: DeclaredSymbolSink,
  firstBinding = 0,
  structs: readonly StructDecl[] = [],
): BindingDecl[] {
  const out: BindingDecl[] = [];
  const byName = new Map(structs.map((s) => [s.name, s]));
  structsHere = (n) => byName.get(n);
  let next = firstBinding;
  const listed = exportedByList(sourceFile);
  const exported = new Map<BindingDecl, string>();
  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    const isConst = (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0;
    const isLet = (stmt.declarationList.flags & ts.NodeFlags.Let) !== 0;
    if (!isConst && !isLet) continue;
    const declared = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword) ?? false;
    const isExported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      if (decl.initializer && isResourceCall(decl.initializer)) {
        const b = fromCall(
          decl.name.text,
          decl.initializer,
          isConst,
          sourceFile,
          diagnostics,
          next,
        );
        if (b) {
          checkHostShareable(b, byName, sourceFile, decl, diagnostics);
          out.push(b);
          const as = isExported ? b.name : listed.get(b.name);
          if (as !== undefined) exported.set(b, as);
          recordDeclaration(symbols, sourceFile, decl.name, {
            name: b.name,
            kind: 'binding',
            type: b.type,
            mutable: b.access === 'read_write',
          });
          next = Math.max(next, b.binding + 1);
        }
        continue;
      }
      if (isOverrideType(decl.type)) continue;
      if (decl.type?.kind === ts.SyntaxKind.TypeOperator) {
        const op = decl.type as ts.TypeOperatorNode;
        if (op.operator === ts.SyntaxKind.UniqueKeyword) continue;
      }
      if (declared && decl.type) {
        const b = fromType(decl.name.text, decl.type, isConst, sourceFile, diagnostics, next);
        if (b) {
          checkHostShareable(b, byName, sourceFile, decl.type, diagnostics);
          out.push(b);
          const as = isExported ? b.name : listed.get(b.name);
          if (as !== undefined) exported.set(b, as);
          recordDeclaration(symbols, sourceFile, decl.name, {
            name: b.name,
            kind: 'binding',
            type: b.type,
            mutable: b.access === 'read_write',
          });
          next = Math.max(next, b.binding + 1);
        }
      }
    }
  }
  const names = new Set<string>();
  const duplicates: BindingDecl[] = [];
  for (const b of out) {
    if (names.has(b.name)) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          undefined,
          `Duplicate resource "${b.name}".`,
          TS_CODES.DUPLICATE_SYMBOL,
        ),
      );
      duplicates.push(b);
      continue;
    }
    names.add(b.name);
  }
  for (const b of duplicates) out.splice(out.indexOf(b), 1);
  const seen = new Map<string, string>();
  for (const b of out) {
    const key = `${b.group}:${b.binding}`;
    const prev = seen.get(key);
    if (prev) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          undefined,
          `@binding(${b.binding}) in group ${b.group} is used by "${prev}" and "${b.name}".`,
          TS_CODES.UNSUPPORTED,
        ),
      );
    } else seen.set(key, b.name);
  }
  refuseReservedFields(
    out.filter((b) => exported.has(b)).map((b) => [b, exported.get(b)!] as const),
    byName,
    sourceFile,
    diagnostics,
  );
  return out;
}

const ACCESSOR_OWN = ['set'];
const UNIFORM_OWN = ['set', 'needsUpdate', 'dispose'];

function fieldDeclaration(
  sourceFile: ts.SourceFile,
  struct: string,
  field: string,
): { readonly cls: string; readonly node: ts.Node } | undefined {
  const seen = new Set<string>();
  for (let name: string | undefined = struct; name !== undefined && !seen.has(name);) {
    seen.add(name);
    const decl = classDeclarationIn(sourceFile, name);
    if (decl === undefined) return undefined;
    const m = decl.members.find(
      (x): x is ts.PropertyDeclaration =>
        ts.isPropertyDeclaration(x) && x.name.getText(sourceFile) === field,
    );
    if (m !== undefined) return { cls: name, node: m.name };
    const base = decl.heritageClauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword)
      ?.types[0]?.expression;
    name = base !== undefined && ts.isIdentifier(base) ? base.text : undefined;
  }
  return undefined;
}

function refuseReservedFields(
  exported: readonly (readonly [BindingDecl, string])[],
  structs: ReadonlyMap<string, StructDecl>,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  if (exported.length === 0) return;
  const classOf = classInFile(sourceFile, structs);
  const reported = new Set<string>();
  for (const [binding, as] of exported) {
    const r = hostResourceOf(binding, classOf);
    if (r.kind !== 'resource') continue;
    const host = `${r.resource}<${r.cls}>`;
    const seen = new Set<string>();
    const walk = (s: ShaderType, own: readonly string[]): void => {
      if (s.kind === 'array') return walk(s.elem, ACCESSOR_OWN);
      if (s.kind !== 'struct' || seen.has(s.name)) return;
      seen.add(s.name);
      const decl = structs.get(s.name);
      if (decl === undefined) return;
      for (const f of decl.fields) {
        if (!own.includes(f.name)) {
          walk(f.type, ACCESSOR_OWN);
          continue;
        }
        const at = fieldDeclaration(sourceFile, s.name, f.name);
        const shown = at?.cls ?? authorTypeText(s);
        const key = `${shown}.${f.name}`;
        if (reported.has(key)) continue;
        reported.add(key);
        diagnostics.push(
          makeDiagnostic(
            sourceFile,
            at?.node,
            `"${key}" is named like the host accessor's own ${f.name === 'needsUpdate' ? 'property' : 'method'} "${f.name}": "${as}" is a binding the module exports, a ${host} in the host, whose fields are properties of that accessor. Rename the field (Rule 6.1).`,
            TS_CODES.HOST_RESERVED_FIELD,
          ),
        );
      }
    };
    walk(r.struct, r.resource === 'Uniform' ? UNIFORM_OWN : ACCESSOR_OWN);
  }
}

let structsHere: StructLookup = () => undefined;

function fromType(
  name: string,
  type: ts.TypeNode,
  isConst: boolean,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  autoBinding: number,
): BindingDecl | undefined {
  if (!ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName)) {
    diagnostics.push(
      diag(
        sourceFile,
        type,
        `declare "${name}" must be uniform<T>, storage<T>, a texture, a sampler or override<T>.`,
      ),
    );
    return undefined;
  }
  const kind = type.typeName.text;
  if (HANDLE_TYPE_NAMES.has(kind)) {
    const handle = mapTsTypeToShaderType(type, sourceFile, diagnostics);
    if (!handle) return undefined;
    if (!isConst) {
      diagnostics.push(
        diag(sourceFile, type, `"${name}" is a ${kind}; declare it const, not let.`),
      );
      return undefined;
    }
    return { group: 0, binding: autoBinding, name, space: 'uniform', type: handle };
  }
  if (kind !== 'uniform' && kind !== 'storage') {
    diagnostics.push(
      diag(
        sourceFile,
        type,
        `declare "${name}" must be uniform<T>, storage<T>, a texture, a sampler or override<T>.`,
      ),
    );
    return undefined;
  }
  const inner = type.typeArguments?.[0];
  if (!inner) {
    diagnostics.push(diag(sourceFile, type, `${kind}<T> needs a type argument.`));
    return undefined;
  }
  let access: StorageBufferAccess | undefined;
  if (kind === 'storage') {
    access =
      type.typeArguments?.[1] !== undefined
        ? readStorageAccess(type.typeArguments[1], sourceFile, diagnostics, name)
        : inferredStorageAccess(sourceFile, name);
  } else if (type.typeArguments?.[1] !== undefined) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        type.typeArguments[1],
        `uniform<T> takes one type argument. A uniform buffer is read-only, so it has no ` +
          `access mode to write.`,
        TS_CODES.UNKNOWN_TYPE,
      ),
    );
  }
  if (!isConst) {
    const innerText = inner.getText(sourceFile);
    diagnostics.push(
      diag(
        sourceFile,
        type,
        `"${name}" is a ${kind} binding, and a binding is declared const: write ` +
          `"declare const ${name}: ${
            kind === 'storage'
              ? `storage<${innerText}, "${access ?? 'read_write'}">`
              : `uniform<${innerText}>`
          }". ` +
          (kind === 'storage'
            ? `A storage binding's access mode is its second type argument, not the ` +
              `declaration keyword.`
            : `A uniform buffer is read-only, so there is no writable form of it to ask for.`),
      ),
    );
  }
  const beforeType = diagnostics.length;
  const mapped =
    mapTsTypeToShaderType(inner, sourceFile, diagnostics) ??
    (ts.isTypeReferenceNode(inner) &&
    ts.isIdentifier(inner.typeName) &&
    !writesRefusedType(inner, sourceFile)
      ? structT(inner.typeName.text)
      : undefined);
  if (diagnostics.slice(beforeType).some((d) => d.category === 'error')) {
    recordRecoveredBinding(sourceFile, name);
  }
  if (!mapped) return undefined;
  if (
    refuseOptionalAt(
      mapped,
      inner,
      'a binding',
      sourceFile,
      diagnostics,
      authorTypeText,
      structsHere,
    )
  ) {
    recordRecoveredBinding(sourceFile, name);
    return undefined;
  }
  if (refuseJaggedArray(mapped, inner, sourceFile, diagnostics)) {
    recordRecoveredBinding(sourceFile, name);
    return undefined;
  }
  const atomic = kind === 'uniform' ? atomicWithin(mapped) : undefined;
  if (atomic !== undefined) {
    diagnostics.push(
      diag(
        sourceFile,
        type,
        `"${name}" holds an atomic<${atomic.elem}>, which lives in storage memory only: ` +
          `write "declare const ${name}: storage<${inner.getText(sourceFile)}, ` +
          `\"read_write\">".`,
      ),
    );
    return undefined;
  }
  if (
    mapped.kind === 'sampler' ||
    mapped.kind === 'sampler-comparison' ||
    mapped.kind === 'texture' ||
    mapped.kind === 'storage-texture' ||
    mapped.kind === 'depth-texture'
  ) {
    const isSampler = mapped.kind === 'sampler' || mapped.kind === 'sampler-comparison';
    diagnostics.push(
      diag(
        sourceFile,
        type,
        `"${name}" is a ${isSampler ? 'sampler' : 'texture'}; it is declared ` +
          `bare, not inside ${kind}<...>: write "declare const ${name}: ${inner.getText(sourceFile)}".`,
      ),
    );
    return undefined;
  }
  return {
    group: 0,
    binding: autoBinding,
    name,
    space: kind === 'storage' ? 'storage' : 'uniform',
    access,
    type: mapped,
  };
}

function fromCall(
  name: string,
  call: ts.CallExpression,
  isConst: boolean,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  autoBinding: number,
): BindingDecl | undefined {
  const kind = ts.isIdentifier(call.expression) ? call.expression.text : '';
  const typeArg = call.typeArguments?.[0];
  if (!typeArg) {
    diagnostics.push(diag(sourceFile, call, `${kind}<T>() needs a type argument.`));
    return undefined;
  }
  const beforeType = diagnostics.length;
  const type =
    mapTsTypeToShaderType(typeArg, sourceFile, diagnostics) ??
    (ts.isTypeReferenceNode(typeArg) &&
    ts.isIdentifier(typeArg.typeName) &&
    !writesRefusedType(typeArg, sourceFile)
      ? structT(typeArg.typeName.text)
      : undefined);
  if (diagnostics.slice(beforeType).some((d) => d.category === 'error')) {
    recordRecoveredBinding(sourceFile, name);
  }
  if (
    refuseOptionalAt(
      type,
      typeArg,
      'a binding',
      sourceFile,
      diagnostics,
      authorTypeText,
      structsHere,
    )
  ) {
    recordRecoveredBinding(sourceFile, name);
    return undefined;
  }
  if (refuseJaggedArray(type, typeArg, sourceFile, diagnostics)) {
    recordRecoveredBinding(sourceFile, name);
    return undefined;
  }
  if (!type) return undefined;
  if (!isConst) {
    diagnostics.push(
      diag(
        sourceFile,
        call,
        `"${name}" is a ${kind} binding, and a binding is declared const: write ` +
          `"const ${name} = ${
            kind === 'storage'
              ? `storage<${typeArg.getText(sourceFile)}, "read_write">`
              : `uniform<${typeArg.getText(sourceFile)}>`
          }()". ` +
          (kind === 'storage'
            ? `A storage binding's access mode is its second type argument, not the ` +
              `declaration keyword.`
            : `A uniform buffer is read-only, so there is no writable form of it to ask for.`),
      ),
    );
    return undefined;
  }
  let group = 0;
  let binding = autoBinding;
  let access: StorageBufferAccess | undefined;
  if (kind === 'storage') {
    access = readStorageAccess(call.typeArguments?.[1], sourceFile, diagnostics, name);
  } else if (call.typeArguments?.[1] !== undefined) {
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        call.typeArguments[1],
        `uniform<T>() takes one type argument. A uniform buffer is read-only, so it has no ` +
          `access mode to write.`,
        TS_CODES.UNKNOWN_TYPE,
      ),
    );
  }
  let keptOptions: string | undefined;
  const arg0 = call.arguments[0];
  if (arg0 && ts.isNumericLiteral(arg0)) {
    binding = Number(arg0.text);
    if (call.arguments[1] && ts.isNumericLiteral(call.arguments[1])) {
      group = binding;
      binding = Number(call.arguments[1].text);
    }
  } else if (arg0 && ts.isObjectLiteralExpression(arg0)) {
    const opt = parseOptions(arg0);
    if (opt.group !== undefined) group = opt.group;
    if (opt.binding !== undefined) binding = opt.binding;
    keptOptions = arg0.properties
      .filter((prop) => prop !== opt.access)
      .map((prop) => prop.getText(sourceFile))
      .join(', ');
    if (opt.access !== undefined) {
      const args = keptOptions === '' ? '' : `{ ${keptOptions} }`;
      const typeText = typeArg.getText(sourceFile);
      const word =
        opt.accessWord !== undefined && isStorageBufferAccess(opt.accessWord)
          ? opt.accessWord
          : 'read_write';
      diagnostics.push(
        diag(
          sourceFile,
          opt.access,
          kind === 'storage'
            ? `The { access } option is gone: a storage binding's access mode is its second ` +
                `type argument. Write "const ${name} = storage<${typeText}, ` +
                `\"${word}\">(${args})".`
            : `The { access } option is gone, and a uniform buffer is read-only: it has no ` +
                `access mode to ask for. Write "const ${name} = uniform<${typeText}>(${args})".`,
        ),
      );
    }
  }
  recordCallFormBinding(sourceFile, name, callArgsText(call, sourceFile, keptOptions));
  return { group, binding, name, space: kind === 'storage' ? 'storage' : 'uniform', access, type };
}

function callArgsText(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  keptOptions: string | undefined,
): string {
  if (keptOptions !== undefined) return keptOptions === '' ? '()' : `({ ${keptOptions} })`;
  return `(${call.arguments.map((a) => a.getText(sourceFile)).join(', ')})`;
}

function parseOptions(obj: ts.ObjectLiteralExpression): {
  group?: number;
  binding?: number;
  access?: ts.ObjectLiteralElementLike;
  accessWord?: string;
} {
  const out: {
    group?: number;
    binding?: number;
    access?: ts.ObjectLiteralElementLike;
    accessWord?: string;
  } = {};
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
    const key = prop.name.text;
    if ((key === 'group' || key === 'binding') && ts.isNumericLiteral(prop.initializer)) {
      out[key] = Number(prop.initializer.text);
    }
    if (key === 'access') {
      out.access = prop;
      if (ts.isStringLiteral(prop.initializer)) out.accessWord = prop.initializer.text;
    }
  }
  return out;
}

function readStorageAccess(
  accessArg: ts.TypeNode | undefined,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  name: string,
): StorageBufferAccess {
  if (accessArg === undefined) return inferredStorageAccess(sourceFile, name);
  const written =
    ts.isLiteralTypeNode(accessArg) && ts.isStringLiteral(accessArg.literal)
      ? accessArg.literal.text
      : undefined;
  if (written !== undefined && isStorageBufferAccess(written)) return written;
  const got = accessArg.getText(sourceFile);
  diagnostics.push(
    makeDiagnostic(
      sourceFile,
      accessArg,
      `storage<T, Access> Access is ${STORAGE_BUFFER_ACCESS.map((w) => `"${w}"`).join(' or ')}; ` +
        `got ${got}.` +
        (written === 'write'
          ? ` A storage BUFFER has no write-only mode; that is a storage texture's, ` +
            `texture_storage_2d<Format, "write">.`
          : ''),
      TS_CODES.UNKNOWN_TYPE,
    ),
  );
  return 'read_write';
}

function isStorageBufferAccess(word: string): word is StorageBufferAccess {
  return (STORAGE_BUFFER_ACCESS as readonly string[]).includes(word);
}

function checkHostShareable(
  binding: BindingDecl,
  structs: ReadonlyMap<string, StructDecl>,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  diagnostics: TsCompilerDiagnostic[],
): void {
  const space = binding.space === 'storage' ? 'storage' : 'uniform';
  const seen = new Set<string>();
  const walk = (t: ShaderType, path: string): void => {
    if (t.kind === 'scalar' && t.scalar === 'bool') {
      diagnostics.push(
        layoutDiag(
          sourceFile,
          node,
          `"${path}" is a bool; a ${space} struct holds numeric scalars only (WGSL's ` +
            `host-shareable rule). Use u32.`,
        ),
      );
      return;
    }
    if (t.kind === 'vec' && t.elem === 'bool') {
      diagnostics.push(
        layoutDiag(
          sourceFile,
          node,
          `"${path}" is a ${authorTypeText(t)}; a ${space} binding holds no bool, alone or in a ` +
            `vector (WGSL's host-shareable rule). Use vec${String(t.n)}u.`,
        ),
      );
      return;
    }
    if (t.kind === 'mat' && t.elem === 'f32' && t.rows === 2 && space === 'uniform') {
      // Implements: Rule 4.8
      diagnostics.push(
        layoutDiag(sourceFile, node, `"${path}" is in a uniform: ${twoRowStd140Reason(t.cols)}.`),
      );
      return;
    }
    if (t.kind === 'array') {
      if (t.size === undefined && space === 'uniform') {
        diagnostics.push(
          layoutDiag(
            sourceFile,
            node,
            `"${path}" is a list of no fixed length, which a uniform cannot hold: a uniform ` +
              `buffer has one size. Give it a length, array<T, N>, or declare "${binding.name}" ` +
              `as storage<T>.`,
          ),
        );
        return;
      }
      walk(t.elem, `${path}[]`);
      return;
    }
    if (t.kind !== 'struct') return;
    if (seen.has(t.name)) return;
    seen.add(t.name);
    const decl = structs.get(t.name);
    if (decl === undefined) return;
    const shown = authorTypeText(t);
    for (const [i, f] of decl.fields.entries()) {
      if (f.type.kind === 'array' && f.type.size === undefined && i !== decl.fields.length - 1) {
        diagnostics.push(
          layoutDiag(
            sourceFile,
            node,
            `"${shown}.${f.name}" is a list of no fixed length and is not the last field of ` +
              `"${shown}": nothing after it has an offset. Move it last, or give it a length.`,
          ),
        );
        continue;
      }
      walk(f.type, `${shown}.${f.name}`);
    }
  };
  walk(binding.type, binding.name);
}

function layoutDiag(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
): TsCompilerDiagnostic {
  return makeDiagnostic(sourceFile, node, message, TS_CODES.LAYOUT);
}

function jaggedWithin(
  t: ShaderType | undefined,
  structs: StructLookup,
  seen: Set<string> = new Set(),
): { readonly holder: ShaderType; readonly row: ShaderType; readonly path: string } | undefined {
  if (t === undefined) return undefined;
  if (t.kind === 'array') {
    if (t.elem.kind === 'array' && t.elem.size === undefined)
      return { holder: t, row: t.elem, path: '[i]' };
    const w = jaggedWithin(t.elem, structs, seen);
    return w === undefined ? undefined : { ...w, path: `[i]${w.path}` };
  }
  if (t.kind === 'struct') {
    if (seen.has(t.name)) return undefined;
    seen.add(t.name);
    for (const f of structs(t.name)?.fields ?? []) {
      const w = jaggedWithin(f.type, structs, seen);
      if (w !== undefined) return { ...w, path: `.${f.name}${w.path}` };
    }
  }
  return undefined;
}

function refuseJaggedArray(
  type: ShaderType | undefined,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  const within = jaggedWithin(type, structsHere);
  if (within === undefined || type === undefined) return false;
  const row = within.row.kind === 'array' ? within.row.elem : within.row;
  const field = within.path.replace(/\[i\]$/, '').replace(/^\./, '');
  const subject =
    field === ''
      ? `"${authorTypeText(type)}" is`
      : `"${authorTypeText(type)}" holds "${field}: ${authorTypeText(within.holder)}",`;
  diagnostics.push(
    makeDiagnostic(
      sourceFile,
      node,
      `${subject} a list of lists of no fixed length, and an array's element has a fixed size ` +
        `(WGSL). Hold the rows flat: the values in one array<${authorTypeText(row)}> and each ` +
        `row's first index in an array<u32> of offsets, read as "values[offsets[r] + k]".`,
      TS_CODES.UNKNOWN_TYPE,
    ),
  );
  return true;
}

function diag(sourceFile: ts.SourceFile, node: ts.Node, message: string): TsCompilerDiagnostic {
  return makeDiagnostic(sourceFile, node, message, TS_CODES.UNSUPPORTED);
}
