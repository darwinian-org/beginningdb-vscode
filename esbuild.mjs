import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const selectedTargets = process.argv.includes('--node')
  ? ['node']
  : process.argv.includes('--web')
    ? ['web']
    : ['node', 'web'];

const configs = {
  node: {
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    external: ['vscode'],
    sourcemap: true,
    sourcesContent: false,
    outfile: 'dist/extension.js',
    logLevel: 'info'
  },
  web: {
    entryPoints: ['src/extension.browser.ts'],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    external: ['vscode'],
    sourcemap: true,
    sourcesContent: false,
    outfile: 'dist/extension.browser.js',
    logLevel: 'info'
  }
};

if (watch) {
  const contexts = await Promise.all(selectedTargets.map(target => esbuild.context(configs[target])));
  await Promise.all(contexts.map(context => context.watch()));
} else {
  await Promise.all(selectedTargets.map(target => esbuild.build(configs[target])));
}
