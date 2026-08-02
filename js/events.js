/* Raids, arrivals and seasonal misfortune - everything that happens *to* the
   colony rather than because of it. */
window.HF = window.HF || {};

HF.Events = {
  /* ---------- raiders ---------- */

  spawnRaid: function (game) {
    const count = 1 + Math.floor(game.day() / 60) + (game.rng.chance(0.35) ? 1 : 0);
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
        spawnDay: game.day(),
        lost: 0,
      });
    }
    game.log(count + ' bandit' + (count > 1 ? 's' : '') + ' sighted to the ' +
             HF.Events.compass(spawn, centre) + '.', 'bad');
    const gap = game.scenario().raidGapScale || 1;
    game.nextRaidDay = game.day() +
      Math.round(game.rng.int(HF.CFG.RAID_MIN_GAP, HF.CFG.RAID_MAX_GAP) * gap);
  },

  /* ---------- the year passing ----------
     Things that happen and mean nothing. Almost every line in the record used
     to be a threat or a transaction, which made the valley read as a problem
     rather than a place - and a village worth keeping has to be somewhere the
     player would want to look at even when nothing is going wrong. */
  AMBIENT: {
    Spring: [
      'The mountain cherry is out along the ridge.',
      'Frogs started up in the paddies last night and did not stop.',
      'A heron has taken to standing in the shallows at dawn.',
      'Someone has hung paper at the shrine for the year.',
      'The first swallows are back under the eaves.',
    ],
    Summer: [
      'Fireflies over the water after dark.',
      'The cicadas have started, and will not be stopping.',
      'Rain for three days. The paddies are as full as they will get.',
      'Too hot to work through the middle of the day, so nobody does.',
      'Someone has been sleeping outside on the good nights.',
    ],
    Autumn: [
      'The maples have turned on the far slope.',
      'Geese going over, heading somewhere else.',
      'The first frost held off another week.',
      'Chestnuts underfoot everywhere along the treeline.',
      'The evenings are drawing in noticeably now.',
    ],
    Winter: [
      'Snow on the mountain, and the smell of it in the air.',
      'The river has ice at the edges.',
      'Nothing to do but mend things and wait it out.',
      'Someone keeps the hearth going all night now.',
      'Tracks in the snow that nobody can agree about.',
    ],
  },

  ambient: function (game) {
    if (!game.rng.chance(0.16)) return;
    const lines = HF.Events.AMBIENT[game.season()];
    const line = game.rng.pick(lines);
    // Do not repeat the same observation twice in a season's memory.
    for (const e of game.entries.slice(-14)) if (e.message === line) return;
    game.log(line, 'ambient');
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
    if (game.day() - (r.spawnDay || 0) > 25) { r.withdrew = true; return; }

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

    if (game.scenario().raids && game.day() >= game.nextRaidDay && alive.length > 0) {
      HF.Events.spawnRaid(game);
    }

    HF.Events.ambient(game);

    // An offer left standing too long walks on down the valley.
    if (game.offer && game.day() > game.offer.until) {
      game.log((game.offer.tag || 'The trader') + ' has moved on.', 'info');
      game.offer = null;
    }
    if (!game.offer && game.day() >= game.nextMerchantDay && alive.length > 0) {
      game.nextMerchantDay = game.day() + game.rng.int(HF.CFG.MERCHANT.gap[0], HF.CFG.MERCHANT.gap[1]);
      HF.Events.makeOffer(game);
    }

    if (game.day() >= game.nextMigrantDay) {
      game.nextMigrantDay = game.day() + HF.CFG.MIGRANT_GAP + game.rng.int(-4, 6);
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

  /* ---------- merchants ----------
     One person, one offer, take it or leave it. Deliberately not a trade
     screen: an offer you can refuse is a decision with a face on it, where a
     table of exchange rates would just be arithmetic. It is also the release
     valve on the whole design - the castle only ever asks for rice, so without
     some way to turn timber into rice there is exactly one way to play. */

  MERCHANTS: [
    { who: 'A rice broker up from the castle town', tag: 'The broker',
      wants: 'wood',  gives: 'food' },
    { who: 'A timber factor with an ox cart', tag: 'The timber factor',
      wants: 'food',  gives: 'wood' },
    { who: 'A mason\'s agent, buying for a keep', tag: 'The mason\'s agent',
      wants: 'stone', gives: 'food' },
    { who: 'A pedlar who has walked the whole province', tag: 'The pedlar',
      wants: 'wood', gives: 'stone' },
    { who: 'A monk collecting for a burnt temple', tag: 'The monk',
      wants: 'food',  gives: 'stone' },
    { who: 'A quartermaster with rice and no carts', tag: 'The quartermaster',
      wants: 'stone', gives: 'food' },
  ],

  makeOffer: function (game) {
    /* Weighted towards a trader who wants what the village has too much of and
       carries what it has too little of. Purely random offers meant a timber
       village could go sixty turns without anyone asking for timber, which made
       trade too unreliable to actually plan around - and a path you cannot plan
       around is not a path. Weighting keeps the uncertainty (you still cannot
       summon a trader, and the rate still swings) while making the option real. */
    const cap = HF.Build.storageCap(game);
    const pressure = {};
    for (const r in game.res) pressure[r] = game.res[r] / cap;
    // Rice is never truly surplus while a levy is coming.
    pressure.food = Math.max(0, pressure.food - game.levyDemand(game.levyIndex) / cap);

    const weighted = [];
    for (const m of HF.Events.MERCHANTS) {
      // Wanting what we have plenty of, and bringing what we lack, is worth
      // more. Everyone keeps a floor so any trader can still turn up.
      const w = 1 + Math.max(0, pressure[m.wants] * 4) + Math.max(0, (1 - pressure[m.gives]) * 2);
      weighted.push({ m: m, w: w });
    }
    let roll = game.rng.next() * weighted.length * 3;
    let m = weighted[0].m;
    for (const entry of weighted) {
      roll -= entry.w;
      if (roll <= 0) { m = entry.m; break; }
    }

    const have = Math.floor(game.res[m.wants]);
    // Ask for something the village could plausibly part with, so the offer is
    // a decision rather than a taunt.
    const want = HF.U.clamp(Math.round(have * game.rng.int(40, 70) / 100), 10, 140);
    if (want > have) return;

    // Rates swing, so a patient village can wait for a better visitor.
    const rate = m.gives === 'food' ? 0.62 : m.wants === 'food' ? 1.5 : 0.85;
    const give = Math.max(6, Math.round(want * rate * (0.8 + game.rng.next() * 0.55)));

    game.offer = {
      who: m.who,
      tag: m.tag,
      wants: m.wants, wantAmount: want,
      gives: m.gives, giveAmount: give,
      until: game.day() + HF.CFG.MERCHANT.standFor,
    };
    const W = HF.RESOURCES[m.wants], G = HF.RESOURCES[m.gives];
    game.log(m.who + ' will take ' + want + ' ' + W.label.toLowerCase() +
             ' for ' + give + ' ' + G.label.toLowerCase() + '.', 'trade');
  },

  /* Returns a short reason when the deal cannot be struck, or null on success. */
  acceptOffer: function (game) {
    const o = game.offer;
    if (!o) return 'Nobody is here to trade with.';
    if (game.res[o.wants] < o.wantAmount) {
      return 'Not enough ' + HF.RESOURCES[o.wants].label.toLowerCase() + ' left to make the trade.';
    }
    game.res[o.wants] -= o.wantAmount;
    game.addResource(o.gives, o.giveAmount);
    game.tradesMade++;
    game.log('Traded ' + o.wantAmount + ' ' + HF.RESOURCES[o.wants].label.toLowerCase() +
             ' for ' + o.giveAmount + ' ' + HF.RESOURCES[o.gives].label.toLowerCase() + '.', 'trade');
    game.offer = null;
    return null;
  },

  declineOffer: function (game) {
    if (!game.offer) return;
    game.offer = null;
    game.log('The offer was let go.', 'info');
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
      // An open valley has no collectors, so it must not be told they are coming.
      Autumn: game.scenario().levy
        ? 'Autumn. Growth slows, and the collectors are coming - fill the kura.'
        : 'Autumn. Growth slows. Bring in what there is.',
      Winter: 'Winter. Nothing grows, and the cold takes anyone far from a hearth.',
    };
    game.log(notes[s], 'season');
  },
};
