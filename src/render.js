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
import { AO_SUB } from './occlusion.js';

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
  constructor(canvas, world, lights, camera, occlusion) {
    this.canvas = canvas;
    this.c = canvas.getContext('2d');
    this.world = world;
    this.lights = lights;
    this.occlusion = occlusion;
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

  /* The world rectangle currently on screen, in world pixels, with a margin
   * for things that stand up above their own footprint. Everything that draws
   * clips to this — the map is far bigger than the view, and blitting all of
   * it every frame is most of a frame budget spent on pixels nobody sees. */
  view() {
    const { camera, canvas } = this;
    const hw = canvas.width / 2 / camera.zoom, hh = canvas.height / 2 / camera.zoom;
    const M = TILE * 3;
    return {
      x0: camera.x - hw - M, y0: camera.y - hh - M,
      x1: camera.x + hw + M, y1: camera.y + hh + M,
    };
  }

  /* Blit only the part of a full-map bitmap that is actually visible. `dw`/`dh`
   * are the size the whole bitmap would be drawn at, and `ox`/`oy` its origin
   * in world pixels — the light maps hang half a sample outside the map. */
  blitVisible(c, img, ox, oy, dw, dh, v) {
    const x0 = Math.max(ox, v.x0), y0 = Math.max(oy, v.y0);
    const x1 = Math.min(ox + dw, v.x1), y1 = Math.min(oy + dh, v.y1);
    if (x1 <= x0 || y1 <= y0) return;
    const sx = ((x0 - ox) / dw) * img.width, sy = ((y0 - oy) / dh) * img.height;
    const sw = ((x1 - x0) / dw) * img.width, sh = ((y1 - y0) / dh) * img.height;
    c.drawImage(img, sx, sy, sw, sh, x0, y0, x1 - x0, y1 - y0);
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

  /* What the composed scene depends on. Anything not in here can change
   * without a recompose — which is the point: the room is a still image except
   * for whatever is turning in it. */
  sceneKey() {
    const { camera, canvas, world, lights, occlusion } = this;
    // Whether each thing is moving is part of the key, because a thing that
    // starts turning has to come *out* of the baked scene — otherwise a fan
    // that was still when the scene was composed stays baked into it and is
    // drawn live on top as well, which shows up as a rectangle of doubled
    // pixels around it.
    let moving = 0;
    for (const t of world.things.values()) if (t.rate) moving++;
    return [camera.x, camera.y, camera.zoom, canvas.width, canvas.height,
      world.version, world.paintVersion, lights.stale, lights.sunAt,
      occlusion ? occlusion.stale : 0, moving].join(',');
  }

  draw(overlay) {
    const { c, canvas, camera } = this;
    const key = this.sceneKey();
    if (key !== this.composed) {
      this.compose();
      this.composed = key;
    }

    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(this._scene, 0, 0);
    camera.apply(c, canvas);

    // Only the things that are actually moving are redrawn per frame. Ground
    // first, so a fan's blades shadow the floor under it.
    const v = this.view();
    const moving = this.sorted().filter(t => t.rate && this.onScreen(t, v));
    for (const thing of moving) {
      const a = ART[thing.key];
      if (!a || !a.floor) continue;
      const [fw, fd] = footprint(thing.key, thing.rot);
      c.save();
      c.translate(thing.x * TILE, thing.y * TILE);
      a.floor(c, fw, fd, thing);
      c.restore();
    }
    if (moving.length) this.drawThings(v, moving, c, 'moving');

    if (overlay) overlay(c);
  }

  /* Everything that is holding still: terrain, occlusion, light, and every
   * object that is not turning. Redrawn only when the camera moves or the
   * world changes, which on a still scene is never. */
  compose() {
    const { world, camera } = this;
    if (this.terrainVersion !== world.paintVersion) this.bakeTerrain();
    this.lights.update();

    const [scene, c] = this.surface('_scene');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#0b0e11';
    c.fillRect(0, 0, scene.width, scene.height);
    camera.apply(c, scene);

    const v = this.view();
    c.imageSmoothingEnabled = false;
    this.blitVisible(c, this.terrainCache, 0, 0,
      world.w * TILE, world.h * TILE, v);

    // Ambient occlusion, straight onto the floor and under everything else.
    // Walls that do not darken the floor at their feet read as printed on it,
    // and the taller the wall the worse that looks.
    if (this.occlusion) {
      this.occlusion.update();
      c.imageSmoothingEnabled = true;
      c.globalCompositeOperation = 'multiply';
      this.blitVisible(c, this.occlusion.canvas, 0, 0,
        world.w * TILE, world.h * TILE, v);
      c.globalCompositeOperation = 'source-over';
      c.imageSmoothingEnabled = false;
    }

    for (const thing of this.sorted()) {
      const a = ART[thing.key];
      if (!a || !a.floor || thing.rate || !this.onScreen(thing, v)) continue;
      const [fw, fd] = footprint(thing.key, thing.rot);
      c.save();
      c.translate(thing.x * TILE, thing.y * TILE);
      a.floor(c, fw, fd, thing);
      c.restore();
    }

    // Light over the *ground only*, and the half-sample offset is because
    // sample (0,0) is the centre of tile (0,0), not its corner.
    //
    // Anything with height is lit separately, by its own footprint. A wall is
    // drawn thirty pixels above its own tile, so a screen-space light pass
    // samples it against whatever is a row north — for the north wall of a
    // room that is the dark outside, while its face gets the lit interior, and
    // the wall comes out in patches straddling the boundary.
    // Exactly over the map rectangle. These bitmaps cover the map one sample
    // per TILE/SUB, so any offset or padding here shifts every light in the
    // world by a fraction of a tile.
    const lw = world.w * TILE, lh = world.h * TILE;
    c.imageSmoothingEnabled = true;
    c.globalCompositeOperation = 'multiply';
    this.blitVisible(c, this.lights.canvas, 0, 0, lw, lh, v);
    c.globalCompositeOperation = 'lighter';
    this.blitVisible(c, this.lights.glow, 0, 0, lw, lh, v);
    c.globalCompositeOperation = 'source-over';
    c.imageSmoothingEnabled = false;

    const still = this.sorted().filter(t => !t.rate && this.onScreen(t, v));
    if (still.length) this.drawThings(v, still, c, 'still');
  }

  /* Everything with height, lit by the tile it stands on rather than by the
   * screen position it happens to be drawn at.
   *
   * Done as two full-screen layers rather than per object. The obvious version
   * — a little scratch canvas per thing — ping-pongs between GPU surfaces once
   * per object, and a room with a hundred and forty chairs in it ran at eight
   * frames a second. This does two cross-canvas draws for the whole scene
   * regardless of how much is in it.
   *
   *   layer   every thing, drawn once, on transparent
   *   tint    each thing's own light, as a flat rectangle over its silhouette
   *
   * Masking the tint to the layer first is what lets the multiply happen
   * without the rectangles painting over the floor between things.
   */
  drawThings(v, shown, out, pass) {
    const { camera, world } = this;
    // Each pass owns its layers. Sharing them let the static pass's furniture
    // sit in the buffer while the fan pass masked and blitted a small box out
    // of it, which painted a rectangle of stale, re-tinted furniture around
    // every fan.
    const [layer, lc] = this.surface(`layer:${pass}`);
    const [tint, tc] = this.surface(`tint:${pass}`);

    // Only the box those things actually cover gets cleared and blitted. On a
    // screen mostly full of floor that is a fraction of the pixels, and pixels
    // are the whole cost here. The previous box is cleared too, or a shrinking
    // one leaves its edges behind.
    const b = this.boundsOf(shown);
    const prev = this[`prev:${pass}`] || b;
    this[`prev:${pass}`] = b;
    const wipe = c2 => {
      c2.setTransform(1, 0, 0, 1, 0, 0);
      c2.clearRect(prev.x, prev.y, prev.w, prev.h);
      c2.clearRect(b.x, b.y, b.w, b.h);
    };
    wipe(lc);
    wipe(tc);
    camera.apply(lc, layer);
    camera.apply(tc, tint);

    tc.imageSmoothingEnabled = true;
    for (const thing of shown) {
      this.drawThingInto(lc, thing);

      const a = ART[thing.key];
      if (!a) continue;
      const h = a.h || 0;
      const [fw, fd] = footprint(thing.key, thing.rot);
      const X = thing.x * TILE, Y = thing.y * TILE;
      const pad = a.spread || 8;
      // The light over this thing's *footprint*, stretched up over its whole
      // silhouette. A single flat colour per thing works but quantises: under a
      // wall light the tiles either side differ enough to read as blocks. Taking
      // the patch straight off the light map keeps the gradient, and neighbours
      // stay continuous because they sample adjoining patches of the same map.
      const map = this.lights.canvas;
      const k = map.width / (world.w * TILE);          // samples per world pixel
      tc.drawImage(map, X * k, Y * k, fw * k, fd * k,
        X - pad, Y - h - pad, fw + pad * 2, fd + h + pad * 2);
    }

    tc.setTransform(1, 0, 0, 1, 0, 0);
    tc.globalCompositeOperation = 'destination-in';
    tc.drawImage(layer, b.x, b.y, b.w, b.h, b.x, b.y, b.w, b.h);
    tc.globalCompositeOperation = 'source-over';

    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalCompositeOperation = 'multiply';
    lc.drawImage(tint, b.x, b.y, b.w, b.h, b.x, b.y, b.w, b.h);
    lc.globalCompositeOperation = 'source-over';

    const m = out.getTransform();
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.drawImage(layer, b.x, b.y, b.w, b.h, b.x, b.y, b.w, b.h);
    out.setTransform(m);
  }

  /* The screen rectangle a set of things covers, clamped to the canvas. */
  boundsOf(things) {
    const { camera, canvas } = this;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of things) {
      const a = ART[t.key];
      const h = (a && a.h) || 0;
      // Some art reaches past its own footprint — a fan's blades overhang the
      // tile, as real ones do. Clip the bounds to the footprint and the blur
      // disc comes back as a rounded rectangle, because that is a circle cut
      // by a box.
      const pad = (a && a.spread) || 8;
      const [fw, fd] = footprint(t.key, t.rot);
      x0 = Math.min(x0, t.x * TILE - pad);
      y0 = Math.min(y0, t.y * TILE - h - pad);
      x1 = Math.max(x1, t.x * TILE + fw + pad);
      y1 = Math.max(y1, t.y * TILE + fd + pad);
    }
    const z = camera.zoom;
    const ox = canvas.width / 2 - camera.x * z, oy = canvas.height / 2 - camera.y * z;
    const sx = Math.max(0, Math.floor(x0 * z + ox));
    const sy = Math.max(0, Math.floor(y0 * z + oy));
    return {
      x: sx, y: sy,
      w: Math.min(canvas.width, Math.ceil(x1 * z + ox)) - sx,
      h: Math.min(canvas.height, Math.ceil(y1 * z + oy)) - sy,
    };
  }

  onScreen(t, v) {
    const a = ART[t.key];
    const [fw, fd] = footprint(t.key, t.rot);
    const h = (a && a.h) || 0;
    const pad = (a && a.spread) || 8;
    const x = t.x * TILE, y = t.y * TILE;
    return x + fw + pad > v.x0 && x - pad < v.x1
      && y + fd + pad > v.y0 && y - h - pad < v.y1;
  }

  surface(name) {
    const key = name.startsWith('_') ? name : '_' + name;
    if (!this[key]) this[key] = document.createElement('canvas');
    const cv = this[key];
    if (cv.width !== this.canvas.width || cv.height !== this.canvas.height) {
      cv.width = this.canvas.width;
      cv.height = this.canvas.height;
    }
    return [cv, cv.getContext('2d')];
  }

  /* A soft ellipse pooled at the foot of a thing. It was a rounded rectangle
   * at flat alpha, which at any zoom reads as a grey slab lying on the floor
   * rather than as a shadow — the softness is the whole point, and a
   * hard-edged shadow is worse than none. */
  contactShadow(c, t, a, fw, fd, h, ghost) {
    if (ghost || a.shadow === false || h <= 0) return;
    const sx = t.x * TILE + fw / 2, sy = t.y * TILE + fd - 1.5;
    const rx = fw * 0.5, ry = Math.min(fd * 0.3, 3.5 + h * 0.12);
    const r = Math.max(rx, ry);
    const g = c.createRadialGradient(sx, sy, 0, sx, sy, r);
    // Dark and tight at the foot, gone by the rim. A broad even ellipse reads
    // as a puddle under the furniture; occlusion is a contact effect.
    const dark = 0.3 + Math.min(0.16, h / 220);
    g.addColorStop(0, `rgba(0,0,0,${dark})`);
    g.addColorStop(0.35, `rgba(0,0,0,${dark * 0.5})`);
    g.addColorStop(0.7, `rgba(0,0,0,${dark * 0.14})`);
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
    this.drawThingInto(this.c, t, ghost);
  }

  drawThingInto(c, t, ghost = false) {
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
      this.contactShadow(c, t, a, fw, fd, h, ghost);
      c.save();
      c.translate(X, Y - h);
      a.view(c, fw, fd, h, rot, t);
      c.restore();
      c.restore();
      return;
    }

    // A wall with another wall in front of it shows no face — the neighbour's
    // body covers it. This one line is most of what makes a run of wall read
    // as a single structure rather than a row of separate blocks. A doorway
    // does not count: it is a hole, so the wall behind it is visible through
    // it and needs its face.
    const buried = def.joins && this.world.blocked(t.x, t.y + 1);

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
      // Deliberately no line along the buried edge. It used to be drawn so a
      // covered wall still showed where its top stopped, but on a north-south
      // run that line lands on every tile boundary and the whole wall reads as
      // a ladder.
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
