/* Terrain generation and tile queries. */
window.HF = window.HF || {};

HF.Map = {
  /* Returns { w, h, tiles } where tiles is a flat row-major array. */
  generate: function (rng, w, h) {
    const elev = HF.U.noiseField(rng, w, h, 11, 4, 0.5);
    const moist = HF.U.noiseField(rng, w, h, 8, 3, 0.55);
    const tiles = new Array(w * h);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;

        // Island falloff: push elevation down towards the border so the colony
        // sits on a landmass with a coast rather than running off the screen.
        const nx = (x / (w - 1)) * 2 - 1;
        const ny = (y / (h - 1)) * 2 - 1;
        const edge = Math.max(Math.abs(nx), Math.abs(ny));
        const e = elev[i] - Math.pow(edge, 3.2) * 0.55;
        const m = moist[i];

        let terrain, feature = null;
        if (e < 0.30) terrain = 'water';
        else if (e < 0.34) terrain = 'sand';
        else if (e > 0.70) terrain = 'mountain';
        else if (e > 0.60) terrain = 'hill';
        else if (m > 0.56) terrain = 'forest';
        else terrain = 'grass';

        if (terrain === 'grass' && m > 0.45 && rng.chance(0.06)) feature = 'berries';

        tiles[i] = {
          terrain: terrain,
          feature: feature,
          variant: rng.next(),      // per-tile jitter so the art isn't a flat grid
          building: null,           // building id occupying this tile
          regrow: 0,                // turn at which a stripped tile comes back
        };
      }
    }

    return { w: w, h: h, tiles: tiles };
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
        let open = 0, wood = 0, rock = 0;
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            const t = HF.Map.at(g, x + dx, y + dy);
            if (!t) continue;
            if (t.terrain === 'grass') open++;
            if (t.terrain === 'forest') wood++;
            if (t.terrain === 'hill' || t.terrain === 'mountain') rock++;
          }
        }
        // Want room to build, trees nearby, some stone, and roughly central.
        const centrality = 1 - HF.U.dist(x, y, g.w / 2, g.h / 2) / (g.w / 2);
        const score = open * 1.0 + Math.min(wood, 14) * 0.8 + Math.min(rock, 10) * 0.6
                    + centrality * 12 + rng.next();
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
