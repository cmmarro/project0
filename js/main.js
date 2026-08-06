// Wiring: input -> actions -> render. No game rules live in this file.

import { newGame, cityAt, cityById, unitById, unitsAt } from './core/state.js';
import { updateVisibility, endTurn } from './core/turn.js';
import {
  canFoundCity,
  canMove,
  doFoundCity,
  doMove,
  nextUnitAt,
  setProduction,
} from './core/actions.js';
import { render, resizeCanvas, tileFromEvent } from './ui/render.js';
import { renderPanel } from './ui/panel.js';

const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');
const panel = document.getElementById('panel');

let state;
let hover = null;

function start(seed) {
  state = newGame(seed);
  updateVisibility(state);
  state.selectedUnitId = state.units[0]?.id ?? null;
  resizeCanvas(canvas, state.map);
  draw();
}

function draw() {
  render(ctx, state, { hover });
  panel.innerHTML = renderPanel(state, hover);
}

// --- selection ----------------------------------------------------------

function selectUnit(unit) {
  state.selectedUnitId = unit ? unit.id : null;
  state.selectedCityId = null;
}

function selectCity(city) {
  state.selectedCityId = city ? city.id : null;
  state.selectedUnitId = null;
}

function selectTile(x, y) {
  const stack = unitsAt(state, x, y);
  if (stack.length) {
    // Re-clicking a stack walks through it.
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

// --- input --------------------------------------------------------------

canvas.addEventListener('click', (e) => {
  const p = tileFromEvent(canvas, e, state.map);
  if (!p) return;

  // An empty adjacent tile is unambiguous: the player means "go there".
  // Anything occupied selects instead, so a stack never gets stepped on by
  // accident. Right-click and the arrow keys move regardless.
  const occupied = unitsAt(state, p.x, p.y).length || cityAt(state, p.x, p.y);
  if (!occupied && tryMove(p.x, p.y)) {
    draw();
    return;
  }

  selectTile(p.x, p.y);
  draw();
});

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const p = tileFromEvent(canvas, e, state.map);
  if (p && tryMove(p.x, p.y)) draw();
});

canvas.addEventListener('mousemove', (e) => {
  const p = tileFromEvent(canvas, e, state.map);
  if (p?.x === hover?.x && p?.y === hover?.y) return;
  hover = p;
  draw();
});

canvas.addEventListener('mouseleave', () => {
  hover = null;
  draw();
});

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

// Handy from the devtools console: `game()` returns the live state object.
window.game = () => state;

// Seed can be pinned via ?seed=123 to replay a specific world.
const requested = new URLSearchParams(location.search).get('seed');
start(requested ? Number(requested) : undefined);
