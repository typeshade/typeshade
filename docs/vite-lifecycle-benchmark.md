# Vite lifecycle benchmark

Status: measurement work approved by the owner on 2026-10-30. The baseline is main
`49f4f2884c0c38dc6134c837efd5565e5395b721`, including the O2 work in PR #839.

## Question and scope

Measure the compiler cost a Vite consumer encounters during its first production build,
watch rebuild, development startup and hot module replacement. The existing host-face
microbenchmark measures warm compiler calls; the SwiftShader benchmarks measure emitted
program execution. Neither establishes these Vite lifecycle costs.

Add an optional benchmark harness and a reproducible measurement record. Keep the production
compiler, plugin behavior, package dependencies and CI requirements unchanged. This task does
not implement a native compiler path or the other open feature proposals.

## Measurement contract

- Use the real Vite plugin and representative existing shaders in disposable consumer projects.
- Record Vite wall time separately from time inside the TypeShade transform hook. Name every
  timing boundary, including watcher and browser acknowledgement costs.
- Give first-build and development-start samples fresh processes and empty Vite cache
  directories. Do not describe a warm operating-system page cache as a cold machine.
- Measure watch rebuilds and HMR after explicit warmups. Verify that each edited revision
  reaches the built artifact or the browser without a full-page reload masquerading as HMR.
- Check correctness and instrumentation outside the measured samples. A deliberately invalid
  shader and a known changed result must be observed before timing results are accepted.
- Preserve raw samples, source and tool versions, configuration, output checks and limitations.
  Run measured samples without concurrent validation jobs. Repeat the baseline independently.
- Treat any native IR-reuse experiment as a later decision based on the measured bottleneck.

## Results

Not measured yet. The implementation and validation record will replace this status when the
instrument has passed its correctness checks and both baseline runs have completed.
