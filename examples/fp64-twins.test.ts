// ═══ fp64 twins: the two surfaces compute the same double, and the emulation is that double ═══
//
// The third leg, and the reason it exists. `emit-goldens.test.ts` pins the bytes of each twin,
// `shade-twins.test.ts` pins its `reflect()` against its EDSL original and the structural diff
// between them, and `scripts/compile-gate.ts` hands both emits to Tint and to a real WebGL2
// driver. Not one of those reads a NUMBER. For an emulated double that is the whole question:
// a twin whose `f64` chain lowered to plausible but wrong f32 arithmetic would pass all three,
// and so would a twin that quietly narrowed an operand a step earlier than its original does.
// `fp64-lane-stripes.test.ts` asks the question for one example's numeric core; this asks it
// for every registered `fp64-*-twin`, at the inputs the port was measured on.
//
// Two rows per side, four evaluations per sample, exactly as the porting harness ran them:
//
//   - the DOUBLE row, `compileModule(module, { precision: 'f64' })`, where an `f64` is a
//     JavaScript double (JS numbers ARE IEEE binary64, the definitional semantics);
//   - the EMULATED row, `compileModule(fp64Lower(module), { precision: 'f32' })`, where every
//     `f64` is the `splitF64` pair the host packs and every op rounds to f32: the arithmetic
//     a GPU actually runs.
//
// Two assertions, and they are different in kind:
//
//   1. TWIN AGREES WITH ORIGINAL, on both rows, to 1e-9. This is the gate. The two surfaces
//      build the same expression tree or they do not, and a twin that reassociated a sum,
//      widened an operand or folded a constant in JavaScript shows up here as a number. It is
//      exactly 0 on every sample below, so the tolerance is a guard rail, not a budget.
//   2. THE EMULATION LANDS ON THE DOUBLE, to the 1e-6 `fp64-lane-stripes.test.ts` uses, but
//      only on the samples flagged `tracks`. That flag is a MEASUREMENT, not a wish. These
//      examples are split screens whose left half narrows first ON PURPOSE, and the double row
//      does no `fround`, so on an f32-half or `fp64: 0` sample the emulated row parts from it
//      by design: 6.04e-1 on `fp64-checker-plane`, 1.58e+0 on `fp64-rtc`. Asserting agreement
//      there would assert the example does not draw its own picture. The parting samples are
//      not dead weight either: the arm below requires every set to carry both kinds, so a
//      sample set that drifted onto the flat half entirely cannot pass by asserting nothing.
//
// The samples are embedded rather than read from anywhere: a test that reads its inputs from a
// path outside the package is a test that passes on one machine.
//
// `gpuStubs: true` so a derivative (`fwidth`, twice in `fp64-loran`) reads 0 instead of
// throwing; it is stubbed identically on both sides, so it cannot hide a difference between
// them. The `_fp64` guard the lowering injects needs no binding: on the CPU it is the
// `f64Guard` intrinsic, which answers exactly 1.

import { describe, it, expect } from 'vitest';
import { SHADE_TWINS, shadeExamples } from './_shade.js';
import { examples } from './index.js';
import { compileModule } from '../src/core/oracle.js';
import { fp64Lower } from '../src/core/passes/fp64-lower.js';
import { splitF64 } from '../src/core/fp64/df64-lib.js';
import { zeroOf, type CpuValue } from '../src/core/cpu-runtime.js';
import { stageOf, type ModuleDecl, type StructDecl } from '../src/core/ir/nodes.js';
import type { ShaderType } from '../src/core/ir/types.js';

/** Twin against original, on both rows. Measured at exactly 0 on every sample here. */
const TOL = 1e-9;
/** Emulated against double, the bound `fp64-lane-stripes.test.ts` holds the df64 pair to: a
 *  thousand times tighter than one f32 ulp at 1e7, which is the distance these examples draw. */
const EMU_TOL = 1e-6;

type UniformValue = number | readonly number[];

interface Sample {
  /** What the porter's sample file called it: which half of the screen, and why this input. */
  readonly label: string;
  readonly uv: readonly [number, number];
  /** Merged over the set's defaults. */
  readonly uniforms?: Readonly<Record<string, UniformValue>>;
  /** MEASURED on the original: the emulated row lands within EMU_TOL of the double row here.
   *  False is not a defect, it is the f32 collapse (or, in `fp64-julia`'s deepest samples, the
   *  df64 pair's own ~48-bit floor) that the example is drawn to show. */
  readonly tracks: boolean;
}

interface SampleSet {
  readonly uniforms: Readonly<Record<string, UniformValue>>;
  readonly samples: readonly Sample[];
}

/** The inputs each twin was ported against, keyed by the EDSL example id. */
const SAMPLES: Readonly<Record<string, SampleSet>> = {
  'fp64-deep-zoom': {
    uniforms: { origin: 12345678.0625, span: 4, fp64: 1 },
    samples: [
      {
        label: 'f32 half at 1.2e7: one ulp is 2, the fraction is gone',
        uv: [0.25, 0.5],
        tracks: false,
      },
      {
        label: 'f64 half at 1.2e7: the same formula keeps the stripe',
        uv: [0.75, 0.5],
        tracks: true,
      },
      {
        label: 'f64 half, another sweep position',
        uv: [0.6, 0.25],
        tracks: true,
      },
      {
        label: 'f64 half at 9.87e8, the deep end of the DISTANCE slider',
        uv: [0.9, 0.75],
        uniforms: { origin: 987654321.375, span: 8 },
        tracks: true,
      },
      {
        label: 'f64 half at 1e6, where both halves still stripe',
        uv: [0.75, 0.5],
        uniforms: { origin: 1000000.3, span: 1 },
        tracks: true,
      },
      {
        label: 'f32 half at 1e6, the comparison case',
        uv: [0.25, 0.5],
        uniforms: { origin: 1000000.3, span: 1 },
        tracks: false,
      },
      {
        label: 'toggle off: the f64 half takes the f32 path too',
        uv: [0.75, 0.5],
        uniforms: { fp64: 0 },
        tracks: false,
      },
      {
        label: 'boundary: uv.x = 0.5 is the f64 side',
        uv: [0.5, 0.5],
        tracks: true,
      },
      {
        label: 'f32 half at 9.87e8, flat',
        uv: [0.1, 0.9],
        uniforms: { origin: 987654321.375, span: 8 },
        tracks: false,
      },
    ],
  },
  'fp64-checker-plane': {
    uniforms: {
      center: [100000000.3, 50000000.7],
      resolution: [640, 480],
      zoom_exp: -0.9,
      fp64: 1,
    },
    samples: [
      {
        label: 'f64 half at 1e8: the view f32 cannot draw (ulp 8 = eight cells)',
        uv: [0.75, 0.5],
        tracks: true,
      },
      {
        label: 'f64 half, one cell seam inside the AA width: `line` is partial, not saturated',
        uv: [0.79469, 0.5],
        tracks: false,
      },
      {
        label: 'f64 half at 1e8, near a cell seam so `line` is not saturated',
        uv: [0.9, 0.9],
        tracks: true,
      },
      {
        label: 'f64 half at 1e9, the far end of the distance slider',
        uv: [0.68, 0.42],
        uniforms: { center: [1000000000.3, 500000000.7] },
        tracks: true,
      },
      {
        label: 'f64 half at 1e6 zoomed in: both halves are still crisp there',
        uv: [0.7, 0.355],
        uniforms: { center: [1000000.3, 500000.7], zoom_exp: 2 },
        tracks: true,
      },
      {
        label: 'f64 half with the fp64 toggle off: the whole screen takes the f32 path',
        uv: [0.8, 0.6],
        uniforms: { fp64: 0 },
        tracks: false,
      },
      {
        label: 'f32 half at 1e8: parity cannot flip, the half is flat',
        uv: [0.25, 0.5],
        tracks: false,
      },
      {
        label: 'f32 half at 1e6: f32 still resolves the cells',
        uv: [0.25, 0.4],
        uniforms: { center: [1000000.3, 500000.7] },
        tracks: true,
      },
      {
        label: 'the split seam itself, on the f32 side of uv.x = 0.5',
        uv: [0.49, 0.55],
        tracks: false,
      },
    ],
  },
  'fp64-loran': {
    uniforms: {
      center: [73048614.07988955, 97081924.73716922],
      st_a: [37947331.92202055, 107517440.44572489],
      st_b: [60083275.543199204, 82219219.16437787],
      resolution: [640, 480],
      zoom_exp: -1.6,
      fp64: 1,
    },
    samples: [
      {
        label: 'f64 half, mag 7.5: the ulp-wider-than-a-band regime the blurb names',
        uv: [0.75, 0.5],
        tracks: true,
      },
      {
        label: 'f64 half, off-centre',
        uv: [0.62, 0.28],
        tracks: true,
      },
      {
        label: 'f64 half, mag 8.5: deeper than plain f32 can resolve at all',
        uv: [0.95, 0.8],
        uniforms: {
          center: [730486139.6288956, 970819242.2416925],
          st_a: [379473319.22020555, 1075174404.457249],
          st_b: [600832755.431992, 822192191.6437787],
        },
        tracks: true,
      },
      {
        label: 'f64 half, mag 9 with the view zoomed in (span 10^-1.5)',
        uv: [0.85, 0.15],
        uniforms: {
          center: [2310000000.13, 3070000000.57],
          st_a: [1200000000, 3400000000],
          st_b: [1900000000, 2600000000],
          zoom_exp: 1.5,
        },
        tracks: true,
      },
      {
        label: 'f32 half of the split screen, same stations',
        uv: [0.25, 0.5],
        tracks: false,
      },
      {
        label: 'f32 half, near the seam',
        uv: [0.45, 0.62],
        tracks: false,
      },
      {
        label: 'toggle off (fp64 = 0): the right half takes the f32 branch too',
        uv: [0.8, 0.4],
        uniforms: { fp64: 0 },
        tracks: false,
      },
      {
        label: 'mag 6, where both halves still draw a clean chart',
        uv: [0.7, 0.6],
        uniforms: {
          center: [2310000.13, 3070000.57],
          st_a: [1200000, 3400000],
          st_b: [1900000, 2600000],
        },
        tracks: true,
      },
    ],
  },
  'fp64-rtc': {
    uniforms: {
      center: [100000000, 50000000],
      mark: [100000003.7, 50000002.3],
      resolution: [640, 480],
      zoom_exp: -1.4,
      fp64: 1,
    },
    samples: [
      {
        label: 'f64 half at 1e8, on the reticle: ulp(1e8)=8 world units, plain f32 goes flat',
        uv: [0.75, 0.5],
        tracks: true,
      },
      {
        label: 'f64 half, off-centre, inside the first ring',
        uv: [0.68, 0.62],
        tracks: true,
      },
      {
        label: 'f64 half, outer ring + vignette falloff',
        uv: [0.95, 0.18],
        tracks: true,
      },
      {
        label: 'f32 half at 1e8, the quantized twin of the first sample',
        uv: [0.25, 0.5],
        tracks: false,
      },
      {
        label: 'f32 half, off-centre',
        uv: [0.18, 0.62],
        tracks: false,
      },
      {
        label: 'toggle off: both halves take the f32 branch',
        uv: [0.75, 0.5],
        uniforms: { fp64: 0 },
        tracks: false,
      },
      {
        label: 'mag 6, where the doc says both halves still agree',
        uv: [0.8, 0.45],
        uniforms: { center: [1000000, 500000], mark: [1000003.7, 500002.3] },
        tracks: true,
      },
      {
        label: 'mag 9, one decade past the slider top: f32 ulp is 64 world units',
        uv: [0.85, 0.35],
        uniforms: { center: [1000000000, 500000000], mark: [1000000003.7, 500000002.3] },
        tracks: true,
      },
      {
        label: 'mag 9 on the f32 half: the same eye, the reticle snapped off-target',
        uv: [0.15, 0.35],
        uniforms: { center: [1000000000, 500000000], mark: [1000000003.7, 500000002.3] },
        tracks: false,
      },
      {
        label: 'wider view span (zoom_exp -2), f64 half',
        uv: [0.72, 0.55],
        uniforms: { zoom_exp: -2 },
        tracks: true,
      },
    ],
  },
  'fp64-julia': {
    uniforms: {
      center: [1.5255044073468653, -0.07591217756271362],
      resolution: [640, 480],
      zoom_exp: 4,
      fp64: 1,
    },
    samples: [
      {
        label: 'f64 half, the 1e-4 span the zoom slider opens on',
        uv: [0.75, 0.5],
        tracks: false,
      },
      {
        label: 'f32 half, the same complex window at 1e-4',
        uv: [0.25, 0.5],
        tracks: false,
      },
      {
        label: 'f64 half at a 1e-10 span, well past the ~1e-7 f32 wall',
        uv: [0.78, 0.62],
        uniforms: { zoom_exp: 10 },
        tracks: false,
      },
      {
        // A tracking sample has to be COLOURED to assert anything: the interior of the set is
        // [0, 0, 0, 1] on both rows and would pass the bound by being black twice. This one
        // and the two below were picked by measurement, not by eye.
        label: 'f64 half, 1e-8 span on a 16:9 viewport, off the bisected row',
        uv: [0.8, 0.2],
        uniforms: { resolution: [1920, 1080], zoom_exp: 8 },
        tracks: true,
      },
      {
        label: 'f32 half, 1e-9 span, pixel A of an adjacent pair',
        uv: [0.2, 0.5],
        uniforms: { zoom_exp: 9 },
        tracks: false,
      },
      {
        label: 'f32 half, 1e-9 span, pixel B: the f32 ulp near 1.5 quantizes it onto A',
        uv: [0.2005, 0.5],
        uniforms: { zoom_exp: 9 },
        tracks: false,
      },
      {
        label: 'f64 half, 1e-9 span, pixel A of the same pair',
        uv: [0.7, 0.5],
        uniforms: { zoom_exp: 9 },
        tracks: false,
      },
      {
        label: 'f64 half, 1e-9 span, pixel B: the emulated double still separates them',
        uv: [0.7005, 0.5],
        uniforms: { zoom_exp: 9 },
        tracks: false,
      },
      {
        label: 'f64 half, mid depth off the bisected row',
        uv: [0.6, 0.85],
        uniforms: { zoom_exp: 7 },
        tracks: true,
      },
      {
        label: 'toggle off: the f64 half runs the f32 path in place',
        uv: [0.75, 0.5],
        uniforms: { fp64: 0, zoom_exp: 10 },
        tracks: false,
      },
      {
        label: 'f64 half, 1e-11 span, centre rounded to 1.5 so the f32 wall moves',
        uv: [0.9, 0.35],
        uniforms: { center: [1.5, -0.07591217756271362], zoom_exp: 11 },
        tracks: true,
      },
      {
        // The one sample here where the PRECISION OF THE ESCAPE TEST shows. The example takes
        // |z|² in f32 from the narrowed words, not in df64, and near |z|² = 16 the two can
        // disagree by a step. Every other sample in this set escapes (or stays) the same way
        // under both tests, so a twin whose escape test drifted back to df64 while its
        // original stayed in f32 (or the reverse) passed every numeric check here and was
        // caught only by the byte goldens, which a re-bake overwrites. This pixel is one of
        // three that bisecting count boundaries to adjacent f32 uv values found: a df64 test
        // escapes at step 49 (its |z|² narrows to exactly 16) and the f32 test at step 50, a
        // colour 4.1e-4 apart on the emulated row. Tracking MEASURED: the double row counts 50
        // here too, and the emulated row lands 7.3e-8 from it. At the other two pixels the
        // double counts with the df64 test instead; within an f32 rounding of 16 neither test
        // is the double's.
        label: 'f64 half, 1e-4 span, |z|² within an f32 rounding of 16 at step 49',
        uv: [0.6000940799713135, 0.220703125],
        tracks: true,
      },
    ],
  },
  'fp64-burning-ship': {
    uniforms: { center: [-1.748, 0], resolution: [640, 480], zoom_exp: 4, fp64: 1 },
    samples: [
      {
        label: 'f32 half, 1e-4 span, escape structure still present in f32',
        uv: [0.25, 0.62],
        tracks: false,
      },
      {
        label: 'f64 half, same 1e-4 span',
        uv: [0.75, 0.62],
        tracks: true,
      },
      {
        label: 'f64 half at a 1e-10 span, far past the f32 ulp of 1.748 (~1e-7)',
        uv: [0.9, 0.62],
        uniforms: { zoom_exp: 10 },
        tracks: true,
      },
      {
        label: 'f32 half at the same 1e-10 span, where plain f32 goes flat',
        uv: [0.1, 0.62],
        uniforms: { zoom_exp: 10 },
        tracks: false,
      },
      {
        label: 'fp64 toggle off, the right half falls back to the f32 branch',
        uv: [0.8, 0.4],
        uniforms: { zoom_exp: 10, fp64: 0 },
        tracks: false,
      },
      {
        label: 'f64 half at a 1e-12 span, near the df64 floor',
        uv: [0.62, 0.33],
        uniforms: { zoom_exp: 12 },
        tracks: false,
      },
      {
        label: 'f64 half just past the ~1e-7 collapse threshold',
        uv: [0.68, 0.71],
        uniforms: { zoom_exp: 7 },
        tracks: true,
      },
      {
        label: 'f32 half, 1e-2 span, the wide ship where both halves agree',
        uv: [0.35, 0.28],
        uniforms: { zoom_exp: 2 },
        tracks: false,
      },
    ],
  },
  'fp64-newton': {
    uniforms: {
      center: [0.17616732990860245, 0.7111381151066305],
      resolution: [640, 480],
      zoom_exp: 4,
      fp64: 1,
    },
    samples: [
      {
        label: 'f64 half, default span 1e-4: root 1 (vermilion), converges fast',
        uv: [0.51, 0.45],
        tracks: true,
      },
      {
        label:
          'f64 half, default span: the neighbouring sky basin, the Wada interleave one screen width away',
        uv: [0.72, 0.7],
        tracks: true,
      },
      {
        label:
          'f64 half, span 1e-10, past one f32 ulp of the center (~1.5e-8): the emulated double still separates the basins',
        uv: [0.6, 0.45],
        uniforms: { zoom_exp: 10 },
        tracks: true,
      },
      {
        label:
          'f32 half, the SAME complex point at span 1e-10 (sx = 0.2 either side): plain f32 starts every pixel at one quantized point and goes flat',
        uv: [0.1, 0.45],
        uniforms: { zoom_exp: 10 },
        tracks: false,
      },
      {
        label:
          'toggle off (fp64 = 0): the f64 half takes the all-f32 branch at the pixel of sample 2',
        uv: [0.6, 0.45],
        uniforms: { zoom_exp: 10, fp64: 0 },
        tracks: false,
      },
      {
        label: 'f64 half, span 1e-12, root e^{2pi i/3} (sky)',
        uv: [0.9, 0.45],
        uniforms: { zoom_exp: 12 },
        tracks: true,
      },
      {
        label:
          'f64 half, span 1e-12, root e^{-2pi i/3} (gold), a boundary pixel whose step never goes sub-epsilon',
        uv: [0.51, 0.2],
        uniforms: { zoom_exp: 12 },
        tracks: true,
      },
      {
        label: 'f64 half, span 1e-7, corner pixel right at the f32 threshold',
        uv: [0.99, 0.02],
        uniforms: { zoom_exp: 7 },
        tracks: true,
      },
      {
        label: "f64 half, the slider's deepest setting, span 1e-13",
        uv: [0.96, 0.45],
        uniforms: { zoom_exp: 13 },
        tracks: true,
      },
    ],
  },
  'fp64-mandelbrot-de': {
    uniforms: { center: [-1.7489, 0], resolution: [640, 480], zoom_exp: 10, fp64: 1 },
    samples: [
      {
        label: 'span 1e-10, f64 half, off axis: a glowing filament',
        uv: [0.62, 0.41],
        tracks: false,
      },
      {
        label:
          'span 1e-10, f32 half, the SAME complex point (uv.x - 0.5 folds to the same sx): collapsed to interior',
        uv: [0.12, 0.41],
        tracks: false,
      },
      {
        label: 'span 1e-10, f64 half, on the real axis: never escapes, escaped = 0',
        uv: [0.75, 0.5],
        tracks: true,
      },
      {
        label: 'span 1e-10, f64 half, far corner of the view',
        uv: [0.98, 0.93],
        tracks: false,
      },
      {
        label: 'toggle off, the f64 half runs all-f32 and matches sample 1',
        uv: [0.62, 0.41],
        uniforms: { fp64: 0 },
        tracks: false,
      },
      {
        label: 'span 1e-13, f64 half: the deepest the slider goes',
        uv: [0.55, 0.52],
        uniforms: { zoom_exp: 13 },
        tracks: false,
      },
      {
        label: 'span 1e-2, f64 half: shallow enough that both precisions agree',
        uv: [0.9, 0.7],
        uniforms: { zoom_exp: 2 },
        tracks: true,
      },
      {
        label: 'span 1e-2, f32 half, the same complex point',
        uv: [0.4, 0.7],
        uniforms: { zoom_exp: 2 },
        tracks: false,
      },
      {
        label: 'world coordinate near 1e7, f64 half, where an f32 ulp is 1',
        uv: [0.8, 0.6],
        uniforms: { center: [10000000.3, 0.7], zoom_exp: 5 },
        tracks: true,
      },
      {
        label: 'world coordinate near 1e7, f32 half, the same complex point',
        uv: [0.3, 0.6],
        uniforms: { center: [10000000.3, 0.7], zoom_exp: 5 },
        tracks: true,
      },
    ],
  },
  'fp64-clock': {
    uniforms: { time: 12.5, resolution: [640, 480], epoch: 100000000.123, speed: 0.25, fp64: 1 },
    samples: [
      {
        label: 'f64 half, dial point sx=0.56, epoch 1e8+0.123 where one f32 ulp is 8 s',
        uv: [0.78, 0.62],
        tracks: true,
      },
      {
        label: 'f64 half, SAME dial point one 60 Hz frame later: the f64 hand has moved',
        uv: [0.78, 0.62],
        uniforms: { time: 12.5166666 },
        tracks: true,
      },
      {
        label: 'f32 half, the mirrored dial point (sx=0.56) at the same 1e8 epoch',
        uv: [0.28, 0.62],
        tracks: false,
      },
      {
        label: 'f32 half, SAME point one frame later: +time is absorbed by ulp(1e8), frozen',
        uv: [0.28, 0.62],
        uniforms: { time: 12.5166666 },
        tracks: false,
      },
      {
        label: 'f64 half, bezel ring at r near 0.82',
        uv: [0.9, 0.55],
        tracks: true,
      },
      {
        label: 'f64 half, tick band, epoch swept to 1e9 seconds (30+ years)',
        uv: [0.68, 0.3],
        uniforms: { epoch: 1000000000.123 },
        tracks: true,
      },
      {
        label: 'f64 half with the fp64 toggle off: the right dial takes the f32 path too',
        uv: [0.75, 0.4],
        uniforms: { fp64: 0 },
        tracks: false,
      },
      {
        label: 'f64 half, epoch 1e4 where both halves still sweep',
        uv: [0.72, 0.7],
        uniforms: { epoch: 10000.123 },
        tracks: true,
      },
      {
        label: 'f32 half, hub and trail, epoch 1e4 where both halves still sweep',
        uv: [0.3, 0.7],
        uniforms: { epoch: 10000.123 },
        tracks: false,
      },
    ],
  },
  'fp64-cancellation': {
    uniforms: { resolution: [640, 480], half_width: 0.05, fp64: 1 },
    samples: [
      {
        label:
          'f64 half, on the curve near the right edge: sx = 0.96, so x - 1 = 0.92w and the true (x-1)^7 is 0.43 plot units, which the expanded form must recover from eight ~1-sized terms',
        uv: [0.98, 0.715],
        tracks: true,
      },
      {
        label:
          'f64 half, same column well below the curve: the fill term, whose boundary is the whole verdict of the picture',
        uv: [0.98, 0.3],
        tracks: true,
      },
      {
        label: 'f64 half, near the seam: sx = 0.04, the mirror-image negative lobe',
        uv: [0.52, 0.29],
        tracks: false,
      },
      {
        label: 'f64 half, mid-panel where the curve is still ~1e-3 of the plot range',
        uv: [0.9, 0.62],
        tracks: true,
      },
      {
        label:
          'f64 half, slider at its minimum w = 0.012: the true value is ~3.6e-14 absolute, two decades past where f32 went flat and where df64 itself starts to fray',
        uv: [0.98, 0.715],
        uniforms: { half_width: 0.012 },
        tracks: false,
      },
      {
        label:
          'f64 half, slider at its maximum w = 0.12, at 1280x720 so the pixel-width terms move too',
        uv: [0.96, 0.44],
        uniforms: { half_width: 0.12, resolution: [1280, 720] },
        tracks: true,
      },
      {
        label:
          'f32 half, the exact mirror of sample 0 (sx = 0.96): plain f32 goes flat here, the expanded polynomial returning ~5e-6 noise against a true 3.6e-10',
        uv: [0.48, 0.715],
        tracks: false,
      },
      {
        label: 'f32 half, the mirror of sample 2 (sx = 0.04)',
        uv: [0.02, 0.29],
        tracks: false,
      },
      {
        label:
          'toggle off (fp64 = 0): the right half takes the f32 branch too, so this column must land where sample 6 does',
        uv: [0.98, 0.715],
        uniforms: { fp64: 0 },
        tracks: false,
      },
    ],
  },
  'fp64-sine-sweep': {
    uniforms: { resolution: [640, 480], base: 1000000.123, fp64: 1 },
    samples: [
      {
        label:
          'f64 half, base 1e8, sx 0.73: one f32 ulp of the argument is 8 radians, wider than the whole 8*PI sweep, so f32 sin sticks at -0.787573 while f64 sin reads 0.999970; the plot row sits between the two, so the fill flips',
        uv: [0.865, 0.5531],
        uniforms: { base: 100000000.123 },
        tracks: false,
      },
      {
        label:
          'f64 half, base 1e8, sx 0.72: the neighbouring column, f32 sin still -0.787573 (the same staircase tread), f64 sin 0.966625',
        uv: [0.86, 0.54476],
        uniforms: { base: 100000000.123 },
        tracks: true,
      },
      {
        label:
          "f64 half, base 1e8, sx 0.12: the widest gap on the sweep, f64 sin -0.932604 against f32's +0.931639",
        uv: [0.56, 0.49976],
        uniforms: { base: 100000000.123 },
        tracks: true,
      },
      {
        label: 'f64 half, base 1e7, sx 0.77: f64 sin -0.190436, f32 sin +0.279818',
        uv: [0.885, 0.52235],
        uniforms: { base: 10000000.123 },
        tracks: true,
      },
      {
        label: 'f64 half, base 1e7, sx 0.25: f64 sin 0.306057, f32 sin 0.657303',
        uv: [0.625, 0.74084],
        uniforms: { base: 10000000.123 },
        tracks: true,
      },
      {
        label:
          'f32 half, base 1e8, the same sx 0.73: the staircase side of the split, and the sample that shows the two surfaces build the same f32 arithmetic',
        uv: [0.365, 0.5531],
        uniforms: { base: 100000000.123 },
        tracks: false,
      },
      {
        label: 'f64 half, base 1e8, sx 0.73, fp64 toggle off: the right half runs the f32 path too',
        uv: [0.865, 0.5531],
        uniforms: { base: 100000000.123, fp64: 0 },
        tracks: false,
      },
      {
        label:
          "f64 half, base 1e6 (the slider's default), sx 0.63: the sweep still resolves, f64 sin 0.108685 against f32's 0.127678",
        uv: [0.815, 0.2],
        uniforms: { base: 1000000.123 },
        tracks: true,
      },
      {
        label: 'f64 half, base 1e4, sx 0.42: both halves smooth, f64 and f32 sin agree to 2.7e-7',
        uv: [0.71, 0.5],
        uniforms: { base: 10000.123 },
        tracks: true,
      },
    ],
  },
};

const structsOf = (m: ModuleDecl): ReadonlyMap<string, StructDecl> =>
  new Map(m.structs.map((s) => [s.name, s]));

/** The fragment entry. The EDSL's `fn()` records its stage in `attrs`, the source language in
 *  `stage`, and `stageOf` reads both, which is what `reflect()` does too. */
const fragmentEntry = (m: ModuleDecl): string => {
  const f = m.funcs.find((x) => stageOf(x) === 'fragment');
  if (!f) throw new Error('no fragment entry');
  return f.name;
};

/** A sample's JSON as the CPU value of `type` in the AUTHORED module: an `f64` is one JS
 *  number, a `vec2f64` a pair of them, a struct its fields, a field the sample omits zero. */
function asDouble(
  v: unknown,
  type: ShaderType,
  structs: ReadonlyMap<string, StructDecl>,
): CpuValue {
  if (type.kind === 'struct') {
    const decl = structs.get(type.name);
    if (!decl) throw new Error(`no struct ${type.name}`);
    const src = (v ?? {}) as Record<string, unknown>;
    const out: Record<string, CpuValue> = {};
    for (const f of decl.fields) out[f.name] = asDouble(src[f.name], f.type, structs);
    return out;
  }
  if (v === undefined || v === null) return zeroOf(type, structs);
  return v as CpuValue;
}

/** The same value as the LOWERED module takes it: an `f64` field becomes the `splitF64` pair
 *  the host packs into the buffer, a `vecN<f64>` the `{ hi, lo }` planes, recursively. Only
 *  right when BOTH halves are fed this way; hand-packing is how a lowered row comes to agree
 *  with a double row that was never asked the same question. */
function asLowered(
  v: CpuValue,
  type: ShaderType,
  structs: ReadonlyMap<string, StructDecl>,
): CpuValue {
  if (type.kind === 'f64') return splitF64(v as number);
  if (type.kind === 'vec64') {
    const pairs = (v as number[]).map((x) => splitF64(x));
    return { hi: pairs.map((p) => p[0]!), lo: pairs.map((p) => p[1]!) } as unknown as CpuValue;
  }
  if (type.kind === 'struct') {
    const decl = structs.get(type.name);
    if (!decl) throw new Error(`no struct ${type.name}`);
    const src = v as Record<string, CpuValue>;
    const out: Record<string, CpuValue> = {};
    for (const f of decl.fields) out[f.name] = asLowered(src[f.name]!, f.type, structs);
    return out;
  }
  return v;
}

const flatten = (v: CpuValue): number[] => {
  if (typeof v === 'number') return [v];
  if (typeof v === 'boolean') return [v ? 1 : 0];
  if (Array.isArray(v)) return (v as CpuValue[]).flatMap(flatten);
  if (v && typeof v === 'object')
    return Object.values(v as Record<string, CpuValue>).flatMap(flatten);
  return [NaN];
};

/** Largest absolute component difference. `Infinity` when the two are not the same shape, so a
 *  mismatch fails the assertion rather than passing on a short walk. */
const maxAbsDiff = (a: CpuValue, b: CpuValue): number => {
  const xs = flatten(a);
  const ys = flatten(b);
  if (xs.length !== ys.length) return Infinity;
  let m = 0;
  for (let i = 0; i < xs.length; i++) {
    const d = Math.abs(xs[i]! - ys[i]!);
    if (Number.isNaN(d)) return Infinity;
    m = Math.max(m, d);
  }
  return m;
};

/** One sample on one module: the fragment entry evaluated as authored and as lowered. */
function evaluate(
  m: ModuleDecl,
  set: SampleSet,
  s: Sample,
): { double: CpuValue; emulated: CpuValue } {
  const structs = structsOf(m);
  const name = fragmentEntry(m);
  const f = m.funcs.find((x) => x.name === name)!;
  const uniforms = { ...set.uniforms, ...(s.uniforms ?? {}) };

  // Every binding is set: a struct one from the sample, anything else (the guard's texture
  // handle) zero, which `gpuStubs` answers.
  const bindings = m.bindings.map((b) => ({
    name: b.name,
    type: b.type,
    value: b.type.kind === 'struct' ? asDouble(uniforms, b.type, structs) : zeroOf(b.type, structs),
  }));

  // The IO struct parameter, field by field: `uv` from the sample, `pos` derived from it and
  // the resolution the way a rasterizer would, anything else zero.
  const res = (uniforms['resolution'] as readonly number[] | undefined) ?? [1, 1];
  const pos = [s.uv[0] * res[0]!, s.uv[1] * res[1]!, 0, 1];
  const fieldOf = (fieldName: string, type: ShaderType): CpuValue =>
    fieldName === 'uv'
      ? [...s.uv]
      : fieldName === 'pos' || fieldName === 'position'
        ? [...pos]
        : zeroOf(type, structs);
  const args: CpuValue[] = f.params.map((p) => {
    if (p.type.kind === 'struct') {
      const decl = structs.get(p.type.name)!;
      const out: Record<string, CpuValue> = {};
      for (const fl of decl.fields) out[fl.name] = fieldOf(fl.name, fl.type);
      return out;
    }
    return fieldOf(p.name, p.type);
  });

  const cpu = compileModule(m, { precision: 'f64', gpuStubs: true });
  for (const b of bindings) cpu.setBinding(b.name, b.value);
  const double = cpu.fns[name]!(...args);

  const lowered = compileModule(fp64Lower(m), { precision: 'f32', gpuStubs: true });
  for (const b of bindings) lowered.setBinding(b.name, asLowered(b.value, b.type, structs));
  const emulated = lowered.fns[name]!(...args);

  return { double, emulated };
}

/** The registered fp64 twins, paired with the EDSL example each mirrors. */
const pairs = [...SHADE_TWINS]
  .filter(([twinId]) => twinId.startsWith('fp64-'))
  .map(([twinId, ofId]) => ({
    twinId,
    ofId,
    twin: shadeExamples.find((e) => e.id === twinId)!.module,
    original: examples.find((e) => e.id === ofId)!.module,
    set: SAMPLES[ofId],
  }));

describe('fp64 twins: the sample sets are the ones the port was measured on', () => {
  it('every registered fp64 twin carries a sample set, and every set names a twin', () => {
    // The floor. A twin registered without samples would be pinned by the goldens and the
    // compile gate and checked numerically by nothing, which is the hole this file fills.
    for (const p of pairs) expect(p.set, `${p.twinId}: no samples for ${p.ofId}`).toBeDefined();
    for (const ofId of Object.keys(SAMPLES))
      expect(
        pairs.some((p) => p.ofId === ofId),
        `SAMPLES has ${ofId}, which no registered twin mirrors`,
      ).toBe(true);
    expect(pairs.length).toBeGreaterThanOrEqual(11);
  });

  for (const p of pairs) {
    it(`${p.twinId}: the set carries both a tracking sample and a parting one`, () => {
      // Neither assertion below may be vacuous. A set of only f32-half samples would never
      // exercise the emulation; a set of only tracking ones would never cover the half the
      // example exists to contrast it with.
      const samples = p.set!.samples;
      expect(
        samples.filter((s) => s.tracks).length,
        'no sample where the emulation tracks',
      ).toBeGreaterThan(0);
      expect(
        samples.filter((s) => !s.tracks).length,
        'no sample where the two precisions part',
      ).toBeGreaterThan(0);
    });
  }
});

describe('fp64 twins: the twin computes what its original computes', () => {
  for (const p of pairs) {
    const samples = p.set!.samples;
    it.each(samples.map((s, i) => [i, s.label, s] as const))(
      `${p.twinId}: sample %i (%s) agrees on both rows`,
      (_i, _label, s) => {
        const o = evaluate(p.original, p.set!, s);
        const t = evaluate(p.twin, p.set!, s);
        // The double row: the same algebra, evaluated in binary64. A reassociated sum or a
        // constant the EDSL folded in JavaScript would move this and nothing else would.
        expect(maxAbsDiff(o.double, t.double), 'double row').toBeLessThanOrEqual(TOL);
        // The emulated row: the same df64 calls in the same order, under f32 rounding. This is
        // the one that catches a narrow moved by one step, which the double row cannot see
        // because it does no rounding at all.
        expect(maxAbsDiff(o.emulated, t.emulated), 'emulated row').toBeLessThanOrEqual(TOL);
      },
    );
  }
});

describe('fp64 twins: the emulation is the double, where the example says it is', () => {
  for (const p of pairs) {
    const tracking = p.set!.samples.filter((s) => s.tracks);
    it.each(tracking.map((s, i) => [i, s.label, s] as const))(
      `${p.twinId}: tracking sample %i (%s) lowers to its own double`,
      (_i, _label, s) => {
        // `oracle(fp64Lower(m)) ≈ oracle(m)`, the metamorphic relation the fp64 pass is
        // designed around, asserted on the TWIN: the source surface reaches the same df64
        // bodies the EDSL does, and they carry the value a double carries.
        const t = evaluate(p.twin, p.set!, s);
        expect(maxAbsDiff(t.double, t.emulated), 'twin: emulated vs double').toBeLessThan(EMU_TOL);
        // And on the original, so a sample that stopped tracking is read as a change in the
        // shader or in the df64 library rather than as a defect in the twin.
        const o = evaluate(p.original, p.set!, s);
        expect(maxAbsDiff(o.double, o.emulated), 'original: emulated vs double').toBeLessThan(
          EMU_TOL,
        );
      },
    );
  }
});
