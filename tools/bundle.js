/* Inlines the stylesheet and every script into one self-contained HTML file, so
   the game can be handed around as a single page (or hosted somewhere that only
   serves one file) without changing how the sources are organised.

   Usage:
     node tools/bundle.js                 -> dist/hearthfall.html   (standalone page)
     node tools/bundle.js --fragment      -> dist/hearthfall-fragment.html
                                             (no <html>/<head>/<body>, for hosts
                                              that supply their own skeleton)
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const fragment = process.argv.includes('--fragment');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const cssHrefs = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map(m => m[1]);
const scriptSrcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
if (scriptSrcs.length === 0) throw new Error('no scripts found in index.html');

const css = cssHrefs.map(read).join('\n');
const js = scriptSrcs.map(src => '/* ===== ' + src + ' ===== */\n' + read(src)).join('\n');

// Body content, minus the script tags that we are about to inline.
const bodyMatch = html.match(/<body>([\s\S]*)<\/body>/);
if (!bodyMatch) throw new Error('could not find <body> in index.html');
const body = bodyMatch[1].replace(/<script src="[^"]+"><\/script>\s*/g, '').trim();

const title = (html.match(/<title>([\s\S]*?)<\/title>/) || [, 'Hearthfall'])[1];

/* The favicon is an inline SVG data URI, so its attribute value contains ">".
   Match whole quoted attributes rather than stopping at the first ">", or the
   tag comes out truncated with an unterminated quote - which then swallows
   whatever follows it, including the <style> block. */
const favicon = (html.match(/<link\s+rel="icon"(?:[^>"']|"[^"]*"|'[^']*')*>/) || [''])[0];

/* Some hosts render the page inside their own <head>, where we cannot add a
   viewport meta tag. Without one, phones lay the page out at 980px and the
   whole mobile layout never engages, so put it in at runtime if it is absent. */
const viewportShim = [
  '(function () {',
  '  if (document.querySelector(\'meta[name="viewport"]\')) return;',
  '  var m = document.createElement("meta");',
  '  m.name = "viewport";',
  '  m.content = "width=device-width, initial-scale=1, viewport-fit=cover";',
  '  document.head.appendChild(m);',
  '})();',
].join('\n');

const parts = [];
if (fragment) {
  parts.push('<title>' + title + '</title>');
  if (favicon) parts.push(favicon);
  parts.push('<style>\n' + css + '\n</style>');
  parts.push(body);
  parts.push('<script>\n' + viewportShim + '\n' + js + '\n<\/script>');
} else {
  parts.push('<!DOCTYPE html>');
  parts.push('<html lang="en">');
  parts.push('<head>');
  parts.push('<meta charset="utf-8">');
  parts.push('<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">');
  parts.push('<title>' + title + '</title>');
  if (favicon) parts.push(favicon);
  parts.push('<style>\n' + css + '\n</style>');
  parts.push('</head>');
  parts.push('<body>');
  parts.push(body);
  parts.push('<script>\n' + js + '\n<\/script>');
  parts.push('</body>');
  parts.push('</html>');
}

const outDir = path.join(ROOT, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, fragment ? 'hearthfall-fragment.html' : 'hearthfall.html');
fs.writeFileSync(outFile, parts.join('\n') + '\n');

console.log('wrote ' + path.relative(ROOT, outFile) + ' (' +
  Math.round(fs.statSync(outFile).size / 1024) + ' kB, ' +
  scriptSrcs.length + ' scripts, ' + cssHrefs.length + ' stylesheet' +
  (cssHrefs.length === 1 ? '' : 's') + ')');
