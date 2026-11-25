import type ts from 'typescript';
import type { ShaderType } from '../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { makeDiagnostic } from '../diagnostic.js';
import { TS_CODES } from '../codes.js';
import {
  optionalAbsence,
  optionalT,
  optionalInner,
  mayBeOptional,
  type Absence,
} from './registry.js';
import type { StructLookup } from './values.js';

export interface OptionalWithin {
  readonly opt: ShaderType;
  readonly inner: ShaderType;
  readonly path: string;
}

export function optionalWithin(
  t: ShaderType | undefined,
  structs: StructLookup,
  seen: Set<string> = new Set(),
): OptionalWithin | undefined {
  if (t === undefined) return undefined;
  const inner = optionalInner(t);
  if (inner !== undefined) return { opt: t, inner, path: '' };
  if (t.kind === 'array') {
    const w = optionalWithin(t.elem, structs, seen);
    return w === undefined ? undefined : { ...w, path: `[i]${w.path}` };
  }
  if (t.kind === 'struct') {
    if (seen.has(t.name)) return undefined;
    seen.add(t.name);
    for (const f of structs(t.name)?.fields ?? []) {
      const w = optionalWithin(f.type, structs, seen);
      if (w !== undefined) return { ...w, path: `.${f.name}${w.path}` };
    }
  }
  return undefined;
}

// Why: WGSL forbids a `bool` in host-shareable memory, so the remedy names a `u32` flag.
export function refusedOptionalPosition(
  written: string,
  position: string,
  inner: string,
  holder?: { readonly type: string; readonly path: string },
  remedy: (inner: string) => string = (i) => `Carry a u32 flag beside the value, "${i}".`,
): string {
  const subject =
    holder === undefined
      ? `"${written}" holds`
      : `"${holder.type}" holds "${holder.path.replace(/^\./, '')}: ${written}",`;
  return (
    `${subject} a value and a flag saying whether it is there, which a local, a parameter, a ` +
    `function's result, a struct field or an array element may hold; ${position} may not. ` +
    remedy(inner)
  );
}

export function refuseOptionalAt(
  type: ShaderType | undefined,
  node: ts.Node,
  position: string,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[] | undefined,
  spell: (t: ShaderType) => string,
  structs: StructLookup = () => undefined,
  remedy?: (inner: string) => string,
): boolean {
  const within = optionalWithin(type, structs);
  if (within === undefined) return false;
  const mask = optionalAbsence(within.opt)!;
  const written = `${spell(within.inner)}${mask & 2 ? ' | null' : ''}${mask & 1 ? ' | undefined' : ''}`;
  diagnostics?.push(
    makeDiagnostic(
      sourceFile,
      node,
      refusedOptionalPosition(
        written,
        position,
        spell(within.inner),
        within.path === '' ? undefined : { type: spell(type!), path: within.path },
        remedy,
      ),
      TS_CODES.UNKNOWN_TYPE,
    ),
  );
  return true;
}

export function optionalDeclaredType(
  mapped: ShaderType | undefined,
  questionToken: ts.QuestionToken | undefined,
  subject: string,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  spell: (t: ShaderType) => string,
): ShaderType | undefined {
  if (mapped === undefined || questionToken === undefined) return mapped;
  const inner = optionalInner(mapped);
  if (inner !== undefined) return optionalT(inner, (optionalAbsence(mapped)! | 1) as Absence);
  if (mayBeOptional(mapped)) return optionalT(mapped);
  const name = spell(mapped);
  diagnostics.push(
    makeDiagnostic(
      sourceFile,
      questionToken,
      `${subject} would hold ${/^[aeiofAEIOF]/.test(name) ? 'an' : 'a'} ${name} and a flag ` +
        `saying whether it is there, and an optional holds what a function-scope struct field ` +
        `may: a scalar, a vector, a matrix, an array with a size or a struct.`,
      TS_CODES.UNKNOWN_TYPE,
    ),
  );
  return undefined;
}

const OMITTABLE = new WeakMap<ts.SourceFile, Set<string>>();

export function markOmittableField(sourceFile: ts.SourceFile, struct: string, field: string): void {
  let set = OMITTABLE.get(sourceFile);
  if (set === undefined) {
    set = new Set();
    OMITTABLE.set(sourceFile, set);
  }
  set.add(`${struct}.${field}`);
}

export function isOmittableField(
  sourceFile: ts.SourceFile,
  struct: string,
  field: string,
): boolean {
  return OMITTABLE.get(sourceFile)?.has(`${struct}.${field}`) ?? false;
}
