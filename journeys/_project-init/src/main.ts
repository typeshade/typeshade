import { createDevice } from 'typeshade/runtime';
import { twice } from './ops.shade.ts';

async function run(): Promise<number[]> {
  const device = await createDevice({ prefer: ['webgpu'] });
  try {
    const input = device.array(new Float32Array([1.25, -2, 3.5]));
    const out = device.array(3, 'f32');
    await twice(input, out);
    return [...(await out.read())];
  } finally {
    await device.dispose();
  }
}

void run().then(
  (values) => {
    document.documentElement.dataset.result = JSON.stringify(values);
  },
  (error: unknown) => {
    document.documentElement.dataset.error = String(error);
  },
);
