// Verifies: Rule 11.9, Rule 11.10, Rule 11.11.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { packModule } from './pack.js';
import { hostFace } from './host-face.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const SOURCE = readFileSync(
  new URL('../../../journeys/_console-variants/console.shade.ts', import.meta.url),
  'utf8',
);
const fileName = 'console.shade.ts';
function both(source = SOURCE) {
  const result = compile(source, { fileName });
  expect(result.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const service = createTypeshadeLanguageService();
  service.openDocument(fileName, source);
  expect(service.getDiagnostics(fileName)).toEqual([]);
  return result.module!;
}

describe('retained console variants (change 0085)', () => {
  it('retains reachable calls by default without enabling them or adding IR', () => {
    const module = both();
    const pack = packModule(module);
    expect(pack.schema).toBe(2);
    expect(pack.console).toBeUndefined();
    expect(pack.ir).toBeUndefined();
    expect(pack.wgsl).not.toContain('_console');
    expect(pack.variants?.console?.wgsl).toContain('_console');
    expect(pack.variants?.console?.log.sites).toHaveLength(1);
    expect(pack.variants?.console).toEqual(packModule(module, { console: true }).console);
    expect(JSON.parse(JSON.stringify(pack))).toEqual(pack);
    expect(packModule(module, { console: false })).toEqual(pack);
    const enabled = packModule(module, { console: true });
    expect(enabled.variants).toBeUndefined();
    const stripped = packModule(module, { console: 'never' });
    expect(stripped.console).toBeUndefined();
    expect(stripped.variants).toBeUndefined();
  });

  it('omits variants without reachable calls and preserves explicit host-face stripping', () => {
    const unreachable = SOURCE.replace('  report(gid.x);', '');
    expect(packModule(both(unreachable)).variants).toBeUndefined();
    const quiet = SOURCE.replace('console.log("retained", i, 7.25);', '');
    expect(packModule(both(quiet)).variants).toBeUndefined();
    const packOf = (console?: 'gpu' | 'never') => {
      const face = hostFace(SOURCE, { fileName, ...(console === undefined ? {} : { console }) });
      expect(face.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
      return JSON.parse(/^export default (\{.*\});$/m.exec(face.code!)![1]!);
    };
    expect(packOf().variants.console.wgsl).toContain('_console');
    expect(packOf('gpu').console.wgsl).toContain('_console');
    expect(packOf('never').variants).toBeUndefined();
  });
});
