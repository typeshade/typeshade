// The public host option types, checked by build on each supported TypeScript version (0085).
// Verifies: Rule 11.8.
import { expectTypeOf, it } from 'vitest';
import { createDevice, type Device, type DeviceOptions } from '../runtime.js';
import type { DeviceOptions as RootOptions } from '../index.js';

const probes = (): void => {
  void createDevice();
  void createDevice({ prefer: ['cpu'], fp64Flavor: 'auto' });
  void createDevice({ device: {}, fp64Flavor: 'integer', poolBytes: 0 });
  void createDevice({ runtime: { device: {} }, fp64Flavor: 'float' });
  void createDevice({
    prefer: ['webgpu'],
    limits: { maxBufferSize: 1024 },
    features: ['shader-f16'],
  });
  void createDevice({ device: {}, limits: {}, features: [] });
  void createDevice({ runtime: { device: {} }, features: ['shader-f16'] });
  const extended: DeviceOptions & { label?: string } = { device: {}, label: 'shared' };
  void createDevice(extended);
  // @ts-expect-error a device and a tier preference are mutually exclusive
  void createDevice({ device: {}, prefer: ['cpu'] });
  // @ts-expect-error a device and a runtime are mutually exclusive
  void createDevice({ device: {}, runtime: { device: {} } });
  // @ts-expect-error a runtime and a tier preference are mutually exclusive
  void createDevice({ runtime: { device: {} }, prefer: ['cpu'] });
  // @ts-expect-error a conflicting hoisted value is refused too
  const invalid: DeviceOptions = { device: {}, prefer: ['webgpu'] };
  // @ts-expect-error unsupported flavor setting
  void createDevice({ fp64Flavor: 'fast' });
  // @ts-expect-error a limit value is numeric
  void createDevice({ limits: { maxBufferSize: 'large' } });
  // @ts-expect-error feature names form a list
  void createDevice({ features: 'shader-f16' });
  void invalid;
};

it('shares the root and runtime types and reports a resolved flavor', () => {
  expectTypeOf<RootOptions>().toEqualTypeOf<DeviceOptions>();
  expectTypeOf<Device['fp64Flavor']>().toEqualTypeOf<'float' | 'integer'>();
  void probes;
});
