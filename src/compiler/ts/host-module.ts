// Generate executable JavaScript from the analyzed host exports. No source analysis is performed here.
import type { ConsoleLog } from '../../core/console.js';
import { generateModuleJs } from '../../core/cpu-codegen.js';
import { type Pack } from '../../core/manifest.js';
import { hostContentReads } from './host-content-access.js';
import { type ClassExport, type FaceExport, type MemberCall } from './host-face-contracts.js';
import { REASON, baseClass, header, isRefused } from './host-face-shared.js';

// ─── the generated module ────────────────────────────────────────────────────────────────────

const RT = '__ts_rt';

const MOD = '__ts_m';

/** The JavaScript a bundler reads for the import: the CPU tier's code as module code, with no
 *  `new Function`, and one checking wrapper per callable export.
 *
 *  No name the file declares is bound here. An export is bound under a name of the generator's
 *  own, `__ts_x0`, and exported under the file's (`export { __ts_x0 as Object }`), and a
 *  wrapper's parameters are `__ts_p0` and on: a name the file declares is the file's whatever it
 *  spells (Rule 2.1), and bound at the top of this module it would shadow a global the code
 *  here reads, `Object.freeze` for an enum, and `Math`, `Array`, `NaN`, `Infinity` and
 *  `undefined` in the CPU tier's code, so one export named `Object` left the module unable to
 *  load. A name the author cannot write, one that begins with `__` (Rule 3.2), cannot meet
 *  these. */
export function moduleText(
  stem: string,
  exports: readonly FaceExport[],
  gen: ReturnType<typeof generateModuleJs>,
  runtime: string,
  wgsl: string,
  wgslInteger: string | undefined,
  pack: Pack,
  contentReads: ReturnType<typeof hostContentReads>,
  log?: ConsoleLog,
): string {
  const q = (s: string): string => JSON.stringify(s);
  const consts = exports.filter((e) => e.kind === 'const');
  const constTable = consts.map((e) => `${q(e.const)}: ${gen.constIds.get(e.const)}`).join(', ');
  const hasPrivates = gen.fns.some((f) => f.startsWith('"$initPrivates"'));
  const specializes = pack.overrides.length !== 0 && exports.some((e) => e.kind === 'compute');
  // A struct a result holds is an instance of its class when the class is exported (D1): the
  // conversion is handed the classes' prototypes, `__ts_P`, which the module builds last.
  const classes = exports.filter((e): e is FaceExport & { kind: 'class' } => e.kind === 'class');
  const outOf = classes.length > 0 ? 'fromShaderIn' : 'fromShader';
  const protos = classes.length > 0 ? ', __ts_P' : '';
  const out: string[] = [
    header(stem),
    `import * as ${RT} from ${q(runtime)};`,
    // Pure, so a bundle that imports only the default export, the manifest, drops the CPU tier.
    ...(specializes
      ? ['function __ts_cpu(__ts_overrides) {', 'return (function ($) {']
      : [`const ${MOD} = /*#__PURE__*/ (function ($) {`]),
    ...gen.decls,
    `$.F = {\n${gen.fns.join(',\n')}\n};`,
    `return { F: $.F, C: { ${constTable} }, $: $${specializes ? ', specialize: __ts_cpu' : ''} };`,
    `})(/*#__PURE__*/ ${RT}.createCodegenRuntime({ consoleSink: ${RT}.hostConsole${specializes ? ', overrides: __ts_overrides' : ''} }));`,
    ...(specializes ? ['}', `const ${MOD} = /*#__PURE__*/ __ts_cpu();`] : []),
    // The program's manifest, which the program runtime loads (Rule 11.10).
    `export default ${JSON.stringify(pack)};`,
  ];
  // The module's WGSL, once, for every entry the host calls on WebGPU, and under the `'integer'`
  // flavor of the emulated double when the module emulates `f64` (change 0073).
  if (exports.some((e) => e.kind === 'compute' || e.kind === 'fragment')) {
    out.push(`const __ts_wgsl = ${q(wgsl)};`);
    if (wgslInteger !== undefined) out.push(`const __ts_wgsl_integer = ${q(wgslInteger)};`);
  }
  const texts =
    wgslInteger === undefined
      ? 'wgsl: __ts_wgsl'
      : 'wgsl: __ts_wgsl, wgslInteger: __ts_wgsl_integer';
  if (log !== undefined) out.push(`const __ts_console = ${JSON.stringify(log)};`);
  let t = 0;
  // Each export's own binding, and the name the file exports it under.
  const bound: string[] = [];
  const bind = (name: string): string => {
    const id = `__ts_x${bound.length}`;
    bound.push(`${id} as ${name}`);
    return id;
  };
  // A callable export is a method of an object literal, read off it, so it keeps the file's
  // name as its own (`m.Object.name` is "Object") with no binding of that name here.
  const callable = (name: string, params: readonly string[], body: readonly string[]): string[] => [
    `const ${bind(name)} = { ${q(name)}(${params.join(', ')}) {`,
    ...body.map((line) => `  ${line}`),
    `} }[${q(name)}];`,
  ];
  for (const e of exports) {
    switch (e.kind) {
      case 'function': {
        const types = e.params.map((p) => {
          const id = `__ts_t${t++}`;
          out.push(`const ${id} = ${JSON.stringify(p.type)};`);
          return id;
        });
        const ret = `__ts_t${t++}`;
        out.push(`const ${ret} = ${JSON.stringify(e.result)};`);
        const ps = e.params.map((_, i) => `__ts_p${i}`);
        const args = e.params.map(
          (p, i) => `${RT}.toShader(${q(e.name)}, ${q(p.name)}, ${types[i]}, ${ps[i]})`,
        );
        // The arguments go to the call as they are converted, in order, with no array spread
        // between (#410). A module with private variables converts every argument first, so
        // one that does not fit is refused before the variables start over, as before.
        const held = hasPrivates ? args.map((_, i) => `__ts_a${i}`) : args;
        out.push(
          ...callable(e.name, ps, [
            `if (arguments.length !== ${ps.length}) ${RT}.arity(${q(e.name)}, ${ps.length}, arguments.length);`,
            ...(hasPrivates && args.length > 0
              ? [`const ${args.map((a, i) => `${held[i]} = ${a}`).join(', ')};`]
              : []),
            ...(hasPrivates ? [`${MOD}.F.$initPrivates();`] : []),
            `return ${RT}.${outOf}(${ret}, ${MOD}.F[${q(e.fn)}](${held.join(', ')})${protos});`,
          ]),
        );
        break;
      }
      case 'const':
        out.push(
          `const ${bind(e.name)} = /*#__PURE__*/ ${RT}.constantOf(${JSON.stringify(e.type)}, ${MOD}.C[${q(e.const)}]);`,
        );
        break;
      case 'enum': {
        const fwd = e.members.map(([n, v]) => `${q(n)}: ${v}`);
        const back = e.members.map(([n, v]) => `${q(String(v))}: ${q(n)}`);
        out.push(`const ${bind(e.name)} = Object.freeze({ ${[...fwd, ...back].join(', ')} });`);
        break;
      }
      case 'struct':
      case 'class':
      case 'shape':
      case 'resource':
        break;
      case 'compute': {
        const id = `__ts_e${t++}`;
        const reads = `__ts_reads${t}`;
        out.push(
          `const ${id} = { ...${JSON.stringify(e.entry)}, ${texts}${e.entry.console === true ? ', log: __ts_console' : ''} };`,
          `const ${reads} = ${JSON.stringify([...contentReads.get(e.entry.fn)!.bindings])};`,
          ...callable(
            e.name,
            ['bindings', 'workgroups', 'options = undefined'],
            [
              `return ${RT}.callCompute(${MOD}, ${id}, arguments.length, bindings, workgroups, options, ${reads});`,
            ],
          ),
        );
        break;
      }
      case 'kernel': {
        const id = `__ts_e${t++}`;
        const reads = `__ts_reads${t}`;
        const ps = e.face.params.map((_, i) => `__ts_p${i}`);
        out.push(
          `const ${id} = ${JSON.stringify(e.face)};`,
          `const ${reads} = ${JSON.stringify([...contentReads.get(e.face.fn)!.params])};`,
          ...callable(e.name, ps, [
            `return ${RT}.callKernel(${MOD}, ${id}, arguments.length, [${ps.join(', ')}], ${reads});`,
          ]),
        );
        break;
      }
      case 'fragment': {
        const id = `__ts_e${t++}`;
        const reads = `__ts_reads${t}`;
        out.push(
          `const ${id} = { ...${JSON.stringify(e.entry)}, ${texts}${e.entry.console === true ? ', log: __ts_console' : ''} };`,
          `const ${reads} = ${JSON.stringify([...contentReads.get(e.entry.fn)!.bindings])};`,
          ...callable(
            e.name,
            ['target', 'bindings'],
            [`return ${RT}.callDraw(${MOD}, ${id}, arguments.length, target, bindings, ${reads});`],
          ),
        );
        break;
      }
      case 'never':
        if (e.typeOnly) break;
        out.push(
          `const ${bind(e.name)} = /*#__PURE__*/ ${RT}.notCallable(${q(e.name)}, ${q(e.reason)});`,
        );
        break;
    }
  }
  const classIds = new Map<string, string>();
  if (classes.length > 0) out.push(...classModule(classes, exports, bind, classIds));
  // An exported binding is a host resource of its class's layouts, made once here, after the
  // classes (change 0138, R10).
  for (const e of exports)
    if (e.kind === 'resource')
      out.push(
        `const ${bind(e.name)} = ${RT}.exportedBinding(${q(e.name)}, ${q(stem)}, ${classIds.get(e.cls)}${e.length !== undefined ? `, ${String(e.length)}` : ''});`,
      );
  if (bound.length > 0) out.push(`export { ${bound.join(', ')} };`);
  return `${out.join('\n')}\n`;
}

/** The JavaScript classes of the module's exported classes (change 0109), each bound under a
 *  name of the generator's own and exported under the file's, a class above another first.
 *
 *  An instance's fields are its own properties, each a host value. The constructor, each method,
 *  each accessor half and each static function calls `callMember` with what it needs to check
 *  and convert, run on the CPU tier and write back (`typeshade/runtime/internal`). A class below
 *  another extends its JavaScript class, so `instanceof` holds along the chain (D2), and runs
 *  its own constructor's function, which runs the classes above it as the module does: its
 *  `super` hands the class above `__ts_skip`, which builds nothing. A member a host cannot call
 *  throws the reason the view gives it (D3), and so does `new` of an abstract class. The class
 *  bodies read no name but the generator's own (`__ts_`), and bind none: each class is the value
 *  of a property named as the file names it, so it carries that name with no binding of it. */
function classModule(
  classes: readonly ClassExport[],
  exports: readonly FaceExport[],
  bind: (name: string) => string,
  idOf: Map<string, string>,
): string[] {
  const q = (s: string): string => JSON.stringify(s);
  const out: string[] = ['const __ts_skip = {};'];
  const ids = new Map<ClassExport, string>();
  let n = 0;
  const spec = (fields: readonly string[]): string => {
    const id = `__ts_c${n++}`;
    out.push(`const ${id} = { ${fields.join(', ')} };`);
    return id;
  };
  const refusal = (name: string, reason: string): string => {
    const id = `__ts_c${n++}`;
    out.push(`const ${id} = /*#__PURE__*/ ${RT}.notCallable(${q(name)}, ${q(reason)});`);
    return id;
  };
  const call = (call: MemberCall, shown: string, object: string | undefined): string =>
    spec([
      `n: ${q(shown)}`,
      `fn: ${q(call.fn)}`,
      `p: ${JSON.stringify(call.params.map((p) => [p.name, p.type]))}`,
      `r: ${JSON.stringify(call.result)}`,
      ...(object !== undefined ? [`o: ${object}`] : []),
      ...(call.writes ? ['w: 1'] : []),
      ...(call.self ? ['s: 1'] : []),
    ]);
  const run = (id: string, self: string, args: string): string =>
    `${RT}.callMember(${MOD}, __ts_P, ${id}, ${self}, ${args})`;
  const bases = new Set(classes.map((e) => baseClass(e, exports)).filter((b) => b !== undefined));
  const emit = (e: ClassExport): void => {
    if (ids.has(e)) return;
    const base = baseClass(e, exports);
    if (base !== undefined) emit(base);
    const object = `__ts_o${ids.size}`;
    out.push(`const ${object} = ${JSON.stringify(e.type)};`);
    const body: string[] = [];
    // The constructor: the class above builds nothing, then this one builds the instance, unless
    // a class below is building it.
    const head = [
      ...(base !== undefined ? ['super(__ts_skip);'] : []),
      ...(bases.has(e) ? ['if (arguments[0] === __ts_skip) return;'] : []),
    ];
    const ctor = e.ctor;
    const built =
      ctor === undefined
        ? `${refusal(`new ${e.name}`, REASON.abstract)}();`
        : 'reason' in ctor
          ? `${refusal(`new ${e.name}`, ctor.reason)}();`
          : 'zero' in ctor
            ? `${run(spec([`n: ${q(`new ${e.name}`)}`, 'p: []', `o: ${object}`, 'c: 1', `z: ${JSON.stringify(ctor.zero)}`]), 'this', 'arguments')};`
            : `${run(spec([`n: ${q(`new ${e.name}`)}`, `fn: ${q(ctor.fn)}`, `p: ${JSON.stringify(ctor.params.map((p) => [p.name, p.type]))}`, `o: ${object}`, 'c: 1']), 'this', 'arguments')};`;
    body.push(`constructor() { ${[...head, built].join(' ')} }`);
    for (const m of e.members) {
      // An abstract class's instance members run in the classes below it. One the view declares
      // `never` throws its reason on the abstract class as well (D3).
      if (e.abstract && !m.static && !isRefused(m)) continue;
      const lead = m.static ? 'static ' : '';
      const self = m.static ? 'undefined' : 'this';
      const shown = `${e.name}.${m.name}`;
      const object_ = m.static ? undefined : object;
      if (m.kind === 'method') {
        const id =
          'reason' in m.call ? refusal(shown, m.call.reason) : call(m.call, shown, object_);
        body.push(
          'reason' in m.call
            ? `${lead}${q(m.name)}() { return ${id}(); }`
            : `${lead}${q(m.name)}() { return ${run(id, self, 'arguments')}; }`,
        );
        continue;
      }
      if (m.reason !== undefined) {
        const id = refusal(shown, m.reason);
        body.push(`${lead}get ${q(m.name)}() { return ${id}(); }`);
        body.push(`${lead}set ${q(m.name)}(__ts_v) { ${id}(); }`);
        continue;
      }
      if (m.get !== undefined)
        body.push(
          `${lead}get ${q(m.name)}() { return ${run(call(m.get, shown, object_), self, '[]')}; }`,
        );
      if (m.set !== undefined)
        body.push(
          `${lead}set ${q(m.name)}(__ts_v) { ${run(call(m.set, shown, object_), self, '[__ts_v]')}; }`,
        );
    }
    // The layouts `uniform()`, `zeros()` and `array()` read (change 0138), under a registered
    // symbol, so the class needs no name of the runtime's.
    body.push(`static [Symbol.for("typeshade.layout")] = ${JSON.stringify(e.layouts)};`);
    const id = bind(e.name);
    ids.set(e, id);
    idOf.set(e.name, id);
    out.push(
      `const ${id} = { ${q(e.name)}: class${base !== undefined ? ` extends ${ids.get(base)}` : ''} {`,
      ...body.map((line) => `  ${line}`),
      `} }[${q(e.name)}];`,
    );
  };
  for (const e of classes) emit(e);
  // The prototype of each class whose instance a result is (D1): an abstract class has none.
  const concrete = classes.filter((e) => !e.abstract);
  out.push(
    `const __ts_P = new Map([${concrete.map((e) => `[${q(e.type.s)}, ${ids.get(e)}.prototype]`).join(', ')}]);`,
  );
  return out;
}
