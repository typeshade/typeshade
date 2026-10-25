import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Browser } from 'playwright';
import {
  assertNativeGateGpu,
  gateBrowserSettings,
  verifyGateGpu,
  withGateBrowser,
  type GateGpuReport,
} from '../scripts/gate-browser.js';

afterEach(() => vi.restoreAllMocks());

describe('private GPU gate browser settings', () => {
  it('keeps the exact software CI flags when unset or explicitly software', () => {
    for (const env of [{}, { TYPESHADE_GPU_BACKEND: 'software' }]) {
      expect(gateBrowserSettings(env, 'win32')).toEqual({
        backend: 'software',
        launch: {
          executablePath: undefined,
          args: [
            '--enable-unsafe-webgpu',
            '--enable-unsafe-swiftshader',
            '--use-angle=swiftshader',
            '--use-vulkan=swiftshader',
            '--enable-features=Vulkan',
          ],
        },
      });
    }
  });

  it('keeps the software executable override behavior', () => {
    expect(
      gateBrowserSettings({ TYPESHADE_CHROMIUM: './headless-shell' }).launch.executablePath,
    ).toBe('./headless-shell');
  });

  it('selects the two measured Windows native flags without software flags', () => {
    expect(
      gateBrowserSettings(
        { TYPESHADE_GPU_BACKEND: 'native', TYPESHADE_CHROMIUM: 'C:\\Browser\\chrome.exe' },
        'win32',
      ),
    ).toEqual({
      backend: 'native',
      launch: {
        executablePath: 'C:\\Browser\\chrome.exe',
        args: ['--enable-unsafe-webgpu', '--use-angle=d3d11'],
      },
    });
  });

  it('leaves the native backend choice to the browser on other operating systems', () => {
    expect(
      gateBrowserSettings(
        { TYPESHADE_GPU_BACKEND: 'native', TYPESHADE_CHROMIUM: '/usr/bin/chromium' },
        'linux',
      ).launch.args,
    ).toEqual(['--enable-unsafe-webgpu']);
  });

  it.each([undefined, '', 'chrome.exe', './chrome.exe'])(
    'refuses native without an explicit absolute executable: %s',
    (executable) => {
      expect(() =>
        gateBrowserSettings(
          { TYPESHADE_GPU_BACKEND: 'native', TYPESHADE_CHROMIUM: executable },
          'win32',
        ),
      ).toThrow(/absolute TYPESHADE_CHROMIUM/);
    },
  );

  it.each(['', 'auto', 'Native', 'hardware'])(
    'refuses an unknown backend instead of falling back: %s',
    (backend) => {
      expect(() => gateBrowserSettings({ TYPESHADE_GPU_BACKEND: backend })).toThrow(
        /software or native/,
      );
    },
  );
});

describe('outer GPU gate cleanup preserves outcomes and always releases the server', () => {
  it('preserves a thrown probe error when both browser and server cleanup fail', async () => {
    const primary = new Error('probe failed');
    const browserError = new Error('browser close failed');
    const serverError = new Error('server close failed');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const server = vi.fn(async () => {
      throw serverError;
    });
    await expect(
      withGateBrowser(
        {
          close: async () => {
            throw browserError;
          },
        },
        server,
        async () => {
          throw primary;
        },
      ),
    ).rejects.toBe(primary);
    expect(server).toHaveBeenCalledOnce();
    expect(logged).toHaveBeenCalledWith('GPU gate browser cleanup also failed', browserError);
    expect(logged).toHaveBeenCalledWith('GPU gate server cleanup also failed', serverError);
  });

  it('returns the existing error result instead of masking it with browser cleanup failure', async () => {
    const result = { error: 'the dev server did not start' };
    const browserError = new Error('browser close failed');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const server = vi.fn();
    await expect(
      withGateBrowser(
        {
          close: async () => {
            throw browserError;
          },
        },
        server,
        async () => result,
      ),
    ).resolves.toBe(result);
    expect(server).toHaveBeenCalledOnce();
    expect(logged).toHaveBeenCalledWith('GPU gate browser cleanup also failed', browserError);
  });

  it('still fails a successful gate on browser cleanup error, after releasing its server', async () => {
    const browserError = new Error('browser close failed');
    const server = vi.fn();
    await expect(
      withGateBrowser(
        {
          close: async () => {
            throw browserError;
          },
        },
        server,
        async () => ({ ok: true }),
      ),
    ).rejects.toBe(browserError);
    expect(server).toHaveBeenCalledOnce();
  });

  it('propagates a standalone server cleanup failure after closing the browser', async () => {
    const serverError = new Error('server close failed');
    const browser = { close: vi.fn(async () => {}) };
    await expect(
      withGateBrowser(
        browser,
        async () => {
          throw serverError;
        },
        async () => undefined,
      ),
    ).rejects.toBe(serverError);
    expect(browser.close).toHaveBeenCalledOnce();
  });
});

describe('native GPU gate checks observed hardware', () => {
  const gpu = (description: string): GateGpuReport['webgpu'] => ({
    vendor: '',
    architecture: '',
    device: '',
    description,
    fallback: false,
  });
  const gl = (renderer: string): GateGpuReport['webgl'] => ({
    renderer,
    unmasked: true,
    lost: false,
  });
  const both = { webgpu: true, webgl: true };

  it.each(['NVIDIA GeForce', 'AMD Radeon', 'Intel Iris', 'Apple M3', 'Qualcomm Adreno'])(
    'accepts identified hardware without a preferred-vendor restriction: %s',
    (name) => {
      expect(() =>
        assertNativeGateGpu({ webgpu: gpu(name), webgl: gl(`ANGLE (${name}, native)`) }, both),
      ).not.toThrow();
    },
  );

  it.each([
    'SwiftShader',
    'llvmpipe',
    'lavapipe',
    'Microsoft Basic Render Driver',
    'D3D11 WARP',
    'CPU adapter',
  ])('rejects a software WebGPU adapter or WebGL renderer: %s', (name) => {
    expect(() => assertNativeGateGpu({ webgpu: gpu(name), webgl: gl('Intel Iris') }, both)).toThrow(
      /software\/fallback/,
    );
    expect(() => assertNativeGateGpu({ webgpu: gpu('Intel Iris'), webgl: gl(name) }, both)).toThrow(
      /software renderer/,
    );
  });

  it('rejects fallback and unidentified/redacted adapters', () => {
    expect(() =>
      assertNativeGateGpu(
        { webgpu: { ...gpu('GPU')!, fallback: true } },
        { webgpu: true, webgl: false },
      ),
    ).toThrow(/fallback/);
    expect(() => assertNativeGateGpu({ webgpu: gpu('') }, { webgpu: true, webgl: false })).toThrow(
      /identity is unavailable/,
    );
    expect(() => assertNativeGateGpu({}, { webgpu: true, webgl: false })).toThrow(
      /metadata is missing/,
    );
    expect(() =>
      assertNativeGateGpu(
        { webgpu: { ...gpu('GPU')!, fallback: undefined } },
        { webgpu: true, webgl: false },
      ),
    ).toThrow(/fallback/);
  });

  it('rejects masked or lost WebGL contexts', () => {
    expect(() =>
      assertNativeGateGpu(
        { webgl: { ...gl('WebKit WebGL')!, unmasked: false } },
        { webgpu: false, webgl: true },
      ),
    ).toThrow(/identity is unavailable/);
    expect(() =>
      assertNativeGateGpu(
        { webgl: { ...gl('Intel Iris')!, lost: true } },
        { webgpu: false, webgl: true },
      ),
    ).toThrow(/context is lost/);
  });

  it.each(['unknown', 'Unknown', ' null ', 'undefined', 'WebKit WebGL', '?'])(
    'rejects an unmasked but unavailable renderer identity: %s',
    (renderer) => {
      expect(() =>
        assertNativeGateGpu({ webgl: gl(renderer) }, { webgpu: false, webgl: true }),
      ).toThrow(/identity is unavailable/);
    },
  );

  it('checks only APIs the selected differential arms use', () => {
    expect(() =>
      assertNativeGateGpu({ webgpu: gpu('AMD Radeon') }, { webgpu: true, webgl: false }),
    ).not.toThrow();
    expect(() =>
      assertNativeGateGpu({ webgl: gl('Intel Iris') }, { webgpu: false, webgl: true }),
    ).not.toThrow();
  });

  it('does not claim native verification when no API was selected', () => {
    expect(() => assertNativeGateGpu({}, { webgpu: false, webgl: false })).toThrow(/no GPU API/);
  });

  const native = gateBrowserSettings(
    { TYPESHADE_GPU_BACKEND: 'native', TYPESHADE_CHROMIUM: 'C:\\Browser\\chrome.exe' },
    'win32',
  );
  function browserWith(report: GateGpuReport, cleanup: Error, primary?: Error): Browser {
    return {
      newPage: async () => ({
        route: async () => {},
        goto: async () => {},
        evaluate: async () => {
          if (primary) throw primary;
          return report;
        },
        close: async () => {
          throw cleanup;
        },
      }),
    } as unknown as Browser;
  }

  it('probes an empty document without requesting the application or its assets', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const fulfill = vi.fn(
      async (_response: { status: number; contentType: string; body: string }) => {},
    );
    const closed = vi.fn(async () => {});
    const order: string[] = [];
    const browser = {
      newPage: async () => ({
        route: async (
          _pattern: string,
          handler: (route: { fulfill: typeof fulfill }) => Promise<void>,
        ) => {
          order.push('route');
          await handler({ fulfill });
        },
        goto: async (url: string) => {
          order.push(url);
        },
        evaluate: async () => ({ webgpu: gpu('AMD Radeon') }),
        close: closed,
      }),
    } as unknown as Browser;
    await verifyGateGpu(browser, 'http://127.0.0.1:1234/application/', native, {
      webgpu: true,
      webgl: false,
    });
    expect(order).toEqual(['route', 'http://127.0.0.1:1234/application/']);
    expect(fulfill).toHaveBeenCalledOnce();
    expect(fulfill.mock.calls[0]).toEqual([
      expect.objectContaining({ status: 200, contentType: 'text/html' }),
    ]);
    expect(fulfill.mock.calls[0]![0].body).not.toMatch(/<script|\bimport\b/);
    expect(closed).toHaveBeenCalledOnce();
  });

  it('preserves the hardware assertion error when page cleanup also fails', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cleanup = new Error('page close failed');
    await expect(
      verifyGateGpu(
        browserWith({ webgpu: gpu('SwiftShader') }, cleanup),
        'http://localhost/',
        native,
        { webgpu: true, webgl: false },
      ),
    ).rejects.toThrow(/software\/fallback/);
    expect(logged).toHaveBeenCalledWith('native GPU gate: page cleanup also failed', cleanup);
  });

  it('preserves the original page evaluation failure over a cleanup failure', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const primary = new Error('adapter query failed');
    const cleanup = new Error('page close failed');
    await expect(
      verifyGateGpu(browserWith({}, cleanup, primary), 'http://localhost/', native, both),
    ).rejects.toBe(primary);
    expect(logged).toHaveBeenCalledWith('native GPU gate: page cleanup also failed', cleanup);
  });

  it('propagates a standalone page cleanup failure after successful verification', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const cleanup = new Error('page close failed');
    await expect(
      verifyGateGpu(
        browserWith({ webgpu: gpu('AMD Radeon'), webgl: gl('AMD Radeon') }, cleanup),
        'http://localhost/',
        native,
        both,
      ),
    ).rejects.toBe(cleanup);
  });
});
