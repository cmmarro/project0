/* Drawing the world, and the camera that decides which bit of it.
 *
 * Order matters and is fixed: ground, terrain, things, then the light map
 * multiplied over all of it, then the build overlay on top. The overlay sits
 * above the light deliberately — a placement ghost you can't see in an unlit
 * corner is a UI bug dressed up as atmosphere.
 */

import { TILE, TERRAIN, THINGS } from './defs.js';
import { ART, WALL } from './art.js';
import { SUB } from './light.js';

export class Camera {
  constructor(world) {
    this.x = (world.w * TILE) / 2;
    this.y = (world.h * TILE) / 2;
    this.zoom = 1.4;
  }

  screenToTile(px, py, canvas) {
    const wx = (px - canvas.width / 2) / this.zoom + this.x;
    const wy = (py - canvas.height / 2) / this.zoom + this.y;
    return [Math.floor(wx / TILE), Math.floor(wy / TILE)];
  }

  apply(c, canvas) {
    c.setTransform(this.zoom, 0, 0, this.zoom,
      canvas.width / 2 - this.x * this.zoom,
      canvas.height / 2 - this.y * this.zoom);
  }
}

export class Renderer {
  constructor(canvas, world, lights, camera) {
    this.canvas = canvas;
    this.c = canvas.getContext('2d');
    this.world = world;
    this.lights = lights;
    this.camera = camera;
    this.terrainCache = document.createElement('canvas');
    this.terrainVersion = -1;
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
  }

  /* Terrain never animates, so it is baked once into an offscreen canvas the
   * size of the whole map and blitted. Redrawing eight hundred speckled tiles
   * every frame is the sort of thing that quietly costs you the frame budget
   * before there is anything in the world worth spending it on. */
  bakeTerrain() {
    const { world } = this;
    const cv = this.terrainCache;
    cv.width = world.w * TILE;
    cv.height = world.h * TILE;
    const c = cv.getContext('2d');
    c.clearRect(0, 0, cv.width, cv.height);
    for (let y = 0; y < world.h; y++) {
      for (let x = 0; x < world.w; x++) {
        const def = TERRAIN[world.terrainAt(x, y)];
        const px = x * TILE, py = y * TILE;
        c.fillStyle = def.base;
        c.fillRect(px, py, TILE, TILE);
        // A little deterministic noise, so a big concrete floor isn't a flat
        // rectangle of one colour.
        const n = hash(x, y);
        // Grain, plus a whole-tile shade wobble. The wobble matters more than
        // the specks: a floor of one flat colour reads as a placeholder no
        // matter how much noise you sprinkle on it.
        c.fillStyle = n % 3 === 0 ? def.speck : def.base;
        c.globalAlpha = 0.35;
        c.fillRect(px, py, TILE, TILE);
        c.fillStyle = def.speck;
        for (let i = 0; i < 9; i++) {
          const h2 = hash(x * 7 + i, y * 13 + i);
          c.globalAlpha = 0.3 + (h2 % 50) / 110;
          c.fillRect(px + (h2 % TILE), py + ((h2 >> 5) % TILE), 1 + (h2 % 2), 1 + ((h2 >> 3) % 2));
        }
        c.globalAlpha = 1;
        if (def.grout) {
          const p = def.plate || 1;
          c.strokeStyle = def.grout;
          c.lineWidth = 1;
          if (def.planks) {            // long boards, staggered by row
            const off = (y % 2) * (TILE / 2);
            c.beginPath(); c.moveTo(px, py + 0.5); c.lineTo(px + TILE, py + 0.5); c.stroke();
            c.beginPath(); c.moveTo(px + off + 0.5, py); c.lineTo(px + off + 0.5, py + TILE); c.stroke();
          } else {
            c.globalAlpha = p > 1 ? 0.55 : 1;    // big plates, quiet seams
            if (x % p === 0) {
              c.beginPath(); c.moveTo(px + 0.5, py); c.lineTo(px + 0.5, py + TILE); c.stroke();
            }
            if (y % p === 0) {
              c.beginPath(); c.moveTo(px, py + 0.5); c.lineTo(px + TILE, py + 0.5); c.stroke();
            }
            c.globalAlpha = 1;
          }
          if (n % 13 === 0) {          // the odd stain
            c.fillStyle = 'rgba(0,0,0,.05)';
            c.fillRect(px + 3, py + 4, TILE - 8, TILE - 9);
          }
        }
      }
    }
    this.terrainVersion = world.paintVersion;
  }

  draw(overlay) {
    const { c, canvas, world, camera } = this;
    if (this.terrainVersion !== world.paintVersion) this.bakeTerrain();
    this.lights.update();

    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#0b0e11';
    c.fillRect(0, 0, canvas.width, canvas.height);
    camera.apply(c, canvas);

    c.imageSmoothingEnabled = false;
    c.drawImage(this.terrainCache, 0, 0);

    for (const thing of world.things.values()) {
      if (thing.key === 'wall') continue;              // walls drawn as runs
      this.drawThing(thing);
    }
    this.drawWalls();

    // Light, multiplied over everything built so far. The half-tile offset is
    // because sample (0,0) is the centre of tile (0,0), not its corner.
    const px = TILE / SUB, lw = world.w * TILE + px, lh = world.h * TILE + px;
    c.imageSmoothingEnabled = true;
    c.globalCompositeOperation = 'multiply';
    c.drawImage(this.lights.canvas, -px / 2, -px / 2, lw, lh);
    // ...then the excess above full brightness, added back. This is what makes
    // a lamp read as a light source rather than as a hole in a dark filter.
    c.globalCompositeOperation = 'lighter';
    c.drawImage(this.lights.glow, -px / 2, -px / 2, lw, lh);
    c.globalCompositeOperation = 'source-over';

    if (overlay) overlay(c);
  }

  drawThing(thing, ghost = false) {
    const { c } = this;
    const def = THINGS[thing.key];
    const art = ART[thing.key];
    if (!art) return;
    const w = def.size[0] * TILE, h = def.size[1] * TILE;
    c.save();
    if (ghost) c.globalAlpha = 0.55;
    c.translate(thing.cx * TILE, thing.cy * TILE);
    c.rotate((thing.rot || 0) * Math.PI / 2);
    c.translate(-w / 2, -h / 2);
    if (!ghost) {
      c.fillStyle = 'rgba(0,0,0,.22)';                 // contact shadow
      c.beginPath();
      c.roundRect(2, h - 5, w - 4, 6, 3);
      c.fill();
    }
    art(c, w, h, thing);
    c.restore();
  }

  /* Walls join into runs: a tile draws a full block, and the seams between it
   * and its neighbours are erased. Drawn after furniture so a wall always
   * reads as in front of whatever is against it. */
  drawWalls() {
    const { c, world } = this;
    for (const thing of world.things.values()) {
      if (thing.key !== 'wall') continue;
      const x = thing.x * TILE, y = thing.y * TILE;
      c.fillStyle = WALL.fill;
      c.fillRect(x, y, TILE, TILE);
      c.fillStyle = WALL.top;
      c.fillRect(x, y, TILE, 6);
      c.fillStyle = WALL.side;
      c.fillRect(x, y + TILE - 4, TILE, 4);
      c.strokeStyle = WALL.line;
      c.lineWidth = 1;
      const n = world.joinsAt(thing.x, thing.y - 1, 'wall');
      const s = world.joinsAt(thing.x, thing.y + 1, 'wall');
      const w2 = world.joinsAt(thing.x - 1, thing.y, 'wall');
      const e = world.joinsAt(thing.x + 1, thing.y, 'wall');
      c.beginPath();
      if (!n) { c.moveTo(x, y + 0.5); c.lineTo(x + TILE, y + 0.5); }
      if (!s) { c.moveTo(x, y + TILE - 0.5); c.lineTo(x + TILE, y + TILE - 0.5); }
      if (!w2) { c.moveTo(x + 0.5, y); c.lineTo(x + 0.5, y + TILE); }
      if (!e) { c.moveTo(x + TILE - 0.5, y); c.lineTo(x + TILE - 0.5, y + TILE); }
      c.stroke();
    }
  }
}

function hash(x, y) {
  let n = (x * 374761393 + y * 668265263) | 0;
  n = (n ^ (n >> 13)) * 1274126177;
  return Math.abs(n ^ (n >> 16));
}
