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

  GRIEF_CAP: 12,           // ceiling on the village-wide mourning thought

  RAID_START_TURN: 42,
  RAID_MIN_GAP: 24,
  RAID_MAX_GAP: 38,
  MIGRANT_GAP: 26,

  /* The spine of the game. The daimyo's collectors come after each harvest,
     before winter, and they do not care whether you can spare it.

     Four years rather than three, and the first year is a remission year: newly
     opened land was commonly taxed lightly, and it gives the player a full year
     to learn what a levy even is before one can hurt them. The demand then
     roughly doubles each autumn, so the difficulty arrives as a ramp instead of
     a wall. */
  LEVY: {
    turns: [40, 80, 120, 160],
    demands: [18, 55, 100, 155],
    laterIncrease: 60,      // per year beyond the fourth
    warnAhead: 10,
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

  VICTORY_TURN: 160,        // end of the fourth year

  /* Merchants come up the valley with a single offer, take it or leave it.
     This is the freedom valve: it is what makes a timber village or a fishing
     village viable when the castle only ever asks for rice. */
  MERCHANT: { firstTurn: 14, gap: [10, 16], standFor: 4 },

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

/* What the player calls each resource. */
HF.RESOURCES = {
  food:  { label: 'Rice',   unit: 'koku', color: '#d8c26a' },
  wood:  { label: 'Timber', unit: '',     color: '#c69a63' },
  stone: { label: 'Stone',  unit: '',     color: '#a8b0bb' },
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
    id: 'forage', label: 'Gather Chestnuts', verb: 'Gathering', key: 'F', work: 6, workType: 'farm',
    color: '#c9738a',
    valid: function (t) { return t.feature === 'chestnut'; },
    hint: 'Gather chestnuts for the stores. They ripen again, but never in winter.',
  },
  fish: {
    id: 'fish', label: 'Set Fish Traps', verb: 'Fishing', key: 'T', work: 13, workType: 'farm',
    color: '#6fb3c9',
    valid: function (t) { return t.feature === 'fish'; },
    hint: 'Trap fish from the bank. Steady food that owes nothing to the paddies - ' +
          'a river valley can eat while the rice goes to the castle.',
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
    on: ['grass', 'marsh', 'moor'],
    desc: 'Floods, ripens, and asks to be harvested. Ripens half again as fast on reed marsh, ' +
          'and slowly on dry moor - where you put it matters more than how many you have.',
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

HF.FARM = {
  RIPE_AT: 20,
  YIELD: 13,
  GROWTH: { Spring: 1.0, Summer: 1.4, Autumn: 0.8, Winter: 0 },
  /* Where a paddy sits is a real decision: wet ground is worth walking to. */
  SOIL: { marsh: 1.5, grass: 1.0, moor: 0.6 },
};

HF.YIELDS = {
  chop:    { wood: 12 },
  mine:    { stone: 10 },
  forage:  { food: 8 },
  fish:    { food: 7 },
  harvest: { food: HF.FARM.YIELD },
};

/* How long a stripped tile takes to come back, and as what. Bamboo is the
   point of the pair: it yields less per cut than pine but returns inside a
   year, so a bamboo valley can be logged over and over. */
HF.REGROW = {
  forest: { turns: [55, 85], yieldScale: 1 },
  bamboo: { turns: [16, 26], yieldScale: 0.6 },
  chestnut: { turns: [22, 34] },
  fish: { turns: [20, 32] },
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
  'lost a husband to a lord’s quarrel and never learned which one',
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
  steady:     { label: 'Steady',    note: 'Hardship lands lighter than it does on others.' },
  sullen:     { label: 'Sullen',    note: 'Takes everything harder than it is.' },
  devout:     { label: 'Devout',    note: 'Finds meaning where others find only work.' },
  homesick:   { label: 'Homesick',  note: 'This is not home yet. A village of five buildings might be.' },
  tough:      { label: 'Tough',     note: 'Harder to kill than they look.' },
  diligent:   { label: 'Diligent',  note: 'Works faster at everything, and always has.' },
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

/* Thoughts that fade. Events leave a mark for a while and then stop mattering,
   which is what lets a paid levy feel like relief and a missed one like a
   shadow over the next few seasons. */
HF.MEMORIES = {
  levyPaid:    { label: 'The levy was paid',            delta: 8,   turns: 12 },
  levyShort:   { label: 'The collectors took everything', delta: -10, turns: 15 },
  levyStripped:{ label: 'The collectors stripped us bare', delta: -16, turns: 20 },
  bondLost:    { label: 'Lost ',                        delta: -18, turns: 30 },
  raidBroken:  { label: 'The raid was broken',          delta: 6,   turns: 8 },
  buriedSomeone:{ label: 'A death in the village',      delta: -6,  turns: 12 },
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
