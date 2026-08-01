/* Hearthfall - balance constants and content definitions.
   Everything tunable lives here so the rest of the code stays about mechanics. */
window.HF = window.HF || {};

HF.CFG = {
  MAP_W: 44,
  MAP_H: 28,
  TILE: 24,

  START_COLONISTS: 4,
  START_RES: { food: 55, wood: 45, stone: 12 },
  BASE_STORAGE: 150,

  MOVE_BUDGET: 3,          // movement points per colonist per turn
  TURNS_PER_SEASON: 10,
  SEASONS: ['Spring', 'Summer', 'Autumn', 'Winter'],

  FOOD_DECAY: 1.7,
  REST_DECAY: 2.0,
  EAT_THRESHOLD: 34,
  SLEEP_THRESHOLD: 24,
  WAKE_AT: 92,
  MEAL_FOOD: 1,            // stockpile food spent per meal
  MEAL_RESTORE: 46,
  BED_REST: 13,
  GROUND_REST: 6,

  COLONIST_HP: 60,
  STARVE_DAMAGE: 3,
  COLD_DAMAGE: 1,
  REGEN: 1,

  RAID_START_TURN: 42,
  RAID_MIN_GAP: 24,
  RAID_MAX_GAP: 38,
  MIGRANT_GAP: 26,
  MILESTONE_TURN: 120,     // "three years endured"

  SKILL_MAX: 10,
  XP_PER_LEVEL: 14,
};

/* ---------- terrain ---------- */
HF.TERRAIN = {
  water:    { id: 'water',    name: 'Water',    passable: false, cost: 99, build: false },
  sand:     { id: 'sand',     name: 'Sand',     passable: true,  cost: 1,  build: true  },
  grass:    { id: 'grass',    name: 'Meadow',   passable: true,  cost: 1,  build: true  },
  forest:   { id: 'forest',   name: 'Forest',   passable: true,  cost: 2,  build: false },
  hill:     { id: 'hill',     name: 'Rocky Hill', passable: true, cost: 2, build: true  },
  mountain: { id: 'mountain', name: 'Mountain', passable: false, cost: 99, build: false },
};

/* ---------- work types (per-colonist toggles) ---------- */
HF.WORK_TYPES = [
  { id: 'woodcut', label: 'Woodcutting', short: 'Wood',  skill: 'woodcutting' },
  { id: 'mine',    label: 'Mining',      short: 'Mine',  skill: 'mining' },
  { id: 'build',   label: 'Building',    short: 'Build', skill: 'construction' },
  { id: 'farm',    label: 'Farming',     short: 'Farm',  skill: 'farming' },
];

HF.SKILLS = ['woodcutting', 'mining', 'construction', 'farming'];

/* ---------- designations the player paints onto tiles ---------- */
HF.ORDERS = {
  chop: {
    id: 'chop', label: 'Chop', key: 'C', work: 10, workType: 'woodcut',
    valid: function (t) { return t.terrain === 'forest'; },
    hint: 'Fell trees for wood.',
  },
  mine: {
    id: 'mine', label: 'Mine', key: 'M', work: 15, workType: 'mine',
    valid: function (t) { return t.terrain === 'mountain' || t.terrain === 'hill'; },
    hint: 'Cut stone from rock. Mountains must be worked from an adjacent tile.',
  },
  forage: {
    id: 'forage', label: 'Forage', key: 'F', work: 6, workType: 'farm',
    valid: function (t) { return t.feature === 'berries'; },
    hint: 'Gather berries. Bushes regrow, but not in winter.',
  },
  harvest: { // created automatically by ripe farm plots
    id: 'harvest', label: 'Harvest', key: null, work: 8, workType: 'farm',
    valid: function () { return false; },
    hint: 'Bring in a ripe crop.',
  },
};

/* ---------- buildings ---------- */
HF.BUILDINGS = {
  house: {
    id: 'house', label: 'House', cost: { wood: 22 }, work: 26, beds: 2,
    on: ['grass', 'sand', 'hill'],
    desc: 'Sleeps 2. Rested colonists work faster and stay cheerful.',
  },
  storehouse: {
    id: 'storehouse', label: 'Storehouse', cost: { wood: 28 }, work: 24, storage: 150,
    on: ['grass', 'sand', 'hill'],
    desc: '+150 to the cap on every resource. Surplus above the cap spoils.',
  },
  farm: {
    id: 'farm', label: 'Farm Plot', cost: { wood: 5 }, work: 12, farm: true,
    on: ['grass'],
    desc: 'Ripens over time, then asks to be harvested. Dormant all winter.',
  },
  campfire: {
    id: 'campfire', label: 'Campfire', cost: { wood: 12 }, work: 8, warmth: 5,
    on: ['grass', 'sand', 'hill'],
    desc: 'Keeps colonists within 5 tiles warm through winter.',
  },
  wall: {
    id: 'wall', label: 'Stone Wall', cost: { stone: 6 }, work: 10, blocks: true, hp: 80,
    adjacentWork: true,
    on: ['grass', 'sand', 'hill'],
    desc: 'Impassable. Raiders must break through it.',
  },
};

HF.FARM = { RIPE_AT: 20, YIELD: 13, GROWTH: { Spring: 1.0, Summer: 1.4, Autumn: 0.8, Winter: 0 } };

HF.YIELDS = {
  chop:    { wood: 12 },
  mine:    { stone: 10 },
  forage:  { food: 8 },
  harvest: { food: HF.FARM.YIELD },
};

/* ---------- names ---------- */
HF.NAMES = {
  first: ['Ada', 'Bran', 'Cyra', 'Dov', 'Eira', 'Finn', 'Greta', 'Hale', 'Ines', 'Jori',
          'Kess', 'Lune', 'Mira', 'Nels', 'Orin', 'Pell', 'Quill', 'Rowan', 'Sena', 'Tove',
          'Uma', 'Vesa', 'Wren', 'Yarl', 'Zora'],
  last:  ['Ashfell', 'Brookmere', 'Cairn', 'Dunmoor', 'Emberly', 'Frostvale', 'Gladholt',
          'Harrow', 'Ironwood', 'Kelder', 'Lowmarsh', 'Northgate', 'Oakhurst', 'Quarry',
          'Redsong', 'Stonebrook', 'Thornby', 'Weatherall'],
};
