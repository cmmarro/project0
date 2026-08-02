/* The game state and the turn engine.

   A turn resolves in a fixed order: the world grows, colonists act, raiders
   act, then events fire. Everything here is plain JSON-able data (ids, not
   object references) so a save is just JSON.stringify. */
window.HF = window.HF || {};

HF.Game = function (seed, scenarioId) {
  this.seed = seed >>> 0;
  this.rng = new HF.RNG(this.seed);
  this.scenarioId = HF.SCENARIOS[scenarioId] ? scenarioId : HF.DEFAULT_SCENARIO;

  const map = HF.Map.generate(this.rng, HF.CFG.MAP_W, HF.CFG.MAP_H);
  this.w = map.w;
  this.h = map.h;
  this.tiles = map.tiles;

  this.tick = HF.Time.TICKS_PER_HOUR * 7;   // the village wakes at seven
  this.nextId = 1;
  this.colonists = [];
  this.buildings = [];
  this.raiders = [];
  this.designations = {};
  // Every resource exists from the start, at zero, so nothing has to guard
  // against an undefined store halfway through a trade.
  this.res = { food: 0, wood: 0, stone: 0, hemp: 0, herb: 0, cloth: 0, med: 0 };
  Object.assign(this.res, HF.CFG.START_RES);
  this.entries = [];
  this.grief = 0;
  this.nextRaidDay = HF.CFG.RAID_START_DAY + (this.scenario().raidDelay || 0);
  this.nextMigrantDay = HF.CFG.MIGRANT_GAP;
  this.gameOver = null;
  this.endless = false;
  this.levyIndex = 0;          // how many levies have been collected
  this.levyFailures = 0;
  this.standing = HF.CFG.STANDING.start;
  this.levyGenerous = false;   // press surplus rice on the collectors for credit
  this.levyHistory = [];
  this.offer = null;           // the merchant's standing offer, if one is up
  this.nextMerchantDay = HF.CFG.MERCHANT.firstDay;
  this.tradesMade = 0;
  this.taughtTrade = false;   // the first offer is opened for the player, once
  this.banditsKilled = 0;
  this.dirtyTerrain = true;
  this.spoiledToday = false;
  this.spoilLogged = {};
  this.roomsDirty = true;
  this.indoors = null;
  this.recipes = {};          // which bench work the player has turned on

  const site = HF.Map.findStartSite(this, this.rng);
  this.startSite = site;
  const occupied = new Set();
  const spots = HF.Map.openTilesNear(this, site.x, site.y, 3, occupied);
  for (let i = 0; i < HF.CFG.START_COLONISTS; i++) {
    const s = spots[i % spots.length];
    occupied.add(HF.U.key(s.x, s.y));
    this.colonists.push(HF.Colonists.create(this, s.x, s.y));
  }

  for (const c of this.colonists) HF.Colonists.bind(this, c);

  this.log(this.scenario().levy
    ? 'Four peasants settle this valley. Four harvests, four levies - hold the village together.'
    : 'Four peasants settle this valley. Nobody is coming for the rice. Make of it what you like.',
    'season');
  for (const c of this.colonists) {
    this.log(c.name + ' ' + c.origin + '.', 'info');
  }
  if (this.scenario().levy) {
    this.log('The daimyo will send collectors after each harvest. Rice is not just food here.', 'levy');
  }
  HF.Events.announceSeason(this);
};

HF.Game.prototype = {

  /* ---------- calendar ----------
     Everything reads off the tick counter. `day` is the unit the schedules are
     written in; `turn` is gone, and with it the idea that time only moves when
     the player asks it to. */

  day: function () { return HF.Time.day(this.tick); },
  hour: function () { return HF.Time.hour(this.tick); },
  clock: function () { return HF.Time.clockString(this.tick); },
  light: function () { return HF.Time.light(this.tick); },
  isNight: function () { return HF.Time.isNight(this.tick); },

  seasonIndex: function () {
    return Math.floor(this.day() / HF.Time.DAYS_PER_SEASON) % 4;
  },
  season: function () {
    return HF.CFG.SEASONS[this.seasonIndex()];
  },
  year: function () {
    return Math.floor(this.day() / HF.Time.DAYS_PER_YEAR) + 1;
  },
  dayOfSeason: function () {
    return (this.day() % HF.Time.DAYS_PER_SEASON) + 1;
  },

  /* ---------- the levy ----------
     The daimyo's collectors come after each harvest. Rice is not just food:
     it is what the village owes, and a granary that looks comfortable in
     autumn can leave you starving through winter once they have been. */

  scenario: function () {
    return HF.SCENARIOS[this.scenarioId] || HF.SCENARIOS[HF.DEFAULT_SCENARIO];
  },

  levyDemand: function (index) {
    const L = HF.CFG.LEVY;
    let base = index < L.demands.length
      ? L.demands[index]
      : L.demands[L.demands.length - 1] + (index - L.demands.length + 1) * L.laterIncrease;
    // A village in favour is asked for less. Standing you built by overpaying
    // in a good year comes back to you in a bad one.
    if (this.standing >= HF.CFG.STANDING.favourAt) {
      base = Math.round(base * HF.CFG.STANDING.favourRelief);
    }
    return Math.max(1, Math.round(base * (this.scenario().levyScale || 1)));
  },

  nextLevyDay: function () {
    const L = HF.CFG.LEVY;
    if (this.levyIndex < L.days.length) return L.days[this.levyIndex];
    const beyond = this.levyIndex - L.days.length + 1;
    return L.days[L.days.length - 1] + beyond * HF.Time.DAYS_PER_YEAR;
  },

  daysToLevy: function () { return this.nextLevyDay() - this.day(); },

  /* How the castle describes the village, in words rather than a number. */
  standingWord: function () {
    const s = this.standing;
    if (s >= HF.CFG.STANDING.favourAt) return 'in favour';
    if (s >= 62) return 'in good order';
    if (s >= 40) return 'noted';
    if (s >= HF.CFG.STANDING.walkOutBelow) return 'in arrears';
    return 'close to ruin';
  },

  /* Called once on each day rollover, never mid-day. */
  checkLevy: function () {
    if (!this.scenario().levy) return;
    const S = HF.CFG.STANDING;
    const due = this.nextLevyDay();
    const demand = this.levyDemand(this.levyIndex);

    if (this.day() === due - HF.CFG.LEVY.warnAhead) {
      this.log('Word from the castle: the collectors come in ' + HF.CFG.LEVY.warnAhead +
               ' days for ' + demand + ' koku of rice.', 'levy');
    }
    if (this.day() < due) return;

    const have = Math.floor(this.res.food);
    const before = this.standing;

    if (have >= demand) {
      /* Paying is not all-or-nothing any more. Handing over more than the
         demand buys standing, which is the first reason the game has ever
         given to grow rice beyond the number on the chip - and the credit
         carries into a year when the harvest fails. */
      const spare = have - demand;
      const offered = Math.min(spare, S.overPer * S.overCap);
      const generous = this.levyGenerous ? offered : 0;
      this.res.food -= demand + generous;
      const bonus = S.payBonus + Math.floor(generous / S.overPer);
      this.standing = Math.min(S.max, this.standing + bonus);
      this.levyHistory.push({ year: this.year(), demand: demand, paid: true, extra: generous });
      this.log('The levy is paid in full - ' + demand + ' koku carried off to the castle' +
               (generous > 0 ? ', and ' + generous + ' more pressed on them for goodwill' : '') +
               '.', 'levy');
      this.grief = Math.max(0, this.grief - 4);
      HF.Colonists.rememberAll(this, 'levyPaid');
    } else {
      // The wound scales with how far short you fell, so 5 koku missing and 50
      // missing are no longer the same event.
      const short = demand - have;
      const shareMissed = short / demand;
      this.res.food = 0;
      this.standing = Math.max(0, this.standing - shareMissed * S.shortPenalty);
      this.levyFailures++;
      this.levyHistory.push({ year: this.year(), demand: demand, paid: false, short: short });

      if (shareMissed < 0.25) {
        this.log('The levy falls ' + short + ' koku short. The clerk writes the shortfall ' +
                 'down without comment.', 'bad');
        HF.Colonists.rememberAll(this, 'levyShort');
      } else {
        this.log('The levy falls ' + short + ' koku short of ' + demand +
                 '. The collectors strip the kura bare and take the name of the village.', 'bad');
        HF.Colonists.rememberAll(this, 'levyStripped');
      }

      // Only a village already in arrears starts losing people over it.
      if (this.standing < S.walkOutBelow) {
        const alive = this.aliveColonists();
        if (alive.length > 1) {
          const gone = this.rng.pick(alive);
          HF.Colonists.die(this, gone, ' has walked out rather than starve for the castle.', true);
        }
      }
    }

    this.log('The village stands ' + this.standingWord() + ' with the castle.',
             this.standing >= before ? 'levy' : 'bad');

    if (this.standing >= S.favourAt) {
      this.log('Word comes back that the village is well thought of. Next year\'s due is eased.',
               'good');
    }

    this.levyIndex++;

    if (this.standing <= 0) {
      this.gameOver = 'dissolved';
      this.log('The castle has run out of patience. The village is broken up and its people ' +
               'scattered across the province.', 'bad');
    }
  },

  /* ---------- lookups ---------- */

  buildingAt: function (x, y) {
    const t = HF.Map.at(this, x, y);
    if (!t || t.building == null) return null;
    return this.buildings[t.building] || null;
  },

  raiderById: function (id) {
    for (const r of this.raiders) if (r.id === id) return r;
    return null;
  },

  colonistById: function (id) {
    for (const c of this.colonists) if (c.id === id) return c;
    return null;
  },

  colonistAt: function (x, y) {
    for (const c of this.colonists) if (!c.dead && c.x === x && c.y === y) return c;
    return null;
  },

  aliveColonists: function () {
    return this.colonists.filter(function (c) { return !c.dead; });
  },

  builtCount: function (type) {
    let n = 0;
    for (const b of this.buildings) if (b && b.built && b.type === type) n++;
    return n;
  },

  colonyCentre: function () {
    const alive = this.aliveColonists();
    if (alive.length === 0) return this.startSite;
    let sx = 0, sy = 0;
    for (const c of alive) { sx += c.x; sy += c.y; }
    return { x: Math.round(sx / alive.length), y: Math.round(sy / alive.length) };
  },

  /* ---------- resources ---------- */

  addResource: function (r, n) {
    const cap = HF.Build.storageCap(this);
    const before = this.res[r];
    this.res[r] = HF.U.clamp(before + n, 0, cap);
    const lost = before + n - this.res[r];
    // Overflowing stores is worth saying, but it stays true for as long as the
    // player ignores it, and repeating the identical line every few turns
    // buries the levy warnings and the deaths. Say it, then hold off.
    this.spoilLogged = this.spoilLogged || {};
    if (lost > 0.5 && !this.spoiledToday && this.day() - (this.spoilLogged[r] || -99) >= 4) {
      this.spoiledToday = true;
      this.spoilLogged[r] = this.day();
      const res = HF.RESOURCES[r] || { label: r, unit: '' };
      this.log('Nowhere to put it - ' + Math.round(lost) + ' ' +
               (res.unit ? res.unit + ' of ' : '') + res.label.toLowerCase() +
               ' spoiled for want of a kura.', 'bad');
    }
  },

  /* ---------- work orders ---------- */

  designate: function (type, x, y) {
    const tile = HF.Map.at(this, x, y);
    if (!tile) return false;
    const key = HF.U.key(x, y);
    if (this.designations[key]) return false;
    if (tile.building != null) return false;
    if (!HF.ORDERS[type].valid(tile)) return false;
    this.designations[key] = {
      type: type, x: x, y: y, workDone: 0, claimedBy: null,
      work: HF.Map.workFor(this, type, x, y),
    };
    return true;
  },

  undesignate: function (x, y) {
    const key = HF.U.key(x, y);
    const d = this.designations[key];
    if (!d) return false;
    delete this.designations[key];
    for (const c of this.colonists) {
      if (c.task && c.task.targetType === 'designation' && c.task.targetKey === key) c.task = null;
    }
    return true;
  },

  claim: function (task, colonistId) {
    if (task.targetType === 'designation') {
      const d = this.designations[task.targetKey];
      if (d) d.claimedBy = colonistId;
    } else if (task.targetType === 'building' || task.targetType === 'station') {
      const b = this.buildings[task.targetKey];
      if (b) b.claimedBy = colonistId;
    }
  },

  releaseClaims: function (colonistId) {
    for (const k in this.designations) {
      if (this.designations[k].claimedBy === colonistId) this.designations[k].claimedBy = null;
    }
    for (const b of this.buildings) {
      if (b && b.claimedBy === colonistId) b.claimedBy = null;
    }
  },

  releaseClaimsOnBuilding: function (buildingId) {
    for (const c of this.colonists) {
      if (c.task && c.task.targetType === 'building' && c.task.targetKey === buildingId) c.task = null;
    }
  },

  /* ---------- log ---------- */

  log: function (message, kind) {
    this.entries.push({ day: this.day() + 1, message: message, kind: kind || 'info' });
    if (this.entries.length > 220) this.entries.splice(0, this.entries.length - 220);
  },

  /* ---------- the loop ----------

     One tick is a tenth of an in-game hour and it does the small, continuous
     things: people move, work, get hungry. The heavier bookkeeping - crops,
     regrowth, raids, the levy - happens once when the day rolls over, because
     doing it 240 times a day would be both slower and no different. */

  step: function () {
    if (this.gameOver) return;

    const before = this.tick;
    this.tick++;
    const rolled = HF.Time.day(this.tick) !== HF.Time.day(before);

    for (const c of this.colonists) {
      if (!c.dead) HF.Jobs.tick(this, c);
    }
    if (this.dirtyTerrain) HF.Build.settleBlueprints(this);

    // Raiders move on a coarser beat than villagers; they are a threat, not a
    // thing to admire, and stepping them every tick made them twitch.
    if ((this.tick % 3) === 0) {
      for (const r of this.raiders) HF.Events.raiderTurn(this, r);
      const had = this.raiders.length;
      const withdrew = this.raiders.filter(function (r) { return r.withdrew; }).length;
      const killed = this.raiders.filter(function (r) { return r.dead; }).length;
      if (withdrew > 0) {
        this.log(withdrew + ' bandit' + (withdrew > 1 ? 's' : '') + ' lost the trail and withdrew.',
                 'info');
      }
      this.raiders = this.raiders.filter(function (r) { return !r.dead && !r.withdrew; });
      if (had > 0 && this.raiders.length === 0 && killed > 0) {
        this.log('The raid is broken.', 'good');
        HF.Colonists.rememberAll(this, 'raidBroken');
      }
    }

    if (rolled) this.newDay();
  },

  newDay: function () {
    const seasonBefore = this.lastSeason;
    this.lastSeason = this.season();
    if (seasonBefore && this.lastSeason !== seasonBefore) HF.Events.announceSeason(this);

    this.spoiledToday = false;

    HF.Build.settleBlueprints(this);
    HF.Build.tickFarms(this);
    HF.Build.tickRegrowth(this);
    HF.Events.tick(this);

    // Purge orders that no longer make sense (the tree got chopped, the plant
    // was picked by someone else, a wall was built over the spot).
    for (const k in this.designations) {
      const d = this.designations[k];
      const tile = HF.Map.at(this, d.x, d.y);
      if (d.type === 'harvest') {
        const farm = this.buildingAt(d.x, d.y);
        if (!farm || !farm.built || farm.growth < HF.FARM.RIPE_AT) delete this.designations[k];
      } else if (!tile || !HF.ORDERS[d.type].valid(tile)) {
        delete this.designations[k];
      }
    }

    this.grief = Math.max(0, this.grief - 0.5);
    this.standing = Math.min(HF.CFG.STANDING.max, this.standing + HF.CFG.STANDING.recover);

    for (const c of this.aliveColonists()) HF.Colonists.newDay(this, c);

    this.checkLevy();

    if (this.aliveColonists().length === 0) {
      this.gameOver = 'lost';
      this.log('The last of the villagers is gone. The valley falls silent.', 'bad');
    } else if (!this.gameOver && !this.endless && this.scenario().levy &&
               this.day() >= HF.CFG.VICTORY_DAY && this.levyIndex >= HF.CFG.LEVY.days.length) {
      // A milestone, not a finish line. The village is the point, so this
      // stops once to mark four years survived and then gets out of the way.
      this.gameOver = 'won';
      this.log('Four years, four levies, and the village still stands.', 'good');
    }
  },

  /* Dismisses the victory screen and lets the village keep going, with the
     levies continuing to climb once a year. */
  continuePlaying: function () {
    if (this.gameOver !== 'won') return;
    this.gameOver = null;
    this.endless = true;
    this.log('The village carries on. The castle will send for rice again next autumn.', 'levy');
  },

  /* Numbers for the ending screen. */
  summary: function () {
    const built = this.buildings.filter(function (b) { return b && b.built; });
    const counts = {};
    for (const b of built) counts[b.type] = (counts[b.type] || 0) + 1;
    return {
      day: this.day() + 1,
      years: this.year(),
      alive: this.aliveColonists().length,
      lost: this.colonists.filter(function (c) { return c.dead && !c.departed; }).length,
      departed: this.colonists.filter(function (c) { return c.departed; }).length,
      rice: Math.floor(this.res.food),
      leviesPaid: this.levyHistory.filter(function (l) { return l.paid; }).length,
      leviesMissed: this.levyFailures,
      standing: Math.round(this.standing),
      standingWord: this.standingWord(),
      trades: this.tradesMade,
      bandits: this.banditsKilled,
      buildings: counts,
      built: built.length,
    };
  },

  /* ---------- persistence ---------- */

  serialize: function () {
    return JSON.stringify({
      v: 2,
      seed: this.seed, scenarioId: this.scenarioId, rngState: this.rng.s,
      w: this.w, h: this.h, tiles: this.tiles,
      tick: this.tick, nextId: this.nextId, lastSeason: this.lastSeason,
      colonists: this.colonists, buildings: this.buildings, raiders: this.raiders,
      designations: this.designations, res: this.res, entries: this.entries,
      grief: this.grief, nextRaidDay: this.nextRaidDay,
      nextMigrantDay: this.nextMigrantDay, gameOver: this.gameOver,
      recipes: this.recipes,
      endless: this.endless, levyIndex: this.levyIndex,
      levyFailures: this.levyFailures, standing: this.standing,
      levyGenerous: this.levyGenerous, levyHistory: this.levyHistory,
      offer: this.offer, nextMerchantDay: this.nextMerchantDay,
      tradesMade: this.tradesMade, taughtTrade: this.taughtTrade,
      banditsKilled: this.banditsKilled, startSite: this.startSite,
      spoilLogged: this.spoilLogged,
    });
  },
};

HF.Game.load = function (json) {
  const d = JSON.parse(json);
  const g = Object.create(HF.Game.prototype);
  Object.assign(g, d);
  g.rng = new HF.RNG(d.seed);
  g.rng.s = d.rngState >>> 0;
  g.dirtyTerrain = true;
  g.spoiledToday = false;
  g.roomsDirty = true;
  g.indoors = null;
  g.recipes = d.recipes || {};
  g.spoilLogged = d.spoilLogged || {};
  if (g.standing == null) g.standing = HF.CFG.STANDING.start;
  if (!HF.SCENARIOS[g.scenarioId]) g.scenarioId = HF.DEFAULT_SCENARIO;
  return g;
};
