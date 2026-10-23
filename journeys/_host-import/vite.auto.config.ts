import { defineConfig } from 'vite';
import { typeshade } from 'typeshade/vite';

export default defineConfig({
  plugins: [typeshade({ fuse: true })],
  build: {
    lib: {
      entry: { automatic: 'src/auto-fuse.ts', worker: 'src/auto-fuse-worker.ts' },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
    },
    outDir: 'out-auto',
  },
});
