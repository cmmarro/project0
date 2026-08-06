// Unit definitions.
//
// moves     -- movement points refreshed at the start of each turn
// cost      -- production points a city must accumulate to build one
// popCost   -- city population consumed when the unit is completed
// minPop    -- city population required before the build can complete
// actions   -- ids the UI turns into buttons; handled in core/actions.js
// sight     -- tiles revealed around the unit

export const UNITS = {
  settler: {
    id: 'settler',
    name: 'Settler',
    glyph: '⌂', // house
    moves: 2,
    cost: 30,
    popCost: 1,
    minPop: 2,
    sight: 2,
    actions: ['found_city'],
    blurb: 'Founds a new city. Consumed in the process.',
  },
  warrior: {
    id: 'warrior',
    name: 'Warrior',
    glyph: '⚔', // crossed swords
    moves: 2,
    cost: 15,
    popCost: 0,
    minPop: 1,
    sight: 2,
    actions: [],
    blurb: 'Explores and holds ground. Combat is not implemented yet.',
  },
  worker: {
    id: 'worker',
    name: 'Worker',
    glyph: '⚒', // hammer and pick
    moves: 2,
    cost: 20,
    popCost: 0,
    minPop: 1,
    sight: 1,
    actions: [],
    blurb: 'Placeholder. Terrain improvements are not implemented yet.',
  },
};

// What a city may put in its build queue, in menu order.
export const BUILDABLE = ['warrior', 'worker', 'settler'];
