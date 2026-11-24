import { compileTsProgram } from './compiler/ts/source-file.js';
import { isShaderModulePath } from './compiler/ts/host-face.js';

export interface CacheKeyContext {
  readonly id: string;
  readonly sourceCode: string;
}

export type CacheKeyGenerator = (context: CacheKeyContext) => string | undefined | false;

export interface VitestPluginContext {
  defineCacheKeyGenerator(callback: CacheKeyGenerator): void;
}

interface SyncFs {
  readFileSync(path: string, encoding: 'utf8'): string;
}

const builtinFs = (): SyncFs | undefined => {
  const process = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } })
    .process;
  return process?.getBuiltinModule?.('node:fs') as SyncFs | undefined;
};

export function shaderCacheKeyGenerator(configuration: string): CacheKeyGenerator {
  return ({ id, sourceCode }) => {
    const path = id.split('?')[0]!.replace(/\\/g, '/');
    if (!isShaderModulePath(path)) return undefined;
    const fs = builtinFs();
    if (fs === undefined) return false;
    const readDocument = (fileName: string): string | undefined => {
      try {
        return fs.readFileSync(fileName, 'utf8');
      } catch {
        return undefined;
      }
    };
    const { result, linked } = compileTsProgram(sourceCode, {
      fileName: path,
      requireDirective: true,
      readDocument,
    });
    const files = linked?.linked.files.map((f) => f.name) ?? [result.sourceFile.fileName];
    const imported = files
      .filter((file) => file !== path)
      .map((file) => `${file}\n${readDocument(file) ?? ''}`);
    return [configuration, ...imported].join('\n\u0000\n');
  };
}
