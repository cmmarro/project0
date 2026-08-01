/* The game state and the turn engine.

   A turn resolves in a fixed order: the world grows, colonists act, raiders
   act, then events fire. Everything here is plain JSON-able data (ids, not
   object references) so a save is just JSON.stringify. */
window.HF = window.HF || {};

HF.Game = function (seed) {
  this.seed = seed >>> 0;
  this.rng = new HF.RNG(this.seed);

  const map = HF.Map.generate(this.rng, HF.CFG.MAP_W, HF.CFG.MAP_H);
  this.w = map.w;
  this.h = map.h;
  this.tiles = map.tiles;

  this.turn = 1;
  this.nextId = 1;
  this.colonists = [];
  this.buildings = [];
  this.raiders = [];
  this.designations = {};
  this.res = Object.assign({}, HF.CFG.START_RES);
  this.entries = [];
  this.grief = 0;
  this.nextRaidTurn = HF.CFG.RAID_START_TURN;
  this.nextMigrantTurn = HF.CFG.MIGRANT_GAP;
  this.gameOver = null;
  this.endless = false;
  this.levyIndex = 0;          // how many levies have been collected
  this.levyFailures = 0;
  this.levyStrikes = 0;
  this.levyHistory = [];
  this.banditsKilled = 0;
  this.dirtyTerrain = true;
  this.spoiledThisTurn = false;

  const site = HF.Map.findStartSite(this, this.rng);
  this.startSite = site;
  const occupied = new Set();
  const spots = HF.Map.openTilesNear(this, site.x, site.y, 3, occupied);
  for (let i = 0; i < HF.CFG.START_COLONISTS; i++) {
    const s = spots[i % spots.length];
    occupied.add(HF.U.key(s.x, s.y));
    this.colonists.push(HF.Colonists.create(this, s.x, s.y));
  }

  this.log('Four peasants settle this valley. Three harvests, three levies - hold the village together.',
           'season');
  this.log('The daimyo will send collectors after each harvest. Rice is not just food here.', 'levy');
  HF.Events.announceSeason(this);
};

HF.Game.prototype = {

  /* ---------- calendar ---------- */

  seasonIndex: function () {
    return Math.floor((this.turn - 1) / HF.CFG.TURNS_PER_SEASON) % 4;
  },
  season: function () {
    return HF.CFG.SEASONS[this.seasonIndex()];
  },
  year: function () {
    return Math.floor((this.turn - 1) / (HF.CFG.TURNS_PER_SEASON * 4)) + 1;
  },
  dayOfSeason: function () {
    return ((this.turn - 1) % HF.CFG.TURNS_PER_SEASON) + 1;
  },

  /* ---------- the levy ----------
     The daimyo's collectors come after each harvest. Rice is not just food:
     it is what the village owes, and a granary that looks comfortable in
     autumn can leave you starving through winter once they have been. */

  levyDemand: function (index) {
    const L = HF.CFG.LEVY;
    if (index < L.demands.length) return L.demands[index];
    return L.demands[L.demands.length - 1] + (index - L.demands.length + 1) * L.laterIncrease;
  },

  nextLevyTurn: function () {
    const L = HF.CFG.LEVY;
    if (this.levyIndex < L.turns.length) return L.turns[this.levyIndex];
    const beyond = this.levyIndex - L.turns.length + 1;
    return L.turns[L.turns.length - 1] + beyond * HF.CFG.TURNS_PER_SEASON * 4;
  },

  turnsToLevy: function () { return this.nextLevyTurn() - this.turn; },

  checkLevy: function () {
    const due = this.nextLevyTurn();
    const demand = this.levyDemand(this.levyIndex);

    if (this.turn === due - HF.CFG.LEVY.warnAhead) {
      this.log('Word from the castle: the collectors come in ' + HF.CFG.LEVY.warnAhead +
               ' turns for ' + demand + ' koku of rice.', 'levy');
    }
    if (this.turn < due) return;

    const have = Math.floor(this.res.food);

    if (have >= demand) {
      this.res.food -= demand;
      this.levyHistory.push({ year: this.year(), demand: demand, paid: true });
      this.log('The levy is paid in full - ' + demand + ' koku carried off to the castle.', 'levy');
      this.grief = Math.max(0, this.grief - 4);
      for (const c of this.aliveColonists()) c.mood = HF.U.clamp(c.mood + 7, 0, 100);
    } else {
      const short = demand - have;
      this.res.food = 0;

      // A near miss is a warning, not a strike. Without this band one bad
      // harvest zeroes the granary and takes a villager, and the village can
      // never climb back - the game would be decided turns before it ended.
      const tolerated = have >= demand * HF.CFG.LEVY.tolerance;
      this.levyHistory.push({
        year: this.year(), demand: demand, paid: false, short: short, tolerated: tolerated,
      });

      this.levyFailures++;
      const L = HF.CFG.LEVY;
      const left = L.strikesAllowed + 1 - this.levyStrikes;

      if (tolerated) {
        this.levyStrikes += L.strikeNear;
        this.grief += 5;
        this.log('The levy falls ' + short + ' koku short. The collectors take everything and ' +
                 'note the shortfall against the village.', 'bad');
      } else {
        this.levyStrikes += L.strikeBad;
        this.grief += 10;
        this.log('The levy falls ' + short + ' koku short - far short. The collectors strip the ' +
                 'granary bare.', 'bad');
        const alive = this.aliveColonists();
        if (alive.length > 1 && this.levyStrikes <= L.strikesAllowed) {
          const gone = this.rng.pick(alive);
          gone.dead = true;
          gone.departed = true;
          this.releaseClaims(gone.id);
          this.log(gone.name + ' has walked out rather than starve for the castle.', 'bad');
        }
      }
      if (this.levyStrikes <= L.strikesAllowed && left > 0) {
        this.log('The village stands, but only just. Another year like this ends it.', 'levy');
      }
    }

    this.levyIndex++;

    if (this.levyStrikes > HF.CFG.LEVY.strikesAllowed) {
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
    if (lost > 0.5 && !this.spoiledThisTurn) {
      this.spoiledThisTurn = true;
      this.log('Storage is full - ' + Math.round(lost) + ' ' + r + ' went to waste.', 'bad');
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
    this.designations[key] = { type: type, x: x, y: y, workDone: 0, claimedBy: null };
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
    } else if (task.targetType === 'building') {
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
    this.entries.push({ turn: this.turn, message: message, kind: kind || 'info' });
    if (this.entries.length > 220) this.entries.splice(0, this.entries.length - 220);
  },

  /* ---------- the turn ---------- */

  endTurn: function () {
    if (this.gameOver) return;

    const seasonBefore = this.season();
    this.turn++;
    this.spoiledThisTurn = false;

    if (this.season() !== seasonBefore) HF.Events.announceSeason(this);

    HF.Build.tickFarms(this);
    HF.Build.tickRegrowth(this);

    for (const c of this.colonists) {
      if (!c.dead) HF.Jobs.takeTurn(this, c);
    }

    for (const r of this.raiders) HF.Events.raiderTurn(this, r);
    const before = this.raiders.length;
    const withdrew = this.raiders.filter(function (r) { return r.withdrew; }).length;
    const killed = this.raiders.filter(function (r) { return r.dead; }).length;
    if (withdrew > 0) {
      this.log(withdrew + ' raider' + (withdrew > 1 ? 's' : '') + ' lost the trail and withdrew.', 'info');
    }
    this.raiders = this.raiders.filter(function (r) { return !r.dead && !r.withdrew; });
    if (before > 0 && this.raiders.length === 0 && killed > 0) this.log('The raid is broken.', 'good');

    HF.Events.tick(this);

    // Purge orders that no longer make sense (the tree got chopped, the bush
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

    this.checkLevy();

    if (this.aliveColonists().length === 0) {
      this.gameOver = 'lost';
      this.log('The last of the villagers is gone. The valley falls silent.', 'bad');
    } else if (!this.gameOver && !this.endless &&
               this.turn >= HF.CFG.VICTORY_TURN && this.levyIndex >= HF.CFG.LEVY.turns.length) {
      this.gameOver = 'won';
      this.log('Three years, three levies, and the village still stands.', 'good');
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
      turn: this.turn,
      years: this.year(),
      alive: this.aliveColonists().length,
      lost: this.colonists.filter(function (c) { return c.dead && !c.departed; }).length,
      departed: this.colonists.filter(function (c) { return c.departed; }).length,
      rice: Math.floor(this.res.food),
      leviesPaid: this.levyHistory.filter(function (l) { return l.paid; }).length,
      leviesMissed: this.levyFailures,
      bandits: this.banditsKilled,
      buildings: counts,
      built: built.length,
    };
  },

  /* ---------- persistence ---------- */

  serialize: function () {
    return JSON.stringify({
      v: 1,
      seed: this.seed, rngState: this.rng.s,
      w: this.w, h: this.h, tiles: this.tiles,
      turn: this.turn, nextId: this.nextId,
      colonists: this.colonists, buildings: this.buildings, raiders: this.raiders,
      designations: this.designations, res: this.res, entries: this.entries,
      grief: this.grief, nextRaidTurn: this.nextRaidTurn,
      nextMigrantTurn: this.nextMigrantTurn, gameOver: this.gameOver,
      endless: this.endless, levyIndex: this.levyIndex,
      levyFailures: this.levyFailures, levyStrikes: this.levyStrikes,
      levyHistory: this.levyHistory,
      banditsKilled: this.banditsKilled, startSite: this.startSite,
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
  g.spoiledThisTurn = false;
  return g;
};
