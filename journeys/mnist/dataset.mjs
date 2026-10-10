import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
export function parseIdx(images, labels, limit = Infinity) {
  const iv = new DataView(images.buffer, images.byteOffset, images.byteLength);
  const lv = new DataView(labels.buffer, labels.byteOffset, labels.byteLength);
  if (images.length < 16 || labels.length < 8) throw new Error('Truncated IDX header');
  const count = iv.getUint32(4);
  if (
    iv.getUint32(0) !== 2051 ||
    lv.getUint32(0) !== 2049 ||
    iv.getUint32(8) !== 28 ||
    iv.getUint32(12) !== 28 ||
    lv.getUint32(4) !== count
  )
    throw new Error('Invalid MNIST IDX header');
  if (images.length !== 16 + count * 784 || labels.length !== 8 + count)
    throw new Error('Invalid MNIST IDX payload size');
  if (labels.subarray(8).some((v) => v > 9)) throw new Error('Invalid MNIST label');
  if (limit !== Infinity && (!Number.isInteger(limit) || limit < 1))
    throw new Error('Invalid subset size');
  const n = Math.min(count, limit);
  if (n === 0) throw new Error('Empty dataset');
  return {
    pixels: Float32Array.from(images.subarray(16, 16 + n * 784), (v) => v / 255),
    labels: Uint32Array.from(labels.subarray(8, 8 + n)),
  };
}
export async function loadMnist(directory, split, limit, download = false) {
  const stem = split === 'train' ? 'train' : 't10k';
  const names = [`${stem}-images-idx3-ubyte.gz`, `${stem}-labels-idx1-ubyte.gz`];
  const hashes = {};
  const parts = [];
  for (const name of names) {
    const path = join(directory, name);
    let bytes;
    try {
      bytes = await readFile(path);
    } catch (error) {
      if (!download || error.code !== 'ENOENT') throw error;
      const response = await fetch(`https://storage.googleapis.com/cvdf-datasets/mnist/${name}`);
      if (!response.ok) throw new Error(`MNIST download ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
      await mkdir(directory, { recursive: true });
      await writeFile(path, bytes);
    }
    hashes[name] = createHash('sha256').update(bytes).digest('hex');
    parts.push(gunzipSync(bytes));
  }
  return { ...parseIdx(...parts, limit), hashes };
}
