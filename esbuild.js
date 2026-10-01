import * as esbuild from 'esbuild';
import { generateThirdPartyLicenses } from './scripts/generate-licenses.js';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  const context = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    target: 'node20',
    outfile: 'dist/extension.cjs',
    external: ['vscode'],
    logLevel: 'info',
    legalComments: 'eof',
    metafile: true,
  });

  if (watch) {
    await context.watch();
    console.log('Watching for changes...');
  } else {
    const result = await context.rebuild();
    if (result.metafile) {
      await generateThirdPartyLicenses(result.metafile);
    }
    await context.dispose();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

