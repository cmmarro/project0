/* How each thing looks, in a world with a bit of height to it.
 *
 * The view is high oblique: looking down at the room, but tilted enough that
 * you see the south face of everything as well as its top. Not isometric — the
 * grid stays square and axis-aligned, which keeps placement, occupancy and
 * pathing exactly as simple as they were. Only the drawing changes.
 *
 * There are two ways to draw a thing, and which one you want depends entirely
 * on whether the thing is a box.
 *
 * EXTRUDED — for things that are boxes: walls, tables, beds, the dispenser.
 *
 *   top(c, w, d, thing)      the top surface, in a w×d box. Rotates with the
 *                            object, because a bed's pillow end turns.
 *   face(c, w, h, thing)     the south face, w wide and h tall, hanging below
 *                            the top. Never rotates, because "up" is a property
 *                            of the screen and not of the furniture.
 *
 *   Anything without a `face` gets a default slab in its `side` colour, tapered
 *   inward at the bottom. That taper is two lines doing most of the work of
 *   making a box read as a box.
 *
 * VIEWED — for things that are not boxes. A chair is mostly vertical structure
 * with a seat hanging off it, and extruding it can only ever produce an orange
 * box with a bar on the front. So instead:
 *
 *   view(c, w, d, h, rot)    the whole thing, drawn into a w × (d+h) box with
 *                            the footprint's south edge at the bottom. One
 *                            drawing per facing, switched on rot.
 *
 *   This is the sprite-sheet model — north/south/east/west art — except the
 *   frames are canvas commands rather than PNGs, so they stay legible in the
 *   source and cost nothing to load. Reach for it the moment a thing's
 *   silhouette changes shape when you turn it.
 *
 * Two palette rules, both learned by getting them wrong. Art is drawn at *full
 * brightness* and lit down — anything already dim turns to sludge the moment
 * light multiplies over it. And materials must separate: a floor, a wall and a
 * table within a few percent of each other read as one grey mass however good
 * the shapes are.
 */

import { blur } from './anim.js';

const LINE = 'rgba(26,22,18,.85)';

/* A stable number per tile, so a wall's grain does not crawl between frames. */
function grain(x, y) {
  let n = ((x | 0) * 374761393 + (y | 0) * 668265263) | 0;
  n = (n ^ (n >> 13)) * 1274126177;
  return Math.abs(n ^ (n >> 16));
}

function tint(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = v => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/* A little dirt. Deterministic from the seed, so it is part of the object
 * rather than noise that shimmers. */
function speckle(c, x, y, w, h, seed, fill) {
  c.fillStyle = fill;
  for (let i = 0; i < 7; i++) {
    const g = grain(seed + i * 31, i * 17);
    c.fillRect(x + (g % Math.max(1, w - 2)), y + ((g >> 6) % Math.max(1, h - 2)),
      1 + (g % 2), 1);
  }
}

export function box(c, x, y, w, h, fill, r = 2) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  c.fillStyle = fill;
  c.fill();
  c.lineWidth = 1.25;
  c.strokeStyle = LINE;
  c.stroke();
}

/* A leg: a tapered post from the underside of something down to the floor.
 * `top` is where it starts, which is 0 for an extruded face (the face region
 * begins at the underside) and some way down for a viewed thing. */
function leg(c, x, h, w = 5, fill = '#6d4c28', top = 0) {
  c.beginPath();
  c.moveTo(x, top);
  c.lineTo(x + w, top);
  c.lineTo(x + w - 0.8, top + h);
  c.lineTo(x + 0.8, top + h);
  c.closePath();
  c.fillStyle = fill;
  c.fill();
  c.lineWidth = 1;
  c.strokeStyle = LINE;
  c.stroke();
}

/* The edge of a horizontal surface seen from slightly in front — a thin band
 * of the top colour, darkened, with a highlight along its upper lip.
 *
 * Takes an x and a width rather than assuming the full footprint, because the
 * band has to line up with the surface above it. A seat inset two pixels with
 * an edge band drawn full-width is exactly how furniture comes apart.
 */
function edge(c, x, w, t, fill, hi = 'rgba(255,255,255,.18)') {
  c.fillStyle = fill;
  c.fillRect(x, 0, w, t);
  c.fillStyle = hi;
  c.fillRect(x, 0, w, 1.5);
  c.strokeStyle = LINE;
  c.lineWidth = 1;
  c.strokeRect(x + 0.5, 0.5, w - 1, t - 1);
}

export const ART = {
  wall: {
    // Taller than it was. The cost of height in this projection is that a wall
    // covers what is behind it, so the room's south wall eats into the row
    // above — which is why the floor occlusion below it matters so much. Past
    // about a tile it starts hiding furniture rather than framing it.
    h: 30,
    taper: 0,                       // structure doesn't taper; furniture does
    shadow: false,                  // the occlusion map does its footing
    side: '#7d7668',
    top(c, w, d, t) {
      // Flat, and nothing that lines up with the tile. A run of wall is one
      // continuous surface, so anything drawn *per tile* — a highlight along
      // its top, a shade of its own, an outline at its bottom edge — repeats
      // and reads as banding down the length of the run. Only the speckle
      // survives, because it is noise and noise does not tile.
      c.fillStyle = '#a9a192';
      c.fillRect(0, 0, w, d);
      speckle(c, 0, 0, w, d, grain(t.x || 0, t.y || 0), 'rgba(0,0,0,.045)');
    },
    face(c, w, h, t) {
      const n = grain(t.x || 0, t.y || 0);
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#928a7b');
      g.addColorStop(0.62, '#7a7466');
      g.addColorStop(1, '#585448');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);

      // Courses, offset every other row so a run reads as laid rather than
      // extruded. Two lines, and it is most of the difference between a wall
      // and a grey rectangle.
      c.strokeStyle = 'rgba(0,0,0,.13)';
      c.lineWidth = 1;
      const rows = 3, rh = (h - 5) / rows;
      for (let i = 1; i <= rows; i++) {
        const y = Math.round(i * rh) + 0.5;
        c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
        // Staggered by tile as well as by course, so a long run reads as
        // brickwork rather than as the same tile printed twenty times.
        const off = ((i + (t.x || 0)) % 2) * (w / 2);
        c.beginPath(); c.moveTo(off + 0.5, y - rh); c.lineTo(off + 0.5, y); c.stroke();
      }
      speckle(c, 0, 0, w, h, n, 'rgba(0,0,0,.06)');

      c.fillStyle = 'rgba(255,255,255,.18)';     // the lip where top meets face
      c.fillRect(0, 0, w, 1.5);
      c.fillStyle = 'rgba(30,26,20,.34)';        // skirting, where it meets the floor
      c.fillRect(0, h - 4, w, 4);
      c.fillStyle = 'rgba(255,255,255,.06)';
      c.fillRect(0, h - 4.5, w, 1);
    },
  },

  door: {
    h: 30,
    shadow: false,
    // Viewed, not extruded — and this is the clearest case for the distinction
    // in the whole catalogue. A door leaf is a thin *vertical plane*. It has no
    // top surface at all, so forcing it through top-plus-face draws a full
    // tile-deep slab lying flat AND a thirty-pixel front, and you see the door
    // twice: once on the floor and once standing up.
    //
    // Underneath it is floor. A doorway is a hole in a wall; if the wall were
    // not there you would be looking at the ground, so nothing here paints over
    // the tile. The walls either side supply their own cut ends.
    view(c, w, d, h, rot) {
      const ground = h + d * 0.5;              // where the leaf stands
      const wood = '#8a6233';

      if (rot % 2 === 1) {
        // In a north-south run you see the leaf edge-on: a narrow slab running
        // away from you, so its silhouette is the full depth of the tile plus
        // its height.
        const th = 6, x = w / 2 - th / 2;
        c.fillStyle = 'rgba(0,0,0,.3)';
        c.fillRect(x + th, h * 0.5, 3, d + h * 0.5);
        c.fillStyle = wood;
        c.fillRect(x, 0, th, h + d);
        c.fillStyle = 'rgba(255,255,255,.13)';
        c.fillRect(x, 0, th, 2);
        c.fillStyle = 'rgba(0,0,0,.22)';
        c.fillRect(x + th - 2, 0, 2, h + d);
        c.strokeStyle = LINE;
        c.lineWidth = 1;
        c.strokeRect(x + 0.5, 0.5, th - 1, h + d - 1);
        return;
      }

      // Facing you: a panel standing on the floor at the middle of the tile.
      const inset = 1.5;
      const x0 = inset, lw = w - inset * 2;
      const top = ground - h, lh = h;

      c.fillStyle = 'rgba(0,0,0,.34)';         // what it throws on the floor
      c.fillRect(x0 + 1, ground - 1, lw - 2, 5);

      c.fillStyle = wood;
      c.fillRect(x0, top, lw, lh);
      const shade = c.createLinearGradient(0, top, 0, top + lh);
      shade.addColorStop(0, 'rgba(255,255,255,.12)');
      shade.addColorStop(0.28, 'rgba(0,0,0,.03)');
      shade.addColorStop(1, 'rgba(0,0,0,.24)');
      c.fillStyle = shade;
      c.fillRect(x0, top, lw, lh);

      c.fillStyle = '#a5763f';                 // the leaf's top edge, seen from above
      c.fillRect(x0, top, lw, 2.5);
      c.fillStyle = 'rgba(255,255,255,.2)';
      c.fillRect(x0, top, lw, 1);

      c.fillStyle = 'rgba(0,0,0,.2)';          // a middle rail, two panels
      c.fillRect(x0 + 2, top + lh * 0.46, lw - 4, 1.5);
      c.strokeStyle = 'rgba(0,0,0,.16)';
      c.lineWidth = 1;
      c.strokeRect(x0 + 2.5, top + 3.5, lw - 5, lh * 0.4 - 4);
      c.strokeRect(x0 + 2.5, top + lh * 0.53, lw - 5, lh * 0.4 - 3);
      c.strokeStyle = LINE;
      c.lineWidth = 1.25;
      c.strokeRect(x0 + 0.5, top + 0.5, lw - 1, lh - 1);

      c.fillStyle = '#d8c08c';                 // handle
      c.fillRect(x0 + lw - 5.5, top + lh * 0.44, 2.5, 5);
    },
  },

  bed: {
    h: 12,
    taper: 0,                       // it has legs; the taper would cut the air
    side: '#6d4c28',
    top(c, w, d) {
      box(c, 0.5, 0.5, w - 1, d - 1, '#8a5f33', 3);                  // frame
      c.fillStyle = 'rgba(0,0,0,.12)';                                // inner rebate
      c.fillRect(3, 2.5, w - 6, d - 5);

      const headD = d * 0.13;
      box(c, 1.5, 1.5, w - 3, headD, '#9c6d3d', 2.5);                // headboard
      c.fillStyle = 'rgba(255,255,255,.16)';
      c.fillRect(3, 2.5, w - 6, 2);

      const y0 = 1.5 + headD + 1;
      box(c, 3, y0, w - 6, d - y0 - 2.5, '#e6e2d5', 2);              // mattress
      const sheetY = y0 + d * 0.2;
      box(c, 3.5, sheetY, w - 7, d - sheetY - 3, '#4a7fa6', 2);      // blanket
      c.fillStyle = '#f2efe4';                                        // turn-down
      c.fillRect(4.5, sheetY - 3.5, w - 9, 5);
      c.strokeStyle = 'rgba(0,0,0,.14)';
      c.lineWidth = 1;
      c.strokeRect(4.5, sheetY - 3.5, w - 9, 5);

      c.fillStyle = 'rgba(255,255,255,.14)';                          // pillow
      box(c, 5, y0 + 2, w - 10, d * 0.13, '#fbf8ee', 3);

      c.strokeStyle = 'rgba(0,0,0,.10)';                              // quilting
      c.lineWidth = 1;
      for (let i = 1; i < 3; i++) {
        const x = 3.5 + ((w - 7) / 3) * i;
        c.beginPath(); c.moveTo(x, sheetY + 3); c.lineTo(x, d - 4); c.stroke();
      }
      for (const f of [0.62, 0.82]) {
        c.beginPath(); c.moveTo(4.5, d * f); c.lineTo(w - 4.5, d * f); c.stroke();
      }
    },
    face(c, w, h) {
      leg(c, 2.5, h);                               // legs first, rail over them
      leg(c, w - 7.5, h);
      edge(c, 0.5, w - 1, h * 0.52, '#7a5330');     // the footboard rail
      c.fillStyle = 'rgba(0,0,0,.16)';
      c.fillRect(1.5, h * 0.52 - 2, w - 3, 2);
    },
  },

  table: {
    h: 17,
    taper: 0,
    side: '#8a5f33',
    top(c, w, d) {
      box(c, 0.5, 0.5, w - 1, d - 1, '#a5763f', 3);
      // Boards running the long way, with the end grain showing at the edges.
      const boards = Math.max(3, Math.round(w / 16));
      c.strokeStyle = 'rgba(0,0,0,.19)';
      c.lineWidth = 1;
      for (let i = 1; i < boards; i++) {
        const x = Math.round(2 + ((w - 4) / boards) * i) + 0.5;
        c.beginPath(); c.moveTo(x, 2.5); c.lineTo(x, d - 2.5); c.stroke();
      }
      c.strokeStyle = 'rgba(255,255,255,.09)';
      for (let i = 1; i < boards; i++) {
        const x = Math.round(2 + ((w - 4) / boards) * i) + 1.5;
        c.beginPath(); c.moveTo(x, 2.5); c.lineTo(x, d - 2.5); c.stroke();
      }
      c.fillStyle = 'rgba(255,255,255,.13)';         // the light from the north
      c.fillRect(2, 2, w - 4, d * 0.14);
      c.fillStyle = 'rgba(0,0,0,.10)';
      c.fillRect(2, d - 4, w - 4, 2.5);
      speckle(c, 4, 4, w - 8, d - 8, 7, 'rgba(60,40,20,.14)');
    },
    face(c, w, h) {
      // A tabletop is a thin slab on legs over an apron, and drawing it as a
      // solid block is the single thing that most makes furniture look like
      // painted floor. Legs first so the slab's outline closes over them.
      leg(c, 3.5, h, 5);
      leg(c, w - 8.5, h, 5);
      c.fillStyle = '#7a5330';                       // the apron between them
      c.fillRect(6, 4, w - 12, h * 0.34);
      c.strokeStyle = LINE;
      c.lineWidth = 1;
      c.strokeRect(6.5, 4.5, w - 13, h * 0.34 - 1);
      edge(c, 0.5, w - 1, 6, '#9d6f34');
    },
  },

  chair: {
    h: 18,
    // Viewed, not extruded. A chair is a back with a seat hanging off it, and
    // the two swap places when you turn it — facing away, the backrest stands
    // in front of the seat and hides its edge; facing sideways, it is a panel
    // down one side. No amount of top-plus-face gets you that.
    view(c, w, d, h, rot) {
      const F = h + d;                     // the full silhouette, top to floor
      const seatT = '#a5763f', seatE = '#8a5f33', back = '#7a5330', legs = '#6d4c28';
      const floor = F - 1;

      // Legs, drawn first so every panel's outline closes over them.
      const post = (x, top) => leg(c, x, floor - top, 4, legs, top);

      if (rot === 1 || rot === 3) {
        // Sideways. Mirror one view for the other rather than writing it twice
        // — they differ only in which side the back is on. Drawn with the back
        // to the west, so rot 1 is the mirrored one: a quarter turn clockwise
        // takes the back from north to east, the same way the bed's pillow goes.
        c.save();
        if (rot === 1) { c.translate(w, 0); c.scale(-1, 1); }
        post(w * 0.34, F * 0.6);
        post(w * 0.78, F * 0.66);
        box(c, w * 0.28, F * 0.44, w * 0.66, F * 0.2, seatT, 2.5);   // the seat
        c.fillStyle = 'rgba(255,255,255,.10)';
        c.fillRect(w * 0.31, F * 0.46, w * 0.6, 3);
        c.fillStyle = seatE;                                          // its edge
        c.fillRect(w * 0.28, F * 0.62, w * 0.66, 3);
        box(c, w * 0.1, F * 0.16, w * 0.2, F * 0.5, back, 2);         // the back
        c.restore();
        return;
      }

      if (rot === 2) {
        // Facing away. You are looking at the outside of the backrest, and it
        // stands in front of the seat.
        post(w * 0.16, F * 0.66);
        post(w - w * 0.16 - 4, F * 0.66);
        box(c, w * 0.12, F * 0.3, w * 0.76, F * 0.24, seatT, 2.5);    // seat behind
        box(c, w * 0.14, F * 0.46, w * 0.72, F * 0.26, back, 2);      // back in front
        c.fillStyle = 'rgba(255,255,255,.08)';
        c.fillRect(w * 0.17, F * 0.48, w * 0.66, 3);
        return;
      }

      // Facing you. The back rises behind the seat; you see the seat surface
      // and the front edge it sits on.
      post(w * 0.16, F * 0.74);
      post(w - w * 0.16 - 4, F * 0.74);
      box(c, w * 0.14, F * 0.06, w * 0.72, F * 0.26, back, 2);        // back, behind
      box(c, w * 0.12, F * 0.28, w * 0.76, F * 0.44, seatT, 2.5);     // the seat
      c.fillStyle = 'rgba(0,0,0,.14)';                                 // its shadow
      c.fillRect(w * 0.15, F * 0.3, w * 0.7, 3);
      c.fillStyle = 'rgba(255,255,255,.10)';
      c.fillRect(w * 0.15, F * 0.35, w * 0.7, 3);
      c.fillStyle = seatE;                                             // front edge
      c.fillRect(w * 0.12, F * 0.66, w * 0.76, 5);
      c.strokeStyle = LINE;
      c.lineWidth = 1;
      c.strokeRect(w * 0.12 + 0.5, F * 0.66 + 0.5, w * 0.76 - 1, 4);
    },
  },

  dispenser: {
    h: 26,
    taper: 1,
    side: '#7c868e',
    top(c, w, d) {
      box(c, 0.5, 0.5, w - 1, d - 1, '#9aa4ac', 2.5);
      box(c, 3, 2.5, w - 6, d * 0.4, '#78838c', 2);   // hopper along the back
      c.fillStyle = 'rgba(255,255,255,.16)';          // its lid, catching light
      c.fillRect(4, 3.5, w - 8, 2.5);
      c.strokeStyle = 'rgba(0,0,0,.22)';              // the lid's seam
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(w / 2, 3); c.lineTo(w / 2, 2.5 + d * 0.4);
      c.stroke();
      c.fillStyle = '#5d666d';                        // a panel, off to one side
      c.fillRect(w - 20, d * 0.62, 15, d * 0.24);
      c.fillStyle = '#7fe0aa';
      c.beginPath(); c.arc(w - 16, d * 0.74, 1.8, 0, 7); c.fill();
      c.fillStyle = '#e0b46a';
      c.beginPath(); c.arc(w - 11, d * 0.74, 1.8, 0, 7); c.fill();
      speckle(c, 3, 3, w - 6, d - 6, 11, 'rgba(20,30,36,.16)');
    },
    face(c, w, h) {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#9ba5ad');
      g.addColorStop(0.55, '#828d95');
      g.addColorStop(1, '#616b73');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(255,255,255,.2)';
      c.fillRect(0, 0, w, 1.5);

      c.strokeStyle = 'rgba(0,0,0,.16)';              // panel seams
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(0, h * 0.24 + 0.5); c.lineTo(w, h * 0.24 + 0.5);
      c.stroke();

      const n = Math.max(2, Math.round(w / 24));      // nozzles, and a tray each
      for (let i = 0; i < n; i++) {
        const x = ((i + 0.5) * (w - 10)) / n + 5;
        c.fillStyle = '#2f363c';
        c.beginPath();
        c.roundRect(x - 4.5, h * 0.3, 9, h * 0.4, 1.5);
        c.fill();
        c.fillStyle = 'rgba(255,255,255,.10)';
        c.fillRect(x - 3.5, h * 0.32, 7, 1.5);
        c.fillStyle = '#4d565d';
        c.beginPath();
        c.roundRect(x - 7, h - 7, 14, 4, 1.5);
        c.fill();
        c.strokeStyle = 'rgba(0,0,0,.4)';
        c.stroke();
      }
      c.fillStyle = 'rgba(255,255,255,.13)';          // a maker's plate
      c.fillRect(3, h - 6, 9, 3);
      speckle(c, 2, 3, w - 4, h - 8, 19, 'rgba(20,30,36,.2)');
      c.strokeStyle = LINE;
      c.lineWidth = 1;
      c.strokeRect(0.5, 0.5, w - 1, h - 1);
    },
  },

  lamp: {
    h: 34,
    taper: 0,
    side: '#6f7981',
    top(c, w, d) {
      // The stem is drawn here as well, running from under the shade to the
      // south edge of the box — otherwise it starts at the face and the shade
      // hangs several pixels clear of it in mid-air.
      const x = w / 2;
      c.fillStyle = '#6f7981';
      c.fillRect(x - 2.5, d * 0.5, 5, d * 0.5);
      c.strokeStyle = LINE;
      c.lineWidth = 1;
      c.strokeRect(x - 2, d * 0.5, 4, d * 0.5);
      // The shade, seen from above and slightly in front: an ellipse with the
      // lit underside just showing at the near edge.
      c.beginPath();
      c.ellipse(x, d * 0.42, w * 0.36, d * 0.3, 0, 0, 7);
      c.fillStyle = '#f2d78f';
      c.fill();
      c.lineWidth = 1.25;
      c.strokeStyle = LINE;
      c.stroke();
      c.beginPath();
      c.ellipse(x, d * 0.38, w * 0.2, d * 0.15, 0, 0, 7);
      c.fillStyle = '#fff3cd';
      c.fill();
    },
    face(c, w, h) {
      const x = w / 2;
      c.fillStyle = '#6f7981';                      // stem, continuing down
      c.beginPath();
      c.moveTo(x - 2.5, 0);
      c.lineTo(x + 2.5, 0);
      c.lineTo(x + 2, h - 4);
      c.lineTo(x - 2, h - 4);
      c.closePath();
      c.fill();
      c.strokeStyle = LINE;
      c.lineWidth = 1;
      c.stroke();
      box(c, x - 7, h - 5, 14, 5, '#5c656c', 2);   // foot
    },
  },

  ceilingfan: {
    h: 46,                          // hangs above everything else in the room
    taper: 0,
    shadow: false,
    side: '#8d97a3',
    top(c, w, d, t) {
      const cx = w / 2, cy = d / 2;
      const a = t.spin || 0;
      const smear = blur(t);
      const R = w * 1.05;           // the blades overhang the tile, as they do

      // Fast blades are a disc, not four sticks. Fading between the two is
      // what sells the acceleration — you watch them stop being countable.
      if (smear > 0) {
        c.save();
        c.globalAlpha = 0.19 * smear;
        c.fillStyle = '#b9a887';
        c.beginPath();
        c.arc(cx, cy, R, 0, 7);
        c.arc(cx, cy, R * 0.3, 0, 7, true);
        c.fill();
        c.restore();
      }

      c.save();
      c.translate(cx, cy);
      c.globalAlpha = 1 - smear * 0.84;
      for (let i = 0; i < 4; i++) {
        c.save();
        c.rotate(a + (i * Math.PI) / 2);
        c.beginPath();
        c.roundRect(R * 0.24, -R * 0.16, R * 0.76, R * 0.32, R * 0.14);
        c.fillStyle = i % 2 ? '#c2b291' : '#b8a887';
        c.fill();
        c.lineWidth = 1;
        c.strokeStyle = LINE;
        c.stroke();
        c.restore();
      }
      c.restore();

      box(c, cx - w * 0.17, cy - d * 0.17, w * 0.34, d * 0.34, '#9aa4ac', 5);
      c.fillStyle = 'rgba(255,255,255,.2)';
      c.beginPath();
      c.arc(cx - 1.5, cy - 2, w * 0.09, 0, 7);
      c.fill();
    },
    face(c, w, h) {
      // The downrod, and the glass under the motor. Nothing else: it hangs in
      // the air, so there is nothing between here and the floor to draw.
      c.fillStyle = '#7c868e';
      c.fillRect(w / 2 - 2, 0, 4, h * 0.3);
      c.fillStyle = 'rgba(255,244,214,.6)';
      c.beginPath();
      c.ellipse(w / 2, 1, w * 0.24, 3, 0, 0, 7);
      c.fill();
    },
    /* The shadow the blades throw on the floor, drawn under everything else.
     * This is the whole reason a fan beats a light: an empty floor gets a
     * texture that moves, and the room stops being a still image. */
    floor(c, w, d, t) {
      const cx = w / 2, cy = d / 2;
      const a = t.spin || 0;
      const smear = blur(t);
      const R = w * 1.5;
      c.save();
      c.translate(cx, cy);
      if (smear < 1) {
        c.globalAlpha = 0.15 * (1 - smear);
        c.fillStyle = '#000';
        for (let i = 0; i < 4; i++) {
          c.save();
          c.rotate(a + (i * Math.PI) / 2);
          c.beginPath();
          c.roundRect(R * 0.22, -R * 0.15, R * 0.74, R * 0.3, R * 0.13);
          c.fill();
          c.restore();
        }
      }
      if (smear > 0) {              // ...and a soft ring once they blur out
        c.globalAlpha = 0.05 * smear;
        c.fillStyle = '#000';
        c.beginPath();
        c.arc(0, 0, R, 0, 7);
        c.arc(0, 0, R * 0.28, 0, 7, true);
        c.fill();
      }
      c.restore();
    },
  },

  walllight: {
    h: 30,
    taper: 0,
    shadow: false,
    side: '#8d97a3',
    // A bracket on the wall, not a cone hanging in the air. Mounted against
    // the north edge of its tile and throwing south; rotation carries it round
    // to whichever wall it was actually placed on.
    top(c, w, d) {
      c.fillStyle = '#5f686f';                    // the backplate, flat to the wall
      c.fillRect(w * 0.3, 0, w * 0.4, 3.5);
      c.fillStyle = '#6f7981';                    // a short arm out from it
      c.fillRect(w * 0.45, 2.5, w * 0.1, d * 0.16);
      c.beginPath();                              // the shade, a half cone
      c.moveTo(w * 0.26, d * 0.1);
      c.lineTo(w * 0.74, d * 0.1);
      c.lineTo(w * 0.66, d * 0.44);
      c.lineTo(w * 0.34, d * 0.44);
      c.closePath();
      c.fillStyle = '#dfc894';
      c.fill();
      c.lineWidth = 1.25;
      c.strokeStyle = LINE;
      c.stroke();
      c.fillStyle = 'rgba(255,248,222,.9)';       // the bulb, just showing
      c.fillRect(w * 0.36, d * 0.38, w * 0.28, 3);
    },
    face(c, w, h) {
      c.fillStyle = '#5f686f';                    // backplate against the wall
      c.fillRect(w * 0.34, 0, w * 0.32, 5);
      c.fillStyle = 'rgba(255,255,255,.14)';
      c.fillRect(w * 0.34, 0, w * 0.32, 1.5);
      c.fillStyle = 'rgba(255,243,205,.5)';       // spill from under the shade
      c.fillRect(w * 0.28, 3.5, w * 0.44, 3);
      c.strokeStyle = LINE;
      c.lineWidth = 1;
      c.strokeRect(w * 0.34 + 0.5, 0.5, w * 0.32 - 1, 4);
    },
  },
};
