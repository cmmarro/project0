/* The light map.
 *
 * One RGB value per half-tile, recomputed only when the world changes or the
 * sun moves. It is deliberately coarse: the softness you see is the browser
 * interpolating a small bitmap up to screen size, which is cheaper than
 * per-pixel lighting and closer to how a colony sim actually looks — light
 * pools by tile and the gradient is the smoothing.
 *
 * Half-tile rather than whole-tile because at one sample per tile the
 * interpolation smears a lamp's pool across most of a room, and the room stops
 * reading as a room. Two samples costs four times the arithmetic on a grid
 * small enough that nobody notices.
 *
 * The bitmap covers the map rectangle *exactly*: sample i spans world pixels
 * [i·TILE/SUB, (i+1)·TILE/SUB), so it is drawn at (0, 0, w·TILE, h·TILE) with
 * no offset and no padding. Getting that wrong by half a sample — which is
 * what an earlier version did — shifts every light in the world up and to the
 * left by a quarter of a tile, and the symptom is a wall lamp that lights the
 * top of the wall instead of the floor in front of it.
 *
 * Walls stop light. A lamp behind a wall lights the wall and nothing past it,
 * which is the single detail that makes a built room feel enclosed rather than
 * decorated.
 */

import { THINGS } from './defs.js';

const SUB = 2;                       // samples per tile, per axis

export class LightMap {
  constructor(world) {
    this.world = world;
    this.w = world.w * SUB;
    this.h = world.h * SUB;
    this.rgb = new Float32Array(this.w * this.h * 3);
    // Two bitmaps, because light does two different things. `canvas` is the
    // part at or below full brightness and gets multiplied over the world;
    // `glow` is only the excess above full and gets added. Doing it with one
    // multiply pass meant full daylight rendered at 64% and every material in
    // the game came out the same shade of mud.
    this.canvas = make(this.w, this.h);
    this.ctx = this.canvas.getContext('2d');
    this.image = this.ctx.createImageData(this.w, this.h);
    this.glow = make(this.w, this.h);
    this.glowCtx = this.glow.getContext('2d');
    this.glowImage = this.glowCtx.createImageData(this.w, this.h);
    this.sun = 0.12;                 // ambient, 0 = night
    this.stale = -1;
    this.sunAt = -1;
  }

  /* Ambient daylight. A single number rather than a direction — there is no
   * outdoors yet, and a directional sun without one is a cost with no view. */
  setSun(v) {
    this.sun = Math.max(0, Math.min(1, v));
  }

  dirty() {
    return this.stale !== this.world.version || this.sunAt !== this.sun;
  }

  update() {
    if (!this.dirty()) return;
    this.stale = this.world.version;
    this.sunAt = this.sun;

    const { w, h, rgb } = this;
    // Never quite zero. A room at true black reads as a rendering failure
    // rather than as darkness, and you cannot build in it.
    const amb = 0.17 + this.sun * 0.83;
    for (let i = 0; i < w * h; i++) {
      rgb[i * 3] = amb * 0.97;
      rgb[i * 3 + 1] = amb * 0.99;
      rgb[i * 3 + 2] = amb * 1.05;
    }

    // A lamp at noon does almost nothing you can see, because the eye is
    // adjusted to the sun. Scaling every source by how dark it already is
    // costs one multiply and is the difference between lighting that reads as
    // lighting and a permanent bright smear across the floor.
    const relative = 1 - this.sun * 0.88;
    for (const thing of this.world.things.values()) {
      const def = THINGS[thing.key];
      if (!def.light || !thing.on) continue;
      this.cast(thing, def.light, relative);
    }

    this.blit();
  }

  cast(thing, light, scale = 1) {
    const { w, h, rgb } = this;
    const { radius, colour, strength } = light;
    // Something bolted to a wall throws its light into the room, not through
    // the masonry behind it. `rot` is the edge it is mounted on, so it faces
    // the opposite way.
    const facing = light.directional
      ? [[0, 1], [-1, 0], [0, -1], [1, 0]][(thing.rot || 0) % 4]
      : null;
    // Source in sub-tile space, at the centre of the thing's footprint.
    const sx = thing.cx * SUB - 0.5, sy = thing.cy * SUB - 0.5;
    const r = radius * SUB;
    const x0 = Math.max(0, Math.floor(sx - r)), x1 = Math.min(w - 1, Math.ceil(sx + r));
    const y0 = Math.max(0, Math.floor(sy - r)), y1 = Math.min(h - 1, Math.ceil(sy + r));
    const [lr, lg, lb] = colour;

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dist = Math.hypot(x - sx, y - sy);
        if (dist > r) continue;
        if (facing && (x - sx) * facing[0] + (y - sy) * facing[1] < -0.6) continue;
        if (!this.reaches(sx, sy, x, y)) continue;
        // Squared-ish falloff so the pool has a bright middle and a soft rim
        // rather than being a flat disc with an edge.
        const f = Math.pow(1 - dist / r, 1.9) * strength * scale;
        const i = (y * w + x) * 3;
        rgb[i] += (lr / 255) * f;
        rgb[i + 1] += (lg / 255) * f;
        rgb[i + 2] += (lb / 255) * f;
      }
    }
  }

  /* Straight line from source to sample, stopping at the first wall. The
   * blocking tile itself still counts as lit — otherwise every wall reads as a
   * black outline and the room looks unroofed. */
  reaches(sx, sy, tx, ty) {
    const dx = tx - sx, dy = ty - sy;
    const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)));
    if (steps <= 1) return true;
    // Sample i is centred on tile-space (i+0.5)/SUB, so tile T spans index
    // coordinates [T·SUB − 0.5, (T+1)·SUB − 0.5) — which is why the +0.5 is
    // there. Without it a source sitting at the centre of its tile reads as
    // being in the tile to its west the moment a ray steps left, and a wall
    // lamp lights one side of itself and not the other.
    const tile = v => Math.floor((v + 0.5) / SUB);
    const goalX = tile(tx), goalY = tile(ty);
    // A fitting mounted in a wall — a sconce, the dispenser's panel — sits in
    // a tile that blocks. Without exempting its own tile the ray is stopped
    // before it has gone anywhere and the lamp lights nothing, or worse, lights
    // things two tiles off more brightly than things one tile off, because the
    // far ray happens to step past the source tile and the near one does not.
    const homeX = tile(sx), homeY = tile(sy);
    for (let s = 1; s < steps; s++) {
      const px = tile(sx + (dx * s) / steps);
      const py = tile(sy + (dy * s) / steps);
      if (px === goalX && py === goalY) return true;
      if (px === homeX && py === homeY) continue;
      if (this.world.blocked(px, py)) return false;
    }
    return true;
  }

  blit() {
    const { w, h, rgb, image, glowImage } = this;
    const d = image.data, g = glowImage.data;
    for (let i = 0; i < w * h; i++) {
      for (let k = 0; k < 3; k++) {
        const v = rgb[i * 3 + k];
        d[i * 4 + k] = 255 * Math.min(1, v);
        // The excess, rolled off so a stack of overlapping lamps brightens
        // gracefully instead of clipping to a flat white blob.
        g[i * 4 + k] = 255 * roll(Math.max(0, v - 1));
      }
      d[i * 4 + 3] = 255;
      g[i * 4 + 3] = 255;
    }
    this.ctx.putImageData(image, 0, 0);
    this.glowCtx.putImageData(glowImage, 0, 0);
  }

  /* The light falling on a point, in tiles, bilinearly. This is what anything
   * standing *up* out of the floor is lit by — its own footprint, rather than
   * whatever the light map happens to hold at the screen position it is drawn
   * at. Those are different tiles the moment a thing has any height, and using
   * the second is what made walls come out in patches. */
  sample(x, y) {
    const fx = Math.max(0, Math.min(this.w - 1.001, x * SUB - 0.5));
    const fy = Math.max(0, Math.min(this.h - 1.001, y * SUB - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const out = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const a = this.rgb[(y0 * this.w + x0) * 3 + k];
      const b = this.rgb[(y0 * this.w + x0 + 1) * 3 + k];
      const c = this.rgb[((y0 + 1) * this.w + x0) * 3 + k];
      const d = this.rgb[((y0 + 1) * this.w + x0 + 1) * 3 + k];
      out[k] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
    return out;
  }

  /* How lit a tile is, 0..1ish, for anything that needs to ask rather than
   * draw. Nothing needs it yet; a pawn deciding whether it can see will. */
  levelAt(x, y) {
    if (!this.world.inside(x, y)) return 0;
    const s = this.sample(x + 0.5, y + 0.5);
    return (s[0] + s[1] + s[2]) / 3;
  }
}

export { SUB };

function roll(v) {
  return v <= 0 ? 0 : (v / (1 + v)) * 0.55;
}

function make(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return cv;
}
