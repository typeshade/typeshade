// The plumbing the fuse benchmarks share (change 0058): a headless Chromium on WebGPU, which is
// software here (SwiftShader), and a page that imports the built runtime and `typeshade/fuse` as an
// application would, and the shader modules the Vite plugin generates. A benchmark gives the page a
// function to run, which cannot close over anything of this file, and gets back what it returns.
// Like `_harness.mjs`, a name that starts with `_` is not a journey.
//
//   bun run build
//   TYPESHADE_CHROMIUM=/path/to/chrome node journeys/mnist/bench-submissions.mjs

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = normalize(join(HERE, '../dist/src'));

/**
 * Run `measure(options)` in a page with WebGPU. The page imports `typeshade/runtime` and
 * `typeshade/fuse` from `dist/`, and `modules`, a map from a URL (`/batch.shade.ts`) to the
 * JavaScript the page gets there, as modules. Resolves to what `measure` returns. The page runs
 * on SwiftShader, a software device, unless `hardware` is true: then Chromium is launched with
 * WebGPU enabled and no software flag, so the page gets the machine's own adapter (the
 * performance gate, `scripts/perf-gate.ts`).
 */
export async function inPage({ modules, measure, options, hardware = false }) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const text = (body) => {
      res.setHeader('content-type', 'text/javascript; charset=utf-8');
      res.end(body);
    };
    if (modules[url.pathname] !== undefined) return text(modules[url.pathname]);
    if (url.pathname.startsWith('/typeshade/')) {
      const file = normalize(join(DIST, url.pathname.slice('/typeshade/'.length)));
      if (!file.startsWith(DIST + sep) || extname(file) !== '.js') {
        res.statusCode = 404;
        return res.end();
      }
      return text(readFileSync(file, 'utf8'));
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(
      '<!doctype html><title>typeshade bench</title>' +
        '<script type="importmap">{"imports":{' +
        '"typeshade/runtime":"/typeshade/runtime.js",' +
        '"typeshade/runtime/internal":"/typeshade/runtime-internal.js",' +
        '"typeshade/fuse":"/typeshade/fuse.js"}}</script>',
    );
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const browser = await chromium.launch({
    executablePath: process.env.TYPESHADE_CHROMIUM || undefined,
    // A hardware run leaves the GPU process on: headless Chromium reaches the adapter through
    // its own GPU process, which the headless shell has too.
    ...(hardware ? { headless: true } : {}),
    args: hardware
      ? ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-features=Vulkan']
      : [
          '--enable-unsafe-webgpu',
          '--enable-unsafe-swiftshader',
          '--use-angle=swiftshader',
          '--use-vulkan=swiftshader',
          '--enable-features=Vulkan',
        ],
  });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    return await page.evaluate(measure, options);
  } finally {
    await browser.close();
    server.close();
  }
}

/** The median of a list of numbers. */
export const median = (xs) => {
  const s = [...xs].sort((p, q) => p - q);
  return s.length % 2 === 1 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** A row of a result table: the median, the least and the most of the samples, in milliseconds. */
export const row = (name, times, seen) => ({
  name,
  medianMs: Number(median(times).toFixed(2)),
  minMs: Number(Math.min(...times).toFixed(2)),
  maxMs: Number(Math.max(...times).toFixed(2)),
  submissions: seen.submits,
  dispatches: seen.dispatches,
  // Present where the benchmark counts the buffers the device was asked for.
  ...(seen.buffers !== undefined ? { buffers: seen.buffers } : {}),
});
