// Render a renderer component to static HTML inside node:test, so component
// behavior can be asserted on its output instead of on its source text.
// Rolldown (Vite's bundler) compiles the JSX; React stays external so the
// component and react-dom/server share one React instance.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { rolldown } from 'rolldown';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Inside node_modules so the bundle's bare `react` imports resolve normally.
const cacheDirectory = path.join(root, 'node_modules', '.cache', 'slipstream-component-tests');

export async function loadComponent(relativePath) {
  const input = path.join(root, relativePath);
  const bundle = await rolldown({
    input,
    platform: 'node',
    external: (id) => /^react(?:-dom)?(?:\/|$)/u.test(id),
    transform: { jsx: { runtime: 'automatic' } },
    logLevel: 'silent',
  });
  fs.mkdirSync(cacheDirectory, { recursive: true });
  const outDirectory = fs.mkdtempSync(path.join(cacheDirectory, 'build-'));
  try {
    await bundle.write({ dir: outDirectory, format: 'esm', entryFileNames: 'component.mjs' });
    return await import(pathToFileURL(path.join(outDirectory, 'component.mjs')).href);
  } finally {
    await bundle.close();
    fs.rmSync(outDirectory, { recursive: true, force: true });
  }
}

export function render(Component, props) {
  return renderToStaticMarkup(React.createElement(Component, props));
}
