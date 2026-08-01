/* Hyakushō - balance constants and content definitions.

   A village of peasants in the Sengoku period. Everything tunable lives here so
   the rest of the code stays about mechanics. Internal ids (food/wood/stone,
   grass/forest/hill) are deliberately plain; the words the player reads come
   from the `name` and `label` fields. */
window.HF = window.HF || {};

HF.CFG = {
  MAP_W: 44,
  MAP_H: 28,

  START_COLONISTS: 4,
  START_RES: { food: 55, wood: 45, stone: 12 },
  BASE_STORAGE: 150,

  MOVE_BUDGET: 3,          // movement points per villager per turn
  TURNS_PER_SEASON: 10,
  SEASONS: ['Spring', 'Summer', 'Autumn', 'Winter'],

  FOOD_DECAY: 1.7,
  REST_DECAY: 2.0,
  EAT_THRESHOLD: 34,
  SLEEP_THRESHOLD: 24,
  WAKE_AT: 92,
  MEAL_FOOD: 1,
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

  /* The spine of the game. The daimyo's collectors come after each harvest,
     before winter, and they do not care whether you can spare it. */
  LEVY: {
    turns: [30, 70, 110],
    demands: [40, 75, 115],
    laterIncrease: 45,      // per year beyond the third
    warnAhead: 8,
    /* Missing a levy earns strikes rather than ending things outright: a near
       miss costs one, a bad miss costs two, and three break up the village.
       So you can survive one bad year, or two tight ones, but not both. */
    tolerance: 0.65,        // paying at least this share of the demand is a near miss
    strikeNear: 1,
    strikeBad: 2,
    strikesAllowed: 2,
  },

  VICTORY_TURN: 120,        // end of the third year

  SKILL_MAX: 10,
  XP_PER_LEVEL: 14,
};

/* What the player calls each resource. */
HF.RESOURCES = {
  food:  { label: 'Rice',   unit: 'koku', color: '#d8c26a' },
  wood:  { label: 'Timber', unit: '',     color: '#c69a63' },
  stone: { label: 'Stone',  unit: '',     color: '#a8b0bb' },
};

/* ---------- terrain ----------
   `elev` is in whole tile-heights and drives the isometric relief. */
HF.TERRAIN = {
  water:    { id: 'water',    name: 'River',        passable: false, cost: 99, build: false, elev: 0 },
  sand:     { id: 'sand',     name: 'Riverbank',    passable: true,  cost: 1,  build: true,  elev: 0 },
  grass:    { id: 'grass',    name: 'Meadow',       passable: true,  cost: 1,  build: true,  elev: 0 },
  forest:   { id: 'forest',   name: 'Pine Grove',   passable: true,  cost: 2,  build: false, elev: 0 },
  hill:     { id: 'hill',     name: 'Rocky Slope',  passable: true,  cost: 2,  build: true,  elev: 1 },
  mountain: { id: 'mountain', name: 'Mountain',     passable: false, cost: 99, build: false, elev: 2 },
};

/* ---------- work types (per-villager toggles) ---------- */
HF.WORK_TYPES = [
  { id: 'woodcut', label: 'Forestry',  short: 'Wood',  skill: 'woodcutting' },
  { id: 'mine',    label: 'Quarrying', short: 'Stone', skill: 'mining' },
  { id: 'build',   label: 'Carpentry', short: 'Build', skill: 'construction' },
  { id: 'farm',    label: 'Farming',   short: 'Rice',  skill: 'farming' },
];

HF.SKILLS = ['woodcutting', 'mining', 'construction', 'farming'];
HF.SKILL_LABELS = {
  woodcutting: 'Forestry', mining: 'Quarrying',
  construction: 'Carpentry', farming: 'Farming',
};

/* ---------- work orders the player paints onto tiles ---------- */
HF.ORDERS = {
  chop: {
    id: 'chop', label: 'Fell Timber', verb: 'Felling', key: 'C', work: 10, workType: 'woodcut',
    color: '#d9a441',
    valid: function (t) { return t.terrain === 'forest'; },
    hint: 'Fell pine for timber. The grove grows back in time.',
  },
  mine: {
    id: 'mine', label: 'Quarry Stone', verb: 'Quarrying', key: 'M', work: 15, workType: 'mine',
    color: '#89a9cf',
    valid: function (t) { return t.terrain === 'mountain' || t.terrain === 'hill'; },
    hint: 'Cut stone from slopes and mountains. Mountains are worked from an adjacent tile.',
  },
  forage: {
    id: 'forage', label: 'Gather Chestnuts', verb: 'Gathering', key: 'F', work: 6, workType: 'farm',
    color: '#c9738a',
    valid: function (t) { return t.feature === 'chestnut'; },
    hint: 'Gather chestnuts for the stores. They ripen again, but never in winter.',
  },
  harvest: {                                   // raised automatically by ripe paddies
    id: 'harvest', label: 'Harvest', verb: 'Harvesting', key: null, work: 8, workType: 'farm',
    color: '#9ac46a',
    valid: function () { return false; },
    hint: 'Bring in a ripe paddy.',
  },
};

/* ---------- buildings ---------- */
HF.BUILDINGS = {
  house: {
    id: 'house', label: 'Minka', sub: 'farmhouse',
    cost: { wood: 22 }, work: 26, beds: 2,
    on: ['grass', 'sand', 'hill'],
    desc: 'A thatched farmhouse. Sleeps two. Villagers with a bed work harder and keep their spirits.',
  },
  storehouse: {
    id: 'storehouse', label: 'Kura', sub: 'granary',
    cost: { wood: 28 }, work: 24, storage: 150,
    on: ['grass', 'sand', 'hill'],
    desc: 'A plastered granary. Raises the cap on every store by 150. Anything over the cap rots.',
  },
  farm: {
    id: 'farm', label: 'Rice Paddy', sub: '',
    cost: { wood: 5 }, work: 12, farm: true,
    on: ['grass'],
    desc: 'Floods, ripens, and asks to be harvested. Your only real source of rice. Dormant all winter.',
  },
  campfire: {
    id: 'campfire', label: 'Hearth Fire', sub: '',
    cost: { wood: 12 }, work: 8, warmth: 5,
    on: ['grass', 'sand', 'hill'],
    desc: 'Keeps anyone within five tiles alive through the winter cold.',
  },
  tower: {
    id: 'tower', label: 'Yagura', sub: 'watchtower',
    cost: { wood: 16, stone: 8 }, work: 22, guard: 6, guardBonus: 4,
    on: ['grass', 'sand', 'hill'],
    desc: 'Villagers fighting within six tiles strike harder. Bandits are the price of a full granary.',
  },
  wall: {
    id: 'wall', label: 'Ishigaki', sub: 'stone rampart',
    cost: { stone: 6 }, work: 10, blocks: true, hp: 80,
    adjacentWork: true,
    on: ['grass', 'sand', 'hill'],
    desc: 'Impassable. Bandits must break it down, which costs them turns you can use.',
  },
};

HF.FARM = { RIPE_AT: 20, YIELD: 13, GROWTH: { Spring: 1.0, Summer: 1.4, Autumn: 0.8, Winter: 0 } };

HF.YIELDS = {
  chop:    { wood: 12 },
  mine:    { stone: 10 },
  forage:  { food: 8 },
  harvest: { food: HF.FARM.YIELD },
};

/* ---------- names ----------
   Peasants of the period generally had no surname, so villagers are known by a
   given name and where they are from. */
HF.NAMES = {
  first: ['Tarō', 'Hana', 'Jirō', 'Kiku', 'Saburō', 'Ume', 'Gorō', 'Yuki', 'Sen', 'Toshi',
          'Aki', 'Matsu', 'Nao', 'Haru', 'Riku', 'Kane', 'Tsune', 'Yoshi', 'Sato', 'Mine',
          'Take', 'Chiyo', 'Iwa', 'Suke', 'Kiyo', 'Shino'],
  place: ['Kurogawa', 'Hinodani', 'Yamashita', 'Kawabe', 'Sugihara', 'Nomura', 'Takigawa',
          'Ishimura', 'Ozawa', 'Fujino', 'Aramaki', 'Shirakawa', 'Tanigawa', 'Onoda',
          'Kiyama', 'Mizuno'],
};
