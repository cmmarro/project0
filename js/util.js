/* Seeded RNG plus small helpers shared across the simulation. */
window.HF = window.HF || {};

/* mulberry32 - tiny, fast, and its whole state is one integer, which means a
   saved game can restore the exact random stream it was running on. */
HF.RNG = function (seed) {
  this.s = seed >>> 0;
};
HF.RNG.prototype.next = function () {
  this.s = (this.s + 0x6D2B79F5) >>> 0;
  let t = this.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
HF.RNG.prototype.int = function (min, max) {          // inclusive
  return min + Math.floor(this.next() * (max - min + 1));
};
HF.RNG.prototype.pick = function (arr) {
  return arr[Math.floor(this.next() * arr.length)];
};
HF.RNG.prototype.chance = function (p) {
  return this.next() < p;
};

HF.U = {
  clamp: function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; },

  /* Chebyshev distance - the right metric for 8-way movement. */
  dist: function (ax, ay, bx, by) {
    return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
  },

  key: function (x, y) { return x + ',' + y; },

  parseKey: function (k) {
    const p = k.split(',');
    return { x: +p[0], y: +p[1] };
  },

  NEIGHBORS: [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ],

  capitalize: function (s) { return s.charAt(0).toUpperCase() + s.slice(1); },

  /* Value noise: a coarse random lattice smoothed with cosine interpolation and
     stacked over a few octaves. Enough structure for coastlines and ridges
     without pulling in a noise library. */
  noiseField: function (rng, w, h, cells, octaves, persistence) {
    const out = new Float32Array(w * h);
    let amp = 1, total = 0, freq = cells;

    for (let o = 0; o < octaves; o++) {
      const gw = Math.max(2, Math.ceil(w / freq) + 1);
      const gh = Math.max(2, Math.ceil(h / freq) + 1);
      const grid = new Float32Array(gw * gh);
      for (let i = 0; i < grid.length; i++) grid[i] = rng.next();

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const fx = x / freq, fy = y / freq;
          const x0 = Math.floor(fx), y0 = Math.floor(fy);
          const tx = fx - x0, ty = fy - y0;
          const sx = tx * tx * (3 - 2 * tx);          // smoothstep
          const sy = ty * ty * (3 - 2 * ty);
          const a = grid[y0 * gw + x0];
          const b = grid[y0 * gw + Math.min(x0 + 1, gw - 1)];
          const c = grid[Math.min(y0 + 1, gh - 1) * gw + x0];
          const d = grid[Math.min(y0 + 1, gh - 1) * gw + Math.min(x0 + 1, gw - 1)];
          const top = a + (b - a) * sx;
          const bot = c + (d - c) * sx;
          out[y * w + x] += (top + (bot - top) * sy) * amp;
        }
      }
      total += amp;
      amp *= persistence;
      freq = Math.max(2, freq / 2);
    }

    for (let i = 0; i < out.length; i++) out[i] /= total;
    return out;
  },
};
