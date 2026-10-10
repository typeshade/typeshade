// Browser- and Node-safe official MNIST IDX parsing and dataset identity.
// SHA-256 values are from the committed full 60k/10k MNIST experiment record.
// These constants belong to the experiment, not to TypeShade Core.
export const MNIST_GZIP_SHA256 = {
  "train-images-idx3-ubyte.gz": "440fcabf73cc546fa21475e81ea370265605f56be210a4024d2ca8f203523609",
  "train-labels-idx1-ubyte.gz": "3552534a0a558bbed6aed32b30c495cca23d567ec52cac8be1a0730e8010255c",
  "t10k-images-idx3-ubyte.gz": "8d422c7b0a1c1c79245a5bcf07fe86e33eeafee792b84584aec276f5a2dbc4e6",
  "t10k-labels-idx1-ubyte.gz": "f7ae60f92e00ec6debd23a6088c31dbd2371eca3ffa0defaefb259924204aec6"
};

export function parseIdx(images: Uint8Array, labels: Uint8Array, limit = Infinity) {
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
