/* Colonists: creation, needs, mood, skills, and combat stats.
   Deciding what they do each turn lives in jobs.js. */
window.HF = window.HF || {};

HF.Colonists = {
  create: function (game, x, y) {
    const rng = game.rng;
    const skills = {};
    for (const s of HF.SKILLS) skills[s] = { level: rng.int(0, 3), xp: 0 };

    // Everyone gets one thing they are genuinely good at, so the roster feels
    // like a group of people rather than interchangeable workers.
    const specialty = rng.pick(HF.SKILLS);
    skills[specialty].level = rng.int(4, 6);

    const work = {};
    for (const wt of HF.WORK_TYPES) work[wt.id] = true;

    const trait = rng.pick(Object.keys(HF.TRAITS));
    const maxHp = HF.CFG.COLONIST_HP + (trait === 'tough' ? HF.TRAIT_TUNING.toughHp : 0);

    const c = {
      id: game.nextId++,
      // Peasants of the period rarely had surnames; they were known by name
      // and by where they came from.
      name: HF.Colonists.pickName(game, rng),
      renamed: false,
      origin: rng.pick(HF.ORIGINS),
      mark: rng.pick(HF.MARKS),
      trait: trait,
      bondTo: null,           // id of one other villager
      bondKind: null,
      specialty: specialty,
      x: x, y: y,
      hp: maxHp,
      maxHp: maxHp,
      needs: { food: rng.int(70, 95), rest: rng.int(70, 95) },
      mood: 62,
      memories: [],          // { label, delta, left }
      lowMoodTurns: 0,
      breakdown: 0,          // turns left refusing to work
      asleep: false,
      skills: skills,
      work: work,
      task: null,
      activity: 'Idle',
      dead: false,
      departed: false,
    };
    return c;
  },

  /* Names have to be unique. Four villagers out of 26 given names and 16
     places collide more often than you would guess, and two people called
     Kiyo of Nomura is not a coincidence the player reads as flavour - it reads
     as the game being broken, and it makes the death of one of them
     meaningless. Falls back to a distinguishing epithet if the pool is
     genuinely exhausted. */
  pickName: function (game, rng) {
    const taken = new Set(game.colonists.map(function (c) { return c.name; }));
    for (let i = 0; i < 40; i++) {
      const n = rng.pick(HF.NAMES.first) + ' of ' + rng.pick(HF.NAMES.place);
      if (!taken.has(n)) return n;
    }
    let n = rng.pick(HF.NAMES.first) + ' of ' + rng.pick(HF.NAMES.place);
    let suffix = 2;
    while (taken.has(n)) n = n + ' the ' + (suffix++ === 2 ? 'younger' : 'elder');
    return n;
  },

  /* Ties one villager to another. Called once when the village is founded and
     again whenever somebody arrives, so nobody stays a stranger for long. */
  bind: function (game, c) {
    if (c.bondTo != null) return;
    const others = game.colonists.filter(function (o) {
      return !o.dead && o.id !== c.id && o.bondTo == null;
    });
    const pool = others.length ? others : game.aliveColonists().filter(function (o) {
      return o.id !== c.id;
    });
    if (!pool.length) return;
    const other = game.rng.pick(pool);
    const kind = game.rng.pick(HF.BONDS);
    c.bondTo = other.id;
    c.bondKind = kind;
    if (other.bondTo == null) { other.bondTo = c.id; other.bondKind = kind; }
  },

  /* Adds a thought that fades. Re-applying one refreshes it rather than
     stacking, so a run of bad years does not drive spirits to zero forever. */
  remember: function (c, key, suffix) {
    const m = HF.MEMORIES[key];
    if (!m) return;
    const label = m.label + (suffix || '');
    const existing = c.memories.find(function (o) { return o.label === label; });
    if (existing) { existing.left = m.turns; return; }
    c.memories.push({ label: label, delta: m.delta, left: m.turns });
  },

  rememberAll: function (game, key, suffix) {
    for (const c of game.aliveColonists()) HF.Colonists.remember(c, key, suffix);
  },

  skillLevel: function (c, skill) {
    return c.skills[skill] ? c.skills[skill].level : 0;
  },

  /* Work done per turn. Skill dominates; misery and exhaustion drag it down. */
  workRate: function (c, skill) {
    let rate = 1 + HF.Colonists.skillLevel(c, skill) * 0.3;
    if (c.trait === 'diligent') rate *= HF.TRAIT_TUNING.diligentRate;
    if (c.mood < 30) rate *= 0.65;
    if (c.needs.rest < 20) rate *= 0.7;
    return rate;
  },

  gainXp: function (game, c, skill, amount) {
    const s = c.skills[skill];
    if (!s || s.level >= HF.CFG.SKILL_MAX) return;
    s.xp += amount;
    const need = HF.CFG.XP_PER_LEVEL * (s.level + 1);
    if (s.xp >= need) {
      s.xp -= need;
      s.level++;
      // Deliberately not logged. The number is already on the villager's card,
      // and a chronicle full of bookkeeping buries the lines that are actually
      // about something.
    }
  },

  isWarm: function (game, c) {
    for (const b of game.buildings) {
      if (!b || !b.built) continue;
      const def = HF.BUILDINGS[b.type];
      if (def.warmth && HF.U.dist(c.x, c.y, b.x, b.y) <= def.warmth) return true;
      if (def.beds && c.x === b.x && c.y === b.y) return true;
    }
    return false;
  },

  /* Roadside shrines are scenery with one small hook: living in sight of one
     is a comfort, and more of one to somebody devout. It is a reason to settle
     in one part of the valley rather than another. */
  nearShrine: function (game, c) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const t = HF.Map.at(game, c.x + dx, c.y + dy);
        if (t && t.feature === 'shrine') return true;
      }
    }
    return false;
  },

  freeBed: function (game, c) {
    let best = null, bestD = Infinity;
    for (const b of game.buildings) {
      if (!b || !b.built) continue;
      const def = HF.BUILDINGS[b.type];
      if (!def.beds) continue;
      const used = game.colonists.filter(function (o) {
        return !o.dead && o.id !== c.id && o.asleep && o.x === b.x && o.y === b.y;
      }).length;
      if (used >= def.beds) continue;
      const d = HF.U.dist(c.x, c.y, b.x, b.y);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  },

  /* Every reason a villager feels the way they do, as a list of named,
     signed lines.

     This is the same arithmetic the mood calculation always did. What changed
     is that it comes back with its reasons attached instead of collapsing into
     one opaque number, because a simulation the player cannot see the workings
     of may as well not be running. "Spirit 41" tells you nothing; "Sleeping on
     bare earth -8, Warm by the hearth +4, The collectors took everything -10"
     is a village you can make decisions about, and a story you can retell. */
  thoughts: function (game, c) {
    const out = [];
    const scale = c.trait === 'steady' ? HF.TRAIT_TUNING.steadyScale
                : c.trait === 'sullen' ? HF.TRAIT_TUNING.sullenScale : 1;

    // Bad news is what the trait bends, so the numbers shown are already the
    // real ones and the list still sums to the target.
    function add(label, delta) {
      if (!delta) return;
      out.push({ label: label, delta: delta < 0 ? delta * scale : delta });
    }

    const n = c.needs;
    if (n.food > 70) add('Well fed', 8);
    else if (n.food < 25) add('Starving', -22);
    else if (n.food < 45) add('Going hungry', -9);

    if (n.rest > 70) add('Well rested', 6);
    else if (n.rest < 20) add('Dead on their feet', -16);
    else if (n.rest < 40) add('Short of sleep', -7);

    if (HF.Colonists.freeBed(game, c) || c.asleep) add('A bed to sleep in', 8);
    else add('Sleeping on bare earth', -8);

    if (game.season() === 'Winter') {
      if (HF.Colonists.isWarm(game, c)) add('Warm by the hearth', 4);
      else add('No hearth in this cold', -14);
    }

    if (game.res.food > 90) add('The kura is full', 5);
    if (game.res.food <= 0) add('Nothing left in the kura', -10);

    const houses = Math.min(8, game.builtCount('house') * 3);
    if (houses) add('A village taking shape', houses);

    // Capped, because whoever was tied to the dead already carries a named
    // thought for them. This is the rest of the village being subdued, and it
    // must not be the thing that finishes them off.
    if (game.grief > 0.5) add('Mourning', -Math.min(game.grief, HF.CFG.GRIEF_CAP));

    if (HF.Colonists.nearShrine(game, c)) add('A shrine close by', c.trait === 'devout' ? 7 : 4);

    if (c.trait === 'devout') add('Devout', HF.TRAIT_TUNING.devoutMood);
    if (c.trait === 'homesick') {
      const standing = game.buildings.filter(function (b) { return b && b.built; }).length;
      if (standing < HF.TRAIT_TUNING.homesickCured) add('Homesick', HF.TRAIT_TUNING.homesickMood);
    }

    for (const m of c.memories) out.push({ label: m.label, delta: m.delta < 0 ? m.delta * scale : m.delta, fades: m.left });

    return out;
  },

  /* Mood eases towards the sum of those thoughts rather than jumping to it, so
     a single hard turn does not whipsaw the whole village. */
  updateMood: function (game, c) {
    let target = 55;
    for (const t of HF.Colonists.thoughts(game, c)) target += t.delta;

    for (let i = c.memories.length - 1; i >= 0; i--) {
      if (--c.memories[i].left <= 0) c.memories.splice(i, 1);
    }

    c.mood = HF.U.clamp(c.mood + (target - c.mood) * 0.4, 0, 100);

    if (c.mood < 22) c.lowMoodTurns++;
    else c.lowMoodTurns = Math.max(0, c.lowMoodTurns - 1);

    if (c.lowMoodTurns >= 4 && c.breakdown <= 0) {
      c.breakdown = 3;
      c.lowMoodTurns = 0;
      c.task = null;
      // A village in a bad way breaks down again the moment it recovers, and
      // logging every relapse buries everything else under the same three
      // lines. Say it once, then let the spirit bar carry it.
      if (game.turn - (c.lastBreakdownLog || -99) >= 15) {
        c.lastBreakdownLog = game.turn;
        game.log(c.name + ' has sat down in the dirt and will not be moved.', 'bad');
      }
    }
  },

  decayNeeds: function (game, c) {
    const n = c.needs;
    n.food = HF.U.clamp(n.food - HF.CFG.FOOD_DECAY, 0, 100);
    if (c.asleep) {
      const inBed = game.buildingAt(c.x, c.y) &&
                    HF.BUILDINGS[game.buildingAt(c.x, c.y).type].beds;
      n.rest = HF.U.clamp(n.rest + (inBed ? HF.CFG.BED_REST : HF.CFG.GROUND_REST), 0, 100);
    } else {
      n.rest = HF.U.clamp(n.rest - HF.CFG.REST_DECAY, 0, 100);
    }
  },

  applyHealth: function (game, c) {
    if (c.needs.food <= 0) {
      c.hp -= HF.CFG.STARVE_DAMAGE;
      if (c.hp > 0) c.activity = 'Starving';
    } else if (game.season() === 'Winter' && !HF.Colonists.isWarm(game, c)) {
      c.hp -= HF.CFG.COLD_DAMAGE;
    } else if (c.needs.food > 45 && c.hp < c.maxHp) {
      c.hp = Math.min(c.maxHp, c.hp + HF.CFG.REGEN);
    }

    if (c.hp <= 0 && !c.dead) {
      HF.Colonists.die(game, c, c.needs.food <= 0 ? ' has starved.' : ' died of the cold.');
    }
  },

  /* One place for every way a villager can be lost, because every one of them
     has to land on the people left behind. The village mourns a little; whoever
     was tied to them mourns by name, and goes on mourning for a season. */
  die: function (game, c, how, departed) {
    if (c.dead) return;
    c.dead = true;
    c.departed = !!departed;
    c.hp = 0;
    c.task = null;
    game.releaseClaims(c.id);
    game.grief += departed ? 4 : 6;
    game.log(c.name + how, 'bad');

    for (const o of game.aliveColonists()) {
      if (o.bondTo === c.id) {
        HF.Colonists.remember(o, 'bondLost', c.name);
        game.log(o.name + ' was ' + (o.bondKind || 'close to') + ' ' + c.name + '.', 'bad');
      } else {
        HF.Colonists.remember(o, 'buriedSomeone');
      }
    }
  },

  /* A yagura does not fight, but villagers within sight of one strike with
     more confidence - which is the whole reason to spend stone on it. */
  guardBonus: function (game, c) {
    let best = 0;
    for (const b of game.buildings) {
      if (!b || !b.built) continue;
      const def = HF.BUILDINGS[b.type];
      if (!def.guard) continue;
      if (HF.U.dist(c.x, c.y, b.x, b.y) <= def.guard) best = Math.max(best, def.guardBonus);
    }
    return best;
  },

  attack: function (game, c, bandit) {
    const dmg = game.rng.int(5, 9)
              + Math.floor(HF.Colonists.skillLevel(c, 'mining') / 4)
              + HF.Colonists.guardBonus(game, c);
    bandit.hp -= dmg;
    c.activity = 'Fighting';
    if (bandit.hp <= 0) {
      bandit.dead = true;
      game.banditsKilled = (game.banditsKilled || 0) + 1;
      game.log(c.name + ' cut down a bandit.', 'good');
    }
  },
};
