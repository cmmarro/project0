// Bundles the game into one self-contained HTML file.
//
// The game normally runs as separate ES modules, which needs a web server.
// This inlines the CSS and concatenates the modules into a single inline
// <script type="module">, so the result can be opened from anywhere -- a file://
// path, a static host, or a page that forbids external requests entirely.
//
//   node build-single-file.mjs [outfile]
//
// Every module lives in one shared scope after concatenation, so the load order
// below must be dependency order, and top-level names must stay unique across
// modules. Both hold today; if a bundle ever throws "X is not defined", a module
// moved ahead of something it depends on.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

const MODULES = [
  'js/core/rng.js',
  'js/data/terrain.js',
  'js/data/units.js',
  'js/data/names.js',
  'js/core/map.js',
  'js/core/state.js',
  'js/core/economy.js',
  'js/core/actions.js',
  'js/core/turn.js',
  'js/ui/camera.js',
  'js/ui/pointer.js',
  'js/ui/render.js',
  'js/ui/panel.js',
  'js/main.js',
];

// Drops `import ... ;` statements (which may span lines) and the `export`
// keyword. Nothing else about the source changes.
function stripModuleSyntax(source) {
  const out = [];
  let skipping = false;

  for (const line of source.split('\n')) {
    if (skipping) {
      if (line.trimEnd().endsWith(';')) skipping = false;
      continue;
    }

    if (/^import\s/.test(line)) {
      if (!line.trimEnd().endsWith(';')) skipping = true;
      continue;
    }

    out.push(line.replace(/^export\s+(?=const|let|function|class)/, ''));
  }

  if (skipping) throw new Error('unterminated import statement');
  return out.join('\n').trim();
}

const css = await readFile(resolve(root, 'styles/game.css'), 'utf8');

const modules = await Promise.all(
  MODULES.map(async (path) => {
    const source = await readFile(resolve(root, path), 'utf8');
    return `// ${'='.repeat(66)}\n// ${path}\n// ${'='.repeat(66)}\n\n${stripModuleSyntax(source)}`;
  })
);

const html = `<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Civ Prototype</title>
  <style>
${css.trim()}
  </style>
</head>

<body>
  <header class="topbar">
    <h1>Civ Prototype</h1>
    <div class="topbar-actions">
      <span class="hint">tap to select · tap an adjacent tile to move · drag to pan · scroll or pinch to zoom · Enter ends turn</span>
      <button id="new-game">New Map</button>
    </div>
  </header>

  <main>
    <div class="map-wrap">
      <canvas id="map"></canvas>
    </div>
    <aside id="panel"></aside>
  </main>

  <script type="module">
${modules.join('\n\n')}
  </script>
</body>

</html>
`;

const outfile = process.argv[2] ?? resolve(root, 'dist/civ.html');
await writeFile(outfile, html);
console.log(`wrote ${outfile} (${(html.length / 1024).toFixed(1)} KB)`);
