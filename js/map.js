/* Terrain generation and tile queries. */
window.HF = window.HF || {};

HF.Map = {
  /* Returns { w, h, tiles } where tiles is a flat row-major array. */
  generate: function (rng, w, h) {
    const elev = HF.U.noiseField(rng, w, h, 11, 4, 0.5);
    const moist = HF.U.noiseField(rng, w, h, 8, 3, 0.55);
    // A third, coarser field decides which *kind* of wet and which kind of
    // wood, so groves and marshes come in patches rather than salting the map
    // evenly. Two valleys should not feel like the same valley.
    const grain = HF.U.noiseField(rng, w, h, 17, 2, 0.6);
    const tiles = new Array(w * h);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;

        // Island falloff: push elevation down towards the border so the village
        // sits on a landmass with a coast rather than running off the screen.
        // Softened from what it was - the old curve drowned well over half the
        // map, which left too little ground for the terrain kinds to tell any
        // story on.
        const nx = (x / (w - 1)) * 2 - 1;
        const ny = (y / (h - 1)) * 2 - 1;
        const edge = Math.max(Math.abs(nx), Math.abs(ny));
        const e = elev[i] - Math.pow(edge, 4.2) * 0.42;
        const m = moist[i];
        const g = grain[i];

        let terrain, feature = null;
        if (e < 0.29) terrain = 'water';
        else if (e < 0.33) terrain = 'sand';
        else if (e > 0.70) terrain = 'mountain';
        else if (e > 0.60) terrain = 'hill';
        else if (e < 0.40 && m > 0.40) terrain = 'marsh';        // low and damp
        else if (m > 0.52) terrain = g > 0.50 ? 'bamboo' : 'forest';
        else if (m < 0.40 && g < 0.50) terrain = 'moor';         // high and dry
        else terrain = 'grass';

        // Everything that grows wild is scattered from one table, so the mix
        // of a valley follows from its ground rather than being hand-placed.
        for (const id in HF.PLANTS) {
          const pl = HF.PLANTS[id];
          if (id === 'fish') continue;              // placed below, bank-side only
          if (pl.on.indexOf(terrain) === -1) continue;
          if (!rng.chance(pl.chance)) continue;
          feature = id;
          break;
        }

        tiles[i] = {
          terrain: terrain,
          feature: feature,
          variant: rng.next(),      // per-tile jitter so the art isn't a flat grid
          building: null,           // building id occupying this tile
          regrow: 0,                // turn at which a stripped tile comes back
          regrowTo: null,           // and what comes back - see HF.REGROW
        };
      }
    }

    const g = { w: w, h: h, tiles: tiles };

    // Fish sit in water within reach of a bank, because a trap nobody can walk
    // to is a promise the map cannot keep.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = tiles[y * w + x];
        if (t.terrain !== 'water') continue;
        let bank = false;
        for (const d of HF.U.NEIGHBORS) {
          const n = HF.Map.at(g, x + d[0], y + d[1]);
          if (n && HF.TERRAIN[n.terrain].passable) { bank = true; break; }
        }
        if (bank && rng.chance(HF.PLANTS.fish.chance)) t.feature = 'fish';
      }
    }

    // One or two roadside shrines. They do nothing but stand there and lift
    // the spirits of anyone who lives near one.
    let shrines = 0;
    for (let tries = 0; tries < 400 && shrines < rng.int(1, 3); tries++) {
      const x = rng.int(3, w - 4), y = rng.int(3, h - 4);
      const t = tiles[y * w + x];
      if (t.feature || (t.terrain !== 'grass' && t.terrain !== 'moor')) continue;
      t.feature = 'shrine';
      shrines++;
    }

    return g;
  },

  inBounds: function (g, x, y) {
    return x >= 0 && y >= 0 && x < g.w && y < g.h;
  },

  at: function (g, x, y) {
    if (!HF.Map.inBounds(g, x, y)) return null;
    return g.tiles[y * g.w + x];
  },

  terrainOf: function (g, x, y) {
    const t = HF.Map.at(g, x, y);
    return t ? HF.TERRAIN[t.terrain] : null;
  },

  /* Can a colonist stand here? Built walls block; blueprints do not, so a
     builder can stand beside a half-finished wall without trapping itself. */
  passable: function (g, x, y) {
    const t = HF.Map.at(g, x, y);
    if (!t) return false;
    if (!HF.TERRAIN[t.terrain].passable) return false;
    if (t.building != null) {
      const b = g.buildings[t.building];
      if (b && b.built && HF.BUILDINGS[b.type].blocks) return false;
    }
    return true;
  },

  moveCost: function (g, x, y) {
    return HF.TERRAIN[HF.Map.at(g, x, y).terrain].cost;
  },

  /* Tiles a colonist can work this job from: the tile itself when it is
     walkable, otherwise every walkable neighbour. */
  workStands: function (g, x, y, forceAdjacent) {
    const out = [];
    if (!forceAdjacent && HF.Map.passable(g, x, y)) out.push({ x: x, y: y });
    if (out.length === 0 || forceAdjacent) {
      for (const d of HF.U.NEIGHBORS) {
        const nx = x + d[0], ny = y + d[1];
        if (HF.Map.passable(g, nx, ny)) out.push({ x: nx, y: ny });
      }
    }
    return out;
  },

  /* Picks a sheltered, walkable, non-coastal spot for the first camp. */
  findStartSite: function (g, rng) {
    let best = null, bestScore = -Infinity;
    for (let y = 3; y < g.h - 3; y++) {
      for (let x = 3; x < g.w - 3; x++) {
        if (!HF.Map.passable(g, x, y)) continue;
        let open = 0, wood = 0, rock = 0, wet = 0;
        for (let dy = -4; dy <= 4; dy++) {
          for (let dx = -4; dx <= 4; dx++) {
            const t = HF.Map.at(g, x + dx, y + dy);
            if (!t) continue;
            if (t.terrain === 'grass' || t.terrain === 'moor') open++;
            if (t.terrain === 'forest' || t.terrain === 'bamboo') wood++;
            if (t.terrain === 'hill' || t.terrain === 'mountain') rock++;
            if (t.terrain === 'marsh') wet++;
          }
        }
        /* Wet ground is weighted hard. People settled where the rice would
           grow, and without this the site picker put every village on dry
           meadow - marsh is a tenth of the map, but barely one paddy in a
           hundred was ever built on it, so the best ground in the game was
           something the player never actually met. */
        const centrality = 1 - HF.U.dist(x, y, g.w / 2, g.h / 2) / (g.w / 2);
        const score = open * 0.7 + Math.min(wet, 16) * 1.6 + Math.min(wood, 16) * 0.8
                    + Math.min(rock, 10) * 0.5 + centrality * 12 + rng.next();
        if (score > bestScore) { bestScore = score; best = { x: x, y: y }; }
      }
    }
    return best || { x: (g.w / 2) | 0, y: (g.h / 2) | 0 };
  },

  /* Flood fill of everywhere on foot from a tile, ignoring buildings - the map
     can generate offshore islands, and anything spawned on one could never
     reach the colony. Walls are deliberately not treated as barriers here
     because raiders break through them. */
  reachMask: function (g, sx, sy) {
    const mask = new Uint8Array(g.w * g.h);
    const start = HF.Map.at(g, sx, sy);
    if (!start || !HF.TERRAIN[start.terrain].passable) return mask;

    function walkable(x, y) {
      if (x < 0 || y < 0 || x >= g.w || y >= g.h) return false;
      return HF.TERRAIN[g.tiles[y * g.w + x].terrain].passable;
    }

    const queue = [sy * g.w + sx];
    mask[queue[0]] = 1;
    for (let i = 0; i < queue.length; i++) {
      const idx = queue[i];
      const x = idx % g.w, y = (idx / g.w) | 0;
      for (const d of HF.U.NEIGHBORS) {
        const nx = x + d[0], ny = y + d[1];
        if (!walkable(nx, ny)) continue;
        const ni = ny * g.w + nx;
        if (mask[ni]) continue;
        // Match the pathfinder's rule: no slipping diagonally between two
        // blocked tiles, or this would report corner-only spits as connected.
        if (d[0] !== 0 && d[1] !== 0 && !walkable(x + d[0], y) && !walkable(x, y + d[1])) continue;
        mask[ni] = 1;
        queue.push(ni);
      }
    }
    return mask;
  },

  /* Walkable tiles near a point, nearest first - used to place arrivals. */
  openTilesNear: function (g, x, y, radius, occupied) {
    const out = [];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx, ny = y + dy;
        if (!HF.Map.passable(g, nx, ny)) continue;
        if (occupied && occupied.has(HF.U.key(nx, ny))) continue;
        out.push({ x: nx, y: ny, d: HF.U.dist(x, y, nx, ny) });
      }
    }
    out.sort(function (a, b) { return a.d - b.d; });
    return out;
  },
};
