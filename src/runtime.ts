// === `typeshade/runtime`: what a generated host module imports (Rule 11.7) ===
//
// Not API. A module the Vite plugin (`typeshade/vite`) generates for a `.shade.ts` imports this,
// from the same package version as the plugin that wrote it, and nothing else should: the names
// below are the contract between the generator and its output, and change with them. It holds the
// runtime the CPU tier's code closes over and the host-value boundary (Rule 8.21), and no
// compiler, so an application that imports a shader module ships the op library alone.

export * from './core/host-runtime.js';
