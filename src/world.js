/* The map: terrain underfoot, things on top, and the rules about what can go
 * where.
 *
 * Everything that changes the world goes through `place` and `remove`, so
 * there is exactly one place that knows a bed is two tiles long and one place
 * that marks the light map dirty. The renderer and the build menu only read.
 */

import { THINGS, TERRAIN } from './defs.js';

export class World {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.terrain = new Array(w * h).fill('void');
    // Which thing id occupies each tile. Multi-tile things write their id into
    // every tile they cover, so "what's under the cursor" is one array lookup
    // rather than a search through a list of rectangles.
    this.at = new Array(w * h).fill(null);
    this.things = new Map();
    this.nextId = 1;
    this.version = 0;                // bumped on any change, for cache checks
    // Terrain is baked into a bitmap and things are not, so they need separate
    // counters. Sharing one meant every lamp placed re-baked the entire floor.
    this.paintVersion = 0;
  }

  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  idx(x, y) {
    return y * this.w + x;
  }

  terrainAt(x, y) {
    return this.inside(x, y) ? this.terrain[this.idx(x, y)] : 'void';
  }

  thingAt(x, y) {
    if (!this.inside(x, y)) return null;
    const id = this.at[this.idx(x, y)];
    return id === null ? null : this.things.get(id);
  }

  /* Every tile a thing would cover if placed here. Rotation swaps the axes;
   * odd sizes therefore need the footprint computed rather than assumed. */
  footprint(key, x, y, rot = 0) {
    const def = THINGS[key];
    if (!def) return [];
    let [w, h] = def.size;
    if (rot % 2 === 1) [w, h] = [h, w];
    const tiles = [];
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) tiles.push([x + dx, y + dy]);
    }
    return tiles;
  }

  canPlace(key, x, y, rot = 0) {
    const def = THINGS[key];
    if (!def) return false;
    for (const [tx, ty] of this.footprint(key, x, y, rot)) {
      if (!this.inside(tx, ty)) return false;
      const other = this.thingAt(tx, ty);
      // Overhead things share a tile with whatever is standing on it; that is
      // the whole difference between a ceiling light and a standing lamp.
      if (other && (def.occupies !== false) && (THINGS[other.key].occupies !== false)) {
        return false;
      }
      if (other && other.key === key) return false;
    }
    return true;
  }

  place(key, x, y, rot = 0) {
    if (!this.canPlace(key, x, y, rot)) return null;
    const def = THINGS[key];
    const tiles = this.footprint(key, x, y, rot);
    const thing = {
      id: this.nextId++, key, x, y, rot,
      tiles,
      // The visual centre, which is not the origin for anything bigger than a
      // single tile. Kept here so the renderer never recomputes it.
      cx: x + (rot % 2 === 1 ? def.size[1] : def.size[0]) / 2,
      cy: y + (rot % 2 === 1 ? def.size[0] : def.size[1]) / 2,
      on: true,
    };
    this.things.set(thing.id, thing);
    if (def.occupies !== false) {
      for (const [tx, ty] of tiles) this.at[this.idx(tx, ty)] = thing.id;
    } else {
      thing.overhead = true;
    }
    this.version++;
    return thing;
  }

  remove(x, y) {
    const thing = this.thingAt(x, y) || this.overheadAt(x, y);
    if (!thing) return false;
    for (const [tx, ty] of thing.tiles) {
      if (this.at[this.idx(tx, ty)] === thing.id) this.at[this.idx(tx, ty)] = null;
    }
    this.things.delete(thing.id);
    this.version++;
    return true;
  }

  /* Overhead things aren't in the occupancy array, so finding one means a
   * scan. There are never many, and keeping them out of `at` is what lets you
   * put a lamp on a tile a pawn will later stand on. */
  overheadAt(x, y) {
    for (const t of this.things.values()) {
      if (!t.overhead) continue;
      if (t.tiles.some(([tx, ty]) => tx === x && ty === y)) return t;
    }
    return null;
  }

  paint(key, x, y) {
    if (!this.inside(x, y) || !TERRAIN[key]) return false;
    const i = this.idx(x, y);
    if (this.terrain[i] === key) return false;
    this.terrain[i] = key;
    this.version++;
    this.paintVersion++;
    return true;
  }

  blocked(x, y) {
    const t = this.thingAt(x, y);
    return !!(t && THINGS[t.key].blocks);
  }

  /* Whether a wall run should join to the neighbour, for drawing. */
  joinsAt(x, y, key) {
    const t = this.thingAt(x, y);
    if (!t) return false;
    if (t.key === key) return true;
    // A door reads as part of the wall it sits in, or every doorway looks
    // like a gap with something floating in it.
    return THINGS[t.key].inWall || (key === 'wall' && THINGS[t.key].inWall);
  }

  /* A starting room, so there is something on screen before you build. */
  static starter(w, h) {
    const world = new World(w, h);
    const x0 = Math.floor(w / 2) - 8, y0 = Math.floor(h / 2) - 6;
    const x1 = x0 + 16, y1 = y0 + 12;
    for (let y = y0 + 1; y < y1; y++) {
      for (let x = x0 + 1; x < x1; x++) world.paint('concrete', x, y);
    }
    for (let x = x0; x <= x1; x++) {
      world.place('wall', x, y0);
      world.place('wall', x, y1);
    }
    for (let y = y0 + 1; y < y1; y++) {
      world.place('wall', x0, y);
      world.place('wall', x1, y);
    }
    world.remove(x0 + 8, y1);
    world.place('door', x0 + 8, y1);
    world.place('ceilinglight', x0 + 8, y0 + 6);
    return world;
  }
}
