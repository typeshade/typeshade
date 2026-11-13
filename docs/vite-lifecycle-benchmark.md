# Vite lifecycle benchmark

Status: instrument implementation and validation in PR #840; baseline measurements are pending.
The owner approved this work on 2026-10-30. The compiler baseline is main
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

## Reproduce

Use the repository's pinned Node and Bun versions and install its locked dependencies.
Install Playwright's Chromium headless shell, or set `TYPESHADE_CHROMIUM` to an installed browser.
The harness prepares a package with the existing publish-manifest derivation and checks its
build receipt. A normal measurement requires a clean, committed checkout and a successful build
of that revision. Package preparation and installation are outside every reported timing.

```sh
bun run build
node scripts/bench-vite-lifecycle.mjs --verify --output artifacts/vite-verify.json
node scripts/bench-vite-lifecycle.mjs --samples 5 --warmup 3 --output artifacts/vite-run-1.json
node scripts/bench-vite-lifecycle.mjs --samples 5 --warmup 3 --output artifacts/vite-run-2.json
```

`--verify` is a correctness smoke run, not a performance observation. It permits a dirty
checkout while the instrument is developed. `--fixture loop-fuse`, `--fixture mnist` or
`--fixture path-tracer` selects one workload. Run the two measured commands sequentially with
no concurrent builds, tests or benchmarks.

Each sample has separate Node processes for production build, watch rebuild and development.
Each project has an empty Vite cache directory. OS file caches remain warm, including from the
correctness probes. The published package's peer TypeScript comes from the installed toolchain.
The plugin's default options and dependency prebundling remain enabled.

The production consumer is an ES library that retains every shader export and the default
manifest. The development page retains the complete shader namespace. These small consumers
isolate three existing shaders; they do not represent a whole application or GPU execution.
Each source copy adds a small `lifecycleRevision()` export so that a changed result is observable.

## Timing boundaries and controls

| Measurement            | Start and end                                                                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First production build | Parent starts the fresh child until it receives the build-complete message; includes Node startup, imports and Vite build, but excludes artifact verification   |
| Imports                | Dynamic imports of Vite and the built TypeShade plugin in the child                                                                                             |
| Build API              | Immediately before `build()` until its returned promise resolves                                                                                                |
| Watch rebuild          | Before writing the changed shader until the existing Rollup watcher reports build end                                                                           |
| Development startup    | Before creating the dev server until the browser module acknowledges its initial value; excludes Node imports and browser launch, which are reported separately |
| HMR                    | Before writing the changed shader until the dependency-accept callback reaches the Node host through Playwright's binding                                       |
| TypeShade transform    | Inside the real shader transform hook; includes compilation, filesystem access and host-view generation                                                         |

Watch and HMR sessions first run a changed-result canary, then the requested number of warmup
edits, then one measured edit. Five samples therefore use five independent sessions per mode
and workload. Every edit must produce the expected revision; a stale event cannot satisfy it.
HMR must preserve the document's time origin and navigation count, with no full-reload event.

Before samples, an unwrapped and a wrapped plugin must produce identical bundle bytes. A
changed bundle must produce the new revision. The actual output validator must reject a wrong
expected revision, and the compiler must reject a deliberately invalid shader. Bundle execution
checks run in separate short Node processes, outside timers and outside the compiler's heap.

Hook durations are inclusive wall time, not CPU samples. Wall time outside the hook includes
bundling, runtime-module processing, filesystem work, watcher latency, instrumentation and
acknowledgement transport. It is not a direct measurement of Vite's own CPU cost. The raw report
retains individual timing intervals, revisions, hashes, versions and output checks.
