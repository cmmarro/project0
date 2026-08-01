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

    const c = {
      id: game.nextId++,
      // Peasants of the period rarely had surnames; they were known by name
      // and by where they came from.
      name: rng.pick(HF.NAMES.first) + ' of ' + rng.pick(HF.NAMES.place),
      specialty: specialty,
      x: x, y: y,
      hp: HF.CFG.COLONIST_HP,
      maxHp: HF.CFG.COLONIST_HP,
      needs: { food: rng.int(70, 95), rest: rng.int(70, 95) },
      mood: 62,
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

  skillLevel: function (c, skill) {
    return c.skills[skill] ? c.skills[skill].level : 0;
  },

  /* Work done per turn. Skill dominates; misery and exhaustion drag it down. */
  workRate: function (c, skill) {
    let rate = 1 + HF.Colonists.skillLevel(c, skill) * 0.3;
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
      game.log(c.name + ' is now ' + (HF.SKILL_LABELS[skill] || skill) + ' ' + s.level + '.', 'good');
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

  /* Mood is recomputed from scratch each turn from living conditions, then
     eased towards the target so it does not whipsaw. */
  updateMood: function (game, c) {
    let target = 55;
    const n = c.needs;

    if (n.food > 70) target += 8;
    else if (n.food < 25) target -= 22;
    else if (n.food < 45) target -= 9;

    if (n.rest > 70) target += 6;
    else if (n.rest < 20) target -= 16;
    else if (n.rest < 40) target -= 7;

    if (HF.Colonists.freeBed(game, c) || c.asleep) target += 8;
    else target -= 8;

    if (game.season() === 'Winter') {
      target += HF.Colonists.isWarm(game, c) ? 4 : -14;
    }
    if (game.res.food > 90) target += 5;
    if (game.res.food <= 0) target -= 10;
    target += Math.min(8, game.builtCount('house') * 3);
    target -= game.grief;

    c.mood = HF.U.clamp(c.mood + (target - c.mood) * 0.4, 0, 100);

    if (c.mood < 22) c.lowMoodTurns++;
    else c.lowMoodTurns = Math.max(0, c.lowMoodTurns - 1);

    if (c.lowMoodTurns >= 4 && c.breakdown <= 0) {
      c.breakdown = 3;
      c.lowMoodTurns = 0;
      c.task = null;
      game.log(c.name + ' has broken down and stopped working.', 'bad');
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
      c.dead = true;
      c.hp = 0;
      game.releaseClaims(c.id);
      game.grief += 6;
      game.log(c.name + ' has died.', 'bad');
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
