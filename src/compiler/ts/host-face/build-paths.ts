import type { TsCompilerDiagnostic } from '../source-file.js';

export const hostViewPath = (path: string): string => path.replace(/\.ts$/, '.typeshade.ts');

export const isShaderModulePath = (path: string): boolean => path.endsWith('.shade.ts');

export function formatBuildErrors(diagnostics: readonly TsCompilerDiagnostic[]): string {
  return diagnostics
    .filter((d) => d.category === 'error')
    .map((d) =>
      `${d.fileName}:${d.line}:${d.character} ${d.code ?? ''} ${d.message}`.replace(/  +/, ' '),
    )
    .join('\n');
}
