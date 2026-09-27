
<!-- LINT.IfChange(tests) -->

- `bun run build`: `tsc --build` (dist and `.d.ts`), then `tsc -p tsconfig.tests.json`, the
  noEmit pass over tests, examples and scripts.
- `bun run lint` (ESLint) and `bun run format:check` (Prettier, then the shader-source `;`).
- `bun run test`: vitest over `src/**` and `examples/**`.
- The CI check job refreshes generated emit goldens after the unit suite and commits any intentional changes back to the pull request branch before the remaining checks.
- `bun run gate:compile`: every registered example emitted and compiled. Needs Chromium once:
  `./node_modules/.bin/playwright install --only-shell chromium`.
- `bun run gate:render`: the class-based 3D SDF example is rendered on headless WebGPU and its 48x48 RGBA8 pixels are compared exactly with the committed image golden. Use `UPDATE_RT_GOLDEN=1 bun run gate:render` only for an intentional golden refresh.
- `bun run gate:journeys` (after `build`): the packed tarball installed into a fresh project,
  and every program in `journeys/` checked the way a user meets it: `compile()`, the language
  service, the README's `tsconfig.shade.json` <!-- doc-refs: skip — the file a user writes, not one in this tree -->, WebGPU and the CPU oracle against the journey's
  own JavaScript reference. A change that improves what a user can write adds its journey
  (`journeys/README.md`).
- CI's traceability job: `doorstop -C -e -F` over `reqs/` and the traceability matrix as an