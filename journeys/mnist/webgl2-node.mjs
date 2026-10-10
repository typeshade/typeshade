import { chromium } from 'playwright';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { manifest } from './cpu.mjs';

/** Browser-backed WebGL2 TypeShade experiment. Never uses WebGPU or a JS CPU oracle. */
export async function webgl2BrowserBackend() {
  let datasetBuffers;
  const server = await createServer({
    plugins: [
      {
        name: 'mnist-webgl2-dataset',
        configureServer(server) {
          server.middlewares.use('/__mnist_webgl2', (request, response) => {
            const name = request.url?.split('/').at(-1);
            const data = datasetBuffers?.[name];
            if (!data) {
              response.statusCode = 404;
              response.end();
              return;
            }
            response.setHeader('content-type', 'application/octet-stream');
            response.end(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
          });
        },
      },
    ],
    configFile: false,
    logLevel: 'silent',
    root: fileURLToPath(new URL('../../', import.meta.url)),
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
  });

  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({
      executablePath: process.env.TYPESHADE_CHROMIUM || undefined,
      ...(process.env.TYPESHADE_BROWSER_CHANNEL
        ? { channel: process.env.TYPESHADE_BROWSER_CHANNEL }
        : {}),
      headless: process.env.TYPESHADE_HEADED !== '1',
      args: ['--no-sandbox', '--use-gl=angle'],
    });
    const page = await browser.newPage();
    page.on('pageerror', (error) => console.error(error));
    await page.goto(server.resolvedUrls.local[0]);
    const glInfo = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) throw new Error('WebGL2 unavailable: no WebGL2 context');
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        version: gl.getParameter(gl.VERSION),
        vendor: gl.getParameter(gl.VENDOR),
        renderer: gl.getParameter(gl.RENDERER),
        unmaskedVendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : undefined,
        unmaskedRenderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : undefined,
      };
    });
    console.log(JSON.stringify({ webgl2Context: glInfo }));
    const pack = manifest();

    return {
      async makeBackend(host) {
        const capacity = host.logits.length / 10;
        const residentHost = {
          ...host,
          pixels: new Float32Array(capacity * 784),
          labels: new Uint32Array(capacity),
        };
        datasetBuffers = { pixels: host.pixels, labels: host.labels };
        const serialized = Object.fromEntries(
          Object.entries(residentHost).map(([name, value]) => [
            name,
            { type: value.constructor.name, values: [...value] },
          ]),
        );
        const start = performance.now();
        await page.evaluate(
          async ({ serialized, pack }) => {
            const { webgl2Backend } = await import('/journeys/mnist/webgl2.mjs');
            const [pixels, labels] = await Promise.all(
              ['pixels', 'labels'].map(async (name) => {
                const response = await fetch(`/__mnist_webgl2/${name}`);
                if (!response.ok) throw new Error(`Dataset transfer failed: ${response.status}`);
                return response.arrayBuffer();
              }),
            );
            globalThis.mnistWebgl2Data = {
              pixels: new Float32Array(pixels),
              labels: new Uint32Array(labels),
            };
            const inputs = Object.fromEntries(
              Object.entries(serialized).map(([name, value]) => [
                name,
                new globalThis[value.type](value.values),
              ]),
            );
            globalThis.mnistWebgl2Backend = await webgl2Backend(inputs, pack);
          },
          { serialized, pack },
        );
        const info = await page.evaluate(() => globalThis.mnistWebgl2Backend.info);
        return {
          tier: 'webgl2',
          executionClassification: `WebGL2 GLSL ES 3.00 pass execution; renderer: ${info.unmaskedRenderer ?? info.renderer}`,
          timingDomain: 'Node + Chromium + WebGL2 pass execution wall time; not GPU kernel time',
          transfers: {
            label: 'WebGL2 pass runtime (not native compute); no GPU upload/readback counters',
            browserHostSetupMs: performance.now() - start,
            browserDatasetBytes: host.pixels.byteLength + host.labels.byteLength,
          },
          deviceTensorBytes: 0,
          deviceInfo: info,
          async dispatch(entry, batch) {
            if (entry === 'forward') {
              await page.evaluate(({ offset, count }) => {
                const data = globalThis.mnistWebgl2Data;
                globalThis.mnistWebgl2Backend.setBatch(
                  data.pixels.subarray(offset * 784, (offset + count) * 784),
                  data.labels.subarray(offset, offset + count),
                );
              }, batch);
            }
            await page.evaluate(
              ({ entry, batch }) =>
                globalThis.mnistWebgl2Backend.dispatch(entry, { ...batch, offset: 0 }),
              { entry, batch },
            );
          },
          async read(name) {
            const values = await page.evaluate(
              async (name) => [...(await globalThis.mnistWebgl2Backend.read(name))],
              name,
            );
            return Float32Array.from(values);
          },
          async telemetry() {
            return page.evaluate(() => globalThis.mnistWebgl2Backend.telemetry());
          },
          async destroy() {
            await page.evaluate(() => globalThis.mnistWebgl2Backend.destroy());
          },
        };
      },
      glInfo,
      async cleanup() {
        await browser.close();
        await server.close();
      },
    };
  } catch (error) {
    await browser?.close();
    await server.close();
    throw error;
  }
}
