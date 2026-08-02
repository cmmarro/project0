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
  /* Enough rice to reach the first harvest. A paddy takes a fortnight to come
     in and four people eat about four koku a day, so anything less than this
     is a village that starves before its first crop through no fault of the
     player's. */
  START_RES: { food: 95, wood: 60, stone: 12, cloth: 6 },
  BASE_STORAGE: 150,

  SEASONS: ['Spring', 'Summer', 'Autumn', 'Winter'],

  /* ---------- rates, all per tick ----------
     A tick is a tenth of an in-game hour. These were per-turn numbers when a
     turn was a keystroke; every one of them has been divided down so that a
     villager gets through roughly the same day, but does it in front of you. */
  TICKS_PER_TILE: 5,       // on cost-1 ground, before terrain cost
  WORK_PER_TICK: 0.26,     // multiplied by the villager's work rate

  FOOD_DECAY: 0.21,        // full to empty in a bit over two days

  /* Rest is tuned so the cycle closes on twenty-four hours. Awake from six to
     nine is fifteen hours and costs about seventy-five; a night on a futon
     puts it back. Get this wrong by a little and sleep slowly walks around the
     clock until the village is napping at noon - which is exactly what the
     first pass did. */
  /* A fifteen-hour day costs 57 rest. A night on a futon puts back 76 and
     tops out; a night on the ground puts back 45, so sleeping rough loses
     about twelve a day and degrades over a week rather than immediately. That
     margin is the whole point: it has to be bad enough to make beds urgent and
     survivable enough that the first week is not spent napping in a field. */
  REST_DECAY: 0.38,
  EAT_THRESHOLD: 38,
  SLEEP_THRESHOLD: 22,
  WAKE_AT: 88,
  MEAL_FOOD: 1,
  MEAL_RESTORE: 46,
  BED_REST: 0.85,          // a futon: a night's sleep fills the bar and no more
  ROOM_REST_BONUS: 0.25,   // indoors and out of the weather
  GROUND_REST: 0.5,        // sleeping rough slowly loses ground

  /* Health, per tick. These were the last numbers still carrying their
     per-turn values, which at 240 ticks a day meant an empty stomach killed
     somebody in seventeen hours and a winter afternoon outdoors cost half
     their health. Both are meant to be problems you get a few days to solve. */
  COLONIST_HP: 60,
  STARVE_DAMAGE: 0.075,    // about three days from full health to dead
  COLD_DAMAGE: 0.037,      // a week of winter nights outdoors
  REGEN: 0.058,            // fed and warm, back to full in four days

  GRIEF_CAP: 12,           // ceiling on the village-wide mourning thought

  /* Everything scheduled is now counted in days rather than turns. */
  RAID_START_DAY: 50,
  RAID_MIN_GAP: 28,
  RAID_MAX_GAP: 44,
  MIGRANT_GAP: 30,

  /* The spine of the game. The daimyo's collectors come after each harvest,
     before winter, and they do not care whether you can spare it.

     Four years rather than three, and the first year is a remission year: newly
     opened land was commonly taxed lightly, and it gives the player a full year
     to learn what a levy even is before one can hurt them. The demand then
     roughly doubles each autumn, so the difficulty arrives as a ramp instead of
     a wall. */
  LEVY: {
    days: [36, 84, 132, 180],   // after each autumn harvest, before winter
    demands: [18, 55, 100, 155],
    laterIncrease: 60,      // per year beyond the fourth
    warnAhead: 9,           // days of notice
  },

  /* Standing is what the castle thinks of the village, and it replaced a
     three-strikes counter. Strikes made every levy a pass/fail gate: 5 koku
     short and 50 short cost exactly the same, so there was one correct plan and
     no reason to ever grow more rice than the number. Standing is continuous -
     a small shortfall is a small wound, a large one nearly fatal - and paying
     over the demand buys credit you can spend on a bad year later. */
  STANDING: {
    start: 60,
    max: 100,
    payBonus: 12,           // for meeting the demand at all
    overPer: 6,             // +1 standing per this much rice paid above the demand
    overCap: 12,
    shortPenalty: 62,       // scaled by the share of the demand you failed to pay
    recover: 0.25,          // per turn, the castle slowly forgets
    favourAt: 82,           // above this, next year's demand is eased
    favourRelief: 0.85,
    walkOutBelow: 22,       // desperate villages start losing people
  },

  VICTORY_DAY: 192,         // end of the fourth year

  /* Merchants come up the valley with a single offer, take it or leave it.
     This is the freedom valve: it is what makes a timber village or a fishing
     village viable when the castle only ever asks for rice. */
  MERCHANT: { firstDay: 12, gap: [9, 15], standFor: 4 },   // days

  SKILL_MAX: 10,
  XP_PER_LEVEL: 14,
};

/* ---------- how hard the world presses ----------
   The levy and the bandits were built first and grew to fill the game, which
   left no room to just keep a village. These let the player say how much of
   that they want. Open Valley is the real answer to "let it breathe": the
   seasons, the ground and the people, and nothing coming over the hill. */
HF.SCENARIOS = {
  open: {
    id: 'open', label: 'Open Valley',
    note: 'No collectors and no bandits. Seasons, ground, and people. It does not end.',
    levy: false, raids: false,
  },
  quiet: {
    id: 'quiet', label: 'A Quiet Province',
    note: 'The castle asks, but lightly, and trouble is a long way off. Room to make mistakes.',
    levy: true, levyScale: 0.6, raids: true, raidDelay: 55, raidGapScale: 1.5,
  },
  full: {
    id: 'full', label: 'Under the Daimyō',
    note: 'The levy as written, and bandits from the second year. The village can be broken up.',
    levy: true, levyScale: 1, raids: true, raidDelay: 0, raidGapScale: 1,
  },
};
HF.DEFAULT_SCENARIO = 'quiet';

/* What the player calls each resource. Hemp and herbs come off the land and are
   useless until worked; cloth and medicine are what a villager makes of them at
   a bench. Keeping the crafted pair small is deliberate - a longer chain would
   be more to explain and no more to decide. */
HF.RESOURCES = {
  food:  { label: 'Rice',     unit: 'koku', color: '#d8c26a', short: 'Rice' },
  wood:  { label: 'Timber',   unit: '',     color: '#c69a63', short: 'Timber' },
  stone: { label: 'Stone',    unit: '',     color: '#a8b0bb', short: 'Stone' },
  hemp:  { label: 'Hemp',     unit: '',     color: '#9fae72', short: 'Hemp' },
  herb:  { label: 'Herbs',    unit: '',     color: '#7fb08a', short: 'Herbs' },
  cloth: { label: 'Cloth',    unit: '',     color: '#cfc0a8', short: 'Cloth' },
  med:   { label: 'Medicine', unit: '',     color: '#c98fa8', short: 'Med' },
};

/* ---------- what grows wild ----------
   Each is a tile feature with a season it can be taken in, so the year has a
   shape beyond the rice: bracken in spring, mushrooms after the autumn rain,
   hemp standing through the summer. Foraging used to be one bush that did the
   same thing all year. */
HF.PLANTS = {
  chestnut: {
    id: 'chestnut', label: 'Chestnut', order: 'forage',
    yields: { food: 8 }, work: 6, regrow: [22, 34],
    seasons: ['Summer', 'Autumn'],
    on: ['grass', 'moor'], chance: 0.05,
    note: 'Food, in autumn especially.',
  },
  bracken: {
    id: 'bracken', label: 'Bracken', order: 'forage',
    yields: { food: 5 }, work: 4, regrow: [14, 22],
    seasons: ['Spring'],
    on: ['grass', 'moor', 'forest'], chance: 0.05,
    note: 'Warabi shoots. Only worth taking in spring.',
  },
  mushroom: {
    id: 'mushroom', label: 'Mushrooms', order: 'forage',
    yields: { food: 7 }, work: 4, regrow: [12, 20],
    seasons: ['Autumn'],
    on: ['forest', 'bamboo'], chance: 0.07,
    note: 'Under the pines, after the autumn rain.',
  },
  yam: {
    id: 'yam', label: 'Wild Yam', order: 'forage',
    yields: { food: 11 }, work: 9, regrow: [30, 46],
    seasons: ['Autumn', 'Winter'],
    on: ['forest', 'hill', 'moor'], chance: 0.035,
    note: 'Hard digging, but it keeps, and it is there in winter.',
  },
  hemp: {
    id: 'hemp', label: 'Wild Hemp', order: 'forage',
    yields: { hemp: 9 }, work: 7, regrow: [24, 36],
    seasons: ['Summer', 'Autumn'],
    on: ['grass', 'moor', 'marsh'], chance: 0.05,
    note: 'Asa. Worthless until it is woven.',
  },
  herb: {
    id: 'herb', label: 'Medicinal Herbs', order: 'forage',
    yields: { herb: 6 }, work: 5, regrow: [26, 40],
    seasons: ['Spring', 'Summer', 'Autumn'],
    on: ['grass', 'marsh', 'forest', 'hill'], chance: 0.035,
    note: 'No use raw. Ground at a bench it becomes medicine.',
  },
  fish: {
    id: 'fish', label: 'Fish', order: 'fish',
    yields: { food: 7 }, work: 13, regrow: [20, 32],
    seasons: ['Spring', 'Summer', 'Autumn', 'Winter'],
    on: ['water'], chance: 0.09,
    note: 'The one thing the river gives all year.',
  },
};

/* Recipes worked at a bench. The player turns one on and villagers keep at it
   while the materials last. */
HF.RECIPES = {
  cloth: {
    id: 'cloth', label: 'Weave Cloth', station: 'bench',
    cost: { hemp: 6 }, yields: { cloth: 3 }, work: 22, skill: 'construction',
    note: 'Hemp into cloth. A futon needs it, and so does anyone cold.',
  },
  medicine: {
    id: 'medicine', label: 'Grind Medicine', station: 'bench',
    cost: { herb: 5 }, yields: { med: 2 }, work: 18, skill: 'farming',
    note: 'Herbs into medicine. The injured mend far faster with it to hand.',
  },
  preserve: {
    id: 'preserve', label: 'Dry and Salt', station: 'bench',
    cost: { food: 14 }, yields: { food: 20 }, work: 26, skill: 'farming',
    note: 'Slow work that turns a glut into more than you started with. ' +
          'Only worth doing when the kura is full and the levy is far off.',
  },
};

/* ---------- terrain ----------
   `elev` is in whole tile-heights and drives the isometric relief.

   Every kind here has to be worth telling apart, or it is just noise on the
   map. Marsh is where rice does best and nothing else will stand; bamboo is
   timber that comes back within the year; moor is open ground you can build on
   that grows nothing on its own. Between them, two valleys play differently. */
HF.TERRAIN = {
  water:    { id: 'water',    name: 'River',        passable: false, cost: 99, build: false, elev: 0 },
  sand:     { id: 'sand',     name: 'Riverbank',    passable: true,  cost: 1,  build: true,  elev: 0 },
  grass:    { id: 'grass',    name: 'Meadow',       passable: true,  cost: 1,  build: true,  elev: 0 },
  marsh:    { id: 'marsh',    name: 'Reed Marsh',   passable: true,  cost: 2,  build: false, elev: 0, wet: true },
  moor:     { id: 'moor',     name: 'Susuki Moor',  passable: true,  cost: 1,  build: true,  elev: 0 },
  forest:   { id: 'forest',   name: 'Pine Grove',   passable: true,  cost: 2,  build: false, elev: 0 },
  bamboo:   { id: 'bamboo',   name: 'Bamboo Grove', passable: true,  cost: 2,  build: false, elev: 0 },
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
    valid: function (t) { return t.terrain === 'forest' || t.terrain === 'bamboo'; },
    hint: 'Fell pine or cut bamboo. Pine pays better; bamboo is back within the year.',
  },
  mine: {
    id: 'mine', label: 'Quarry Stone', verb: 'Quarrying', key: 'M', work: 15, workType: 'mine',
    color: '#89a9cf',
    valid: function (t) { return t.terrain === 'mountain' || t.terrain === 'hill'; },
    hint: 'Cut stone from slopes and mountains. Mountains are worked from an adjacent tile.',
  },
  forage: {
    id: 'forage', label: 'Forage', verb: 'Gathering', key: 'F', work: 6, workType: 'farm',
    color: '#c9738a',
    valid: function (t) {
      const pl = HF.PLANTS[t.feature];
      return !!pl && pl.order === 'forage';
    },
    hint: 'Take whatever is growing: bracken in spring, hemp and chestnuts in ' +
          'summer, mushrooms and yam in autumn. Out of season it is not worth the walk.',
  },
  fish: {
    id: 'fish', label: 'Set Fish Traps', verb: 'Fishing', key: 'T', work: 13, workType: 'farm',
    color: '#6fb3c9',
    valid: function (t) { return t.feature === 'fish'; },
    hint: 'Trap fish from the bank. Steady food that owes nothing to the paddies - ' +
          'a river valley can eat while the rice goes to the castle.',
  },
  /* One brush for "make this ground empty". Chopping and foraging both already
     clear a tile, but only of their own kind, so squaring off a patch to build
     on meant two tools and two drags over the same ground. This takes whatever
     is there and does the right thing with it - and it is what a blueprint
     drops on vegetated ground by itself. */
  clear: {
    id: 'clear', label: 'Clear Ground', verb: 'Clearing', key: 'G', work: 8, workType: 'woodcut',
    color: '#b8a27a',
    valid: function (t) {
      if (t.terrain === 'forest' || t.terrain === 'bamboo') return true;
      const pl = HF.PLANTS[t.feature];
      return !!pl && pl.order === 'forage';
    },
    hint: 'Take down whatever is standing here - trees, bamboo, or whatever is ' +
          'growing - and leave bare ground. You still get what it was worth.',
  },
  harvest: {                                   // raised automatically by ripe paddies
    id: 'harvest', label: 'Harvest', verb: 'Harvesting', key: null, work: 8, workType: 'farm',
    color: '#9ac46a',
    valid: function () { return false; },
    hint: 'Bring in a ripe paddy.',
  },
};

/* ---------- what you can put on a tile ----------
   Three categories, because they answer different questions. Structures make a
   room; furniture makes it worth being in; works are the things that produce.

   A minka used to be a single stamp that was a house, two beds and shelter all
   at once. Now you build the walls, hang a door, and lay futons inside - and
   the room being enclosed is what makes it warm and the sleep worth having. */
HF.BUILD_CATEGORIES = [
  { id: 'structure', label: 'Structure', note: 'Walls and doors. Enclose a space and it becomes a room.' },
  { id: 'furniture', label: 'Furniture', note: 'What makes a room worth sleeping in.' },
  { id: 'works',     label: 'Works',     note: 'Paddies, benches, and the rest of the working village.' },
];

HF.BUILDINGS = {
  /* ---- structure ---- */
  wall: {
    id: 'wall', label: 'Timber Wall', sub: '', cat: 'structure',
    cost: { wood: 4 }, work: 7, blocks: true, encloses: true, hp: 55,
    adjacentWork: true,
    on: ['grass', 'sand', 'hill', 'moor'],
    desc: 'Quick to raise. Enclose a space with these and what is inside is a room.',
  },
  door: {
    id: 'door', label: 'Door', sub: '', cat: 'structure',
    cost: { wood: 5 }, work: 8, encloses: true, hp: 35,
    on: ['grass', 'sand', 'hill', 'moor'],
    desc: 'Seals a room but lets people through. A room with no door is a box.',
  },
  ishigaki: {
    id: 'ishigaki', label: 'Ishigaki', sub: 'stone rampart', cat: 'structure',
    cost: { stone: 6 }, work: 12, blocks: true, encloses: true, hp: 80,
    adjacentWork: true,
    on: ['grass', 'sand', 'hill', 'moor'],
    desc: 'Impassable and slow to break. Bandits must come through it.',
  },

  /* ---- furniture ---- */
  futon: {
    id: 'futon', label: 'Futon', sub: 'bed', cat: 'furniture',
    cost: { wood: 3, cloth: 2 }, work: 9, beds: 1,
    on: ['grass', 'sand', 'hill', 'moor'],
    desc: 'One person sleeps here. Indoors and near a hearth, they sleep properly.',
  },
  hearth: {
    id: 'hearth', label: 'Irori', sub: 'hearth', cat: 'furniture',
    cost: { stone: 4, wood: 6 }, work: 10, warmth: 5,
    on: ['grass', 'sand', 'hill', 'moor'],
    desc: 'A sunken hearth. Keeps anyone within five tiles alive through winter, ' +
          'and lights the room after dark.',
  },
  table: {
    id: 'table', label: 'Low Table', sub: '', cat: 'furniture',
    cost: { wood: 8 }, work: 12, social: 4,
    on: ['grass', 'sand', 'hill', 'moor'],
    desc: 'Somewhere to eat that is not the floor. Anyone eating near one is the ' +
          'better for it.',
  },
  chest: {
    id: 'chest', label: 'Storage Chest', sub: '', cat: 'furniture',
    cost: { wood: 10 }, work: 11, storage: 70,
    on: ['grass', 'sand', 'hill', 'moor'],
    desc: 'Raises what the village can hold by 70. Cheaper than a kura, and fits inside.',
  },

  /* ---- works ---- */
  farm: {
    id: 'farm', label: 'Rice Paddy', sub: '', cat: 'works',
    cost: { wood: 5 }, work: 12, farm: true,
    on: ['grass', 'marsh', 'moor'],
    desc: 'Floods, ripens, and asks to be harvested. Half again as fast on reed ' +
          'marsh, and slow on dry moor.',
  },
  bench: {
    id: 'bench', label: 'Work Bench', sub: 'craft', cat: 'works',
    cost: { wood: 14 }, work: 16, station: 'bench',
    on: ['grass', 'sand', 'hill', 'moor'],
    desc: 'Weaves hemp into cloth, grinds herbs into medicine, dries a glut of ' +
          'rice into more than you started with. Tap it to choose the work.',
  },
  storehouse: {
    id: 'storehouse', label: 'Kura', sub: 'granary', cat: 'works',
    cost: { wood: 28, stone: 6 }, work: 24, storage: 150,
    on: ['grass', 'sand', 'hill', 'moor'],
    desc: 'A plastered granary. Raises the cap on every store by 150. Anything ' +
          'over the cap rots.',
  },
  tower: {
    id: 'tower', label: 'Yagura', sub: 'watchtower', cat: 'works',
    cost: { wood: 16, stone: 8 }, work: 22, guard: 6, guardBonus: 4,
    on: ['grass', 'sand', 'hill', 'moor'],
    desc: 'Villagers fighting within six tiles strike harder.',
  },
};

HF.FARM = {
  RIPE_AT: 14,              // days, at spring growth on ordinary ground
  YIELD: 13,
  GROWTH: { Spring: 1.0, Summer: 1.4, Autumn: 0.8, Winter: 0 },
  /* Where a paddy sits is a real decision: wet ground is worth walking to. */
  SOIL: { marsh: 1.5, grass: 1.0, moor: 0.6 },
};

/* Chopping is the only order whose yield still lives here; everything foraged
   or trapped reads its own numbers off HF.PLANTS, so adding a plant is one
   entry and no edits anywhere else. */
HF.YIELDS = {
  chop:    { wood: 12 },
  mine:    { stone: 10 },
  harvest: { food: HF.FARM.YIELD },
};

/* How long a felled grove takes to come back, and as what. Bamboo is the point
   of the pair: less per cut than pine, but back inside the year, so a bamboo
   valley can be logged over and over. Plants carry their own regrow times. */
HF.REGROW = {
  forest: { regrow: [55, 85], yieldScale: 1 },
  bamboo: { regrow: [16, 26], yieldScale: 0.6 },
};

/* Is this plant worth taking right now? Out of season it is still standing
   there - it just yields nothing worth the walk, which is what gives the year
   its shape. */
HF.plantInSeason = function (plantId, season) {
  const pl = HF.PLANTS[plantId];
  return !!pl && pl.seasons.indexOf(season) !== -1;
};

/* ---------- character ----------
   None of this is simulated. An origin does not change how fast anyone works;
   a scar does nothing at all. They are here because a villager the player can
   picture is a villager the player will tell stories about, and detail that
   never feeds back into the systems costs nothing to balance and nothing to
   understand. Only TRAITS have a hook, and each has exactly one. */

/* Stock figures of the period. The player already knows what a burned village
   or a deserted levy means, so one clause does the work of a paragraph. */
HF.ORIGINS = [
  'came down from a village the Oda burned',
  'was a temple servant until the monks were driven out',
  'is a third child, and will inherit nothing',
  'carried baggage behind an army and thought better of it',
  'was sold to a silk house as a child and walked home',
  'lost a husband to a lord\u2019s quarrel and never learned which one',
  'has worked this valley since before the wars',
  'deserted an ashigaru levy and does not speak of it',
  'held a spear for a house that no longer exists',
  'burned charcoal in the hills above the valley',
  'arrived with a hoe, a pot, and nothing else',
  'buried two children in a famine year',
  'was a boatman until the ford was taken',
  'ran from a castle town the winter it changed hands',
];

/* Appearance. Pure flavour - it exists so the player has something to picture. */
HF.MARKS = [
  'a burn scar up one forearm',
  'grey coming in early at the temples',
  'a nose broken and set badly',
  'hands stained dark from indigo',
  'a missing fingertip',
  'shoulders like someone twice the size',
  'a limp from a childhood fall',
  'one tooth blacked out at the front',
  'eyes kept narrowed even indoors',
  'a voice worn down to almost nothing',
];

/* One mechanical hook each, and every hook shows up by name in the villager's
   thoughts - a trait the player cannot see the effect of is not a trait. */
HF.TRAITS = {
  steady:   { label: 'Steady',   note: 'Hardship lands lighter than it does on others.' },
  sullen:   { label: 'Sullen',   note: 'Takes everything harder than it is.' },
  devout:   { label: 'Devout',   note: 'Finds meaning where others find only work.' },
  homesick: { label: 'Homesick', note: 'This is not home yet. A village of five buildings might be.' },
  tough:    { label: 'Tough',    note: 'Harder to kill than they look.' },
  diligent: { label: 'Diligent', note: 'Works faster at everything, and always has.' },
};

HF.TRAIT_TUNING = {
  steadyScale: 0.6,       // multiplies every negative thought
  sullenScale: 1.4,
  devoutMood: 6,
  homesickMood: -7,
  homesickCured: 5,       // buildings standing before this valley feels like home
  toughHp: 14,
  diligentRate: 1.15,
};

/* A tie to one other villager. It does nothing whatsoever while both are alive.
   That is the whole design: it is the minimum representation that supports the
   story it exists for, which is the one where somebody does not come back.

   All four have to read correctly in both "X is ___ Y" and "X was ___ Y", so
   they are noun phrases throughout - a verb phrase here produces "X is was
   raised alongside Y". */
HF.BONDS = ['kin to', 'the oldest friend of', 'a childhood companion of', 'in the debt of'];

/* Thoughts that fade, counted in days. Events leave a mark for a while and
   then stop mattering, which is what lets a paid levy feel like relief and a
   missed one like a shadow over the next few seasons. */
HF.MEMORIES = {
  levyPaid:     { label: 'The levy was paid',               delta: 8,   days: 10 },
  levyShort:    { label: 'The collectors took everything',  delta: -10, days: 14 },
  levyStripped: { label: 'The collectors stripped us bare', delta: -16, days: 18 },
  bondLost:     { label: 'Lost ',                           delta: -18, days: 26 },
  raidBroken:   { label: 'The raid was broken',             delta: 6,   days: 7 },
  buriedSomeone:{ label: 'A death in the village',          delta: -6,  days: 11 },
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
