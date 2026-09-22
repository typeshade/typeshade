// ═══ TypeShade compile gate — every example, both targets, compiled by the real compilers ═══
//
// WHAT IT PROVES. `examples/emit-goldens.test.ts` proves the emitters are byte-STABLE; it
// cannot say whether the bytes are a program. This gate can: each registered example is
// emitted here (in the same process the tests run in, from the same `examples` registry),
// and every emit is handed to the compiler that would receive it in production —
//
//   WGSL             `GPUDevice.createShaderModule` + `getCompilationInfo()` — Tint, inside
//                    Chromium's WebGPU. Every example emits WGSL, so every example is here.
//   GLSL ES 3.00     `compileShader` for the vertex AND fragment stage, then `linkProgram`,
//                    on a real WebGL2 context — ANGLE's translator. The `renderable` examples
//                    only — that registry flag is this package's single authority on "has a
//                    GLSL ES 3.00 form", and 6 of 43 clear it false today for four different
//                    reasons (no compute stage in GLSL ES 3.00, twice — the EDSL kernel and its
//                    source twin; a helper module with no entry point, twice; a host-side one; a
//                    loose scalar uniform, which GLSL ES 3.00 has no std140 block for). Those
//                    print `—`, never `ok`, so the count stays honest.
//
// BOTH CORPORA. The sweep is `examples` (the curated `fn()` EDSL registry) followed by
// `shadeExamples` (the `"use typeshade"` `.shade.ts` files, compiled by `_shade.ts`). They
// are two authoring surfaces over ONE IR, so they are one list here: what this gate asks —
// does the emitted text compile — has the same answer shape for both, and a `.shade.ts`
// example that Tint rejects is exactly as broken as an EDSL one that does.
//
// Both run headless on SwiftShader, which is a real Vulkan / GL implementation in software:
// what it cannot stand in for is a GPU's rasterization and speed, and neither is measured
// here. Compile / validate / link is exactly the class SwiftShader is good for.
//
// WHY IT CANNOT BE VACUOUSLY GREEN (CLAUDE.md §12 — validate the instrument against a
// known positive before believing a zero):
//
//   1. WebGPU MUST be reachable. `navigator.gpu` absent, no adapter, or no device is a
//      FAILURE of the gate, never a silent WGSL-less pass — the flags below are the four
//      that make WebGPU exist on SwiftShader, and the page is served from loopback because
//      `about:blank` is not a secure context and has no `navigator.gpu` at all.
//   2. Before any example is judged, each compiler is fed a shader that is NOT a program
//      (`fn broken( {`) and must REPORT it. A compiler that accepts garbage is a blind
//      instrument; the gate fails on it rather than trusting the 36 greens that follow.
//   3. A cut arm for the gate's own verification: `TYPESHADE_GATE_CUT=<example id>` corrupts
//      that example's emits before they reach the compilers, and the gate must then fail
//      NAMING that example and the backend. Never set in CI.
//
// Usage:  bun scripts/compile-gate.ts             (from the package root)
//         TYPESHADE_CHROMIUM=/path/to/headless_shell bun scripts/compile-gate.ts
//         — the executable is playwright's installed chromium-headless-shell unless named.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { chromium } from 'playwright'
import { examples } from '../examples/index.js'
import { shadeExamples } from '../examples/_shade.js'
import {
  emitGlslModule,
  emitModule,
  hostFeaturesFor,
  reflect,
  wgslBackend,
  type Capability,
} from '../src/index.js'

/** The four flags that make WebGPU exist on SwiftShader. `--enable-unsafe-webgpu` alone
 *  leaves `'gpu' in navigator === false` without `--enable-unsafe-swiftshader`. */
const CHROMIUM_ARGS = [
  '--enable-unsafe-webgpu',
  '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader',
  '--use-vulkan=swiftshader',
  '--enable-features=Vulkan',
]

interface Job {
  readonly id: string
  readonly wgsl: string
  /** Both stages, or `null` for an example with no GLSL ES 3.00 form (compute-only). */
  readonly glsl: { readonly vertex: string; readonly fragment: string } | null
}

interface Verdict {
  readonly id: string
  /** Compiler messages of type `error`; empty means the compiler accepted the program. */
  readonly wgslErrors: readonly string[]
  /** `null` when the example has no GLSL form; else the compile + link errors. */
  readonly glslErrors: readonly string[] | null
}

interface PageReport {
  readonly adapter: string
  /** The optional device features the corpus asked for and this adapter granted. */
  readonly granted: readonly string[]
  /** The ones it asked for and this adapter does not have — printed, never silently dropped. */
  readonly missing: readonly string[]
  /** The instrument check: did each compiler REPORT the deliberately broken shader? */
  readonly brokenWgslReported: boolean
  readonly brokenGlslReported: boolean
  readonly verdicts: readonly Verdict[]
}

const CUT = process.env['TYPESHADE_GATE_CUT'] ?? ''

/** The cut arm: an emit that is no longer a program. Applied AFTER emission so the emitter
 *  itself is untouched — this severs the wire between "emitted" and "compiled", which is
 *  the wire the gate exists to watch. */
const corrupt = (text: string): string => `${text}\n/* cut */ fn broken( {`

/** Everything the gate compiles: the EDSL registry, then the `"use typeshade"` corpus. */
const ALL_EXAMPLES = [...examples, ...shadeExamples]

function jobs(): Job[] {
  return ALL_EXAMPLES.map((ex) => {
    const cut = ex.id === CUT
    const wgsl = emitModule(ex.module)
    const glsl = ex.renderable
      ? {
          vertex: emitGlslModule(ex.module, 'vertex'),
          fragment: emitGlslModule(ex.module, 'fragment'),
        }
      : null
    return {
      id: ex.id,
      wgsl: cut ? corrupt(wgsl) : wgsl,
      glsl: glsl && cut ? { vertex: corrupt(glsl.vertex), fragment: corrupt(glsl.fragment) } : glsl,
    }
  })
}

/** The optional WebGPU features the corpus needs, derived from the modules themselves rather
 *  than listed by hand: a capability an example requires translates into the `requiredFeatures`
 *  string the WGSL target wants, which is exactly what a host would pass `requestDevice`. An
 *  example that opts into nothing contributes nothing, so this is empty for most corpora. */
function wantedFeatures(): string[] {
  const caps = new Set<Capability>()
  for (const ex of ALL_EXAMPLES) for (const c of reflect(ex.module).requiredFeatures) caps.add(c)
  return [...new Set(hostFeaturesFor(wgslBackend, [...caps]))].sort()
}

/** A page on loopback — a secure context, so `navigator.gpu` exists. Serves one empty document. */
function serve(): Promise<Server> {
  return new Promise((resolveServer) => {
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.end('<!doctype html><title>typeshade compile gate</title>')
    })
    server.listen(0, '127.0.0.1', () => resolveServer(server))
  })
}

/** Runs INSIDE the browser. Plain DOM + WebGPU + WebGL2 — nothing from this package. */
async function compileInPage(input: {
  jobs: Job[]
  broken: string
  wanted: string[]
}): Promise<PageReport> {
  if (!('gpu' in navigator) || navigator.gpu === undefined) {
    throw new Error('navigator.gpu is absent — WebGPU is not reachable in this browser')
  }
  const adapter = await navigator.gpu.requestAdapter()
  if (adapter === null) throw new Error('requestAdapter() returned null — no WebGPU adapter')
  // The OPTIONAL features the corpus asks for, intersected with what this adapter has.
  // `requestDevice()` with no list gives a device with none of them, and Tint then refuses
  // `enable clip_distances;` with `extension 'clip_distances' is not allowed in the current
  // environment` — which reads like a bad emit and is not one. An example that needs a
  // feature the adapter genuinely lacks is reported below rather than silently compiled
  // against a device that cannot honour it.
  const granted = input.wanted.filter((f) => adapter.features.has(f as GPUFeatureName))
  const missing = input.wanted.filter((f) => !adapter.features.has(f as GPUFeatureName))
  const device = await adapter.requestDevice({ requiredFeatures: granted as GPUFeatureName[] })
  const info = adapter.info
  const adapterLabel = `${info.vendor || '?'} / ${info.architecture || '?'} / ${info.description || info.device || '?'}`

  async function wgslErrors(code: string): Promise<string[]> {
    device.pushErrorScope('validation')
    const module = device.createShaderModule({ code })
    const compilation = await module.getCompilationInfo()
    const scope = await device.popErrorScope()
    const errors = compilation.messages
      .filter((m) => m.type === 'error')
      .map((m) => `${String(m.lineNum)}:${String(m.linePos)} ${m.message}`)
    if (scope !== null) errors.push(`validation: ${scope.message}`)
    return errors
  }

  const gl = document.createElement('canvas').getContext('webgl2')
  if (gl === null) throw new Error('getContext("webgl2") returned null — WebGL2 is not reachable')

  // An arrow, not a `function` declaration: a declaration is hoisted, so TS analyses its body
  // with `gl`'s DECLARED type and the null-check above never reaches it (TS18047 on every use).
  const glslErrors = (vertex: string, fragment: string): string[] => {
    const errors: string[] = []
    const stage = (type: number, source: string, label: string): WebGLShader | null => {
      const shader = gl.createShader(type)
      if (shader === null) {
        errors.push(`${label}: createShader returned null`)
        return null
      }
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        errors.push(`${label}: ${gl.getShaderInfoLog(shader) ?? 'compile failed with no log'}`)
        gl.deleteShader(shader)
        return null
      }
      return shader
    }
    const vs = stage(gl.VERTEX_SHADER, vertex, 'vertex')
    const fs = stage(gl.FRAGMENT_SHADER, fragment, 'fragment')
    if (vs !== null && fs !== null) {
      const program = gl.createProgram()
      if (program === null) {
        errors.push('link: createProgram returned null')
      } else {
        gl.attachShader(program, vs)
        gl.attachShader(program, fs)
        gl.linkProgram(program)
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          errors.push(`link: ${gl.getProgramInfoLog(program) ?? 'link failed with no log'}`)
        }
        gl.deleteProgram(program)
      }
    }
    if (vs !== null) gl.deleteShader(vs)
    if (fs !== null) gl.deleteShader(fs)
    return errors
  }

  // The instrument check, FIRST: each compiler must report a non-program.
  const brokenWgslReported = (await wgslErrors(input.broken)).length > 0
  const brokenGlslReported = glslErrors(input.broken, input.broken).length > 0

  const verdicts: Verdict[] = []
  for (const job of input.jobs) {
    verdicts.push({
      id: job.id,
      wgslErrors: await wgslErrors(job.wgsl),
      glslErrors: job.glsl === null ? null : glslErrors(job.glsl.vertex, job.glsl.fragment),
    })
  }
  return {
    adapter: adapterLabel,
    granted,
    missing,
    brokenWgslReported,
    brokenGlslReported,
    verdicts,
  }
}

async function main(): Promise<number> {
  const all = jobs()
  if (all.length < 10) {
    console.error(
      `compile gate: the registry has ${String(all.length)} examples — the reader is broken, not the registry`,
    )
    return 1
  }
  if (CUT !== '' && !all.some((j) => j.id === CUT)) {
    console.error(`compile gate: TYPESHADE_GATE_CUT='${CUT}' names no example`)
    return 1
  }

  const server = await serve()
  const port = (server.address() as AddressInfo).port
  const browser = await chromium.launch({
    executablePath: process.env['TYPESHADE_CHROMIUM'] || undefined,
    args: CHROMIUM_ARGS,
  })
  let report: PageReport
  try {
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${String(port)}/`)
    report = await page.evaluate(compileInPage, {
      jobs: all,
      broken: 'fn broken( {',
      wanted: wantedFeatures(),
    })
  } finally {
    await browser.close()
    server.close()
  }

  let failures = 0
  console.log(`compile gate — WebGPU adapter: ${report.adapter}`)
  if (report.granted.length > 0 || report.missing.length > 0) {
    console.log(
      `features: requested ${report.granted.join(', ') || '(none)'}` +
        (report.missing.length > 0 ? ` · NOT on this adapter: ${report.missing.join(', ')}` : ''),
    )
  }
  // The instrument verdict is printed on BOTH paths. A check whose success is silent cannot be
  // told apart, in a CI log, from a check that was deleted — and this one is the only reason to
  // believe the greens below (CLAUDE.md §12: validate the instrument before believing a zero).
  if (report.brokenWgslReported && report.brokenGlslReported) {
    console.log('instrument: Tint and WebGL2 both REPORTED a non-program — the verdicts can fail')
  } else {
    console.error(
      `FAIL instrument: a compiler accepted a non-program (Tint reported: ${String(report.brokenWgslReported)}, ` +
        `WebGL2 reported: ${String(report.brokenGlslReported)}) — every verdict below would be blind`,
    )
    failures += 1
  }
  const width = Math.max(...report.verdicts.map((v) => v.id.length))
  for (const v of report.verdicts) {
    const wgsl = v.wgslErrors.length === 0 ? 'ok' : 'FAIL'
    const glsl = v.glslErrors === null ? '—' : v.glslErrors.length === 0 ? 'ok' : 'FAIL'
    const bad = wgsl === 'FAIL' || glsl === 'FAIL'
    if (bad) failures += 1
    console.log(
      `${bad ? 'FAIL' : 'ok  '}  ${v.id.padEnd(width)}  wgsl→Tint ${wgsl.padEnd(4)}  glsl→WebGL2 ${glsl}`,
    )
    for (const e of v.wgslErrors) console.log(`        wgsl: ${e}`)
    for (const e of v.glslErrors ?? []) console.log(`        glsl: ${e}`)
  }
  const withGlsl = report.verdicts.filter((v) => v.glslErrors !== null).length
  console.log(
    `${String(report.verdicts.length)} examples · WGSL on Tint: ${String(report.verdicts.length)} · ` +
      `GLSL ES 3.00 on WebGL2: ${String(withGlsl)} (vertex + fragment + link) · failures: ${String(failures)}`,
  )
  return failures === 0 ? 0 : 1
}

process.exitCode = await main()
