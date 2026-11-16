// Source spelling and its synchronous compilation scopes.
// Linked origins and written struct names have independent lifetimes. Each scope restores
// its previous value in finally, including nested compilation and compiler failures.

import ts from 'typescript';
import type { ShaderType } from '../../core/ir/types.js';
import { CAS_RESULT_STRUCTS } from '../../core/ir/types.js';
import { logicalTypeKey as typeKey, optionalInner, optionalAbsence } from './optional.js';
import { authorTypeName } from './type-map.js';

/** A struct the module emits under a name the author did not write, and what they wrote: a
 *  class inside a namespace is emitted `N_P` and written `N.P` (#107), an instance of a generic
 *  class is emitted `Slot_f32` and written `Slot<f32>` (T9, #92). The emitted name is one the
 *  editor does not know (TS2304 "Cannot find name 'N_P'"), so a message that printed it named
 *  a type the author cannot find. */
interface WrittenStruct {
  /** The class's name behind the namespaces that hold it, dotted: `N.P`. */
  readonly name: string;
  /** What its type parameters are bound to, in the order it declares them; empty for a class
   *  that is not generic. */
  readonly args: readonly ShaderType[];
  /** The name the class's statics are emitted under, which no type argument reaches: `N_P`,
   *  `Slot` for the struct `Slot_f32`. */
  readonly base: string;
}

/** The written form of each struct of the module being compiled whose emitted name is not what
 *  the author wrote. Dynamically scoped, for the reason `generics.ts` binds type arguments that
 *  way: every message that names a type reaches {@link authorTypeText} many frames below the
 *  compile that collected the structs, and threading the table down would touch every lowering
 *  signature. {@link withWrittenStructs} restores what it found. */
let WRITTEN_STRUCTS: ReadonlyMap<string, WrittenStruct> | undefined;

/** Run `f`, one compile, with no struct's written form in force until {@link useWrittenStructs}
 *  binds the ones it collects, and restore whatever was in force before. */
export function withWrittenStructs<R>(f: () => R): R {
  const saved = WRITTEN_STRUCTS;
  WRITTEN_STRUCTS = undefined;
  try {
    return f();
  } finally {
    WRITTEN_STRUCTS = saved;
  }
}

/** While a linked source (Rule 3.9, `link.ts`) is lowered: that source, and the file and the text
 *  each of its spans was written as. The linker renames a declaration two files of one program
 *  share (Rule 3.2), and a sentence still names it as its own file writes it. */
export interface LinkedOrigin {
  readonly sourceFile: ts.SourceFile;
  /** Every file of the program as `written` names it, the file it starts from first, then in
   *  the order the linker read them. */
  readonly files: readonly string[];
  readonly written: (
    start: number,
    end: number,
  ) => { readonly file: string; readonly text: string } | undefined;
}

let LINKED_ORIGIN: LinkedOrigin | undefined;

/** Run `f`, the lowering of the linked source `origin.sourceFile`, with {@link writtenName} and
 *  {@link sameFile} reading `origin`, and restore whatever was in force before. */
export function withLinkedOrigin<R>(origin: LinkedOrigin, f: () => R): R {
  const saved = LINKED_ORIGIN;
  LINKED_ORIGIN = origin;
  try {
    return f();
  } finally {
    LINKED_ORIGIN = saved;
  }
}

/** A declared name as its own file writes it: `hash` for the `b_hash` the linker emits. */
export function writtenName(id: ts.Identifier): string {
  const sf = id.getSourceFile();
  if (LINKED_ORIGIN?.sourceFile !== sf) return id.text;
  return LINKED_ORIGIN.written(id.getStart(sf), id.getEnd())?.text ?? id.text;
}

/** The text of `node` as its own file writes it: `hash(p)` for the `b_hash(p)` the linker
 *  emits. */
export function writtenText(node: ts.Node): string {
  const sf = node.getSourceFile();
  if (LINKED_ORIGIN?.sourceFile !== sf) return node.getText(sf);
  return LINKED_ORIGIN.written(node.getStart(sf), node.getEnd())?.text ?? node.getText(sf);
}

/** The text from `start` to `end` of `sf` as its own file writes it, where the linker joined
 *  files into `sf`; the text of `sf` itself otherwise or where the range maps to no one file. */
export function writtenRange(sf: ts.SourceFile, start: number, end: number): string {
  if (LINKED_ORIGIN?.sourceFile !== sf) return sf.text.slice(start, end);
  return LINKED_ORIGIN.written(start, end)?.text ?? sf.text.slice(start, end);
}

/** Whether `a` and `b` were written in one file: one file of the program a linked source joins,
 *  or the one source being lowered. */
export function sameFile(a: ts.Node, b: ts.Node): boolean {
  const sf = a.getSourceFile();
  if (b.getSourceFile() !== sf) return false;
  const origin = LINKED_ORIGIN;
  if (origin?.sourceFile !== sf) return true;
  const fileOf = (n: ts.Node): string | undefined =>
    origin.written(n.getStart(sf), n.getStart(sf))?.file;
  return fileOf(a) === fileOf(b);
}

/** Which file of the program `node` was written in: its index in {@link LinkedOrigin.files},
 *  0 for the file the program starts from and for a source that is not linked. */
export function programFileOf(node: ts.Node): number {
  const sf = node.getSourceFile();
  const origin = LINKED_ORIGIN;
  if (origin?.sourceFile !== sf) return 0;
  const file = origin.written(node.getStart(sf), node.getStart(sf))?.file;
  const at = file === undefined ? -1 : origin.files.indexOf(file);
  return at < 0 ? 0 : at;
}

/** What {@link useWrittenStructs} reads a struct's written form off: the name it is emitted
 *  under, the class declaration it comes from, and what that class's type parameters are bound
 *  to. A `CollectedStruct` is one. */
export interface StructOrigin {
  readonly decl: { readonly name: string };
  readonly classNode?: ts.ClassDeclaration;
  readonly binding?: ReadonlyMap<string, ShaderType>;
}

/** Binds the written form of every class in `structs` whose emitted name differs from it, for
 *  the rest of the compile {@link withWrittenStructs} is running. Read off the declaration the
 *  struct was collected from, not off its emitted name, which cannot be split back: a
 *  top-level class may be called `N_P` itself. */
export function useWrittenStructs(structs: readonly StructOrigin[]): void {
  const written = new Map<string, WrittenStruct>();
  for (const s of structs) {
    const node = s.classNode;
    if (node?.name === undefined) continue;
    // `path` is the class as the module names it, `shown` as its own file does: the two differ
    // where the linker renamed a declaration another file of the program shares (Rule 3.2).
    const path = [node.name.text];
    const shown = [writtenName(node.name)];
    for (let at: ts.Node = node.parent; !ts.isSourceFile(at); at = at.parent) {
      if (ts.isModuleDeclaration(at)) {
        path.unshift(at.name.text);
        shown.unshift(ts.isIdentifier(at.name) ? writtenName(at.name) : at.name.text);
      }
    }
    const args = (node.typeParameters ?? []).flatMap((p) => s.binding?.get(p.name.text) ?? []);
    const name = shown.join('.');
    if (name !== s.decl.name || args.length > 0) {
      written.set(s.decl.name, { name, args, base: path.join('_') });
    }
  }
  WRITTEN_STRUCTS = written;
}

/** The class the struct `name` is emitted from, for a sentence about one of its statics: as the
 *  author names it with no type arguments (`N.P`, `Slot` for the struct `Slot_f32`), the name
 *  its statics are emitted under (`N_P`, `Slot`), and whether a namespace holds it. A class
 *  written as it is emitted is its own struct's name. */
export function classOfStruct(name: string): {
  readonly written: string;
  readonly base: string;
  readonly inNamespace: boolean;
} {
  const w = WRITTEN_STRUCTS?.get(name);
  if (w === undefined) return { written: name, base: name, inNamespace: false };
  return { written: w.name, base: w.base, inNamespace: w.name.includes('.') };
}

/** How a diagnostic spells a type back to the author (Rule 12.1, Rule 12.7): a message the front
 *  end writes names the type of a value, a field, a parameter or a return through this, and a
 *  class its sentence is about as a whole (`Struct "N.E" has no fields`, `"N.D" extends
 *  "Missing"`), and so does the interstage check it runs from `src/core`. A sentence about one
 *  member of a class names the member its own way (`class-methods.ts`), and so does one that
 *  `new` says of the class it builds. {@link typeKey} is the COMPILER's key and is NOT a spelling: it
 *  writes a struct as `struct:Params`, an array with no space after the comma, and a vector or a
 *  non-square matrix with a type argument the ambient library does not declare (`vec4<f32>`,
 *  `mat2x3<f32>`). A remedy quoting any of those goes red the moment the author pastes it —
 *  measured, `declare const a: storage<array<vec4<f32>>, "read_write">` is TS2315 "Type 'vec4' is
 *  not generic" in the editor while the compiler is clean — and a message naming one names a type
 *  the editor says does not exist.
 *
 *  So this spells the type in the SOURCE language, and every name it can produce comes from
 *  {@link authorTypeName}, the inverse of the very table `type-map.ts` parses a declaration
 *  with. A type spelled from its parts is composed here: a struct is its name as written
 *  ({@link useWrittenStructs}: `N.P`, `Slot<f32>`), an array is `array<E>` or `array<E, N>`
 *  with a space after the comma, an atomic is `atomic<u32>`, a storage texture takes its
 *  format and access as the string literals the author writes.
 *  `remedy-lines.test.ts` pastes every remedy back into its own program and is what keeps
 *  this honest.
 */
export function authorTypeText(t: ShaderType): string {
  switch (t.kind) {
    case 'struct': {
      // An optional value is written as TypeScript writes it (change 0088).
      const inner = optionalInner(t);
      if (inner !== undefined)
        return `${authorTypeText(inner)}${optionalAbsence(t)! & 2 ? ' | null' : ''}${optionalAbsence(t)! & 1 ? ' | undefined' : ''}`;
      const written = WRITTEN_STRUCTS?.get(t.name);
      if (written !== undefined) {
        return written.args.length > 0
          ? `${written.name}<${written.args.map(authorTypeText).join(', ')}>`
          : written.name;
      }
      // What `atomicCompareExchangeWeak` returns is a struct WGSL predeclares and no one
      // writes; the ambient library declares the call to return this object type, and it is
      // what the editor shows for it.
      const cas = CAS_RESULT_STRUCTS.find((c) => c.name === t.name);
      if (cas !== undefined) {
        return `{ ${cas.fields.map((f) => `${f.name}: ${authorTypeText(f.type)}`).join('; ')} }`;
      }
      return t.name;
    }
    case 'array':
      return t.size !== undefined
        ? `array<${authorTypeText(t.elem)}, ${t.sizeOverride ?? t.size}>`
        : `array<${authorTypeText(t.elem)}>`;
    // `atomic<u32>` is written exactly as WGSL writes it, and the element is a bare scalar
    // name rather than a nested `ShaderType`, so it is composed here and not looked up.
    case 'atomic':
      return `atomic<${t.elem}>`;
    // A kernel function's `Set<K>` or `Map<K, V>` (change 0080), as ECMAScript spells it.
    case 'collection':
      return t.value === undefined ? `Set<${t.key}>` : `Map<${t.key}, ${authorTypeText(t.value)}>`;
    case 'storage-texture': {
      const name = t.dim === '2d-array' ? 'texture_storage_2d_array' : 'texture_storage_2d';
      return `${name}<"${t.format}", "${t.access}">`;
    }
    default:
      // A SQUARE `f64` matrix is the one shape with no row in the parse table (it goes through
      // the generic `matN<f64>` arm), and `typeKey` already writes what an author writes for
      // it, `mat3x3<f64>`. Every other type without a name of its own is a sampled or depth
      // texture, a sampler or `void`, which `typeKey` writes as the author does.
      return authorTypeName(t) ?? typeKey(t);
  }
}
