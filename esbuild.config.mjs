import esbuild from 'esbuild';
import process from 'process';
import builtins from 'builtin-modules';
import { copyFileSync, existsSync, mkdirSync } from 'fs';

const prod = process.argv[2] === 'production';
const DIST_DIR = 'dist';

// Plugin to copy manifest.json and styles.css to dist/
const copyAssets = {
  name: 'copy-assets',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) return;

      if (!existsSync(DIST_DIR)) {
        mkdirSync(DIST_DIR, { recursive: true });
      }

      const assets = ['manifest.json', 'styles.css'];
      for (const file of assets) {
        if (existsSync(file)) {
          copyFileSync(file, `${DIST_DIR}/${file}`);
        }
      }
    });
  }
};

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  plugins: [copyAssets],
  external: [
    'obsidian',
    'electron',
    '@codemirror/autocomplete',
    '@codemirror/collab',
    '@codemirror/commands',
    '@codemirror/language',
    '@codemirror/lint',
    '@codemirror/search',
    '@codemirror/state',
    '@codemirror/view',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/lr',
    // Note: NOT including builtins here - we want Node.js APIs bundled
  ],
  platform: 'node',  // Enable Node.js APIs (Obsidian runs on Electron)
  format: 'cjs',
  target: 'es2018',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  outfile: `${DIST_DIR}/main.js`,
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
