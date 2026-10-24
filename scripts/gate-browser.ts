// Private launch settings and hardware checks shared by the real-GPU compiler gates.
// Unset TYPESHADE_GPU_BACKEND keeps software CI. `native` requires an absolute
// TYPESHADE_CHROMIUM executable and verifies the observed APIs without retry/fallback.
import { posix, win32 } from 'node:path';
import type { Browser } from 'playwright';

export interface GateBrowserSettings {
  readonly backend: 'software' | 'native';
  readonly launch: { executablePath: string | undefined; args: string[] };
}

export function gateBrowserSettings(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform,
): GateBrowserSettings {
  const backend = env.TYPESHADE_GPU_BACKEND ?? 'software';
  if (backend !== 'software' && backend !== 'native')
    throw new Error('TYPESHADE_GPU_BACKEND must be software or native');
  const executablePath = env.TYPESHADE_CHROMIUM || undefined;
  if (
    backend === 'native' &&
    (executablePath === undefined ||
      !(platform === 'win32' ? win32 : posix).isAbsolute(executablePath))
  )
    throw new Error('TYPESHADE_GPU_BACKEND=native requires an absolute TYPESHADE_CHROMIUM path');
  return {
    backend,
    launch: {
      executablePath,
      args:
        backend === 'software'
          ? [
              '--enable-unsafe-webgpu',
              '--enable-unsafe-swiftshader',
              '--use-angle=swiftshader',
              '--use-vulkan=swiftshader',
              '--enable-features=Vulkan',
            ]
          : ['--enable-unsafe-webgpu', ...(platform === 'win32' ? ['--use-angle=d3d11'] : [])],
    },
  };
}

export interface GateGpuNeeds {
  readonly webgpu: boolean;
  readonly webgl: boolean;
}

export interface GateGpuReport {
  readonly webgpu?: {
    readonly vendor: string;
    readonly architecture: string;
    readonly device: string;
    readonly description: string;
    readonly fallback?: boolean;
  };
  readonly webgl?: {
    readonly renderer: string;
    readonly unmasked: boolean;
    readonly lost: boolean;
  };
}

const SOFTWARE =
  /swiftshader|llvmpipe|softpipe|lavapipe|software|microsoft basic render|\bwarp\b|\bcpu\b/i;

function hasIdentity(label: string): boolean {
  return !/^(?:|unknown|null|undefined|generic|webgl\s*2?|webkit\s+webgl|\?)$/i.test(label.trim());
}

/** Check observed metadata, never the requested flags or a preferred vendor's name. */
export function assertNativeGateGpu(report: GateGpuReport, needs: GateGpuNeeds): void {
  if (!needs.webgpu && !needs.webgl)
    throw new Error('native GPU gate: no GPU API was selected for verification');
  if (needs.webgpu) {
    const gpu = report.webgpu;
    if (gpu === undefined) throw new Error('native GPU gate: WebGPU adapter metadata is missing');
    const labels = [gpu.vendor, gpu.architecture, gpu.device, gpu.description];
    if (gpu.fallback !== false || SOFTWARE.test(labels.join(' ')))
      throw new Error(`native GPU gate: WebGPU software/fallback adapter (${JSON.stringify(gpu)})`);
    if (!labels.some(hasIdentity))
      throw new Error('native GPU gate: WebGPU adapter identity is unavailable');
  }
  if (needs.webgl) {
    const gl = report.webgl;
    if (gl === undefined || !gl.unmasked || !hasIdentity(gl.renderer))
      throw new Error('native GPU gate: unmasked WebGL2 renderer identity is unavailable');
    if (gl.lost) throw new Error('native GPU gate: WebGL2 context is lost');
    if (SOFTWARE.test(gl.renderer))
      throw new Error(`native GPU gate: WebGL2 software renderer (${gl.renderer})`);
  }
}

// Serialized by Playwright: no closure over helpers/imports from this module.
async function gpuInfoInPage(needs: GateGpuNeeds): Promise<GateGpuReport> {
  let webgpu: GateGpuReport['webgpu'];
  let webgl: GateGpuReport['webgl'];
  if (needs.webgpu) {
    if (navigator.gpu === undefined) throw new Error('native GPU gate: navigator.gpu is absent');
    const adapter = await navigator.gpu.requestAdapter();
    if (adapter === null) throw new Error('native GPU gate: requestAdapter returned null');
    const info = adapter.info;
    // Current WebGPU exposes this on info; older Chromium exposed it on the adapter.
    const legacy = adapter as GPUAdapter & { readonly isFallbackAdapter?: boolean };
    webgpu = {
      vendor: info.vendor,
      architecture: info.architecture,
      device: info.device,
      description: info.description,
      fallback: info.isFallbackAdapter ?? legacy.isFallbackAdapter,
    };
  }
  if (needs.webgl) {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl === null) throw new Error('native GPU gate: WebGL2 context is unavailable');
    try {
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      webgl = {
        renderer: String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)),
        unmasked: debug !== null,
        lost: gl.isContextLost(),
      };
    } finally {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  }
  return { ...(webgpu === undefined ? {} : { webgpu }), ...(webgl === undefined ? {} : { webgl }) };
}

/** Native verification uses a separate short-lived page, leaving the gate's contexts alone. */
export async function verifyGateGpu(
  browser: Browser,
  url: string,
  settings: GateBrowserSettings,
  needs: GateGpuNeeds,
): Promise<void> {
  if (settings.backend === 'software') return;
  const page = await browser.newPage();
  let primaryFailed = false;
  try {
    // Keep the secure localhost origin without loading the application's scripts or assets.
    await page.route('**/*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>GPU probe</title>',
      }),
    );
    await page.goto(url);
    const report = await page.evaluate(gpuInfoInPage, needs);
    console.log(`GPU gate backend native: ${JSON.stringify(report)}`);
    assertNativeGateGpu(report, needs);
  } catch (error) {
    primaryFailed = true;
    throw error;
  } finally {
    try {
      await page.close();
    } catch (error) {
      if (!primaryFailed) throw error;
      console.error('native GPU gate: page cleanup also failed', error);
    }
  }
}

/** Always release both resources without replacing a thrown/returned gate error with cleanup. */
export async function withGateBrowser<T>(
  browser: Pick<Browser, 'close'>,
  closeServer: () => void | Promise<void>,
  run: () => Promise<T>,
): Promise<T> {
  let primaryFailed = false;
  try {
    const result = await run();
    primaryFailed =
      result !== null &&
      typeof result === 'object' &&
      'error' in result &&
      result.error !== undefined;
    return result;
  } catch (error) {
    primaryFailed = true;
    throw error;
  } finally {
    const failures: { resource: string; error: unknown }[] = [];
    try {
      await browser.close();
    } catch (error) {
      failures.push({ resource: 'browser', error });
    }
    try {
      await closeServer();
    } catch (error) {
      failures.push({ resource: 'server', error });
    }
    const secondary = primaryFailed ? failures : failures.slice(1);
    for (const failure of secondary)
      console.error(`GPU gate ${failure.resource} cleanup also failed`, failure.error);
    if (!primaryFailed && failures.length > 0) throw failures[0]!.error;
  }
}
