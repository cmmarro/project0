// Map generation: two smoothed noise fields (elevation, moisture) run through a
// threshold table. Deliberately simple -- swapping in real noise later only
// means replacing `noiseField`.

import { isPassable } from '../data/terrain.js';

function noiseField(width, height, rng, smoothPasses) {
  let field = new Float32Array(width * height);
  for (let i = 0; i < field.length; i++) field[i] = rng.float();

  for (let pass = 0; pass < smoothPasses; pass++) {
    const next = new Float32Array(field.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            sum += field[ny * width + nx];
            count++;
          }
        }
        next[y * width + x] = sum / count;
      }
    }
    field = next;
  }

  // Smoothing pulls everything toward the mean, so stretch back to 0..1.
  let min = Infinity;
  let max = -Infinity;
  for (const v of field) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min || 1;
  for (let i = 0; i < field.length; i++) field[i] = (field[i] - min) / span;

  return field;
}

// Push elevation down near the borders so continents don't run off the edge.
function edgeFalloff(x, y, width, height) {
  const dx = Math.min(x, width - 1 - x) / (width * 0.5);
  const dy = Math.min(y, height - 1 - y) / (height * 0.5);
  return Math.min(1, Math.min(dx, dy) * 2.2);
}

// Smoothing leaves the noise clustered around the middle, so the outer bands
// have to sit well inside 0..1 or the terrain they select becomes vanishingly
// rare. Forest in particular is the main source of production.
function classify(elevation, moisture) {
  if (elevation < 0.36) return 'ocean';
  if (elevation > 0.82) return 'mountains';
  if (elevation > 0.68) return 'hills';
  if (moisture < 0.28) return 'desert';
  if (moisture < 0.46) return 'plains';
  if (moisture < 0.66) return 'grassland';
  return 'forest';
}

export function generateMap(width, height, rng) {
  const elevation = noiseField(width, height, rng, 3);
  const moisture = noiseField(width, height, rng, 2);
  const tiles = new Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const e = elevation[i] * edgeFalloff(x, y, width, height);
      tiles[i] = { terrain: classify(e, moisture[i]) };
    }
  }

  return { width, height, tiles };
}

// Flood fill the passable tiles into connected landmasses, largest first.
function landmasses(map) {
  const seen = new Uint8Array(map.width * map.height);
  const found = [];

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const start = y * map.width + x;
      if (seen[start] || !isPassable(map.tiles[start])) continue;

      const mass = [];
      const queue = [{ x, y }];
      seen[start] = 1;

      while (queue.length) {
        const p = queue.pop();
        mass.push(p);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = p.x + dx;
            const ny = p.y + dy;
            if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
            const i = ny * map.width + nx;
            if (seen[i] || !isPassable(map.tiles[i])) continue;
            seen[i] = 1;
            queue.push({ x: nx, y: ny });
          }
        }
      }

      found.push(mass);
    }
  }

  return found.sort((a, b) => b.length - a.length);
}

// A reasonable opening position: on the largest continent, on ground that will
// actually feed a city. Without the landmass check roughly one map in ten
// strands the player on an islet with no room to expand.
export function findStartTile(map, rng) {
  const masses = landmasses(map);
  if (!masses.length) return { x: 0, y: 0 };

  const mainland = masses[0];
  const inland = mainland.filter(
    (p) => p.x >= 2 && p.y >= 2 && p.x < map.width - 2 && p.y < map.height - 2
  );

  const pool = inland.length ? inland : mainland;
  const fertile = pool.filter((p) => {
    const t = map.tiles[p.y * map.width + p.x].terrain;
    return t === 'grassland' || t === 'plains';
  });

  return rng.pick(fertile.length ? fertile : pool);
}
