// End-of-turn processing and fog of war.
//
// endTurn is the single place the world advances on its own. When AI players,
// research, or unit healing arrive, they become steps in this pipeline rather
// than logic scattered through the UI.

import {
  CITY_SIGHT,
  FOG_EXPLORED,
  FOG_VISIBLE,
  logMessage,
  spawnUnit,
  tileIndex,
  tilesInRadius,
} from './state.js';
import { cityYields, foodToGrow } from './economy.js';
import { UNITS } from '../data/units.js';

export function endTurn(state) {
  for (const city of state.cities) growCity(state, city);
  for (const city of state.cities) buildInCity(state, city);

  for (const unit of state.units) unit.moves = UNITS[unit.type].moves;

  state.turn++;
  updateVisibility(state);
}

function growCity(state, city) {
  const yields = cityYields(state, city);
  city.food += yields.surplus;
  city.production += yields.production;

  const needed = foodToGrow(city.pop);
  if (city.food >= needed) {
    city.food -= needed;
    city.pop++;
    logMessage(state, `${city.name} grows to ${city.pop}.`);
  } else if (city.food < 0) {
    city.food = 0;
    if (city.pop > 1) {
      city.pop--;
      logMessage(state, `${city.name} starves down to ${city.pop}.`);
    }
  }
}

function buildInCity(state, city) {
  if (!city.order) return;

  const def = UNITS[city.order];
  if (city.production < def.cost) return;
  if (city.pop < def.minPop) {
    logMessage(
      state,
      `${city.name} is holding a ${def.name}: needs ${def.minPop} population.`
    );
    return;
  }

  city.production -= def.cost;
  city.pop -= def.popCost;
  spawnUnit(state, city.order, city.x, city.y);
  logMessage(state, `${city.name} completes a ${def.name}.`);

  // Repeat-build would be a fine default, but silently spending production is
  // worse than an idle city the player can see.
  city.order = null;
}

// --- fog of war ---------------------------------------------------------

export function updateVisibility(state) {
  for (let i = 0; i < state.fog.length; i++) {
    if (state.fog[i] === FOG_VISIBLE) state.fog[i] = FOG_EXPLORED;
  }

  const reveal = (x, y, radius) => {
    for (const p of tilesInRadius(state.map, x, y, radius)) {
      state.fog[tileIndex(state.map, p.x, p.y)] = FOG_VISIBLE;
    }
  };

  for (const unit of state.units) reveal(unit.x, unit.y, UNITS[unit.type].sight);
  for (const city of state.cities) reveal(city.x, city.y, CITY_SIGHT);
}
