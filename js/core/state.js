// The game state and read-only queries against it.
//
// Two rules hold this design together:
//   1. State is plain JSON-serializable data. No class instances, no functions,
//      no typed arrays. That is what makes save/load and undo cheap to add.
//   2. Nothing in here mutates. Mutations live in core/actions.js and
//      core/turn.js so there is exactly one place to look when state changes.

import { makeRng, randomSeed } from './rng.js';
import { generateMap, findStartTile } from './map.js';
import { UNITS } from '../data/units.js';
import { CITY_NAMES } from '../data/names.js';
import { isPassable } from '../data/terrain.js';

export const MAP_WIDTH = 40;
export const MAP_HEIGHT = 24;

export const FOG_UNKNOWN = 0;
export const FOG_EXPLORED = 1;
export const FOG_VISIBLE = 2;

// How far a city reaches for tiles to work.
export const CITY_WORK_RADIUS = 2;
export const CITY_SIGHT = 3;

export function newGame(seed = randomSeed()) {
  const rng = makeRng(seed);
  const map = generateMap(MAP_WIDTH, MAP_HEIGHT, rng);
  const start = findStartTile(map, rng);

  const state = {
    seed,
    turn: 1,
    map,
    fog: new Array(map.width * map.height).fill(FOG_UNKNOWN),
    units: [],
    cities: [],
    nextId: 1,
    nextCityName: 0,
    selectedUnitId: null,
    selectedCityId: null,
    log: [],
  };

  spawnUnit(state, 'settler', start.x, start.y);
  const escort = adjacentPassable(state, start.x, start.y) ?? start;
  spawnUnit(state, 'warrior', escort.x, escort.y);

  return state;
}

// --- mutation primitives -----------------------------------------------
// Used by newGame and by core/actions.js + core/turn.js. Nothing else should
// be adding or removing entities.

export function spawnUnit(state, type, x, y) {
  const unit = {
    id: state.nextId++,
    type,
    x,
    y,
    moves: UNITS[type].moves,
  };
  state.units.push(unit);
  return unit;
}

export function takeCityName(state) {
  const name = CITY_NAMES[state.nextCityName % CITY_NAMES.length];
  const lap = Math.floor(state.nextCityName / CITY_NAMES.length);
  state.nextCityName++;
  return lap === 0 ? name : `${name} ${lap + 1}`;
}

export function logMessage(state, text) {
  state.log.push({ turn: state.turn, text });
  if (state.log.length > 60) state.log.shift();
}

// --- queries ------------------------------------------------------------

export const inBounds = (map, x, y) =>
  x >= 0 && y >= 0 && x < map.width && y < map.height;

export const tileIndex = (map, x, y) => y * map.width + x;

export function tileAt(map, x, y) {
  return inBounds(map, x, y) ? map.tiles[tileIndex(map, x, y)] : null;
}

export function unitsAt(state, x, y) {
  return state.units.filter((u) => u.x === x && u.y === y);
}

export function cityAt(state, x, y) {
  return state.cities.find((c) => c.x === x && c.y === y) ?? null;
}

export function unitById(state, id) {
  return state.units.find((u) => u.id === id) ?? null;
}

export function cityById(state, id) {
  return state.cities.find((c) => c.id === id) ?? null;
}

export const distance = (ax, ay, bx, by) =>
  Math.max(Math.abs(ax - bx), Math.abs(ay - by));

// Eight-way adjacency. Movement, city work radius, and sight all use the same
// Chebyshev metric so "2 tiles away" means one thing everywhere.
export function neighbors(map, x, y) {
  const out = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (inBounds(map, nx, ny)) out.push({ x: nx, y: ny });
    }
  }
  return out;
}

export function tilesInRadius(map, x, y, radius) {
  const out = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (inBounds(map, nx, ny)) out.push({ x: nx, y: ny });
    }
  }
  return out;
}

function adjacentPassable(state, x, y) {
  return (
    neighbors(state.map, x, y).find((p) => isPassable(tileAt(state.map, p.x, p.y))) ??
    null
  );
}
