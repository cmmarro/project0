/* Drawing the world, and the camera that decides which bit of it.
 *
 * The view is high oblique: square grid, axis-aligned, but tilted enough that
 * everything shows a top and a south face. Two things follow from that, and
 * both are structural rather than cosmetic.
 *
 * Height is a *screen-space* offset. A thing's top face is drawn one `h` above
 * its footprint and its south face hangs below that; the footprint itself
 * never moves. So placement, occupancy and (later) pathing stay on a plain
 * square grid and know nothing about any of this.
 *
 * And things now overlap, so draw order stops being free. Everything sorts by
 * the south edge of its footprint — painter's algorithm — which is why walls
 * are in the same pass as furniture rather than drawn last.
 *
 * Order overall: terrain, then the sorted pass, then light multiplied over all
 * of it, then the build overlay. The overlay sits above the light on purpose —
 * a placement ghost you can't see in an unlit corner is a UI bug dressed up as
 * atmosphere.
 */

import { TILE, TERRAIN, THINGS } from './defs.js';
import { ART } from './art.js';
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

/* A thing's footprint in pixels, with rotation applied. */
export function footprint(key, rot = 0) {
  const [w, d] = THINGS[key].size;
  return rot % 2 ? [d * TILE, w * TILE] : [w * TILE, d * TILE];
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
    this.order = [];
    this.orderVersion = -1;
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
  }

  /* Terrain never animates, so it is baked once into an offscreen canvas the
   * size of the whole map and blitted. Redrawing eight hundred speckled tiles
   * every frame quietly costs the frame budget before there is anything in the
   * world worth spending it on. */
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
        const n = hash(x, y);
        c.fillStyle = def.base;
        c.fillRect(px, py, TILE, TILE);
        // Grain, plus a whole-tile shade wobble. The wobble matters more than
        // the specks: a floor of one flat colour reads as a placeholder no
        // matter how much noise you sprinkle on it.
        c.fillStyle = n % 4 === 0 ? def.speck : def.base;
        c.globalAlpha = 0.1 + (n % 7) * 0.02;
        c.fillRect(px, py, TILE, TILE);
        c.fillStyle = def.speck;
        for (let i = 0; i < 9; i++) {
          const h2 = hash(x * 7 + i, y * 13 + i);
          c.globalAlpha = 0.3 + (h2 % 50) / 110;
          c.fillRect(px + (h2 % TILE), py + ((h2 >> 5) % TILE),
            1 + (h2 % 2), 1 + ((h2 >> 3) % 2));
        }
        c.globalAlpha = 1;
        if (def.grout) {
          const p = def.plate || 1;
          c.strokeStyle = def.grout;
          c.lineWidth = 1;
          if (def.planks) {              // long boards, staggered by row
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
          if (n % 13 === 0) {            // the odd stain
            c.fillStyle = 'rgba(0,0,0,.05)';
            c.fillRect(px + 3, py + 4, TILE - 8, TILE - 9);
          }
        }
      }
    }
    this.terrainVersion = world.paintVersion;
  }

  /* Painter's order: south edge first, then west, then height — so a tall
   * thing on the same row draws over a short one behind it. Overhead things go
   * last regardless, because they hang above the whole scene. */
  sorted() {
    if (this.orderVersion === this.world.version) return this.order;
    this.orderVersion = this.world.version;
    this.order = [...this.world.things.values()].sort((a, b) => {
      if (!!a.overhead !== !!b.overhead) return a.overhead ? 1 : -1;
      const [, ad] = footprint(a.key, a.rot);
      const [, bd] = footprint(b.key, b.rot);
      return (a.y * TILE + ad) - (b.y * TILE + bd) || a.x - b.x;
    });
    return this.order;
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

    // Anything an overhead thing casts on the floor goes down before the
    // furniture, so a chair under a fan is lit by the room and shadowed by the
    // blades rather than having a shadow painted over the top of it.
    for (const thing of this.sorted()) {
      const a = ART[thing.key];
      if (!a || !a.floor) continue;
      const [fw, fd] = footprint(thing.key, thing.rot);
      c.save();
      c.translate(thing.x * TILE, thing.y * TILE);
      a.floor(c, fw, fd, thing);
      c.restore();
    }

    for (const thing of this.sorted()) this.drawThing(thing);

    // Light, multiplied over everything built so far. The half-sample offset is
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

  /* A soft ellipse pooled at the foot of a thing. It was a rounded rectangle
   * at flat alpha, which at any zoom reads as a grey slab lying on the floor
   * rather than as a shadow — the softness is the whole point, and a
   * hard-edged shadow is worse than none. */
  contactShadow(t, a, fw, fd, h, ghost) {
    if (ghost || a.shadow === false || h <= 0) return;
    const c = this.c;
    const sx = t.x * TILE + fw / 2, sy = t.y * TILE + fd - 2.5;
    const rx = fw * 0.46 + 2, ry = Math.min(fd * 0.34, 4 + h * 0.16);
    const r = Math.max(rx, ry);
    const g = c.createRadialGradient(sx, sy, 0, sx, sy, r);
    const dark = 0.2 + Math.min(0.14, h / 260);
    g.addColorStop(0, `rgba(0,0,0,${dark})`);
    g.addColorStop(0.5, `rgba(0,0,0,${dark * 0.45})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.save();
    c.translate(sx, sy);
    c.scale(rx / r, ry / r);
    c.translate(-sx, -sy);
    c.fillStyle = g;
    c.beginPath();
    c.arc(sx, sy, r, 0, 7);
    c.fill();
    c.restore();
  }

  /* One thing: shadow on the floor, south face, then top face lifted by `h`.
   * `t` needs only { key, x, y, rot } — the build ghost passes a bare object
   * rather than a placed thing. */
  drawThing(t, ghost = false) {
    const c = this.c;
    const def = THINGS[t.key];
    const a = ART[t.key];
    if (!a) return;
    const rot = t.rot || 0;
    const [fw, fd] = footprint(t.key, rot);
    const X = t.x * TILE, Y = t.y * TILE;
    const h = a.h || 0;
    const taper = a.taper === undefined ? 2 : a.taper;

    c.save();
    if (ghost) c.globalAlpha = 0.62;

    this.contactShadow(t, a, fw, fd, h, ghost);

    // Viewed things draw themselves whole, into a box running from the top of
    // their height down to the south edge of their footprint. Everything below
    // is the extruded path, which only makes sense for things that are boxes.
    if (a.view) {
      this.contactShadow(t, a, fw, fd, h, ghost);
      c.save();
      c.translate(X, Y - h);
      a.view(c, fw, fd, h, rot, t);
      c.restore();
      c.restore();
      return;
    }

    // A wall with another wall in front of it shows no face — the neighbour's
    // body covers it. This one line is most of what makes a run of wall read
    // as a single structure rather than a row of separate blocks.
    const buried = def.joins && this.world.structureAt(t.x, t.y + 1);

    if (h > 0 && !buried) {
      // The south face hangs between the bottom of the top face and the bottom
      // of the footprint, so the whole silhouette runs from Y-h to Y+fd.
      const faceTop = Y + fd - h;
      c.save();
      c.beginPath();                        // taper the sides toward the floor
      c.moveTo(X, faceTop);
      c.lineTo(X + fw, faceTop);
      c.lineTo(X + fw - taper, faceTop + h);
      c.lineTo(X + taper, faceTop + h);
      c.closePath();
      c.clip();
      c.translate(X, faceTop);
      if (a.face) {
        a.face(c, fw, h, t);
      } else {
        const g = c.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, a.side || '#7d7668');
        g.addColorStop(1, shade(a.side || '#7d7668', -0.3));
        c.fillStyle = g;
        c.fillRect(0, 0, fw, h);
        c.fillStyle = 'rgba(255,255,255,.14)';
        c.fillRect(0, 0, fw, 1.5);
      }
      c.restore();
      // Only the default slab gets a tapered outline. Anything that draws its
      // own face has legs or panels, and two diagonals ruled through the empty
      // air beside them is worse than no taper at all.
      if (taper > 0 && !a.face) {           // the taper's own outline
        c.strokeStyle = 'rgba(26,22,18,.6)';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(X + 0.5, faceTop);
        c.lineTo(X + taper + 0.5, faceTop + h);
        c.moveTo(X + fw - 0.5, faceTop);
        c.lineTo(X + fw - taper - 0.5, faceTop + h);
        c.stroke();
      }
    }

    // The top face, lifted, and rotated about its own centre.
    const [w0, d0] = [def.size[0] * TILE, def.size[1] * TILE];
    c.save();
    c.translate(X + fw / 2, Y - h + fd / 2);
    c.rotate(rot * Math.PI / 2);
    c.translate(-w0 / 2, -d0 / 2);
    a.top(c, w0, d0, t);
    c.restore();

    // A wall run's exposed top edges. Without these a north-south run has no
    // outline at all — its top face is the only thing you can see of it, and
    // it reads as a strip of pale floor rather than as a wall.
    if (def.joins && !ghost) {
      const T = Y - h, B = Y - h + fd, L = X, R = X + fw;
      c.strokeStyle = 'rgba(26,22,18,.7)';
      c.lineWidth = 1;
      c.beginPath();
      if (!this.world.structureAt(t.x, t.y - 1)) { c.moveTo(L, T + 0.5); c.lineTo(R, T + 0.5); }
      if (!this.world.structureAt(t.x - 1, t.y)) { c.moveTo(L + 0.5, T); c.lineTo(L + 0.5, B); }
      if (!this.world.structureAt(t.x + 1, t.y)) { c.moveTo(R - 0.5, T); c.lineTo(R - 0.5, B); }
      if (buried) { c.moveTo(L, B - 0.5); c.lineTo(R, B - 0.5); }
      c.stroke();
    }
    c.restore();
  }
}

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const f = v => Math.max(0, Math.min(255, Math.round(v * (1 + amount))));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function hash(x, y) {
  let n = (x * 374761393 + y * 668265263) | 0;
  n = (n ^ (n >> 13)) * 1274126177;
  return Math.abs(n ^ (n >> 16));
}
