// Implements: Rule 6.1, Rule 6.2 (docs/language-design.md; traced in reqs/).
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
import { recordCallFormBinding, recordRecoveredBinding } from './context.js';
import { isOverrideType } from './overrides.js';
import { TS_CODES } from './codes.js';
import { makeDiagnostic } from './diagnostic.js';
import { twoRowStd140Reason } from '../../core/std140.js';

/** The two access modes a storage BUFFER may take, WGSL's own words for
 *  `var<storage, read>` and `var<storage, read_write>`. A storage buffer has no write-only
 *  mode: `write` is a storage TEXTURE's, and `StorageTextureAccess` carries that set.
 *
 *  This is the one list. `ambient.ts` re-exports it (the way it re-exports `ATTRIBUTE_NAMES`
 *  from `builtin-check.ts`) and generates the library's `StorageBufferAccess` union from it, so
 *  the words the editor accepts and the words this file reads out of a declaration cannot
 *  drift. An export is not an author-facing name; the DECLARED name is the union in `SHADE_DTS`.
 */
export const STORAGE_BUFFER_ACCESS = ['read', 'read_write'] as const;

/** An access mode as it is written and as {@link BindingDecl.access} carries it. */
export type StorageBufferAccess = (typeof STORAGE_BUFFER_ACCESS)[number];

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
            // A binding is always declared `const` now, so the keyword carries nothing: what
            // the editor's table calls mutable is what the declared type asked for
            // (`storage<T, "read_write">`). `function.ts` derives the lowering scope's
            // `mutable` from the same field, so the two tables agree by construction.
            mutable: b.access === 'read_write',
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
            // A binding is always declared `const` now, so the keyword carries nothing: what
            // the editor's table calls mutable is what the declared type asked for
            // (`storage<T, "read_write">`). `function.ts` derives the lowering scope's
            // `mutable` from the same field, so the two tables agree by construction.
            mutable: b.access === 'read_write',
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
  // THE TYPE ARGUMENT IS READ FIRST, before the declaration keyword, because the keyword's
  // refusal quotes the line to write and that line has to name the type the author wrote. On
  // `declare let s: storage` there is none: the keyword sentence used to quote a literal `T`
  // beside a second `storage<T> needs a type argument.`, two sentences for one mistake, and
  // the first named a type nobody had written.
  const inner = type.typeArguments?.[0];
  if (!inner) {
    diagnostics.push(diag(sourceFile, type, `${kind}<T> needs a type argument.`));
    return undefined;
  }
  let access: StorageBufferAccess | undefined;
  if (kind === 'storage') {
    // The word the author wrote, on BOTH keyword paths. Forcing `read_write` on the `let` path
    // discarded an explicit `"read"` — the refusal named the opposite mode to the one the
    // declaration asked for — and skipped the word check, so `storage<T, "nope">` under a `let`
    // got no `TS8002` at all. An absent argument is the one thing the keyword still decides:
    // WGSL's default is `read`, and a `let` author wanted to write.
    access =
      type.typeArguments?.[1] !== undefined
        ? readStorageAccess(type.typeArguments[1], sourceFile, diagnostics)
        : isConst
          ? 'read'
          : 'read_write';
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
  // A binding is declared `const`. The keyword used to decide a storage binding's access mode,
  // which was never something a reader could rely on: a TypeScript `const` array forbids
  // rebinding the name and permits `arr[0] = 1`, the opposite of what `declare const` meant
  // here. The mode is the second type argument now (design rule 6.2), and the keyword is
  // refused. REPORTED AND RECOVERED: dropping the binding here trails `TS8022 Unknown
  // identifier "gain"` at every use, which buries the one sentence the author has to read, so
  // this collects the binding anyway the way type-map.ts recovers a storage texture no device
  // binds (T10, #111). The line it quotes carries the access mode read above, so an author who
  // wrote `declare let x: storage<T, "read">` is not told to write `"read_write"`.
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
  // WHETHER THE TYPE READ is measured, not guessed: a refusal pushed while mapping it is the
  // one fact that says the `ShaderType` below is a RECOVERY and not what the author declared.
  // A remedy built from a recovered type quotes a line that is refused again (see
  // `recordRecoveredBinding`), so the site that would quote one is told not to.
  const beforeType = diagnostics.length;
  const mapped =
    mapTsTypeToShaderType(inner, sourceFile, diagnostics) ??
    (ts.isTypeReferenceNode(inner) && ts.isIdentifier(inner.typeName)
      ? structT(inner.typeName.text)
      : undefined);
  if (diagnostics.slice(beforeType).some((d) => d.category === 'error')) {
    recordRecoveredBinding(sourceFile, name);
  }
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
          `write "declare const ${name}: storage<${inner.getText(sourceFile)}, ` +
          `\"read_write\">".`,
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
  // The same measurement the `declare` form makes, for the same reason.
  const beforeType = diagnostics.length;
  const type =
    mapTsTypeToShaderType(typeArg, sourceFile, diagnostics) ??
    (ts.isTypeReferenceNode(typeArg) && ts.isIdentifier(typeArg.typeName)
      ? structT(typeArg.typeName.text)
      : undefined);
  if (diagnostics.slice(beforeType).some((d) => d.category === 'error')) {
    recordRecoveredBinding(sourceFile, name);
  }
  if (!type) return undefined;
  if (!isConst) {
    // The same rule as the `declare` form: a binding is `const`, and a storage binding asks
    // for a writable buffer in its type. Measured on main, `let xs = storage<f32>()` is
    // already dead through the whole front end (`module-vars.ts` collects it too and it ends
    // as `TS8004 Unknown function "storage<f32>()"`), so what changes here is which sentence
    // the author reads, and the binding is dropped as it always was.
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
    access = readStorageAccess(call.typeArguments?.[1], sourceFile, diagnostics);
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
  // The options object as it should read, filled in by the arm below when there is one.
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
    // The option is gone, and it is NOT dropped silently: the whole point of moving the mode
    // into the type is that an author who asks for a writable buffer gets one, so a file that
    // still carries the option reads the type-argument spelling to write instead. Reported and
    // ignored; the mode comes from the type argument above.
    if (opt.access !== undefined) {
      const args = keptOptions === '' ? '' : `{ ${keptOptions} }`;
      const typeText = typeArg.getText(sourceFile);
      // The word is VALIDATED before it is named. Echoing the author's own word back made the
      // remedy quote a line the same file refuses: `{ access: "write" }` was answered with
      // `storage<…, "write">`, which is `TS8002` the moment it is written. A word outside the
      // two recovers as `read_write`, the mode this option was written to ask for.
      const word =
        opt.accessWord !== undefined && isStorageBufferAccess(opt.accessWord)
          ? opt.accessWord
          : 'read_write';
      diagnostics.push(
        diag(
          sourceFile,
          opt.access,
          // A UNIFORM has no access mode at all, so the storage sentence was false about it
          // twice over: it opened "a storage binding's access mode is its second type
          // argument" about a uniform, and the line it named was a two-type-argument
          // `uniform<…>`, which the arm above refuses with `TS8002`.
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
  // The argument list a later refusal quotes back, so a remedy names the line this file HAS
  // rather than the `declare const` form of it, which would be a second resource of the same
  // name (`TS8023 Duplicate resource`) if it were pasted in. The retired `{ access }` option is
  // NOT echoed: the sentence above already says to drop it, and a remedy that carried it would
  // quote a line this file refuses.
  recordCallFormBinding(sourceFile, name, callArgsText(call, sourceFile, keptOptions));
  return { group, binding, name, space: kind === 'storage' ? 'storage' : 'uniform', access, type };
}

/** The call form's argument list as a remedy quotes it: what the author wrote, with the
 *  retired `{ access }` option removed. `keptOptions` is the rest of the object literal, or
 *  `undefined` when the call's argument is not one. */
function callArgsText(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  keptOptions: string | undefined,
): string {
  if (keptOptions !== undefined) return keptOptions === '' ? '()' : `({ ${keptOptions} })`;
  return `(${call.arguments.map((a) => a.getText(sourceFile)).join(', ')})`;
}

/** The `{ group, binding }` a call form may pass. `access` is no longer one of them: the key is
 *  returned as the NODE that spells it so `fromCall` can put the squiggle under it and quote the
 *  type-argument spelling to write, and `accessWord` is what the author asked for so the remedy
 *  names the mode they meant rather than guessing. */
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

/** The access mode a `storage<T, Access>` declaration asks for, read off the second type
 *  argument. An absent argument is `read`, WGSL's own default for the address space. Anything
 *  that is not one of {@link STORAGE_BUFFER_ACCESS} is `TS8002`, the code `mapStorageTexture`
 *  already raises for a bad `texture_storage_2d<Format, Access>` word, and recovers as
 *  `read_write`: measured, recovering as `read` makes the author's own write a second `TS8005`
 *  on the same program, and recovering as `read_write` leaves exactly one sentence. The reader
 *  is the shape `mapStorageTexture`'s own `written()` helper uses, which is the precedent for
 *  reading a WGSL enumerant out of a string literal type. */
function readStorageAccess(
  accessArg: ts.TypeNode | undefined,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): StorageBufferAccess {
  if (accessArg === undefined) return 'read';
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
        // The storage-TEXTURE sentence answers one mistake — asking a buffer for the write-only
        // mode — and was printed for every other one too, so `storage<array<f32>, "nope">` and
        // a non-literal argument were each answered with advice about `"write"` they had
        // nothing to do with.
        (written === 'write'
          ? ` A storage BUFFER has no write-only mode; that is a storage texture's, ` +
            `texture_storage_2d<Format, "write">.`
          : ''),
      TS_CODES.UNKNOWN_TYPE,
    ),
  );
  return 'read_write';
}

/** Whether a word is one of {@link STORAGE_BUFFER_ACCESS}. THE one reader of that list: the
 *  type-argument path narrows a string literal type through it and the retired-`{ access }`
 *  refusal narrows the author's option through it, so neither can name a word the other
 *  refuses. It used to be `written === 'read' || written === 'read_write'` written out here,
 *  which is what made the "one list, cannot drift" claim above untrue — a word added to the
 *  array would have reached the editor's `StorageBufferAccess` union and the sentence below
 *  while this parser still rejected it. */
function isStorageBufferAccess(word: string): word is StorageBufferAccess {
  return (STORAGE_BUFFER_ACCESS as readonly string[]).includes(word);
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
