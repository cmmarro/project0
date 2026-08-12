/* Ambient occlusion on the floor.
 *
 * The single cheapest thing you can do to stop a room looking like furniture
 * lying on wallpaper. Two effects, one map:
 *
 *   contact    floor next to anything solid is darker, because less of the sky
 *              reaches it. Undirected, and it is what makes a wall look like it
 *              meets the floor rather than being printed on it.
 *   cast       a wall throws a shadow south, because everything in this art is
 *              lit from the north — the same convention as the highlight along
 *              the top lip of every object.
 *
 * Baked to a small bitmap and multiplied over the terrain, exactly like the
 * light map, and for the same reason: the softness is the browser interpolating
 * a coarse grid, which costs nothing and looks better than anything you would
 * write by hand.
 *
 * It rebuilds when the world changes, which for structure is rare. Do not be
 * tempted to fold it into the terrain bake — terrain changes when you paint a
 * floor, occlusion changes when you build a wall, and sharing a cache means
 * every wall you place re-speckles eight hundred tiles.
 */

const SUB = 4;                       // samples per tile, per axis
const REACH = 0.95;                  // how far contact darkening spreads, tiles
const CONTACT = 0.5;                 // how dark it gets at the foot of a wall
const CAST = 0.34;                   // ...and in the shadow thrown south of one
const CAST_REACH = 1.5;

export class Occlusion {
  constructor(world) {
    this.world = world;
    this.w = world.w * SUB;
    this.h = world.h * SUB;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.ctx = this.canvas.getContext('2d');
    this.image = this.ctx.createImageData(this.w, this.h);
    this.stale = -1;
  }

  update() {
    if (this.stale === this.world.version) return;
    this.stale = this.world.version;

    const { world, w, h, image } = this;
    const d = image.data;
    const R = Math.ceil(REACH), CR = Math.ceil(CAST_REACH);

    for (let sy = 0; sy < h; sy++) {
      for (let sx = 0; sx < w; sx++) {
        // Sample position in tile space, at the centre of its little cell.
        const px = (sx + 0.5) / SUB, py = (sy + 0.5) / SUB;
        const tx = Math.floor(px), ty = Math.floor(py);
        let occ = 0;

        // Contact: anything solid nearby, falling off with distance to the
        // nearest point of that tile rather than to its centre — otherwise a
        // sample right against a wall reads as half a tile away from it.
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            if (!world.blocked(tx + dx, ty + dy)) continue;
            const bx = tx + dx, by = ty + dy;
            const nx = Math.max(bx, Math.min(bx + 1, px));
            const ny = Math.max(by, Math.min(by + 1, py));
            const dist = Math.hypot(px - nx, py - ny);
            if (dist < REACH) occ += CONTACT * (1 - dist / REACH) ** 1.6;
          }
        }

        // Cast: a wall to the north puts this in shade. Reaches further than
        // contact does, and only ever downwards.
        for (let dy = 1; dy <= CR; dy++) {
          if (!world.blocked(tx, ty - dy)) continue;
          const gap = py - (ty - dy + 1);
          if (gap < CAST_REACH) occ += CAST * (1 - gap / CAST_REACH) ** 1.4;
          break;                     // only the nearest one casts
        }

        const v = 255 * (1 - Math.min(0.78, occ));
        const i = (sy * w + sx) * 4;
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
      }
    }
    this.ctx.putImageData(image, 0, 0);
  }

  /* How shaded a tile is, 0 = open floor. Nothing needs it yet; it is the same
   * number a pawn would want if it ever cared about being in shadow. */
  at(x, y) {
    if (!this.world.inside(x, y)) return 0;
    const i = ((y * SUB + 1) * this.w + x * SUB + 1) * 4;
    return 1 - this.image.data[i] / 255;
  }
}

export { SUB as AO_SUB };
