// The journey's Node consumer imports plain JS, including on Node 20. Stage the same
// private browser helper rather than maintaining another backend parser in the harness.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

export function stageGateBrowser(work: string): string {
  const emitted = ts.transpileModule(
    readFileSync(new URL('./gate-browser.ts', import.meta.url), 'utf8'),
    {
      fileName: 'gate-browser.ts',
      reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    },
  );
  const errors =
    emitted.diagnostics?.filter((d) => d.category === ts.DiagnosticCategory.Error) ?? [];
  if (errors.length > 0)
    throw new Error(
      `cannot stage the GPU gate helper: ${errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n')}`,
    );
  const out = resolve(work, 'gate-browser.mjs');
  writeFileSync(out, emitted.outputText);
  return pathToFileURL(out).href;
}
