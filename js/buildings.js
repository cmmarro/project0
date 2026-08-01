/* Placing, cancelling and running buildings. Resources are paid at placement
   and refunded on cancel, so the player always knows what a plan has cost. */
window.HF = window.HF || {};

HF.Build = {
  canPlace: function (game, type, x, y) {
    const def = HF.BUILDINGS[type];
    const tile = HF.Map.at(game, x, y);
    if (!tile) return { ok: false, reason: 'Off the map.' };
    if (tile.building != null) return { ok: false, reason: 'Something is already here.' };
    if (game.designations[HF.U.key(x, y)]) return { ok: false, reason: 'A work order is here.' };
    if (def.on.indexOf(tile.terrain) === -1) {
      return { ok: false, reason: def.label + ' cannot go on ' + HF.TERRAIN[tile.terrain].name.toLowerCase() + '.' };
    }
    for (const r in def.cost) {
      if (game.res[r] < def.cost[r]) {
        return { ok: false, reason: 'Not enough ' + r + ' (' + def.cost[r] + ' needed).' };
      }
    }
    return { ok: true };
  },

  place: function (game, type, x, y) {
    const check = HF.Build.canPlace(game, type, x, y);
    if (!check.ok) return check;

    const def = HF.BUILDINGS[type];
    for (const r in def.cost) game.res[r] -= def.cost[r];

    const b = {
      id: game.buildings.length,
      type: type,
      x: x, y: y,
      built: false,
      cancelled: false,
      workDone: 0,
      claimedBy: null,
      hp: def.hp || 0,
      growth: 0,
    };
    game.buildings.push(b);
    HF.Map.at(game, x, y).building = b.id;
    game.dirtyTerrain = true;
    return { ok: true, building: b };
  },

  /* Refunds materials in full for a blueprint, half for a finished building. */
  remove: function (game, x, y) {
    const tile = HF.Map.at(game, x, y);
    if (!tile || tile.building == null) return false;
    const b = game.buildings[tile.building];
    if (!b) return false;
    const def = HF.BUILDINGS[b.type];
    const ratio = b.built ? 0.5 : 1;
    for (const r in def.cost) game.addResource(r, Math.floor(def.cost[r] * ratio));

    b.cancelled = true;
    game.buildings[b.id] = null;
    tile.building = null;
    delete game.designations[HF.U.key(x, y)];
    game.releaseClaimsOnBuilding(b.id);
    game.dirtyTerrain = true;
    return true;
  },

  /* What a paddy on this tile is worth per turn: the season, times the ground
     it was dug into. Marsh is half again as fast as meadow, moor barely
     works - so choosing where to build is a real decision rather than a
     formality. */
  growthRate: function (game, b) {
    const tile = HF.Map.at(game, b.x, b.y);
    const soil = (tile && HF.FARM.SOIL[tile.terrain]) || 1;
    return HF.FARM.GROWTH[game.season()] * soil;
  },

  /* Crops ripen with the season, then post their own harvest order. */
  tickFarms: function (game) {
    for (const b of game.buildings) {
      if (!b || !b.built || !HF.BUILDINGS[b.type].farm) continue;
      if (b.growth >= HF.FARM.RIPE_AT) {
        const k = HF.U.key(b.x, b.y);
        if (!game.designations[k]) {
          game.designations[k] = {
            type: 'harvest', x: b.x, y: b.y, workDone: 0, claimedBy: null,
          };
        }
        continue;
      }
      b.growth += HF.Build.growthRate(game, b);
      if (b.growth >= HF.FARM.RIPE_AT) {
        b.growth = HF.FARM.RIPE_AT;
        game.dirtyTerrain = true;
      }
    }
  },

  /* Felled forest and picked bushes come back on their own timer. */
  tickRegrowth: function (game) {
    if (game.season() === 'Winter') return;
    for (let i = 0; i < game.tiles.length; i++) {
      const t = game.tiles[i];
      if (!t.regrow || t.regrow > game.turn) continue;
      t.regrow = 0;
      if (t.building != null) continue;
      const x = i % game.w, y = (i / game.w) | 0;
      if (game.designations[HF.U.key(x, y)]) continue;

      // Whatever was taken from this tile is what comes back to it.
      const what = t.regrowTo;
      t.regrowTo = null;
      if (what === 'fish') {
        if (t.terrain === 'water' && !t.feature) { t.feature = 'fish'; game.dirtyTerrain = true; }
      } else if (what === 'chestnut') {
        if (!t.feature) { t.feature = 'chestnut'; game.dirtyTerrain = true; }
      } else if (what && HF.TERRAIN[what]) {
        if (t.terrain === 'grass' && !t.feature) { t.terrain = what; game.dirtyTerrain = true; }
      }
    }
  },

  storageCap: function (game) {
    let cap = HF.CFG.BASE_STORAGE;
    for (const b of game.buildings) {
      if (b && b.built && HF.BUILDINGS[b.type].storage) cap += HF.BUILDINGS[b.type].storage;
    }
    return cap;
  },

  bedCount: function (game) {
    let n = 0;
    for (const b of game.buildings) {
      if (b && b.built && HF.BUILDINGS[b.type].beds) n += HF.BUILDINGS[b.type].beds;
    }
    return n;
  },
};
