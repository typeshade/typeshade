import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parseIdx } from './idx.mjs';
export { parseIdx } from './idx.mjs';
export async function loadMnist(
  directory: string,
  split: 'train' | 'test',
  limit: number,
  download = false,
) {
  const stem = split === 'train' ? 'train' : 't10k';
  const names = [`${stem}-images-idx3-ubyte.gz`, `${stem}-labels-idx1-ubyte.gz`];
  const hashes: Record<string, string> = {};
  const parts: Uint8Array[] = [];
  for (const name of names) {
    const path = join(directory, name);
    let bytes;
    try {
      bytes = await readFile(path);
    } catch (error) {
      if (!download || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const response = await fetch(`https://storage.googleapis.com/cvdf-datasets/mnist/${name}`);
      if (!response.ok) throw new Error(`MNIST download ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
      await mkdir(directory, { recursive: true });
      await writeFile(path, bytes);
    }
    hashes[name] = createHash('sha256').update(bytes).digest('hex');
    parts.push(gunzipSync(bytes));
  }
  return { ...parseIdx(parts[0], parts[1], limit), hashes };
}
