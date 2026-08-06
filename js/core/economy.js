// City economy: which tiles a city works, and what those tiles yield.
//
// Tile assignment is automatic and greedy. Letting the player assign citizens
// by hand is a real feature, but it belongs on top of this -- the shape here
// (a city owns a list of worked tiles) is the same either way.

import {
  CITY_WORK_RADIUS,
  tileAt,
  tilesInRadius,
} from './state.js';
import { TERRAIN } from '../data/terrain.js';

// A city center is always workable ground: it gets a floor on its yields so a
// city founded on desert or hills is not stillborn.
export function centerYield(tile) {
  const t = TERRAIN[tile.terrain];
  return {
    food: Math.max(1, t.food),
    production: Math.max(1, t.production),
  };
}

export function tileYield(tile) {
  const t = TERRAIN[tile.terrain];
  return { food: t.food, production: t.production };
}

const score = (y) => y.food * 4 + y.production * 3;

export const foodToGrow = (pop) => 8 + 4 * (pop - 1);

// One food per citizen. This has to stay at or below the food a typical land
// tile yields, or new citizens eat more than they bring in and no city can
// ever grow. When terrain improvements land and tiles start yielding more,
// this is the knob to raise.
export const foodUpkeep = (pop) => pop;

// Tiles claimed by cities that come earlier in the list. First-founded wins;
// arbitrary, but stable, which is what matters for now.
function claimedByOthers(state, city) {
  const claimed = new Set();
  for (const other of state.cities) {
    if (other.id === city.id) break;
    for (const p of workedTiles(state, other)) claimed.add(`${p.x},${p.y}`);
  }
  return claimed;
}

// The center tile plus one tile per population point.
export function workedTiles(state, city) {
  const claimed = claimedByOthers(state, city);
  const center = { x: city.x, y: city.y };

  const candidates = tilesInRadius(state.map, city.x, city.y, CITY_WORK_RADIUS)
    .filter((p) => !(p.x === city.x && p.y === city.y))
    .filter((p) => !claimed.has(`${p.x},${p.y}`))
    .map((p) => ({ ...p, y_: tileYield(tileAt(state.map, p.x, p.y)) }))
    .sort((a, b) => score(b.y_) - score(a.y_) || a.x - b.x || a.y - b.y);

  const worked = candidates.slice(0, city.pop);
  const bench = candidates.slice(city.pop);

  // Greedy-by-score alone will happily starve a city on forest and hills, or
  // park it at exactly zero surplus forever. Trade production for food until
  // the city is actually growing.
  let food = centerYield(tileAt(state.map, city.x, city.y)).food
    + worked.reduce((sum, t) => sum + t.y_.food, 0);

  while (food - foodUpkeep(city.pop) <= 0 && bench.length) {
    const bestFood = bench.reduce((a, b) => (b.y_.food > a.y_.food ? b : a));
    const worstFood = worked.reduce((a, b) => (b.y_.food < a.y_.food ? b : a));
    if (bestFood.y_.food <= worstFood.y_.food) break;

    worked.splice(worked.indexOf(worstFood), 1, bestFood);
    bench.splice(bench.indexOf(bestFood), 1, worstFood);
    food += bestFood.y_.food - worstFood.y_.food;
  }

  return [center, ...worked.map((t) => ({ x: t.x, y: t.y }))];
}

export function cityYields(state, city) {
  const worked = workedTiles(state, city);
  let food = 0;
  let production = 0;

  worked.forEach((p, i) => {
    const tile = tileAt(state.map, p.x, p.y);
    const y = i === 0 ? centerYield(tile) : tileYield(tile);
    food += y.food;
    production += y.production;
  });

  return {
    worked,
    food,
    production,
    upkeep: foodUpkeep(city.pop),
    surplus: food - foodUpkeep(city.pop),
  };
}
