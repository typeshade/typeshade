// Top-level resource declarations.
//   const scale = uniform<f32>()
//   declare const camera: uniform<Camera>

import ts from 'typescript';
import type { BindingDecl, StructDecl } from '../../core/ir/nodes.js';
import { structT, type ShaderType } from '../../core/ir/types.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import { mapTsTypeToShaderType, HANDLE_TYPE_NAMES } from './type-map.js';
import { atomicWithin } from './lower/atomics.js';
import { recordDeclaration, type DeclaredSymbolSink } from './symbols.js';
import { isOverrideType } from './overrides.js';
import { TS_CODES } from './codes.js';
import { makeDiagnostic } from './diagnostic.js';
import { twoRowStd140Reason } from '../../core/std140.js';

/** The type names that are a resource HANDLE rather than a buffer: written bare in a
 *  `declare const`, with no address-space wrapper. `sampler` and the texture names are the
 *  whole set — {@link mapTsTypeToShaderType} owns what each one maps to. */
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
  /** The first slot a `declare` binding without an explicit one takes. A single file starts at
   *  0; a multi-file program (roadmap 0.5 item 14, #74) hands each later file the slot after
   *  the earlier files' last, so the bindings of one module are numbered in file order rather
   *  than every file starting at 0 and colliding. */
  firstBinding = 0,
  /** The structs already collected from this file, so a buffer binding's HOST-SHAREABLE rules
   *  can be read through its struct type (§51). Omitted, the struct-shaped rules are skipped;
   *  a caller that has the structs passes them. */
  structs: readonly StructDecl[] = [],
): BindingDecl[] {
  const out: BindingDecl[] = [];
  const byName = new Map(structs.map((s) => [s.name, s]));
  let next = firstBinding;
  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    const isConst = (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0;
    const isLet = (stmt.declarationList.flags & ts.NodeFlags.Let) !== 0;
    if (!isConst && !isLet) continue;
    const declared = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword) ?? false;
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
          recordDeclaration(symbols, sourceFile, decl.name, {
            name: b.name,
            kind: 'binding',
            type: b.type,
            mutable: !isConst,
          });
          next = Math.max(next, b.binding + 1);
        }
        continue;
      }
      // An override occupies no bind slot, so it must not take a binding number on the way
      // past — overrides.ts collects it (#8 A7).
      if (isOverrideType(decl.type)) continue;
      // `declare const brand: unique symbol` is the key of a nominal brand (roadmap 0.3 item
      // T10, #92). It declares no value: what uses it is a type, `f32 & { [brand]: 'm' }`,
      // which type-map.ts erases back to the f32. Nothing reaches the GPU, so nothing is
      // collected, and refusing it would refuse the type it exists for.
      if (decl.type?.kind === ts.SyntaxKind.TypeOperator) {
        const op = decl.type as ts.TypeOperatorNode;
        if (op.operator === ts.SyntaxKind.UniqueKeyword) continue;
      }
      if (declared && decl.type) {
        const b = fromType(decl.name.text, decl.type, isConst, sourceFile, diagnostics, next);
        if (b) {
          checkHostShareable(b, byName, sourceFile, decl.type, diagnostics);
          out.push(b);
          recordDeclaration(symbols, sourceFile, decl.name, {
            name: b.name,
            kind: 'binding',
            type: b.type,
            mutable: !isConst,
          });
          next = Math.max(next, b.binding + 1);
        }
      }
    }
  }
  // A repeated NAME, reported here rather than thrown from the scope later. Two
  // `declare const tex` threw `Duplicate binding "tex" in current scope frame` out of
  // `compile()` and out of the language service's `getDiagnostics()`, so the editor raised an
  // exception where it had shown a squiggle.
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
  return out;
}

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
  // A texture or a sampler is a HANDLE resource: it is written as the type itself, with no
  // uniform<> or storage<> wrapper, because it lives in no address space (#8 A7). It takes
  // the 'uniform' space the EDSL's `resource()` gives it — the field is not optional and
  // every backend keys the declaration off the TYPE, not off the space.
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
  const mapped =
    mapTsTypeToShaderType(inner, sourceFile, diagnostics) ??
    (ts.isTypeReferenceNode(inner) && ts.isIdentifier(inner.typeName)
      ? structT(inner.typeName.text)
      : undefined);
  if (!mapped) return undefined;
  // An atomic lives in storage memory only (WGSL §6.2.8): `uniform<array<atomic<u32>>>` is
  // refused here, where the address space is decided. A struct's fields are not looked into;
  // the struct collector has no address space to check them against.
  const atomic = kind === 'uniform' ? atomicWithin(mapped) : undefined;
  if (atomic !== undefined) {
    diagnostics.push(
      diag(
        sourceFile,
        type,
        `"${name}" holds an atomic<${atomic.elem}>, which lives in storage memory only: ` +
          `write "declare let ${name}: storage<${inner.getText(sourceFile)}>".`,
      ),
    );
    return undefined;
  }
  // A handle is written BARE — `declare const smp: sampler`. Wrapped, it was accepted and took
  // the wrapper's address space, which is not what either backend emits for one, and the doc
  // says bare. Caught here rather than in the type map, because this is the one path that
  // resolves a binding's declared type.
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
    access: kind === 'storage' ? (isConst ? 'read' : 'read_write') : undefined,
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
  const type =
    mapTsTypeToShaderType(typeArg, sourceFile, diagnostics) ??
    (ts.isTypeReferenceNode(typeArg) && ts.isIdentifier(typeArg.typeName)
      ? structT(typeArg.typeName.text)
      : undefined);
  if (!type) return undefined;
  if (kind === 'uniform' && !isConst) {
    diagnostics.push(
      diag(sourceFile, call, `uniform "${name}" must be const. Use const ${name} = uniform<T>().`),
    );
    return undefined;
  }
  let group = 0;
  let binding = autoBinding;
  let access: 'read' | 'read_write' | undefined =
    kind === 'storage' ? (isConst ? 'read' : 'read_write') : undefined;
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
    if (opt.access) access = kind === 'storage' ? opt.access : undefined;
  }
  return { group, binding, name, space: kind === 'storage' ? 'storage' : 'uniform', access, type };
}

function parseOptions(obj: ts.ObjectLiteralExpression): {
  group?: number;
  binding?: number;
  access?: 'read' | 'read_write';
} {
  const out: { group?: number; binding?: number; access?: 'read' | 'read_write' } = {};
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
    const key = prop.name.text;
    if ((key === 'group' || key === 'binding') && ts.isNumericLiteral(prop.initializer)) {
      out[key] = Number(prop.initializer.text);
    }
    if (key === 'access' && ts.isStringLiteral(prop.initializer)) {
      if (prop.initializer.text === 'read' || prop.initializer.text === 'read_write')
        out.access = prop.initializer.text;
    }
  }
  return out;
}

/** The WGSL rules a BUFFER binding's store type must satisfy (§51) — the ones a struct hides,
 *  which is why the type map cannot see them and the backend finds out too late.
 *
 *  Three rules, each measured against the Tint the compile gate runs:
 *
 *  - `bool` is not host-shareable in any address space: `type 'bool' cannot be used in address
 *    space 'uniform' as it is non-host-shareable`. The GLSL writer happily emits `out bool`
 *    into a std140 block, so this is a silent target divergence, not a shared failure.
 *  - A runtime-sized `array<T>` must be the LAST member of its struct; anything after it has
 *    no offset.
 *  - A runtime-sized array may not sit in the uniform address space at all: a uniform buffer's
 *    type must be constructible, and a runtime array is not.
 *
 *  Nested structs are walked, with a `seen` set so a cycle terminates. A cycle is NOT reported
 *  here: nothing in the front end reports one today (`interface A { b: B }` / `interface B { a:
 *  A }` compiles clean and Tint answers `cyclic dependency found: 'A' -> 'B' -> 'A'`), and that
 *  gap is older and wider than these rules. A binding whose struct this file did not collect is
 *  skipped rather than guessed at. */
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
    if (t.kind === 'mat' && t.elem === 'f32' && t.rows === 2 && space === 'uniform') {
      // Rule 4.8: a two-row matrix in a uniform block is refused with the remedy. It reached
      // the author as a TS8015 WARNING from the GLSL writer's layout, with the WGSL kept, so a
      // render module shipped a uniform the two targets lay out at different offsets.
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
    for (const [i, f] of decl.fields.entries()) {
      if (f.type.kind === 'array' && f.type.size === undefined && i !== decl.fields.length - 1) {
        diagnostics.push(
          layoutDiag(
            sourceFile,
            node,
            `"${t.name}.${f.name}" is a list of no fixed length and is not the last field of ` +
              `"${t.name}": nothing after it has an offset. Move it last, or give it a length.`,
          ),
        );
        continue;
      }
      walk(f.type, `${t.name}.${f.name}`);
    }
  };
  walk(binding.type, binding.name);
}

/** A `TS8051 LAYOUT` diagnostic: the host-shareable rules above, which are about the BYTES a
 *  binding lays out and not about whether the surface has the type. */
function layoutDiag(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
): TsCompilerDiagnostic {
  return makeDiagnostic(sourceFile, node, message, TS_CODES.LAYOUT);
}

function diag(sourceFile: ts.SourceFile, node: ts.Node, message: string): TsCompilerDiagnostic {
  return makeDiagnostic(sourceFile, node, message, TS_CODES.UNSUPPORTED);
}
