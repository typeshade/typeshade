import { defineConfig } from 'vite';
import { typeshade } from 'typeshade/vite';

// The one line the setup adds (surface §64). `ssr.noExternal` bundles everything, the runtime
// included, so the journey can check that the bundle ships no compiler.
export default defineConfig({ plugins: [typeshade()], ssr: { noExternal: true } });
