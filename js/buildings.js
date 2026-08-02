/* Placing, cancelling and running buildings. Resources are paid at placement
   and refunded on cancel, so the player always knows what a plan has cost. */
window.HF = window.HF || {};

HF.Build = {
  /* Whether a blueprint can go here. Deliberately says nothing about whether
     the village can afford it: a blueprint costs nothing to place and the
     materials come out of the stores when it is finished. That is what lets
     the player draw a whole house at once and let the village build it as the
     timber comes in, instead of laying one wall every time a tree falls. */
  canPlace: function (game, type, x, y) {
    const def = HF.BUILDINGS[type];
    const tile = HF.Map.at(game, x, y);
    if (!tile) return { ok: false, reason: 'Off the map.' };
    if (tile.building != null) return { ok: false, reason: 'Something is already here.' };
    /* A blueprint waiting for its ground to be cleared does not hold its tile
       yet, so it has to be looked for by position - otherwise a second
       blueprint stacks on the same square, one of them claims the tile when
       the trees come down, and the other is orphaned there forever. */
    if (HF.Build.pendingAt(game, x, y)) {
      return { ok: false, reason: 'Something is already planned here.' };
    }
    // A clearing order is not in the way - it is the thing that makes room.
    const standing = game.designations[HF.U.key(x, y)];
    if (standing && standing.type !== 'clear') {
      return { ok: false, reason: 'A work order is here.' };
    }
    /* Ground with something growing on it counts as buildable, so long as what
       is underneath would do. Placing here drops a clearing order and the
       blueprint waits for it - which is the difference between "select chop,
       drag, wait, select wall, drag again" and just drawing the wall where you
       want it. */
    const cleared = HF.Map.clearedTerrain(tile.terrain);
    if (def.on.indexOf(cleared) === -1) {
      return { ok: false, reason: def.label + ' cannot go on ' +
               HF.TERRAIN[tile.terrain].name.toLowerCase() + '.' };
    }
    return { ok: true, needsClearing: HF.Map.needsClearing(game, x, y) };
  },

  /* A blueprint standing on this tile that has not claimed it yet. */
  pendingAt: function (game, x, y) {
    for (const b of game.buildings) {
      if (b && b.awaitingClear && !b.cancelled && b.x === x && b.y === y) return b;
    }
    return null;
  },

  /* Can the stores cover this blueprint right now? Builders check it before
     picking the job up, so an unaffordable plan waits rather than blocking. */
  affordable: function (game, type) {
    const def = HF.BUILDINGS[type];
    for (const r in def.cost) if (game.res[r] < def.cost[r]) return false;
    return true;
  },

  place: function (game, type, x, y) {
    const check = HF.Build.canPlace(game, type, x, y);
    if (!check.ok) return check;

    const def = HF.BUILDINGS[type];

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
    game.dirtyTerrain = true;
    if (def.encloses) game.roomsDirty = true;

    /* Anything standing here gets a clearing order rather than being silently
       erased under the blueprint. The tile is only claimed by the building once
       it is bare, so the pine is felled - and paid out as timber - before the
       wall goes up on the same spot. */
    if (HF.Map.needsClearing(game, x, y)) {
      b.awaitingClear = true;
      if (!game.designations[HF.U.key(x, y)]) {
        game.designations[HF.U.key(x, y)] = {
          type: 'clear', x: x, y: y, workDone: 0, claimedBy: null,
          work: HF.Map.workFor(game, 'clear', x, y),
        };
      }
    } else {
      HF.Map.at(game, x, y).building = b.id;
    }
    return { ok: true, building: b };
  },

  /* Takes a thing off the map. A blueprint has cost nothing yet, so there is
     nothing to give back; a finished building returns half its materials. */
  remove: function (game, x, y) {
    const tile = HF.Map.at(game, x, y);
    if (!tile) return false;
    // A blueprint waiting for the ground to be cleared does not hold its tile
    // yet, so it has to be found by position rather than through the tile.
    const b = tile.building != null ? game.buildings[tile.building]
                                    : HF.Build.pendingAt(game, x, y);
    if (!b) return false;
    const def = HF.BUILDINGS[b.type];
    if (b.built) {
      for (const r in def.cost) game.addResource(r, Math.floor(def.cost[r] * 0.5));
    }

    b.cancelled = true;
    game.buildings[b.id] = null;
    if (tile.building === b.id) tile.building = null;
    if (def.encloses) game.roomsDirty = true;
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
      if (!t.regrow || t.regrow > game.day()) continue;
      t.regrow = 0;
      if (t.building != null) continue;
      const x = i % game.w, y = (i / game.w) | 0;
      if (game.designations[HF.U.key(x, y)]) continue;

      // Whatever was taken from this tile is what comes back to it.
      const what = t.regrowTo;
      t.regrowTo = null;
      if (HF.PLANTS[what]) {
        if (!t.feature && HF.PLANTS[what].on.indexOf(t.terrain) !== -1) {
          t.feature = what;
          game.dirtyTerrain = true;
        }
      } else if (what && HF.TERRAIN[what]) {
        if (t.terrain === 'grass' && !t.feature) { t.terrain = what; game.dirtyTerrain = true; }
      }
    }
  },

  /* Blueprints waiting on a clearing order take their tile the moment it is
     bare. Run once a day and whenever the map changes under them. */
  settleBlueprints: function (game) {
    for (const b of game.buildings) {
      if (!b || !b.awaitingClear || b.cancelled) continue;
      if (HF.Map.needsClearing(game, b.x, b.y)) {
        /* Still not bare. One pass does not always finish the job - bracken
           grows under pine, so felling the tree leaves the undergrowth - so the
           blueprint simply asks again until the ground is actually clear,
           rather than waiting forever on an order that has already been done. */
        const k = HF.U.key(b.x, b.y);
        if (!game.designations[k]) {
          game.designations[k] = {
            type: 'clear', x: b.x, y: b.y, workDone: 0, claimedBy: null,
            work: HF.Map.workFor(game, 'clear', b.x, b.y),
          };
        }
        continue;
      }
      const tile = HF.Map.at(game, b.x, b.y);
      if (!tile || tile.building != null) continue;
      b.awaitingClear = false;
      tile.building = b.id;
      game.dirtyTerrain = true;
      if (HF.BUILDINGS[b.type].encloses) game.roomsDirty = true;
    }
  },

  /* ---------- taking things down ----------
     Cancelling a blueprint is instant - nothing has been built and nothing
     spent. Pulling down something finished is work somebody has to walk over
     and do, which is why it is a separate tool and a separate job. */
  markDeconstruct: function (game, x, y) {
    const tile = HF.Map.at(game, x, y);
    if (!tile || tile.building == null) return false;
    const b = game.buildings[tile.building];
    if (!b || !b.built || b.deconstruct) return false;
    b.deconstruct = true;
    b.workDone = 0;
    b.claimedBy = null;
    game.dirtyTerrain = true;
    return true;
  },

  unmarkDeconstruct: function (game, x, y) {
    const tile = HF.Map.at(game, x, y);
    if (!tile || tile.building == null) return false;
    const b = game.buildings[tile.building];
    if (!b || !b.deconstruct) return false;
    b.deconstruct = false;
    b.workDone = HF.BUILDINGS[b.type].work;
    game.releaseClaimsOnBuilding(b.id);
    game.dirtyTerrain = true;
    return true;
  },

  /* How much work pulling something down takes: less than putting it up. */
  deconstructWork: function (type) {
    return Math.max(4, Math.round(HF.BUILDINGS[type].work * 0.55));
  },

  /* ---------- rooms ----------
     A tile is indoors when you cannot walk from it to the edge of the map
     without crossing something that encloses. That is the whole definition -
     no roofs to place, no room objects to keep in sync - and it is what makes
     a ring of walls worth building rather than decorative.

     Recomputed only when something that encloses is built or lost, and cached
     on the game, because it is a full-map flood fill. */
  refreshRooms: function (game) {
    const w = game.w, h = game.h;
    const outside = new Uint8Array(w * h);
    const seals = new Uint8Array(w * h);

    for (const b of game.buildings) {
      if (!b || !b.built) continue;
      if (HF.BUILDINGS[b.type].encloses) seals[b.y * w + b.x] = 1;
    }

    // Flood in from every edge tile. Anything the flood never reaches, and
    // which is not itself a wall, is enclosed.
    const queue = [];
    function push(x, y) {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const i = y * w + x;
      if (outside[i] || seals[i]) return;
      outside[i] = 1;
      queue.push(i);
    }
    for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
    for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }

    for (let qi = 0; qi < queue.length; qi++) {
      const i = queue[qi];
      const x = i % w, y = (i / w) | 0;
      // Orthogonal only: a diagonal gap between two wall corners is not a way
      // out of a room, and treating it as one would make small huts leak.
      push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
    }

    const inside = new Uint8Array(w * h);
    for (let i = 0; i < inside.length; i++) inside[i] = (!outside[i] && !seals[i]) ? 1 : 0;
    game.indoors = inside;
    game.roomsDirty = false;
    return inside;
  },

  indoorsAt: function (game, x, y) {
    if (!game.indoors || game.roomsDirty) HF.Build.refreshRooms(game);
    if (x < 0 || y < 0 || x >= game.w || y >= game.h) return false;
    return !!game.indoors[y * game.w + x];
  },

  /* Every finished building of a kind, nearest first from a point. */
  nearestBuilt: function (game, x, y, pred) {
    let best = null, bestD = Infinity;
    for (const b of game.buildings) {
      if (!b || !b.built || !pred(b)) continue;
      const d = HF.U.dist(x, y, b.x, b.y);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
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
