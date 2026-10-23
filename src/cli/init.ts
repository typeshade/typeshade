// Explicit, planned project setup. Importing TypeShade never writes configuration (0085).
import ts from 'typescript';
import type { CliHost } from './run.js';
import { ConfigDocument } from './config-edit.js';
import { resolvePath, relativeTo } from './paths.js';
import { configureVite } from './vite-config.js';

const SYNC = 'tshc sync --allow-empty';
const CHECK = 'tshc check --allow-empty';
const BEFORE_CHECK = `${SYNC} && ${CHECK}`;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function options(doc: ConfigDocument, path: string, host: CliHost): ts.ParsedCommandLine {
  const raw = ts.parseConfigFileTextToJson(path, doc.text).config;
  const result = ts.parseJsonConfigFileContent(
    raw,
    {
      useCaseSensitiveFileNames: true,
      // Initialization needs effective options, not a scan of the user's source tree.
      readDirectory: () => [],
      fileExists: (p) => host.kind(p) === 'file',
      readFile: (p) => host.readFile(p),
    },
    resolvePath(path, '..'),
    undefined,
    path,
  );
  const errors = result.errors.filter((d) => d.code !== 18003);
  if (errors.length)
    throw new Error(`${doc.file}: ${ts.flattenDiagnosticMessageText(errors[0]!.messageText, ' ')}`);
  return result;
}

function prefixed(value: unknown, prefix: string, fallback: string, label: string): string {
  if (value !== undefined && typeof value !== 'string')
    throw new Error(`${label} must be a string.`);
  const original =
    typeof value === 'string' ? value.replace(/^tshc sync(?= && |$)/, SYNC) : fallback;
  if (original === prefix || original.startsWith(`${prefix} && `)) return original;
  return original ? `${prefix} && ${original}` : prefix;
}

/** Initialize a Vite host project, refusing every configuration conflict before writing. */
export function initializeProject(root: string, host: CliHost, project?: string): number {
  try {
    if (host.kind(root) !== 'directory') throw new Error(`${root}: expected a project directory.`);
    const originals = new Map<string, string | undefined>();
    const changes = new Map<string, string>();
    const read = (name: string): string | undefined => {
      const path = resolvePath(root, name);
      const kind = host.kind(path);
      if (kind !== undefined && kind !== 'file') throw new Error(`${name}: expected a file.`);
      const text = host.readFile(path);
      if (kind === 'file' && text === undefined) throw new Error(`${name}: cannot read this file.`);
      originals.set(path, text);
      return text;
    };
    const document = (name: string, initial: string): ConfigDocument =>
      new ConfigDocument(name, read(name) ?? initial);
    const save = (doc: ConfigDocument): void => {
      const path = resolvePath(root, doc.file);
      if (originals.get(path) !== doc.text) changes.set(path, doc.text);
    };

    const packageText = read('package.json');
    if (packageText === undefined)
      throw new Error('package.json: tshc init needs an existing Vite project.');
    try {
      JSON.parse(packageText.replace(/^\uFEFF/, ''));
    } catch {
      throw new Error('package.json: fix its JSON before running tshc init.');
    }
    const pkg = new ConfigDocument('package.json', packageText);
    const viteNames = [
      'vite.config.ts',
      'vite.config.mts',
      'vite.config.js',
      'vite.config.mjs',
      'vite.config.cts',
      'vite.config.cjs',
    ];
    const existingVite = viteNames.filter(
      (name) => host.kind(resolvePath(root, name)) !== undefined,
    );
    if (existingVite.length > 1)
      throw new Error(
        `Multiple Vite configurations: ${existingVite.join(', ')}. Select one before running tshc init.`,
      );
    const dependencies = [pkg.get(['dependencies']), pkg.get(['devDependencies'])];
    if (!existingVite.length && !dependencies.some((d) => record(d) && typeof d.vite === 'string'))
      throw new Error(
        'package.json: tshc init supports Vite projects. Install Vite before running it.',
      );

    const initialHost = `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
          noEmit: true,
          allowImportingTsExtensions: true,
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    )}\n`;
    const rootConfig = document('tsconfig.json', initialHost);
    let configName =
      project === undefined ? 'tsconfig.json' : relativeTo(root, resolvePath(root, project));
    if (project === undefined) {
      const refs = rootConfig.get(['references']);
      if (refs !== undefined) {
        if (
          !Array.isArray(refs) ||
          refs.some((r: unknown) => !record(r) || typeof r.path !== 'string')
        )
          throw new Error('tsconfig.json: references must name project paths.');
        if (refs.length) {
          const apps = refs.filter((r: Record<string, unknown>) =>
            /(?:^|\/)tsconfig\.app\.json$/.test(r.path as string),
          );
          if (apps.length !== 1)
            throw new Error(
              'tsconfig.json: project references are ambiguous. Run tshc init --project <host-tsconfig.json>.',
            );
          configName = relativeTo(root, resolvePath(root, apps[0].path as string));
        }
      }
    }
    if (
      !/^[A-Za-z0-9_./-]+\.json$/.test(configName) ||
      configName.startsWith('../') ||
      configName.startsWith('/')
    )
      throw new Error(
        'The host tsconfig must be inside the project and use letters, numbers, underscores, dots, hyphens or slashes.',
      );
    if (
      ['package.json', 'package-lock.json', 'tsconfig.shade.json'].includes(
        configName.split('/').at(-1)!,
      )
    )
      throw new Error(
        'Select the host tsconfig, not a package manifest, lockfile or shader project.',
      );
    const config = configName === 'tsconfig.json' ? rootConfig : document(configName, '');
    const fullConfig = resolvePath(root, configName);
    const effective = options(config, fullConfig, host);
    for (const key of ['noEmit', 'allowImportingTsExtensions'] as const) {
      if (effective.options[key] === false)
        throw new Error(
          `${configName}: compilerOptions.${key} conflicts with true. Resolve it before running tshc init.`,
        );
      config.require(['compilerOptions', key], true);
    }
    if (
      effective.options.emitDeclarationOnly ||
      (effective.options.declaration && !effective.options.noEmit)
    )
      throw new Error(
        `${configName}: tshc init needs a Vite host project that does not emit declarations. Select it with --project.`,
      );
    if (
      config.get(['compilerOptions', 'moduleSuffixes']) === undefined &&
      effective.options.moduleSuffixes
    )
      config.set(['compilerOptions', 'moduleSuffixes'], effective.options.moduleSuffixes);
    config.strings(['compilerOptions', 'moduleSuffixes'], ['.typeshade', ''], true);
    if (config.get(['exclude']) === undefined) {
      const inherited = (effective.raw as { exclude?: unknown }).exclude;
      if (inherited !== undefined) config.set(['exclude'], inherited);
      else {
        const excluded = ['node_modules', 'bower_components', 'jspm_packages'];
        if (effective.options.outDir)
          excluded.push(relativeTo(resolvePath(fullConfig, '..'), effective.options.outDir));
        config.set(['exclude'], excluded);
      }
    }
    config.strings(['exclude'], ['**/*.shade.ts']);
    save(config);

    const shade = document('tsconfig.shade.json', '{}\n');
    const shaderOptions = {
      lib: [],
      module: 'esnext',
      moduleResolution: 'bundler',
      allowImportingTsExtensions: true,
      experimentalDecorators: true,
      strictPropertyInitialization: false,
      strict: true,
      noEmit: true,
    };
    const actual = options(shade, resolvePath(root, shade.file), host).options;
    const expected = ts.convertCompilerOptionsFromJson(shaderOptions, root).options;
    for (const [key, value] of Object.entries(shaderOptions)) {
      if (
        actual[key] !== undefined &&
        JSON.stringify(actual[key]) !== JSON.stringify(expected[key])
      )
        throw new Error(
          `tsconfig.shade.json: compilerOptions.${key} conflicts with ${JSON.stringify(value)}. Resolve it before running tshc init.`,
        );
      shade.require(['compilerOptions', key], value);
    }
    for (const [key, values] of [
      ['types', ['typeshade/shade']],
      ['customConditions', ['typeshade']],
    ] as const) {
      if (shade.get(['compilerOptions', key]) === undefined && actual[key])
        shade.set(['compilerOptions', key], actual[key]);
      shade.strings(['compilerOptions', key], values);
    }
    shade.strings(['include'], ['**/*.shade.ts']);
    shade.strings(['exclude'], ['node_modules', 'dist']);
    save(shade);

    for (const [key, prefix, fallback] of [
      ['prepare', SYNC, ''],
      ['build', BEFORE_CHECK, 'vite build'],
    ] as const)
      pkg.set(
        ['scripts', key],
        prefixed(pkg.get(['scripts', key]), prefix, fallback, `package.json: scripts.${key}`),
      );
    const checks = ['typecheck', 'type-check'].filter(
      (key) => pkg.get(['scripts', key]) !== undefined,
    );
    if (!checks.length) checks.push('typecheck');
    for (const key of checks)
      pkg.set(
        ['scripts', key],
        prefixed(
          pkg.get(['scripts', key]),
          BEFORE_CHECK,
          `tsc --noEmit -p ./${configName}`,
          `package.json: scripts.${key}`,
        ),
      );
    save(pkg);

    const viteName =
      existingVite[0] ?? (pkg.get(['type']) === 'module' ? 'vite.config.ts' : 'vite.config.mts');
    if (
      existingVite.length &&
      (/\.(?:cts|cjs)$/.test(viteName) ||
        (pkg.get(['type']) !== 'module' && !/\.(?:mts|mjs)$/.test(viteName)))
    )
      throw new Error(
        `${viteName}: use an ESM Vite configuration (.mts, .mjs or a module package), or retain manual setup.`,
      );
    const vite =
      read(viteName) ??
      "import { defineConfig } from 'vite';\n\nexport default defineConfig({});\n";
    const configured = configureVite(viteName, vite);
    if (configured !== originals.get(resolvePath(root, viteName)))
      changes.set(resolvePath(root, viteName), configured);
    const ignored = read('.gitignore') ?? '';
    if (!ignored.split(/\r?\n/).includes('*.shade.typeshade.ts')) {
      const eol = ignored.includes('\r\n') ? '\r\n' : '\n';
      changes.set(
        resolvePath(root, '.gitignore'),
        `${ignored}${ignored && !ignored.endsWith('\n') ? eol : ''}*.shade.typeshade.ts${eol}`,
      );
    }

    // Check every original before the first write. A conflict never leaves a partial setup.
    for (const path of changes.keys())
      if (host.readFile(path) !== originals.get(path))
        throw new Error(
          `${relativeTo(root, path)} changed during initialization. Run tshc init again.`,
        );
    for (const [path, text] of changes) {
      host.writeFile(path, text);
      host.stdout(`wrote ${relativeTo(root, path)}\n`);
    }
    host.stdout(
      changes.size
        ? 'TypeShade setup is ready. Install and run the project scripts normally.\n'
        : 'TypeShade setup is up to date.\n',
    );
    return 0;
  } catch (error) {
    host.stderr(`tshc init: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}
