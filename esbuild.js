import * as esbuild from 'esbuild';
import { generateThirdPartyLicenses } from './scripts/generate-licenses.js';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const testMode = process.argv.includes('--test-mode');

async function main() {
  const nodeOutfile = testMode
    ? 'generated/extension-test/staging/extension.cjs'
    : 'dist/extension.cjs';

  const nodeContext = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production && !testMode,
    minifySyntax: !testMode,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    target: 'node22',
    outfile: nodeOutfile,
    external: ['vscode'],
    define: {
      'import.meta.url': '""',
      __TEST_MODE__: testMode ? 'true' : 'false',
      __DIAGNOSTICS_FILE_OUTPUT__: testMode ? 'true' : 'false',
    },
    treeShaking: true,
    logLevel: 'info',
    legalComments: 'eof',
    metafile: true,
  });

  const browserContext = await esbuild.context({
    entryPoints: ['src/diagram/browser/mermaid-renderer-entry.ts'],
    bundle: true,
    format: 'iife',
    globalName: 'MermaidRenderer',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'browser',
    target: 'es2022',
    outfile: 'dist/mermaid-renderer.js',
    logLevel: 'info',
    legalComments: 'eof',
    metafile: true,
  });

  if (watch) {
    await Promise.all([nodeContext.watch(), browserContext.watch()]);
    console.log('Watching for changes...');
  } else {
    const [nodeResult, browserResult] = await Promise.all([
      nodeContext.rebuild(),
      browserContext.rebuild(),
    ]);

    if (nodeResult.metafile && browserResult.metafile) {
      const mergedMetafile = {
        inputs: { ...nodeResult.metafile.inputs, ...browserResult.metafile.inputs },
        outputs: { ...nodeResult.metafile.outputs, ...browserResult.metafile.outputs },
      };
      await generateThirdPartyLicenses(mergedMetafile);
    }

    await Promise.all([nodeContext.dispose(), browserContext.dispose()]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
