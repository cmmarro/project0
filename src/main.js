/* Wiring: the canvas, the camera, the input, the loop.
 *
 * There is no simulation yet and nothing here pretends there is. This stage is
 * a room you can build in and light — the pawn comes next, and it will get its
 * own loop rather than being threaded through this one.
 */

import { cycle, step } from './anim.js';
import { Build, buildMenu } from './build.js';
import { THINGS } from './defs.js';
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

// A handle on the world for poking at it from the console, and for the
// browser-driven checks. Read-only by convention; nothing in here uses it.
window.__world = world;
window.__lights = lights;

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
let pressedAt = null;

function tileFromEvent(e) {
  const r = canvas.getBoundingClientRect();
  const px = (e.clientX - r.left) * (canvas.width / r.width);
  const py = (e.clientY - r.top) * (canvas.height / r.height);
  return camera.screenToTile(px, py, canvas);
}

canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  pressedAt = { x: e.clientX, y: e.clientY };
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
  const moved = pressedAt
    && Math.hypot(e.clientX - pressedAt.x, e.clientY - pressedAt.y) > 4;
  pressedAt = null;
  if (panning) {
    panning = null;
    canvas.style.cursor = '';
    // A right-click that didn't move is a cancel, not a pan.
    if (e.button === 2) build.cancel();
    // ...and a left-click that didn't move, with nothing selected, is somebody
    // poking at what is already there.
    if (e.button === 0 && !moved && !build.tool) poke(...tileFromEvent(e));
    return;
  }
  build.up();
});

/* Clicking a placed thing with no tool selected. The only thing that answers
 * so far is a fan, which changes speed — but this is where anything you can
 * interact with by pointing at it will go. */
function poke(x, y) {
  const t = world.overheadAt(x, y) || world.thingAt(x, y);
  if (t && THINGS[t.key].cycles) cycle(t);
}

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
  // E and R turn it one way, Q the other — the bindings a colony sim uses, and
  // the ones a hand already on WASD can reach.
  if (e.key === 'e' || e.key === 'E' || e.key === 'r' || e.key === 'R') build.rotate(1);
  if (e.key === 'q' || e.key === 'Q') build.rotate(-1);
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

let last = performance.now();

function frame(now) {
  // Clamped, so a backgrounded tab does not come back and spin the fan through
  // a hundred revolutions in one step.
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  step(world, dt);
  renderer.draw(c => build.overlay(c, renderer));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
