# Rust/WASM expression interning probe

This is an optional experiment after PR #816, not a compiler backend. Nothing in the package
or its build imports this directory. Rust is needed only to reproduce this experiment; the
crate has no dependencies and is not published. Proposal 0100's language meaning is unchanged.

The question is whether moving one operation shared by CSE/GVN to Rust pays for crossing the
boundary from the current JavaScript IR. The compiler already memoizes `keyOf` by expression
identity. Comparing a cold JS walk with a native kernel on an already encoded buffer would
omit both that advantage and the transfer cost.

## Boundary and controls

The harness captures the actual inputs of WGSL and GLSL optimizer hooks while `hostFace` runs.
It verifies that capture leaves generated code, declarations, diagnostics and dependencies
unchanged. Profiling the authored kernel module alone is misleading: default emission removes
kernel functions, while the host subsequently emits their lowered loop modules.

The adapter assigns labels to expression metadata and encodes a postorder graph in `u32`
words. Rust interns `(label, canonical child IDs)` for the entire batch in one call. Its hash
table resolves collisions by full key equality. This version-local packet is not a public or
stable IR format, and the adapter is not an alternative authority on language semantics.
Every captured input is compared with the equivalence classes of the compiler's `keyOf`.
Unsupported expression arms fail explicitly. This validates the sampled domain, not every
possible hand-constructed IR.

Six measurements start from the same expression objects:

- `currentCold`: current JS `keyOf` plus a map assigning equivalence-class IDs, on fresh nodes.
- `currentWarm`: the same operation with its existing WeakMap populated.
- `packedJsTotal`: encoding plus a JS implementation of packet interning, to separate the
  algorithm/data-layout change from the choice of language.
- `wasmTotal`: encoding, allocation, copy into WASM, Rust interning, output materialization and
  freeing both boundary allocations.
- `encode`: packet construction alone.
- `wasmPrepared`: allocation/copy/Rust/output/free with a previously encoded packet. This is
  a lower-bound comparison for an encoded-IR design, not a measurement of retained native IR.

Fresh IR reconstruction and expression enumeration are common setup outside the timer;
production already has JS IR. Validation runs outside timing. Order alternates, with eight
warmups and 31 samples. The largest actual optimizer input per workload is used for timing;
all captured inputs are checked. Pass timing is a one-shot diagnostic over that input, not
a stable estimate of its share of the entire Vite build. This is a microbenchmark, not an
end-to-end compiler or GPU performance measurement.

## Reproduce

Build TypeShade from the repository root with its pinned Node/Bun installation:

```sh
bun install --frozen-lockfile
bun run build
```

Install Rust with the target in `rust-toolchain.toml`, then from this directory:

```sh
cargo test --locked
cargo build --release --target wasm32-unknown-unknown --locked
node run.mjs
```

The harness writes `results.json` (ignored); an optional first argument selects another output
path. Startup time and WASM bytes are reported separately. The raw WASM allocation ABI is for
this trusted harness only and is not hardened as a package API.

## Initial decision: do not integrate this standalone kernel

Measured 2026-10-28 on Linux, Intel Xeon Platinum 8573C, Node 24.19.0, Rust 1.90.0, in the
experiment working tree based on #816 at `ed152172`. All 23 captured optimizer inputs matched the JS equivalence classes. One hundred
generated graphs, signed-zero/type fixtures, a deliberately merged partition and invalid
forward-reference packet also passed their positive/refusal checks. The production compiler
was not modified.

Initial run, medians in milliseconds:

| Workload        | Nodes | Current JS cold | Current JS warm | Packed JS total | WASM total | Encode | WASM prepared |
| --------------- | ----: | --------------: | --------------: | --------------: | ---------: | -----: | ------------: |
| loop-fuse       |   256 |           0.132 |           0.028 |           0.166 |      0.135 |  0.103 |         0.021 |
| MNIST batch     |   106 |           0.042 |           0.009 |           0.060 |      0.051 |  0.039 |         0.009 |
| path-tracer     |   267 |           0.132 |           0.025 |           0.162 |      0.154 |  0.112 |         0.022 |
| fp64 Mandelbrot | 1,094 |           0.599 |           0.132 |           0.685 |      0.623 |  0.476 |         0.085 |

Rust executes the prepared batch quickly, but encoding consumes most of the boundary cost.
Including that cost, this run showed no improvement over cold JS, and the existing warm
cache was much faster. These results reject replacing individual `keyOf` calls or one batch
at a time with this adapter. They do not establish that Rust is unsuitable for the compiler.

The next native experiment would need to keep an encoded IR across several analyses/passes,
amortize conversion, and compare against a JS implementation using that same representation.
It must also preserve identity, effect information, diagnostic locations and emitted bytes.
That larger boundary has not been implemented or approved as a production architecture here.

A second run gave cold-JS/WASM-total medians of 0.172/0.156 ms (loop-fuse), 0.044/0.052 ms
(MNIST), 0.140/0.135 ms (path-tracer), and 0.559/0.553 ms (fp64). Small cold-cache differences
changed direction between runs; warm JS remained faster in every workload. The release WASM
was 28,612 bytes and the second run's read/compile/instantiate startup was 1.14 ms, excluded
from steady-state timing. The decision above accounts for both runs.

## Integration verification

Revalidated on 2026-10-30 after integrating main `2846a0d4`, which includes #816.
The three Rust tests, formatting, Clippy with warnings denied and the locked release WASM
build passed with Rust 1.90.0. On Node 24.19.0, all 23 captured optimizer inputs still
matched the current JS equivalence classes. Capture equality, 100 generated graphs and
the refusal canaries passed. No production source or package dependency changed.

This run overlapped other validation processes, so its timings are not performance evidence.
The two measurements above remain historical observations of `ed152172`; integration does
not establish a new speedup or change the decision against this standalone kernel.
