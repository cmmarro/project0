// Player-initiated changes to the state.
//
// Every action comes in a pair: a `can*` predicate returning either null or a
// human-readable reason it is blocked, and a `do*` that assumes the predicate
// passed. The UI uses the predicate to disable buttons and explain why; the
// action never has to duplicate that reasoning.

import {
  cityAt,
  distance,
  logMessage,
  takeCityName,
  tileAt,
  unitsAt,
} from './state.js';
import { TERRAIN, isPassable } from '../data/terrain.js';
import { UNITS } from '../data/units.js';

export const MIN_CITY_DISTANCE = 3;

// --- movement -----------------------------------------------------------

export function canMove(state, unit, x, y) {
  if (!unit) return 'No unit selected.';
  if (unit.moves <= 0) return `${UNITS[unit.type].name} has no movement left.`;
  if (distance(unit.x, unit.y, x, y) !== 1) return 'Can only move one tile at a time.';

  const tile = tileAt(state.map, x, y);
  if (!tile) return 'Off the edge of the map.';
  if (!isPassable(tile)) return `${TERRAIN[tile.terrain].name} is impassable.`;

  return null;
}

export function doMove(state, unit, x, y) {
  const tile = tileAt(state.map, x, y);
  unit.x = x;
  unit.y = y;
  // Spending the last point on expensive terrain is allowed -- a unit with any
  // movement left can always take one step. Otherwise a Warrior could never
  // enter forest.
  unit.moves = Math.max(0, unit.moves - TERRAIN[tile.terrain].moveCost);
}

// --- founding cities ----------------------------------------------------

export function canFoundCity(state, unit) {
  if (!unit) return 'No unit selected.';
  if (!UNITS[unit.type].actions.includes('found_city')) {
    return `A ${UNITS[unit.type].name} cannot found cities.`;
  }
  if (unit.moves <= 0) return 'Needs movement left to found a city.';
  if (cityAt(state, unit.x, unit.y)) return 'There is already a city here.';

  const tile = tileAt(state.map, unit.x, unit.y);
  if (!isPassable(tile)) return 'Cannot build on this terrain.';

  const tooClose = state.cities.find(
    (c) => distance(c.x, c.y, unit.x, unit.y) < MIN_CITY_DISTANCE
  );
  if (tooClose) return `Too close to ${tooClose.name}.`;

  return null;
}

export function doFoundCity(state, unit) {
  const city = {
    id: state.nextId++,
    name: takeCityName(state),
    x: unit.x,
    y: unit.y,
    pop: 1,
    food: 0,
    production: 0,
    order: null,
  };

  state.cities.push(city);
  removeUnit(state, unit);
  logMessage(state, `${city.name} founded.`);

  return city;
}

// --- city production ----------------------------------------------------

export function canBuild(state, city, unitType) {
  const def = UNITS[unitType];
  if (!def) return 'Unknown unit.';
  if (city.pop < def.minPop) {
    return `${city.name} needs ${def.minPop} population to build a ${def.name}.`;
  }
  return null;
}

export function setProduction(state, city, unitType) {
  // Switching orders keeps accumulated production. Forgiving on purpose; a
  // carry-over penalty is a balance knob to turn later, not a system.
  city.order = unitType;
}

// --- shared helpers -----------------------------------------------------

export function removeUnit(state, unit) {
  const i = state.units.indexOf(unit);
  if (i >= 0) state.units.splice(i, 1);
  if (state.selectedUnitId === unit.id) state.selectedUnitId = null;
}

// Cycle through the units stacked on a tile so a stack stays reachable with
// repeated clicks.
export function nextUnitAt(state, x, y, currentId) {
  const stack = unitsAt(state, x, y);
  if (!stack.length) return null;
  const i = stack.findIndex((u) => u.id === currentId);
  return stack[(i + 1) % stack.length];
}
