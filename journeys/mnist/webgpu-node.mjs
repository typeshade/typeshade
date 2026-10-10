import { chromium } from 'playwright';
import { createServer } from 'vite';
import { manifest } from './cpu.mjs';
// --software explicitly selects SwiftShader. Default launch requests the available backend.
export async function browserBackend({ software = false } = {}) {
  const server = await createServer({
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
        const serialized = Object.fromEntries(
          Object.entries(host).map(([name, value]) => [
            name,
            { type: value.constructor.name, values: [...value] },
          ]),
        );
        await page.evaluate(
          async ({ serialized, pack }) => {
            const { webgpuBackend } = await import('/journeys/mnist/webgpu.mjs');
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
        const transfers = {};
        return {
          tier: 'webgpu',
          transfers,
          async dispatch(entry, batch) {
            await page.evaluate(
              async ({ entry, batch }) => globalThis.mnistBackend.dispatch(entry, batch),
              { entry, batch },
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
