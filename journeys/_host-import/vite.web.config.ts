import { defineConfig } from 'vite';
import { typeshade } from 'typeshade/vite';

// The browser bundle of `src/gpu.ts`, which the journey loads in a page with WebGPU.
export default defineConfig({
  plugins: [typeshade()],
  build: { lib: { entry: 'src/gpu.ts', formats: ['es'], fileName: 'gpu' }, outDir: 'out-web' },
});
