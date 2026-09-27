// Render the merged class-based 3D SDF example on a real WebGPU device (SwiftShader in CI),
// read the RGBA8 render target back, and write a dependency-free PNG.
// This is deliberately separate from emit goldens: the source text may emit correctly while the
// executable shader still renders the wrong pixels.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { deflateSync, inflateSync } from 'node:zlib';
import { chromium } from 'playwright';
import { compile, reflect } from '../src/index.js';
import type { Page } from 'playwright';

const WIDTH = 64;
const HEIGHT = 64;
const TIME = 1.25;
const FRAME = 0;
const UPDATE = process.env.UPDATE_RT_GOLDEN === '1';
const GOLDEN_URL = new URL('./__render-goldens__/rt-renderer-class-64.png', import.meta.url);

const sourceUrl = new URL('../examples/rt-renderer-class.shade.ts', import.meta.url);
const source = readFileSync(sourceUrl, 'utf8');
const result = compile(source, { fileName: 'examples/rt-renderer-class.shade.ts' });

if (result.diagnostics.length > 0) {
  throw new Error(
    result.diagnostics.map((d) => String(d.code) + ': ' + d.message).join('\n'),
  );
}
if (!result.wgsl || !result.module) {
  throw new Error('RT renderer did not produce WGSL + IR module');
}
const wgsl = result.wgsl;

const reflection = reflect(result.module);
const uniform = reflection.bindGroups
  .find((g) => g.group === 0)
  ?.entries.find((e) => e.space === 'uniform');

if (!uniform) throw new Error('RT renderer has no group(0) uniform binding');
const uniformBinding = uniform.binding;

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function pngRgba8(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const rows = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    rows[y * (width * 4 + 1)] = 0;
    rows.set(
      rgba.subarray(y * width * 4, (y + 1) * width * 4),
      y * (width * 4 + 1) + 1,
    );
  }

  const ihdr = new Uint8Array(13);
  const header = new DataView(ihdr.buffer);
  header.setUint32(0, width);
  header.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Uint8Array.from([
    137, 80, 78, 71, 13, 10, 26, 10,
  ]);
  const idat = deflateSync(rows);
  const result = new Uint8Array(
    signature.length + (12 + ihdr.length) + (12 + idat.length) + 12,
  );
  let offset = 0;
  result.set(signature, offset);
  offset += signature.length;
  for (const part of [
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array()),
  ]) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}


type DecodedPng = {
  width: number;
  height: number;
  pixels: Uint8Array;
};

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodePngRgba8(bytes: Uint8Array): DecodedPng {
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i])
      throw new Error('golden is not a PNG');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Uint8Array[] = [];

  while (offset + 12 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
    const length = view.getUint32(0);
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    );
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > bytes.length) throw new Error('golden PNG chunk is truncated');

    if (type === 'IHDR') {
      const header = new DataView(bytes.buffer, bytes.byteOffset + start, length);
      width = header.getUint32(0);
      height = header.getUint32(4);
      bitDepth = header.getUint8(8);
      colorType = header.getUint8(9);
      interlace = header.getUint8(12);
    } else if (type === 'IDAT') {
      idat.push(bytes.slice(start, end));
    } else if (type === 'IEND') {
      break;
    }

    offset = end + 4;
  }

  if (width === 0 || height === 0) throw new Error('golden PNG has no dimensions');
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0)
    throw new Error('golden PNG must be non-interlaced 8-bit RGBA');

  const compressed = new Uint8Array(idat.reduce((n, part) => n + part.length, 0));
  let write = 0;
  for (const part of idat) {
    compressed.set(part, write);
    write += part.length;
  }

  const raw = new Uint8Array(inflateSync(compressed));
  const stride = width * 4;
  const rowSize = stride + 1;
  if (raw.length !== rowSize * height)
    throw new Error('golden PNG has an unexpected decompressed size');

  const pixels = new Uint8Array(width * height * 4);
  const previous = new Uint8Array(stride);
  const current = new Uint8Array(stride);

  for (let y = 0; y < height; y++) {
    const rawOffset = y * rowSize;
    const filter = raw[rawOffset]!;
    for (let x = 0; x < stride; x++) {
      const value = raw[rawOffset + 1 + x]!;
      const a = x >= 4 ? current[x - 4]! : 0;
      const b = previous[x]!;
      const c = x >= 4 ? previous[x - 4]! : 0;
      const restored =
        filter === 0
          ? value
          : filter === 1
            ? value + a
            : filter === 2
              ? value + b
              : filter === 3
                ? value + Math.floor((a + b) / 2)
                : filter === 4
                  ? value + paeth(a, b, c)
                  : (() => {
                      throw new Error('golden PNG uses an unsupported filter');
                    })();
      current[x] = restored & 255;
    }
    pixels.set(current, y * stride);
    previous.set(current);
  }

  return { width, height, pixels };
}

function compareGolden(actual: Uint8Array, png: Uint8Array): {
  differingPixels: number;
  maxChannelDelta: number;
} {
  const expected = decodePngRgba8(png);
  if (expected.width !== WIDTH || expected.height !== HEIGHT)
    throw new Error(
      'golden dimensions are ' +
        String(expected.width) +
        'x' +
        String(expected.height) +
        ', expected ' +
        String(WIDTH) +
        'x' +
        String(HEIGHT),
    );

  let differingPixels = 0;
  let maxChannelDelta = 0;
  for (let i = 0; i < actual.length; i += 4) {
    let pixelDiff = false;
    for (let c = 0; c < 4; c++) {
      const delta = Math.abs(actual[i + c]! - expected.pixels[i + c]!);
      if (delta !== 0) pixelDiff = true;
      maxChannelDelta = Math.max(maxChannelDelta, delta);
    }
    if (pixelDiff) differingPixels++;
  }
  return { differingPixels, maxChannelDelta };
}

type RenderResult = {
  pixels: number[];
  compileMessages: string[];
  validation: string | null;
};

async function renderOnGpu(page: Page): Promise<RenderResult> {
  return page.evaluate(
    async ({ wgsl, binding, width, height, time, frame }) => {
      if (!navigator.gpu) throw new Error('WebGPU is unavailable');
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error('requestAdapter() returned null');

      const device = await adapter.requestDevice();
      const module = device.createShaderModule({ code: wgsl });
      const info = await module.getCompilationInfo();
      const compileMessages = info.messages.map(
        (m) => String(m.type) + ': ' + String(m.lineNum) + ':' + String(m.linePos) + ' ' + m.message,
      );
      const compileErrors = info.messages.filter((m) => m.type === 'error');
      if (compileErrors.length > 0) {
        throw new Error('WGSL compilation failed:\n' + compileMessages.join('\n'));
      }

      const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: {
          module,
          entryPoint: 'fs',
          targets: [{ format: 'rgba8unorm' }],
        },
        primitive: { topology: 'triangle-list' },
      });

      device.pushErrorScope('validation');
      const buffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(
        buffer,
        0,
        new Float32Array([width, height, time, frame]),
      );

      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{
          binding,
          resource: { buffer },
        }],
      });

      const texture = device.createTexture({
        size: [width, height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });

      const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
      const readback = device.createBuffer({
        size: bytesPerRow * height,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });

      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: texture.createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: [0, 0, 0, 1],
        }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3);
      pass.end();
      encoder.copyTextureToBuffer(
        { texture },
        { buffer: readback, bytesPerRow, rowsPerImage: height },
        [width, height, 1],
      );
      device.queue.submit([encoder.finish()]);

      await readback.mapAsync(GPUMapMode.READ);
      const raw = new Uint8Array(readback.getMappedRange().slice(0));
      readback.unmap();
      const validation = await device.popErrorScope();

      const pixels = new Array<number>(width * height * 4);
      for (let y = 0; y < height; y++) {
        const src = y * bytesPerRow;
        const dst = y * width * 4;
        for (let x = 0; x < width * 4; x++) pixels[dst + x] = raw[src + x]!;
      }

      return {
        pixels,
        compileMessages,
        validation: validation?.message ?? null,
      };
    },
    {
      wgsl,
      binding: uniformBinding,
      width: WIDTH,
      height: HEIGHT,
      time: TIME,
      frame: FRAME,
    },
  );
}

const server = createServer((_req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end('<!doctype html><title>TypeShade RT golden</title>');
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

const browser = await chromium.launch({
  executablePath: process.env.TYPESHADE_CHROMIUM || undefined,
  args: [
    '--enable-unsafe-webgpu',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--use-vulkan=swiftshader',
    '--enable-features=Vulkan',
  ],
});

try {
  const page = await browser.newPage();
  const address = server.address() as import('node:net').AddressInfo;
  await page.goto('http://127.0.0.1:' + String(address.port) + '/');

  const first = await renderOnGpu(page);
  if (first.validation) throw new Error('WebGPU validation: ' + first.validation);

  const second = await renderOnGpu(page);
  let differingBytes = 0;
  for (let i = 0; i < first.pixels.length; i++)
    if (first.pixels[i] !== second.pixels[i]) differingBytes++;

  if (differingBytes !== 0) {
    throw new Error('RT renderer is not deterministic: ' + String(differingBytes) + ' bytes differ');
  }

  mkdirSync('artifacts', { recursive: true });
  const rgba = new Uint8Array(first.pixels);
  const png = pngRgba8(WIDTH, HEIGHT, rgba);
  writeFileSync('artifacts/rt-renderer-class-128.png', png);

  if (UPDATE) {
    mkdirSync(new URL('.', GOLDEN_URL), { recursive: true });
    writeFileSync(GOLDEN_URL, png);
    console.log('updated committed RT golden');
  } else {
    const golden = new Uint8Array(readFileSync(GOLDEN_URL));
    const comparison = compareGolden(rgba, golden);
    if (comparison.differingPixels !== 0) {
      throw new Error(
        'RT render differs from golden: ' +
          String(comparison.differingPixels) +
          ' pixels differ; max channel delta ' +
          String(comparison.maxChannelDelta),
      );
    }
    console.log('RT render matches golden: exact RGBA pixel equality');
  }

  const min = Math.min(...rgba);
  const max = Math.max(...rgba);
  let nonBackground = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (
      rgba[i] !== 0 ||
      rgba[i + 1] !== 0 ||
      rgba[i + 2] !== 0 ||
      rgba[i + 3] !== 255
    )
      nonBackground++;
  }

  console.log('WGSL messages: ' + String(first.compileMessages.length));
  console.log('uniform binding: ' + String(uniform.binding));
  console.log('image: ' + String(WIDTH) + 'x' + String(HEIGHT));
  console.log('byte-identical rerender: yes');
  console.log('channel range: ' + String(min) + '..' + String(max));
  console.log('non-background pixels: ' + String(nonBackground) + '/' + String(WIDTH * HEIGHT));
  console.log('wrote artifacts/rt-renderer-class-128.png');
} finally {
  await browser.close();
  server.close();
}
