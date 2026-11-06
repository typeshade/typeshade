// Observe only a new fixture's shader creation. Calling the native method unchanged keeps the
// real compiler in charge; matching pixels alone cannot prove the requested fp64 flavor ran.
type Flavor = 'float' | 'integer';
type Descriptor = { code: string };
type Factory = (descriptor: Descriptor) => unknown;

export function observeDrawShaders(entry: string) {
  const prototype = (
    globalThis as unknown as { GPUDevice?: { prototype: { createShaderModule: Factory } } }
  ).GPUDevice?.prototype;
  if (prototype === undefined) throw new Error('the draw shader observer needs WebGPU');
  const original = prototype.createShaderModule;
  const seen: Record<Flavor, Set<string>> = { float: new Set(), integer: new Set() };
  let selected: Flavor = 'float';
  prototype.createShaderModule = function (this: unknown, ...args: Parameters<Factory>): unknown {
    const [descriptor] = args;
    if (descriptor.code.includes(`fn ${entry}(`)) seen[selected].add(descriptor.code);
    return Reflect.apply(original, this, args);
  };
  return {
    select(flavor: Flavor): void {
      selected = flavor;
    },
    verify(): void {
      const guarded = (code: string): boolean => /var\s+_fp64\s*:/.test(code);
      if (seen.float.size === 0 || ![...seen.float].every(guarded))
        throw new Error(`${entry}: the float WebGPU shader did not declare its runtime guard`);
      if (seen.integer.size === 0 || [...seen.integer].some(guarded))
        throw new Error(`${entry}: the integer WebGPU shader did not omit the runtime guard`);
      if ([...seen.integer].some((code) => seen.float.has(code)))
        throw new Error(`${entry}: float and integer WebGPU used the same shader text`);
    },
    close(): void {
      prototype.createShaderModule = original;
    },
  };
}
