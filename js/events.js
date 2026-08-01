/* Raids, arrivals and seasonal misfortune - everything that happens *to* the
   colony rather than because of it. */
window.HF = window.HF || {};

HF.Events = {
  /* ---------- raiders ---------- */

  spawnRaid: function (game) {
    const count = 1 + Math.floor(game.turn / 55) + (game.rng.chance(0.35) ? 1 : 0);
    const anchor = game.aliveColonists()[0];
    if (!anchor) return;
    const centre = game.colonyCentre();

    // Only spawn where a raider could actually walk to the colony - the map
    // generator produces offshore islands, and a raid stranded on one would
    // never resolve. Then come in from a distant part of that landmass so
    // there is a turn or two of warning.
    const mask = HF.Map.reachMask(game, anchor.x, anchor.y);
    const far = [];
    let maxD = 0;
    for (let y = 0; y < game.h; y++) {
      for (let x = 0; x < game.w; x++) {
        if (!mask[y * game.w + x]) continue;
        const d = HF.U.dist(x, y, centre.x, centre.y);
        if (d > maxD) maxD = d;
        far.push({ x: x, y: y, d: d });
      }
    }
    const rim = far.filter(function (t) { return t.d >= maxD * 0.72; });
    if (rim.length === 0) return;
    const spawn = game.rng.pick(rim);

    const spots = HF.Map.openTilesNear(game, spawn.x, spawn.y, 4, new Set())
      .filter(function (s) { return mask[s.y * game.w + s.x]; });

    for (let i = 0; i < count; i++) {
      const s = spots.length ? spots[i % spots.length] : spawn;
      game.raiders.push({
        id: game.nextId++,
        x: s.x, y: s.y,
        hp: 26, maxHp: 26,
        dead: false,
        withdrew: false,
        spawnTurn: game.turn,
        lost: 0,
      });
    }
    game.log(count + ' bandit' + (count > 1 ? 's' : '') + ' sighted to the ' +
             HF.Events.compass(spawn, centre) + '.', 'bad');
    game.nextRaidTurn = game.turn + game.rng.int(HF.CFG.RAID_MIN_GAP, HF.CFG.RAID_MAX_GAP);
  },

  compass: function (from, to) {
    const dx = from.x - to.x, dy = from.y - to.y;
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'east' : 'west';
    return dy > 0 ? 'south' : 'north';
  },

  raiderTurn: function (game, r) {
    if (r.dead || r.withdrew) return;

    const target = HF.Events.nearestColonist(game, r);
    if (!target) return;

    // A raid that has dragged on gives up, so a siege can never become
    // permanent scenery.
    if (game.turn - (r.spawnTurn || 0) > 45) { r.withdrew = true; return; }

    if (HF.U.dist(r.x, r.y, target.x, target.y) <= 1) {
      const dmg = game.rng.int(4, 7);
      target.hp -= dmg;
      if (target.hp <= 0 && !target.dead) {
        HF.Colonists.die(game, target, ' was cut down by bandits.');
      }
      return;
    }

    // Walls are routed through at a penalty; when the next step is a wall the
    // raider stops and hits it instead of walking past.
    const path = HF.Path.find(game, r.x, r.y, [{ x: target.x, y: target.y }], { wallCost: 14 });
    if (!path || path.length === 0) {
      r.lost = (r.lost || 0) + 1;
      if (r.lost >= 3) r.withdrew = true;    // no route at all - go home
      return;
    }
    r.lost = 0;

    let budget = HF.CFG.MOVE_BUDGET;
    let moved = 0;
    while (path.length > 0 && budget > 0) {
      const next = path[0];
      const tile = HF.Map.at(game, next.x, next.y);
      if (tile.building != null) {
        const b = game.buildings[tile.building];
        if (b && b.built && HF.BUILDINGS[b.type].blocks) {
          b.hp -= game.rng.int(6, 11);
          if (b.hp <= 0) {
            game.log('Bandits have broken through the ishigaki.', 'bad');
            game.buildings[b.id] = null;
            tile.building = null;
            game.dirtyTerrain = true;
          }
          return;
        }
      }
      const diagonal = next.x !== r.x && next.y !== r.y;
      const cost = HF.Map.moveCost(game, next.x, next.y) * (diagonal ? 1.4 : 1);
      if (cost > budget && moved > 0) break;
      budget -= cost;
      r.x = next.x; r.y = next.y;
      path.shift();
      moved++;
    }
  },

  nearestColonist: function (game, r) {
    let best = null, bestD = Infinity;
    for (const c of game.colonists) {
      if (c.dead) continue;
      const d = HF.U.dist(r.x, r.y, c.x, c.y);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  },

  /* ---------- scheduled and random events ---------- */

  tick: function (game) {
    const alive = game.aliveColonists();

    if (game.turn >= HF.CFG.RAID_START_TURN && game.turn >= game.nextRaidTurn && alive.length > 0) {
      HF.Events.spawnRaid(game);
    }

    if (game.turn >= game.nextMigrantTurn) {
      game.nextMigrantTurn = game.turn + HF.CFG.MIGRANT_GAP + game.rng.int(-4, 6);
      const beds = HF.Build.bedCount(game);
      if (game.res.food > 55 && alive.length > 0 && alive.length < beds + 2) {
        HF.Events.addMigrant(game);
      }
    }

    if (game.rng.chance(0.05) && game.season() !== 'Winter') {
      const farms = game.buildings.filter(function (b) {
        return b && b.built && HF.BUILDINGS[b.type].farm && b.growth > 4;
      });
      if (farms.length) {
        const f = game.rng.pick(farms);
        f.growth = Math.max(0, f.growth - 10);
        game.log('Rice blast has struck a paddy.', 'bad');
      }
    }

    if (game.rng.chance(0.04)) {
      const bonus = game.rng.int(6, 14);
      game.addResource('food', bonus);
      game.log('Foragers came back from the hills with ' + bonus + ' koku of stores.', 'good');
    }
  },

  addMigrant: function (game) {
    const centre = game.colonyCentre();
    const spots = HF.Map.openTilesNear(game, centre.x, centre.y, 6, new Set());
    if (!spots.length) return;
    const spot = spots[Math.min(spots.length - 1, game.rng.int(2, 6))];
    const c = HF.Colonists.create(game, spot.x, spot.y);
    game.colonists.push(c);
    HF.Colonists.bind(game, c);
    // Introduce them by where they have been, not by their skill numbers - the
    // numbers are on the card, and a stranger with a history is a stranger the
    // player will notice dying later.
    game.log(c.name + ' has come down the valley road and asked to stay. ' +
             HF.U.capitalize(c.name.split(' ')[0]) + ' ' + c.origin + '.', 'good');
  },

  announceSeason: function (game) {
    const s = game.season();
    const notes = {
      Spring: 'Spring. The paddies thaw and the rice begins to come on.',
      Summer: 'Summer. The rice swells fastest now.',
      Autumn: 'Autumn. Growth slows, and the collectors are coming - fill the kura.',
      Winter: 'Winter. Nothing grows, and the cold takes anyone far from a hearth.',
    };
    game.log(notes[s], 'season');
  },
};
