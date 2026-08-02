/* What each colonist decides to do on a turn, and what happens when they do it.

   Priority order is fixed: survive (eat, sleep), defend, then work. Which work
   they will accept is up to the player's per-colonist toggles; which job they
   pick from that set is nearest-first. */
window.HF = window.HF || {};

HF.Jobs = {
  /* ---------- job descriptors ---------- */

  standsFor: function (game, task) {
    if (task.targetType === 'designation') {
      return HF.Map.workStands(game, task.tx, task.ty, false);
    }
    if (task.targetType === 'building' || task.targetType === 'station') {
      const b = game.buildings[task.targetKey];
      if (!b) return [];
      return HF.Map.workStands(game, b.x, b.y, !!HF.BUILDINGS[b.type].adjacentWork);
    }
    return [{ x: task.tx, y: task.ty }];
  },

  taskStillValid: function (game, c, task) {
    if (!task) return false;
    if (task.targetType === 'designation') {
      const d = game.designations[task.targetKey];
      return !!d && (d.claimedBy === c.id || d.claimedBy == null);
    }
    if (task.targetType === 'building') {
      const b = game.buildings[task.targetKey];
      if (!b || b.cancelled) return false;
      return b.deconstruct ? true : !b.built;
    }
    if (task.targetType === 'station') {
      const b = game.buildings[task.targetKey];
      return !!b && b.built && !!HF.RECIPES[game.recipes[b.id]];
    }
    if (task.targetType === 'raider') {
      const r = game.raiderById(task.targetKey);
      return !!r && !r.dead;
    }
    return true;
  },

  workTypeOf: function (game, task) {
    if (task.targetType === 'designation') {
      const d = game.designations[task.targetKey];
      return d ? HF.ORDERS[d.type].workType : null;
    }
    if (task.targetType === 'building') return 'build';
    return null;
  },

  skillFor: function (workTypeId) {
    const wt = HF.WORK_TYPES.find(function (w) { return w.id === workTypeId; });
    return wt ? wt.skill : 'construction';
  },

  /* ---------- choosing work ---------- */

  findWork: function (game, c) {
    const candidates = [];

    for (const key in game.designations) {
      const d = game.designations[key];
      if (d.claimedBy != null && d.claimedBy !== c.id) continue;
      const order = HF.ORDERS[d.type];
      if (!c.work[order.workType]) continue;
      candidates.push({
        targetType: 'designation', targetKey: key, tx: d.x, ty: d.y,
        skill: order.workType,
        d: HF.U.dist(c.x, c.y, d.x, d.y),
      });
    }

    if (c.work.build) {
      for (const b of game.buildings) {
        if (!b || b.cancelled) continue;
        if (b.claimedBy != null && b.claimedBy !== c.id) continue;
        if (b.built && !b.deconstruct) continue;
        // A blueprint the stores cannot cover waits instead of blocking the
        // builder, so drawing a whole house at once is a plan rather than a
        // jam. It gets picked up the moment the timber lands.
        if (!b.built && !HF.Build.affordable(game, b.type)) continue;
        candidates.push({
          targetType: 'building', targetKey: b.id, tx: b.x, ty: b.y,
          skill: 'build',
          d: HF.U.dist(c.x, c.y, b.x, b.y),
        });
      }
    }

    // A bench with work set on it is a job like any other. It used to be tried
    // only when nothing else was going, which meant a village with any standing
    // orders never wove a thread.
    for (const b of game.buildings) {
      if (!b || !b.built) continue;
      const def = HF.BUILDINGS[b.type];
      if (!def.station) continue;
      if (b.claimedBy != null && b.claimedBy !== c.id) continue;
      const recipe = HF.RECIPES[game.recipes[b.id]];
      if (!recipe) continue;
      if (!c.work[recipe.skill === 'construction' ? 'build' : 'farm']) continue;
      let can = true;
      for (const r in recipe.cost) if (game.res[r] < recipe.cost[r]) can = false;
      if (!can) continue;
      candidates.push({
        targetType: 'station', targetKey: b.id, tx: b.x, ty: b.y,
        skill: recipe.skill === 'construction' ? 'build' : 'farm',
        d: HF.U.dist(c.x, c.y, b.x, b.y),
      });
    }

    if (candidates.length === 0) return null;

    // Nearest first, with a nudge towards jobs this colonist is good at so the
    // carpenter tends to drift to the building site.
    candidates.sort(function (a, b) {
      const sa = a.d - HF.Colonists.skillLevel(c, HF.Jobs.skillFor(a.skill)) * 0.9;
      const sb = b.d - HF.Colonists.skillLevel(c, HF.Jobs.skillFor(b.skill)) * 0.9;
      return sa - sb;
    });

    // Pathfinding is the expensive part, so only test the closest handful.
    for (let i = 0; i < Math.min(candidates.length, 14); i++) {
      const cand = candidates[i];
      const task = {
        kind: 'work',
        targetType: cand.targetType,
        targetKey: cand.targetKey,
        tx: cand.tx, ty: cand.ty,
        path: null,
      };
      const stands = HF.Jobs.standsFor(game, task);
      if (stands.length === 0) continue;
      const path = HF.Path.find(game, c.x, c.y, stands);
      if (path === null) continue;
      task.path = path;
      game.claim(task, c.id);
      return task;
    }
    return null;
  },

  /* Villagers go to bed at night, not merely when the bar bottoms out. That is
     the whole point of having a clock: the village should empty at dusk and
     fill again at dawn, rather than people dropping wherever exhaustion
     happens to catch them. They will still work through the night if they are
     wide awake, and still collapse in the afternoon if they are wrecked. */
  wantsBed: function (game, c) {
    if (c.needs.rest < HF.CFG.SLEEP_THRESHOLD) return true;
    return HF.Time.isSleepTime(game.tick) && c.needs.rest < 78;
  },

  nearestRaider: function (game, c, radius) {
    let best = null, bestD = Infinity;
    for (const r of game.raiders) {
      if (r.dead) continue;
      const d = HF.U.dist(c.x, c.y, r.x, r.y);
      if (d <= radius && d < bestD) { bestD = d; best = r; }
    }
    return best;
  },

  /* ---------- the per-colonist turn ---------- */

  tick: function (game, c) {
    if (c.dead) return;

    HF.Colonists.decayNeeds(game, c);
    // Mood is a sum over a dozen conditions and a flood fill or two; running it
    // every tick for every villager is the single most expensive thing in the
    // loop and nothing about it changes in a tenth of an hour.
    if ((game.tick + c.id) % 10 === 0) HF.Colonists.updateMood(game, c);

    // Waking up takes priority over everything: a colonist at full rest gets up.
    if (c.asleep) {
      /* Rested and it is morning, or the morning is over regardless.

         Without that second clause anyone sleeping rough never gets up: the
         bare ground restores less per night than a day costs, so they can
         never reach the wake threshold and simply lie there until noon. You
         can have a bad night here; you cannot spend the day in bed. */
      const rested = c.needs.rest >= HF.CFG.WAKE_AT;
      const morning = !HF.Time.isSleepTime(game.tick);
      const lateEnough = game.hour() >= 8;
      if ((morning && (rested || lateEnough)) || c.needs.rest >= 99.5 ||
          HF.Jobs.nearestRaider(game, c, 4)) {
        c.asleep = false;
        c.task = null;
      } else {
        c.activity = 'Sleeping';
        HF.Colonists.applyHealth(game, c);
        return;
      }
    }

    if (c.breakdown > 0) {
      c.breakdown--;      // counted in ticks
      game.releaseClaims(c.id);
      c.task = null;
      c.activity = 'Wandering (low mood)';
      HF.Jobs.wander(game, c);
      HF.Colonists.applyHealth(game, c);
      return;
    }

    // Eating is instantaneous - food is a shared stockpile, not a hauled item.
    if (c.needs.food < HF.CFG.EAT_THRESHOLD && game.res.food >= HF.CFG.MEAL_FOOD) {
      game.res.food -= HF.CFG.MEAL_FOOD;
      c.needs.food = HF.U.clamp(c.needs.food + HF.CFG.MEAL_RESTORE, 0, 100);
      c.activity = 'Eating';
      HF.Colonists.applyHealth(game, c);
      return;
    }

    const threat = HF.Jobs.nearestRaider(game, c, 7);
    if (threat) {
      game.releaseClaims(c.id);
      c.task = { kind: 'fight', targetType: 'raider', targetKey: threat.id, tx: threat.x, ty: threat.y, path: null };
    } else if (HF.Jobs.wantsBed(game, c) && (!c.task || c.task.kind !== 'sleep')) {
      game.releaseClaims(c.id);
      const bed = HF.Colonists.freeBed(game, c);
      c.task = bed
        ? { kind: 'sleep', targetType: 'bed', targetKey: bed.id, tx: bed.x, ty: bed.y, path: null }
        : { kind: 'sleep', targetType: null, targetKey: null, tx: c.x, ty: c.y, path: [] };
    }

    if (!HF.Jobs.taskStillValid(game, c, c.task)) {
      game.releaseClaims(c.id);
      c.task = null;
    }

    if (!c.task) {
      c.task = HF.Jobs.findWork(game, c);
      if (!c.task) {
        c.activity = HF.Jobs.idling(game, c);
        HF.Jobs.wander(game, c);
        HF.Colonists.applyHealth(game, c);
        return;
      }
    }

    HF.Jobs.execute(game, c, c.task);
    HF.Colonists.applyHealth(game, c);
  },

  execute: function (game, c, task) {
    if (task.kind === 'fight') {
      const r = game.raiderById(task.targetKey);
      if (!r || r.dead) { c.task = null; return; }
      if (HF.U.dist(c.x, c.y, r.x, r.y) <= 1) {
        HF.Colonists.attack(game, c, r);
        return;
      }
      task.path = HF.Path.find(game, c.x, c.y, [{ x: r.x, y: r.y }]);
      c.activity = 'Closing on a raider';
      if (task.path === null || task.path.length === 0) { c.task = null; return; }
      task.path.pop();                 // stop next to the raider, not on it
      HF.Jobs.move(game, c, task);
      return;
    }

    if (task.kind === 'sleep') {
      if (task.targetType === 'bed') {
        const bed = game.buildings[task.targetKey];
        if (!bed || !bed.built) { c.task = null; return; }
        if (c.x === bed.x && c.y === bed.y) { c.asleep = true; c.activity = 'Sleeping'; return; }
        if (!task.path || task.path.length === 0) {
          task.path = HF.Path.find(game, c.x, c.y, [{ x: bed.x, y: bed.y }]);
        }
        c.activity = 'Heading to bed';
        if (task.path === null) { c.task = null; c.asleep = true; return; }
        HF.Jobs.move(game, c, task);
        if (c.x === bed.x && c.y === bed.y) { c.asleep = true; c.activity = 'Sleeping'; }
      } else {
        c.asleep = true;
        c.activity = 'Sleeping rough';
      }
      return;
    }

    // Regular work: walk to a stand tile, then put turns into the job.
    const stands = HF.Jobs.standsFor(game, task);
    if (stands.length === 0) { game.releaseClaims(c.id); c.task = null; return; }

    const atStand = stands.some(function (s) { return s.x === c.x && s.y === c.y; });
    if (!atStand) {
      if (!task.path || task.path.length === 0) {
        task.path = HF.Path.find(game, c.x, c.y, stands);
      }
      if (task.path === null) { game.releaseClaims(c.id); c.task = null; c.activity = 'Idle'; return; }
      c.activity = HF.Jobs.describe(game, task, true);
      HF.Jobs.move(game, c, task);
      const arrived = stands.some(function (s) { return s.x === c.x && s.y === c.y; });
      if (!arrived) return;
    }

    c.activity = HF.Jobs.describe(game, task, false);
    HF.Jobs.applyWork(game, c, task);
  },

  describe: function (game, task, travelling) {
    let what = 'Work';
    if (task.targetType === 'designation') {
      const d = game.designations[task.targetKey];
      if (d) what = HF.ORDERS[d.type].verb;
    } else if (task.targetType === 'building') {
      const b = game.buildings[task.targetKey];
      if (b && b.deconstruct) what = 'Pulling down the ' + HF.BUILDINGS[b.type].label.toLowerCase();
      else what = b ? 'Building ' + HF.BUILDINGS[b.type].label.toLowerCase() : 'Building';
    } else if (task.targetType === 'station') {
      const b = game.buildings[task.targetKey];
      const recipe = b && HF.RECIPES[game.recipes[b.id]];
      what = recipe ? recipe.label : 'At the bench';
    }
    return travelling ? 'Walking to ' + what.toLowerCase() : what;
  },

  /* Movement is one tile at a time and takes several ticks to cross, which is
     what turns a teleporting counter into somebody walking. The logical
     position is the tile being moved *to*; `from` and `stepT` are only for the
     renderer to interpolate between, so the simulation stays on the grid and
     the pathfinder never has to think in fractions. */
  stepTo: function (game, c, nx, ny) {
    const diagonal = nx !== c.x && ny !== c.y;
    const cost = HF.Map.moveCost(game, nx, ny) * (diagonal ? 1.4 : 1);
    c.fromX = c.x; c.fromY = c.y;
    c.x = nx; c.y = ny;
    c.stepT = 0;
    c.stepLen = Math.max(1, Math.round(HF.CFG.TICKS_PER_TILE * cost));
  },

  /* True once the villager has finished crossing into the tile they are on. */
  settled: function (c) {
    return !c.stepLen || c.stepT >= c.stepLen;
  },

  advance: function (c) {
    if (c.stepLen && c.stepT < c.stepLen) c.stepT++;
  },

  move: function (game, c, task) {
    HF.Jobs.advance(c);
    if (!HF.Jobs.settled(c)) return;          // still crossing the last tile
    if (!task.path || task.path.length === 0) return;

    const next = task.path[0];
    if (!HF.Map.passable(game, next.x, next.y)) { task.path = null; return; }
    HF.Jobs.stepTo(game, c, next.x, next.y);
    task.path.shift();
  },

  wander: function (game, c) {
    HF.Jobs.advance(c);
    if (!HF.Jobs.settled(c)) return;
    if (!game.rng.chance(0.06)) return;
    const d = game.rng.pick(HF.U.NEIGHBORS);
    if (HF.Map.passable(game, c.x + d[0], c.y + d[1])) {
      HF.Jobs.stepTo(game, c, c.x + d[0], c.y + d[1]);
    }
  },

  applyWork: function (game, c, task) {
    if (task.targetType === 'station') return HF.Jobs.applyCraft(game, c, task);

    const workType = HF.Jobs.workTypeOf(game, task);
    const skill = HF.Jobs.skillFor(workType);
    const amount = HF.Colonists.workRate(c, skill) * HF.CFG.WORK_PER_TICK;
    HF.Colonists.gainXp(game, c, skill, amount);

    if (task.targetType === 'designation') {
      const d = game.designations[task.targetKey];
      if (!d) { c.task = null; return; }
      d.workDone += amount;
      if (d.workDone >= HF.ORDERS[d.type].work) HF.Jobs.completeDesignation(game, c, d);
    } else if (task.targetType === 'building') {
      const b = game.buildings[task.targetKey];
      if (!b) { c.task = null; return; }
      b.workDone += amount;
      if (b.deconstruct) {
        if (b.workDone >= HF.Build.deconstructWork(b.type)) {
          HF.Build.remove(game, b.x, b.y);
          c.task = null;
        }
      } else if (b.workDone >= HF.BUILDINGS[b.type].work) {
        HF.Jobs.completeBuilding(game, c, b);
      }
    }
  },

  /* Working a bench. Materials are only taken when the batch finishes, so a
     villager who is pulled off the job halfway does not quietly eat the hemp. */
  applyCraft: function (game, c, task) {
    const b = game.buildings[task.targetKey];
    const recipeId = b && game.recipes[b.id];
    const recipe = recipeId && HF.RECIPES[recipeId];
    if (!recipe) { if (b) b.claimedBy = null; c.task = null; return; }

    for (const r in recipe.cost) {
      if (game.res[r] < recipe.cost[r]) { b.claimedBy = null; c.task = null; return; }
    }

    const amount = HF.Colonists.workRate(c, recipe.skill) * HF.CFG.WORK_PER_TICK;
    HF.Colonists.gainXp(game, c, recipe.skill, amount);
    b.craftDone = (b.craftDone || 0) + amount;
    c.activity = recipe.label;

    if (b.craftDone >= recipe.work) {
      b.craftDone = 0;
      for (const r in recipe.cost) game.res[r] -= recipe.cost[r];
      for (const r in recipe.yields) game.addResource(r, recipe.yields[r]);
      b.claimedBy = null;
      c.task = null;
    }
  },

  /* What somebody with nothing to do is doing.

     Pure flavour - it changes nothing and is not simulated anywhere. But a
     roster of four people all reading "Idle" is four blanks, and the same four
     reading "sitting at the shrine" and "watching the river" is a village.
     Keyed off what is actually around them so it never contradicts the map. */
  idling: function (game, c) {
    const near = function (pred, r) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const t = HF.Map.at(game, c.x + dx, c.y + dy);
          if (t && pred(t)) return true;
        }
      }
      return false;
    };

    const options = ['Sitting a while', 'Mending something', 'Talking'];
    if (near(function (t) { return t.feature === 'shrine'; }, 3)) options.push('At the shrine');
    if (near(function (t) { return t.terrain === 'water'; }, 2)) options.push('Watching the river');
    if (near(function (t) { return t.building != null; }, 2)) options.push('Round the houses');
    if (game.season() === 'Winter') options.push('Keeping out of the cold', 'Close to the fire');
    if (game.season() === 'Spring') options.push('Looking over the paddies');
    if (game.season() === 'Summer') options.push('Out of the sun');
    if (game.season() === 'Autumn') options.push('Counting what is in the kura');
    if (c.trait === 'devout') options.push('Saying something under their breath');
    if (c.trait === 'diligent') options.push('Looking for something to do');

    // Stable per villager per turn rather than flickering every repaint.
    return options[(c.id * 7 + Math.floor(game.tick / 40)) % options.length];
  },

  completeDesignation: function (game, c, d) {
    const tile = HF.Map.at(game, d.x, d.y);
    const yields = HF.YIELDS[d.type] || {};
    let scale = 1;

    if (d.type === 'chop') {
      // Remember what stood here, so bamboo grows back as bamboo and on its own
      // much shorter clock. That difference is the whole reason both exist.
      const was = tile.terrain;
      const spec = HF.REGROW[was] || HF.REGROW.forest;
      scale = spec.yieldScale;
      tile.terrain = 'grass';
      tile.regrowTo = was;
      tile.regrow = game.day() + game.rng.int(spec.regrow[0], spec.regrow[1]);
    } else if (d.type === 'mine') {
      tile.terrain = tile.terrain === 'mountain' ? 'hill' : 'grass';
    } else if (d.type === 'forage' || d.type === 'fish') {
      const plant = HF.PLANTS[tile.feature];
      if (plant) {
        for (const r in plant.yields) {
          // Out of season it is still there to pick; it is just barely worth it.
          const inSeason = HF.plantInSeason(plant.id, game.season());
          game.addResource(r, Math.max(1, Math.round(plant.yields[r] * (inSeason ? 1 : 0.3))));
        }
        tile.regrowTo = plant.id;
        tile.regrow = game.day() + game.rng.int(plant.regrow[0], plant.regrow[1]);
      }
      tile.feature = null;
    } else if (d.type === 'harvest') {
      const farm = game.buildingAt(d.x, d.y);
      if (farm) farm.growth = 0;
    }

    for (const r in yields) game.addResource(r, Math.round(yields[r] * scale));
    game.dirtyTerrain = true;
    delete game.designations[HF.U.key(d.x, d.y)];
    c.task = null;
  },

  completeBuilding: function (game, c, b) {
    const def = HF.BUILDINGS[b.type];
    // Paid for on completion, not on placement. Checked again here because the
    // stores can have been spent elsewhere while this was being walked to.
    if (!HF.Build.affordable(game, b.type)) { b.workDone = def.work; c.task = null; return; }
    for (const r in def.cost) game.res[r] -= def.cost[r];
    b.built = true;
    b.workDone = HF.BUILDINGS[b.type].work;
    b.claimedBy = null;
    if (HF.BUILDINGS[b.type].hp) b.hp = HF.BUILDINGS[b.type].hp;
    if (HF.BUILDINGS[b.type].farm) b.growth = 0;
    game.dirtyTerrain = true;
    game.log(HF.BUILDINGS[b.type].label + ' finished by ' + c.name + '.', 'good');
    c.task = null;
  },
};
