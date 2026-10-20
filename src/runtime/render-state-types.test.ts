// The type half of the render-state fields of proposal 0064 (PR-1, Required validation, "Type
// half"). Each probe is a `@ts-expect-error` line or a call that must compile. `bun run build`
// fails on a stale directive, so a probe that stops failing is caught there. The function
// `probes` is never called: the test only reads its types.
//
// Verifies: Rule 11.11.

import { describe, expectTypeOf, it } from 'vitest';
import type { CompareFunction, Program, RenderPipeline, RenderState } from './program.js';
import type { StencilFaceState, StencilOperation, StencilState } from '../runtime.js';
import type { SamplerOptions } from './resources.js';
import type { DepthAttachment } from '../runtime.js';
import type { Frame, RenderPass, Runtime } from './runtime.js';

declare const program: Program;
declare const pass: RenderPass;
declare const frame: Frame;
declare const rt: Runtime;
declare const colour: import('./resources.js').Texture;
declare const format: string;
declare const width: number;
declare const height: number;
declare const scene: RenderPipeline;
declare const sceneBindings: Record<string, unknown>;
declare const geometry: { readonly count: number };
declare const panel: {
  getBoundingClientRect(): { x: number; y: number; width: number; height: number };
};
declare const uiPipeline: RenderPipeline;
declare const uiBindings: Record<string, unknown>;
declare const quad: { readonly count: number };
declare const depthBuffer: import('./resources.js').Texture;
declare const markBindings: Record<string, unknown>;
declare const outlineBindings: Record<string, unknown>;
declare const shape: { readonly count: number };
declare const flag: boolean;
declare const glassBindings: Record<string, unknown>;
declare const panes: { readonly count: number };

const probes = (): void => {
  // The compare is a CompareFunction: a misspelling is refused.
  // @ts-expect-error 'lesss' is not a CompareFunction
  program.render({ depth: { format: 'depth24plus', compare: 'lesss' } });
  const c: CompareFunction = 'less';
  program.render({ depth: { format: 'x', compare: c } });

  // A state held in a variable with no annotation widens its compare to string, and is refused.
  const hoisted = { depth: { format: 'depth32float', compare: 'greater' } };
  // @ts-expect-error the hoisted compare is a string, not a CompareFunction
  program.render(hoisted);
  program.render({ depth: { format: 'depth32float', compare: 'greater' } } satisfies RenderState);
  program.render({ depth: { format: 'depth32float', compare: 'greater' } } as const);
  const annotated: RenderState = { depth: { format: 'depth32float', compare: 'greater' } };
  program.render(annotated);

  // The runtime refuses a key the type does not name, and the render call infers its state type,
  // so this one compiles (a limit the runtime's refusal covers; see the runtime tests).
  program.render({ depth: { format: 'depth24plus', writ: false } });

  // The blend constant is four numbers: a tuple, a number array or a Float32Array.
  program.render({ blendConstant: [0, 0, 0, 1] });
  const nums: number[] = [0, 0, 0, 1];
  program.render({ blendConstant: nums });
  program.render({ blendConstant: new Float32Array([0, 0, 0, 1]) });
  // @ts-expect-error a string is not an ArrayLike of numbers
  program.render({ blendConstant: 'x' });

  // The compare of a sampler is the same type.
  const so: SamplerOptions = { compare: c };
  // @ts-expect-error 'lesss' is not a comparison
  const bad: SamplerOptions = { compare: 'lesss' };
  void so;
  void bad;

  // The pass methods take each depth argument on its own.
  pass.setBlendConstant([0, 0, 0, 1]);
  pass.setBlendConstant(new Float32Array(4));
  pass.setViewport(0, 0, 16, 12);
  pass.setViewport(0, 0, 16, 12, 0.25);
  pass.setViewport(0, 0, 16, 12, 0.25, 0.75);
  // @ts-expect-error a viewport takes four arguments at least
  pass.setViewport(0, 0, 1);
  pass.setScissorRect(0, 0, 16, 12);

  // Each section-69 fragment of PR-1 compiles as written (Rule 13.8), with its free names declared.
  const scissorUi = (): void => {
    // A scissored UI pass. The rectangle comes from a layout box, so each side is rounded.
    const box = panel.getBoundingClientRect();
    frame.pass({ color: [{ target: colour, load: 'load' }] }, (pass) => {
      pass.setScissorRect(
        Math.round(box.x),
        Math.round(box.y),
        Math.round(box.width),
        Math.round(box.height),
      );
      pass.draw(uiPipeline, uiBindings, quad);
      pass.setScissorRect(0, 0, width, height);
      pass.draw(scene, sceneBindings, geometry);
    });
  };
  const twoViews = (): void => {
    // Two views side by side. Each view sets its viewport before its draws.
    const half = width >> 1;
    frame.pass({ color: [{ target: colour }] }, (pass) => {
      pass.setViewport(0, 0, half, height);
      pass.draw(scene, sceneBindings, geometry);
      pass.setViewport(half, 0, half, height);
      pass.draw(scene, sceneBindings, geometry);
    });
  };
  const blendConstantPass = async (): Promise<void> => {
    // A pipeline constant and a pass constant: the pipeline's draws read its own constant.
    const glow = await program.render({
      vertex: 'vs',
      fragment: 'fs',
      targets: [
        {
          format,
          blend: {
            color: { srcFactor: 'constant', dstFactor: 'one-minus-constant', operation: 'add' },
            alpha: { srcFactor: 'constant', dstFactor: 'one-minus-constant', operation: 'add' },
          },
        },
      ],
      blendConstant: [0.25, 0.5, 0.75, 1],
    });
    frame.pass({ color: [{ target: colour, load: 'load' }] }, (pass) => {
      pass.setBlendConstant([0.25, 0.5, 0.75, 1]);
      pass.draw(glow, sceneBindings, geometry);
    });
  };
  void rt;
  void scissorUi;
  void twoViews;
  void blendConstantPass;
};

const stencilProbes = (): void => {
  // The operation is a StencilOperation: a misspelling is refused.
  // @ts-expect-error 'zeroo' is not a StencilOperation
  program.render({ depth: { format: 'depth24plus-stencil8', stencil: { passOp: 'zeroo' } } });
  const op: StencilOperation = 'replace';
  program.render({ depth: { format: 'depth24plus-stencil8', stencil: { passOp: op } } });

  // A stencil state held in a variable with no annotation widens its operation to string.
  const hoisted = { passOp: 'replace' };
  // @ts-expect-error the hoisted operation is a string, not a StencilOperation
  program.render({ depth: { format: 'depth24plus-stencil8', stencil: hoisted } });
  const annotated: StencilState = { passOp: 'replace' };
  program.render({ depth: { format: 'depth24plus-stencil8', stencil: annotated } });
  const satisfied = { passOp: 'replace' } satisfies StencilState;
  program.render({ depth: { format: 'depth24plus-stencil8', stencil: satisfied } });
  const constant = { passOp: 'replace' } as const;
  program.render({ depth: { format: 'depth24plus-stencil8', stencil: constant } });
  const face: StencilFaceState = { failOp: 'invert' };
  program.render({ depth: { format: 'depth24plus-stencil8', stencil: { front: face } } });

  // A limit, documented: a wrong key among right ones compiles, because the render call infers its
  // state. A key the type does not name alone is refused as a weak type.
  program.render({
    depth: { format: 'depth24plus-stencil8', stencil: { passOp: 'keep', fron: {} } },
  });
  program.render({ depth: { format: 'depth32float', bias: { constant: 1, slopeScal: 1 } } });
  // @ts-expect-error no key of bias is named constnt
  program.render({ depth: { format: 'depth24plus', bias: { constnt: 1 } } });
  // @ts-expect-error no key of stencil is named fron
  program.render({ depth: { format: 'depth24plus-stencil8', stencil: { fron: {} } } });

  // The bias: numbers, and a string is refused.
  program.render({
    depth: { format: 'depth24plus', bias: { constant: -2, slopeScale: 1.5, clamp: 0 } },
  });
  // @ts-expect-error a bias constant is a number
  program.render({ depth: { format: 'depth24plus', bias: { constant: 'x' } } });

  // The reference: a pass takes one number, and a call with none is refused.
  pass.setStencilReference(1);
  // @ts-expect-error setStencilReference takes a reference
  pass.setStencilReference();

  // The sample mask: a number, and a string is refused.
  program.render({ multisample: { mask: 1 } });
  // @ts-expect-error a mask is a number
  program.render({ multisample: { mask: 'x' } });

  // The section-69 fragments compile as written (decal, and the stencil outline with two passes).
  const decalAndOutline = async (): Promise<void> => {
    const decal = await program.render({
      vertex: 'vs',
      fragment: 'fs',
      targets: [format],
      depth: { format: 'depth32float', bias: { constant: -2 } },
    });
    const mark = await program.render({
      vertex: 'vs',
      fragment: 'fs',
      targets: [format],
      depth: {
        format: 'depth24plus-stencil8',
        compare: 'always',
        write: false,
        stencil: { passOp: 'replace', reference: 1 },
      },
    });
    const outline = await program.render({
      vertex: 'vs',
      fragment: 'fs',
      targets: [format],
      depth: {
        format: 'depth24plus-stencil8',
        write: false,
        stencil: { compare: 'not-equal', reference: 1 },
      },
    });
    frame.pass({ color: [{ target: colour }], depth: { target: depthBuffer } }, (pass) => {
      pass.draw(mark, markBindings, shape);
    });
    frame.pass(
      { color: [{ target: colour, load: 'load' }], depth: { target: depthBuffer, load: 'load' } },
      (pass) => {
        pass.draw(outline, outlineBindings, shape);
      },
    );
    void decal;
  };
  void decalAndOutline;
};

/** The attachment types of PR-3: each line of the first probe compiles, and each `@ts-expect-error`
 *  line is refused. The second probe is the two discard and translucent fragments of the surface
 *  document, with its free names declared. */
const attachmentProbes = (): void => {
  const hostView: object = {};
  const hoisted = { target: depthBuffer, readOnly: flag };
  frame.pass({ color: [colour, hostView], depth: { target: depthBuffer } }, () => undefined);
  frame.pass({ depth: { target: depthBuffer, readOnly: true } }, () => undefined);
  frame.pass(
    { depth: { target: depthBuffer, readOnly: false, clear: 0.5, load: 'load', store: 'discard' } },
    () => undefined,
  );
  frame.pass({ depth: { target: depthBuffer, readOnly: flag } }, () => undefined);
  frame.pass({ depth: { target: depthBuffer, stencil: { readOnly: flag } } }, () => undefined);
  frame.pass({ depth: hoisted }, () => undefined);
  frame.pass(
    {
      depth: {
        target: depthBuffer,
        readOnly: true,
        stencil: { readOnly: false, load: 'clear', clear: 7 },
      },
    },
    () => undefined,
  );
  frame.pass({ color: [{ target: colour, store: 'discard' }] }, () => undefined);
  // @ts-expect-error a read-only depth takes no clear
  frame.pass({ depth: { target: depthBuffer, readOnly: true, clear: 1 } }, () => undefined);
  // @ts-expect-error a read-only depth takes no load
  frame.pass({ depth: { target: depthBuffer, readOnly: true, load: 'load' } }, () => undefined);
  // @ts-expect-error a read-only depth takes no store
  frame.pass({ depth: { target: depthBuffer, readOnly: true, store: 'store' } }, () => undefined);
  // @ts-expect-error a boolean readOnly takes no clear
  frame.pass({ depth: { target: depthBuffer, readOnly: flag, clear: 1 } }, () => undefined);
  // @ts-expect-error a read-only stencil object takes no clear
  frame.pass(
    { depth: { target: depthBuffer, stencil: { readOnly: true, clear: 1 } } },
    () => undefined,
  );
  // @ts-expect-error a stray key beside readOnly true
  frame.pass({ depth: { target: depthBuffer, readOnly: true, strange: 1 } }, () => undefined);
  // @ts-expect-error 'discrad' is not a store
  frame.pass({ color: [{ target: colour, store: 'discrad' }] }, () => undefined);
  // @ts-expect-error a store is not a boolean
  frame.pass({ color: [{ target: colour, store: true }] }, () => undefined);
  // @ts-expect-error a colour entry has no stor key
  frame.pass({ color: [{ target: colour, stor: 'discard' }] }, () => undefined);
  // @ts-expect-error 'loda' is not a load
  frame.pass({ color: [{ target: colour, load: 'loda' }] }, () => undefined);
  // @ts-expect-error the stencil object has no stor key
  frame.pass({ depth: { target: depthBuffer, stencil: { stor: 'discard' } } }, () => undefined);
  // @ts-expect-error a depth attachment has no stor key
  frame.pass({ depth: { target: depthBuffer, stor: 'discard' } }, () => undefined);
};

/** The two fragments of the surface document (section 69), as written, with the names they leave free. */
const sectionSixtyNineProbes = async (): Promise<void> => {
  frame.pass(
    { color: [{ target: colour }], depth: { target: depthBuffer, store: 'discard' } },
    (pass) => {
      pass.draw(scene, sceneBindings, geometry);
    },
  );
  const glass = await program.render({
    vertex: 'vs',
    fragment: 'fs',
    targets: [format],
    depth: { format: 'depth24plus', compare: 'less', write: false },
  });
  frame.pass(
    { color: [{ target: colour, load: 'load' }], depth: { target: depthBuffer, readOnly: true } },
    (pass) => {
      pass.draw(glass, glassBindings, panes);
    },
  );
};

describe('the render-state types of proposal 0064 (PR-1)', () => {
  it('types the probes the proposal lists, and the pass methods', () => {
    expectTypeOf(probes).toBeFunction();
    expectTypeOf(stencilProbes).toBeFunction();
    expectTypeOf<StencilOperation>().toEqualTypeOf<
      | 'keep'
      | 'zero'
      | 'replace'
      | 'invert'
      | 'increment-clamp'
      | 'decrement-clamp'
      | 'increment-wrap'
      | 'decrement-wrap'
    >();
    expectTypeOf<CompareFunction>().toEqualTypeOf<
      | 'never'
      | 'less'
      | 'equal'
      | 'less-equal'
      | 'greater'
      | 'not-equal'
      | 'greater-equal'
      | 'always'
    >();
    expectTypeOf<RenderPass['setViewport']>().toBeFunction();
  });
});

describe('the attachment types of proposal 0064 (PR-3)', () => {
  it('exports the depth attachment type from the public entry', () => {
    expectTypeOf<DepthAttachment['stencil']>().not.toBeAny();
    expectTypeOf(attachmentProbes).toBeFunction();
    expectTypeOf(sectionSixtyNineProbes).toBeFunction();
  });
});
