// Terrain definitions. Adding a terrain type should mean adding a row here and
// nothing else -- map generation reads thresholds, the renderer reads `color`,
// the economy reads `food`/`production`, movement reads `moveCost`.
//
// moveCost: null means impassable to land units.

export const TERRAIN = {
  ocean: {
    name: 'Ocean',
    color: '#1c3f63',
    food: 1,
    production: 0,
    moveCost: null,
    water: true,
  },
  desert: {
    name: 'Desert',
    color: '#d8c68d',
    food: 0,
    production: 0,
    moveCost: 1,
  },
  plains: {
    name: 'Plains',
    color: '#b3bd6e',
    food: 1,
    production: 1,
    moveCost: 1,
  },
  grassland: {
    name: 'Grassland',
    color: '#6da84c',
    food: 2,
    production: 0,
    moveCost: 1,
  },
  forest: {
    name: 'Forest',
    color: '#2f6b3d',
    food: 1,
    production: 2,
    moveCost: 2,
  },
  hills: {
    name: 'Hills',
    color: '#8b7c53',
    food: 0,
    production: 2,
    moveCost: 2,
  },
  mountains: {
    name: 'Mountains',
    color: '#6f6f6f',
    food: 0,
    production: 1,
    moveCost: null,
  },
};

export const terrainOf = (tile) => TERRAIN[tile.terrain];

export const isPassable = (tile) => terrainOf(tile).moveCost !== null;
