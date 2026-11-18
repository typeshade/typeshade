import ts from 'typescript';
import {
  ALL_STORAGE_TEXTURE_FORMATS,
  READ_WRITE_STORAGE_FORMATS,
  WRITE_ONLY_STORAGE_FORMATS,
  storageFormatFeature,
  type ShaderType,
  type StorageTextureFormat,
} from '../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { makeDiagnostic } from '../diagnostic.js';
import { TS_CODES } from '../codes.js';

const literalText = (node: ts.TypeNode | undefined): string | undefined =>
  node !== undefined && ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)
    ? node.literal.text
    : undefined;

export function mapStorageTexture(
  name: string,
  dim: '2d' | '2d-array',
  args: readonly ts.TypeNode[],
  typeNode: ts.TypeReferenceNode,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[] | undefined,
): ShaderType | undefined {
  const refuse = (message: string): void => {
    diagnostics?.push(makeDiagnostic(sourceFile, typeNode, message, TS_CODES.UNKNOWN_TYPE));
  };
  const format = literalText(args[0]);
  if (
    format === undefined ||
    !(ALL_STORAGE_TEXTURE_FORMATS as readonly string[]).includes(format)
  ) {
    refuse(
      `${name}<Format, Access> needs a texel format written as a string, one of ` +
        `${ALL_STORAGE_TEXTURE_FORMATS.map((f) => `"${f}"`).join(', ')}. ` +
        `All but the last are the formats every WebGPU device stores to with no feature ` +
        `requested, and "bgra8unorm" is the one that needs "bgra8unorm-storage"; a format ` +
        `outside them compiles and then fails when the host builds the bind group.`,
    );
    return undefined;
  }
  const access = literalText(args[1]) ?? 'write';
  if (access !== 'write' && access !== 'read' && access !== 'read_write') {
    refuse(`${name}<Format, Access> Access is "write", "read" or "read_write"; got "${access}".`);
    return undefined;
  }
  // Why: measured on two Chromium builds with every adapter feature requested, `bgra8unorm`
  // binds at `write-only` only; checked before the read_write list so its reason is this one.
  if (access !== 'write' && (WRITE_ONLY_STORAGE_FORMATS as readonly string[]).includes(format)) {
    const feature = storageFormatFeature(format as StorageTextureFormat);
    refuse(
      `"${format}" is "write" only. A device that requested ` +
        `"${feature ?? "the format's feature"}" stores to it and does not load from it, so ` +
        `"${access}" is refused at the bind group whatever Tint says about the module. ` +
        `Write to it and read the same texture through a sampled binding.`,
    );
  } else if (
    access === 'read_write' &&
    !(READ_WRITE_STORAGE_FORMATS as readonly string[]).includes(format)
  ) {
    refuse(
      `"${format}" cannot be read_write. A device stores AND loads through the same binding ` +
        `only at ${READ_WRITE_STORAGE_FORMATS.map((f) => `"${f}"`).join(', ')}; every other ` +
        `format is "write" or "read", one at a time. Take two bindings over the same texture ` +
        `if this one has to be both.`,
    );
  }
  return { kind: 'storage-texture', dim, format: format as StorageTextureFormat, access };
}
