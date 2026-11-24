# Vite lifecycle benchmark

Status: the instrument passed its correctness checks and two baseline observations are recorded in PR #1558, which supersedes PR #840.
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

Two observations ran sequentially on 2026-11-24 with `--samples 5 --warmup 3`, from the commit
`86d383bfdc54cec1a038741f31e414f41c6b1c01` (clean tree, `bun run build` of that commit, receipt
verified by the harness). No other job ran in the container during either run.

Configuration: Node v22.23.5, Bun 1.4.4, Vite 7.3.7, TypeScript 5.6.3, Playwright 1.64.1 with
Chromium headless shell 158.0.8127.36 (`TYPESHADE_CHROMIUM`), Linux 6.18.44, 4 vCPU Intel Xeon
2.10GHz VM, 16 GB. The container is a shared virtual machine, not a quiet bare-metal host.

Each cell is the median of 5 samples with the range in brackets, in milliseconds.
"Hook" is the time inside the TypeShade transform hook; "wall" is the whole interval of the
timing-boundary table. The 5 samples per cell come from 5 independent sessions per mode.

| Workload (run)  | Production build, wall | Build, hook | Watch rebuild, wall | Watch, hook | Dev start to ack, wall | Dev start, hook | HMR, wall     | HMR, hook |
| --------------- | ---------------------- | ----------- | ------------------- | ----------- | ---------------------- | --------------- | ------------- | --------- |
| loop-fuse (1)   | 3051 [2611-3947]       | 262         | 1283 [803-1789]     | 112         | 1310 [1161-1472]       | 290             | 145 [83-173]  | 101       |
| loop-fuse (2)   | 2247 [1900-2419]       | 215         | 711 [628-856]       | 57          | 810 [681-957]          | 211             | 91 [73-105]   | 58        |
| mnist (1)       | 3452 [3195-4481]       | 345         | 1148 [887-1475]     | 137         | 1397 [1329-1608]       | 330             | 169 [132-259] | 126       |
| mnist (2)       | 2266 [1876-2973]       | 241         | 747 [635-923]       | 88          | 842 [772-955]          | 256             | 83 [72-127]   | 64        |
| path-tracer (1) | 2458 [2314-2724]       | 299         | 804 [771-1051]      | 91          | 921 [757-1304]         | 291             | 120 [76-147]  | 102       |
| path-tracer (2) | 3134 [2741-4569]       | 383         | 1179 [845-1865]     | 181         | 1126 [885-1725]        | 367             | 148 [122-169] | 126       |

Observations (inferences, not decisions):

- The compiler hook is 7% to 12% of a fresh production build, about 10% of a watch rebuild
  and 20% to 25% of development start-up. Node start-up, Vite and bundling take the rest.
- Browser HMR costs 80 to 170 ms median, of which the hook is 60 to 130 ms. The hook is
  therefore most of the HMR latency.
- The two runs differ by up to 2x for the same workload and mode, in both directions. The
  order of the workloads is not stable between runs. Treat differences smaller than that as noise.
- All checks held in every sample: changed revisions reached the output, no full reload event,
  one document navigation, the same `performance.timeOrigin`, no page errors.

Limitations: OS file caches were warm; the VM is shared and its load was not controlled; the
consumers are three small shader files, not whole applications; no GPU call is timed; only
Vite 7.3.7 was tested. Raw sample files stay out of the repository. They hold the individual
timing intervals, hashes and output checks, and the harness regenerates them.

## Reproduce

Use the repository's pinned Node and Bun versions and install its locked dependencies.
Install Playwright's Chromium headless shell, or set `TYPESHADE_CHROMIUM` to an installed browser.
The `--fixture` value is a substring of the fixture path.
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
