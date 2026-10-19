import { defineConfig } from 'vite';
import { typeshade } from 'typeshade/vite';

// The browser bundle of `src/gpu.ts`, which the journey loads in a page with WebGPU. The fuse
// facts are written so that a chain of kernel calls on a device fuses (change 0058, change 0073).
export default defineConfig({
  plugins: [typeshade({ fuse: true })],
  build: { lib: { entry: 'src/gpu.ts', formats: ['es'], fileName: 'gpu' }, outDir: 'out-web' },
});
