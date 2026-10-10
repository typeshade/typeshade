import { readFileSync } from 'node:fs';
import { compile, compileModule, compileModuleJs, packModule } from '../../dist/src/index.js';
export function compileExperiment() {
  const result = compile(readFileSync(new URL('./softmax.shade.ts', import.meta.url), 'utf8'));
  if (result.diagnostics.length) throw new Error(JSON.stringify(result.diagnostics));
  return result.module;
}
export function cpuBackend(bindings, { precision = 'f32', oracle = false } = {}) {
  const module = compileExperiment();
  const cpu = (oracle ? compileModule : compileModuleJs)(module, { precision });
  for (const [name, value] of Object.entries(bindings)) cpu.setBinding(name, value);
  return {
    tier: oracle ? `cpu-oracle-${precision}` : `cpu-generated-${precision}`,
    async dispatch(entry, batch) {
      cpu.setBinding('batch', batch);
      const n =
        entry === 'reduce' ? 1 : entry === 'backward' || entry === 'update' ? 7840 : batch.count;
      for (let i = 0; i < n; i++) cpu.fns[entry]([i, 0, 0]);
    },
    async read(name) {
      return bindings[name].slice();
    },
    destroy() {},
  };
}
export function manifest() {
  return packModule(compileExperiment());
}
