/* Wiring: the canvas, the camera, the input, the loop.
 *
 * There is no simulation yet and nothing here pretends there is. This stage is
 * a room you can build in and light — the pawn comes next, and it will get its
 * own loop rather than being threaded through this one.
 */

import { Build, buildMenu } from './build.js';
import { LightMap } from './light.js';
import { Camera, Renderer } from './render.js';
import { World } from './world.js';

const canvas = document.getElementById('view');
const world = World.starter(48, 36);
const lights = new LightMap(world);
const camera = new Camera(world);
const renderer = new Renderer(canvas, world, lights, camera);

const sunEl = document.getElementById('sun');
const sunLabel = document.getElementById('sunlabel');
const countEl = document.getElementById('count');

const build = new Build(world, camera, canvas, () => {
  syncMenu();
  syncCounts();
});
const syncMenu = buildMenu(document.getElementById('menu'), build);

function syncCounts() {
  countEl.textContent = `${world.things.size} built`;
}

/* --- input ---------------------------------------------------------------- */

let panning = null;
let spaceDown = false;

function tileFromEvent(e) {
  const r = canvas.getBoundingClientRect();
  const px = (e.clientX - r.left) * (canvas.width / r.width);
  const py = (e.clientY - r.top) * (canvas.height / r.height);
  return camera.screenToTile(px, py, canvas);
}

canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  // Right button, middle button or space-drag pans. Left builds — unless
  // nothing is selected, in which case it pans too, which is what you expect
  // when you grab an empty map.
  if (e.button !== 0 || spaceDown || !build.tool) {
    panning = { x: e.clientX, y: e.clientY };
    canvas.style.cursor = 'grabbing';
    return;
  }
  const [x, y] = tileFromEvent(e);
  build.down(x, y);
});

canvas.addEventListener('pointermove', e => {
  if (panning) {
    const r = canvas.getBoundingClientRect();
    const scale = (canvas.width / r.width) / camera.zoom;
    camera.x -= (e.clientX - panning.x) * scale;
    camera.y -= (e.clientY - panning.y) * scale;
    panning = { x: e.clientX, y: e.clientY };
    return;
  }
  const [x, y] = tileFromEvent(e);
  build.move(x, y);
});

canvas.addEventListener('pointerup', e => {
  if (panning) {
    panning = null;
    canvas.style.cursor = '';
    // A right-click that didn't move is a cancel, not a pan.
    if (e.button === 2) build.cancel();
    return;
  }
  build.up();
});

canvas.addEventListener('pointerleave', () => {
  build.hover = null;
  build.up();
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  const px = (e.clientX - r.left) * (canvas.width / r.width);
  const py = (e.clientY - r.top) * (canvas.height / r.height);
  // Zoom towards the cursor, so the tile under the pointer stays put.
  const before = camera.screenToTile(px, py, canvas);
  camera.zoom = Math.max(0.5, Math.min(4, camera.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
  const after = camera.screenToTile(px, py, canvas);
  camera.x += (before[0] - after[0]) * 32;
  camera.y += (before[1] - after[1]) * 32;
}, { passive: false });

addEventListener('keydown', e => {
  if (e.code === 'Space') { spaceDown = true; e.preventDefault(); }
  if (e.key === 'r' || e.key === 'R') build.rotate();
  if (e.key === 'Escape') build.cancel();
});
addEventListener('keyup', e => {
  if (e.code === 'Space') spaceDown = false;
});

sunEl.addEventListener('input', () => {
  const v = sunEl.value / 100;
  lights.setSun(v);
  sunLabel.textContent = v < 0.06 ? 'night'
    : v < 0.3 ? 'dusk' : v < 0.7 ? 'overcast' : 'daylight';
});

addEventListener('resize', () => renderer.resize());

/* --- loop ----------------------------------------------------------------- */

renderer.resize();
lights.setSun(sunEl.value / 100);
syncCounts();

function frame() {
  renderer.draw(c => build.overlay(c, renderer));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
