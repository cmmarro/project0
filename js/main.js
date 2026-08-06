// Wiring: input -> actions -> render. No game rules live in this file.

import {
  newGame,
  cityAt,
  cityById,
  distance,
  tileAt,
  unitById,
  unitsAt,
} from './core/state.js';
import { updateVisibility, endTurn } from './core/turn.js';
import {
  canFoundCity,
  canMove,
  doFoundCity,
  doMove,
  nextUnitAt,
  setProduction,
} from './core/actions.js';
import { render, resizeCanvas } from './ui/render.js';
import { renderPanel } from './ui/panel.js';
import { attachPointerInput } from './ui/pointer.js';
import {
  centerOn,
  clampCamera,
  createCamera,
  ensureVisible,
  panByPixels,
  screenToTile,
  zoomAt,
} from './ui/camera.js';

const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');
const panel = document.getElementById('panel');

let state;
let cam = createCamera();
let view = { width: 1, height: 1 };
let hover = null;

function start(seed) {
  state = newGame(seed);
  updateVisibility(state);
  state.selectedUnitId = state.units[0]?.id ?? null;
  hover = null;

  cam = createCamera();
  view = resizeCanvas(canvas);

  // Open on the starting units rather than the map's top-left corner.
  const focus = state.units[0];
  if (focus) centerOn(cam, state.map, view, focus.x, focus.y);
  else clampCamera(cam, state.map, view);

  draw();
}

function draw() {
  render(ctx, state, cam, view, { hover });
  panel.innerHTML = renderPanel(state, hover);
}

// --- selection ----------------------------------------------------------

function selectUnit(unit) {
  state.selectedUnitId = unit ? unit.id : null;
  state.selectedCityId = null;
  if (unit) ensureVisible(cam, state.map, view, unit.x, unit.y);
}

function selectCity(city) {
  state.selectedCityId = city ? city.id : null;
  state.selectedUnitId = null;
  if (city) ensureVisible(cam, state.map, view, city.x, city.y);
}

function selectTile(x, y) {
  const stack = unitsAt(state, x, y);
  if (stack.length) {
    // Re-tapping a stack walks through it.
    const already = stack.some((u) => u.id === state.selectedUnitId);
    selectUnit(already ? nextUnitAt(state, x, y, state.selectedUnitId) : stack[0]);
    return;
  }

  const city = cityAt(state, x, y);
  if (city) {
    selectCity(city);
    return;
  }

  selectUnit(null);
  state.selectedCityId = null;
}

function tryMove(x, y) {
  const unit = unitById(state, state.selectedUnitId);
  if (!unit || canMove(state, unit, x, y)) return false;
  doMove(state, unit, x, y);
  updateVisibility(state);
  ensureVisible(cam, state.map, view, unit.x, unit.y);
  return true;
}

function moveBy(dx, dy) {
  const unit = unitById(state, state.selectedUnitId);
  if (!unit) return;
  if (tryMove(unit.x + dx, unit.y + dy)) draw();
}

// Jump to the next unit that still has movement.
function cycleIdleUnit() {
  const idle = state.units.filter((u) => u.moves > 0);
  if (!idle.length) return;
  const i = idle.findIndex((u) => u.id === state.selectedUnitId);
  selectUnit(idle[(i + 1) % idle.length]);
}

// --- map input ----------------------------------------------------------

// With a unit selected, tapping an adjacent tile always means "go there" --
// including onto a tile that already holds one of your units. Stacking is free
// and there is no combat, so the cost of a mis-tap is one movement point, and
// in exchange every tile is reachable with a single tap. That matters on touch,
// where there is no right-click to fall back on.
function handleTap(px, py) {
  const p = screenToTile(cam, view, px, py);
  if (!tileAt(state.map, p.x, p.y)) return;

  const unit = unitById(state, state.selectedUnitId);
  if (unit && distance(unit.x, unit.y, p.x, p.y) === 1) {
    if (tryMove(p.x, p.y)) {
      draw();
      return;
    }
    // Blocked terrain or no movement left: hold the selection unless the tap
    // clearly meant something else.
    if (!unitsAt(state, p.x, p.y).length && !cityAt(state, p.x, p.y)) return;
  }

  selectTile(p.x, p.y);
  draw();
}

attachPointerInput(canvas, {
  onTap: ({ x, y }) => handleTap(x, y),
  onPan: (dx, dy) => {
    panByPixels(cam, state.map, view, dx, dy);
    draw();
  },
  onZoom: (factor, px, py) => {
    zoomAt(cam, state.map, view, factor, px, py);
    draw();
  },
  onHover: (p) => {
    const tile = p ? screenToTile(cam, view, p.x, p.y) : null;
    const next = tile && tileAt(state.map, tile.x, tile.y) ? tile : null;
    if (next?.x === hover?.x && next?.y === hover?.y) return;
    hover = next;
    draw();
  },
});

window.addEventListener('resize', () => {
  view = resizeCanvas(canvas);
  clampCamera(cam, state.map, view);
  draw();
});

// --- panel input --------------------------------------------------------

panel.addEventListener('click', (e) => {
  const button = e.target.closest('[data-act]');
  if (!button || button.disabled) return;
  const act = button.dataset.act;

  if (act === 'end-turn') {
    endTurn(state);
    cycleIdleUnit();
  } else if (act === 'found-city') {
    const unit = unitById(state, state.selectedUnitId);
    if (unit && !canFoundCity(state, unit)) {
      const city = doFoundCity(state, unit);
      updateVisibility(state);
      selectCity(city);
    }
  } else if (act === 'skip-unit') {
    const unit = unitById(state, state.selectedUnitId);
    if (unit) unit.moves = 0;
    cycleIdleUnit();
  } else if (act === 'cycle-unit') {
    const unit = unitById(state, state.selectedUnitId);
    if (unit) selectUnit(nextUnitAt(state, unit.x, unit.y, unit.id));
  } else if (act.startsWith('build:')) {
    const city = cityById(state, state.selectedCityId);
    if (city) setProduction(state, city, act.slice('build:'.length));
  }

  draw();
});

document.getElementById('new-game').addEventListener('click', () => start());

// --- keyboard -----------------------------------------------------------

const ARROWS = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  Numpad8: [0, -1], Numpad2: [0, 1], Numpad4: [-1, 0], Numpad6: [1, 0],
  Numpad7: [-1, -1], Numpad9: [1, -1], Numpad1: [-1, 1], Numpad3: [1, 1],
};

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;

  const step = ARROWS[e.code];
  if (step) {
    e.preventDefault();
    moveBy(step[0], step[1]);
    return;
  }

  if (e.code === 'Enter') {
    e.preventDefault();
    endTurn(state);
    cycleIdleUnit();
    draw();
  } else if (e.code === 'Space') {
    e.preventDefault();
    cycleIdleUnit();
    draw();
  }
});

// Handy from the devtools console: `game().state` is the live state object,
// alongside the camera and the current canvas size in CSS pixels.
window.game = () => ({ state, cam, view });

// Seed can be pinned via ?seed=123 to replay a specific world.
const requested = new URLSearchParams(location.search).get('seed');
start(requested ? Number(requested) : undefined);
