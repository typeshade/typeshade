import { chromium } from 'playwright';
import { createServer } from 'vite';
import { manifest } from './cpu.mjs';
// --software explicitly selects SwiftShader. Default launch requests the available backend.
export async function browserBackend({ software = false } = {}) {
  let datasetBuffers;
  const server = await createServer({
    plugins: [
      {
        name: 'mnist-host-data',
        configureServer(server) {
          server.middlewares.use('/__mnist_data', (request, response) => {
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
    root: new URL('../../', import.meta.url).pathname,
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
  });
  let browser;

  try {
    await server.listen();
    browser = await chromium.launch({
      executablePath: process.env.TYPESHADE_CHROMIUM || undefined,
      args: [
        '--no-sandbox',
        '--enable-unsafe-webgpu',
        ...(software
          ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--use-vulkan=swiftshader']
          : []),
      ],
    });
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error(e));
    await page.goto(server.resolvedUrls.local[0]);
    const adapter = await page.evaluate(async () => {
      const adapter = await navigator.gpu?.requestAdapter();
      if (!adapter) throw new Error('No WebGPU adapter; no CPU fallback is permitted');
      return {
        ...adapter.info.toJSON?.(),
        features: [...adapter.features],
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        vendor: adapter.info.vendor,
        architecture: adapter.info.architecture,
        device: adapter.info.device,
        description: adapter.info.description,
        isFallbackAdapter: adapter.info.isFallbackAdapter,
      };
    });
    console.log(JSON.stringify({ webgpuAdapter: adapter, requestedSoftware: software }));
    const pack = manifest();
    return {
      async makeBackend(host) {
        const capacity = host.logits.length / 10;
        const residentHost = {
          ...host,
          pixels: new Float32Array(capacity * 784),
          labels: new Uint32Array(capacity),
        };
        const serialized = Object.fromEntries(
          Object.entries(residentHost).map(([name, value]) => [
            name,
            { type: value.constructor.name, values: [...value] },
          ]),
        );
        datasetBuffers = { pixels: host.pixels, labels: host.labels };
        const transportBegin = performance.now();
        await page.evaluate(
          async ({ serialized, pack }) => {
            const { webgpuBackend } = await import('/journeys/mnist/webgpu.mjs');
            const [pixels, labels] = await Promise.all(
              ['pixels', 'labels'].map(async (name) => {
                const response = await fetch(`/__mnist_data/${name}`);
                if (!response.ok)
                  throw new Error(`Host dataset transfer failed: ${response.status}`);
                return response.arrayBuffer();
              }),
            );
            globalThis.mnistDataset = {
              pixels: new Float32Array(pixels),
              labels: new Uint32Array(labels),
            };
            const host = Object.fromEntries(
              Object.entries(serialized).map(([name, value]) => [
                name,
                new globalThis[value.type](value.values),
              ]),
            );
            globalThis.mnistBackend = await webgpuBackend(host, pack);
          },
          { serialized, pack },
        );
        /** @type {Record<string, string | number>} */
        const transfers = {
          inputBridgeMs: 0,
          browserHostSetupMs: performance.now() - transportBegin,
          browserDatasetBytes: host.pixels.byteLength + host.labels.byteLength,
        };
        const deviceInfo = await page.evaluate(() => globalThis.mnistBackend.deviceInfo);
        const deviceTensorBytes = Object.values(residentHost).reduce(
          (sum, a) => sum + a.byteLength,
          0,
        );
        let bridgeMs = 0;
        return {
          tier: 'webgpu',
          executionClassification:
            adapter.isFallbackAdapter || /swiftshader|lavapipe/i.test(adapter.architecture)
              ? 'GPU training not validated due to unavailable hardware; all numeric stages validated on software WebGPU'
              : 'Entire training on GPU',
          async telemetry() {
            const counters = await page.evaluate(() => globalThis.mnistBackend.transfers);
            Object.assign(transfers, counters);
            return { ...transfers };
          },
          transfers,
          deviceTensorBytes,
          deviceInfo,
          async dispatch(entry, batch) {
            if (entry === 'forward') {
              const begin = performance.now();
              await page.evaluate(({ offset, count }) => {
                const data = globalThis.mnistDataset;
                globalThis.mnistBackend.setBatch(
                  data.pixels.subarray(offset * 784, (offset + count) * 784),
                  data.labels.subarray(offset, offset + count),
                );
              }, batch);
              bridgeMs += performance.now() - begin;
              transfers.inputBridgeMs = bridgeMs;
            }
            await page.evaluate(
              async ({ entry, batch }) => globalThis.mnistBackend.dispatch(entry, batch),
              { entry, batch: { ...batch, offset: 0 } },
            );
          },
          async read(name) {
            const result = await page.evaluate(
              async (name) => ({
                values: [...(await globalThis.mnistBackend.read(name))],
                transfers: globalThis.mnistBackend.transfers,
              }),
              name,
            );
            Object.assign(transfers, result.transfers);
            return Float32Array.from(result.values);
          },
          async destroy() {
            await page.evaluate(() => globalThis.mnistBackend.destroy());
          },
        };
      },
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
