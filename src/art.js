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
    h: 22,
    taper: 0,                       // structure doesn't taper; furniture does
    shadow: false,                  // its own face darkens where it meets the floor
    side: '#7d7668',
    top(c, w, d) {
      c.fillStyle = '#a9a192';
      c.fillRect(0, 0, w, d);
      c.fillStyle = 'rgba(255,255,255,.07)';
      c.fillRect(0, 0, w, d * 0.3);
    },
    face(c, w, h) {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#8b8375');
      g.addColorStop(1, '#5f5a4f');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(255,255,255,.16)';     // the lip where top meets face
      c.fillRect(0, 0, w, 1.5);
      c.fillStyle = 'rgba(0,0,0,.22)';           // where it meets the floor
      c.fillRect(0, h - 2, w, 2);
    },
  },

  door: {
    h: 22,
    taper: 0,
    shadow: false,
    side: '#6d4c28',
    top(c, w, d) {
      // The top of a doorway is the top of the wall it interrupts, with the
      // frame's reveal cut through it. Drawing the door itself up here as well
      // as on the face gave you two doors, one lying flat on the wall.
      c.fillStyle = '#a9a192';
      c.fillRect(0, 0, w, d);
      c.fillStyle = 'rgba(255,255,255,.07)';
      c.fillRect(0, 0, w, d * 0.3);
      c.fillStyle = '#6b6459';                       // the opening, seen down into
      c.fillRect(2.5, d * 0.3, w - 5, d * 0.42);
      c.strokeStyle = 'rgba(26,22,18,.5)';
      c.lineWidth = 1;
      c.strokeRect(2.5, d * 0.3, w - 5, d * 0.42);
    },
    face(c, w, h, t) {
      // Seen along the run, you are looking at the two leaves. Seen end-on —
      // a door in a north-south wall — you are looking at the wall's own face
      // with the door's edge in it, so it should read as wall.
      if ((t.rot || 0) % 2 === 1) {
        ART.wall.face(c, w, h);
        c.fillStyle = '#8a5f33';
        c.fillRect(w * 0.28, 1, w * 0.44, h - 2);
        c.strokeStyle = 'rgba(26,22,18,.55)';
        c.lineWidth = 1;
        c.strokeRect(w * 0.28, 1.5, w * 0.44, h - 3);
        return;
      }
      // The jamb either side, then the leaves centred in the opening between
      // them — one door, sitting in the gap, rather than a slab across it.
      ART.wall.face(c, w, h);
      const jamb = 2.5, ow = w - jamb * 2;
      c.fillStyle = '#33302b';
      c.fillRect(jamb, 1, ow, h - 1);
      const lw = ow / 2;
      for (const x of [jamb, jamb + lw]) {
        box(c, x + 0.5, 2, lw - 1, h - 3, '#a5763f', 1.5);
        c.fillStyle = 'rgba(255,255,255,.14)';
        c.fillRect(x + 1.5, 3, lw - 3, 1.5);
        c.fillStyle = 'rgba(0,0,0,.10)';             // a panel line each
        c.fillRect(x + 2.5, h * 0.45, lw - 5, 1);
      }
      c.fillStyle = '#d8c08c';                       // handles, meeting stiles
      c.fillRect(jamb + lw - 3.5, h * 0.42, 2.5, 5);
      c.fillRect(jamb + lw + 1, h * 0.42, 2.5, 5);
    },
  },

  bed: {
    h: 10,
    taper: 0,                       // it has legs; the taper would cut the air
    side: '#6d4c28',
    top(c, w, d) {
      box(c, 0.5, 0.5, w - 1, d - 1, '#8a5f33', 3);                  // frame
      box(c, 3.5, d * 0.26, w - 7, d - 4 - d * 0.26, '#4a7fa6', 2);  // blanket
      box(c, 3.5, 3, w - 7, d * 0.24, '#eceadf', 2);                 // pillow
      c.strokeStyle = 'rgba(255,255,255,.24)';                        // turn-down
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(4.5, d * 0.36);
      c.lineTo(w - 4.5, d * 0.36);
      c.stroke();
      c.strokeStyle = 'rgba(0,0,0,.13)';                              // folds
      c.lineWidth = 1;
      for (const f of [0.58, 0.78]) {
        c.beginPath(); c.moveTo(5, d * f); c.lineTo(w - 5, d * f); c.stroke();
      }
    },
    face(c, w, h) {
      leg(c, 2.5, h);                               // legs first, rail over them
      leg(c, w - 7.5, h);
      edge(c, 0.5, w - 1, h * 0.55, '#7a5330');     // the frame rail
    },
  },

  table: {
    h: 15,
    taper: 0,
    side: '#8a5f33',
    top(c, w, d) {
      box(c, 0.5, 0.5, w - 1, d - 1, '#a5763f', 3);
      c.strokeStyle = 'rgba(0,0,0,.18)';           // boards
      c.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const x = 2 + ((w - 4) / 4) * i;
        c.beginPath(); c.moveTo(x, 3); c.lineTo(x, d - 3); c.stroke();
      }
      c.fillStyle = 'rgba(255,255,255,.12)';
      c.fillRect(2, 2, w - 4, d * 0.16);
    },
    face(c, w, h) {
      // A tabletop is a thin slab on legs, and drawing it as a solid block is
      // the single thing that most makes furniture look like painted floor.
      // The legs are drawn first so the slab's outline closes over them.
      leg(c, 3.5, h, 5);
      leg(c, w - 8.5, h, 5);
      edge(c, 0.5, w - 1, 5.5, '#96692f');
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
    h: 24,
    taper: 1,
    side: '#7c868e',
    top(c, w, d) {
      box(c, 0.5, 0.5, w - 1, d - 1, '#9aa4ac', 2.5);
      box(c, 3, 2.5, w - 6, d * 0.42, '#78838c', 2);   // hopper along the back
      c.fillStyle = 'rgba(255,255,255,.14)';
      c.fillRect(3, 2.5, w - 6, 2);
      c.fillStyle = '#7fe0aa';                          // status light
      c.beginPath();
      c.arc(w - 7, 6.5, 2.2, 0, 7);
      c.fill();
    },
    face(c, w, h) {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#98a2aa');
      g.addColorStop(1, '#6b757d');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(255,255,255,.18)';
      c.fillRect(0, 0, w, 1.5);
      const n = Math.max(2, Math.round(w / 24));        // nozzles and trays
      for (let i = 0; i < n; i++) {
        const x = ((i + 0.5) * (w - 10)) / n + 5;
        c.fillStyle = '#394046';
        c.beginPath();
        c.roundRect(x - 4, h * 0.3, 8, h * 0.42, 1.5);
        c.fill();
        c.fillStyle = '#525c64';
        c.fillRect(x - 6, h - 5, 12, 3);
      }
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
    top(c, w, d) {
      // Mounted against the north edge of its tile, throwing south. Rotation
      // carries it round to whichever wall it was placed on.
      c.fillStyle = '#6f7981';
      c.fillRect(w * 0.34, 1, w * 0.32, 4);
      c.beginPath();                          // the shade, a half-cone
      c.moveTo(w * 0.24, 3);
      c.lineTo(w * 0.76, 3);
      c.lineTo(w * 0.64, d * 0.42);
      c.lineTo(w * 0.36, d * 0.42);
      c.closePath();
      c.fillStyle = '#e7d3a2';
      c.fill();
      c.lineWidth = 1.25;
      c.strokeStyle = LINE;
      c.stroke();
      c.fillStyle = 'rgba(255,247,220,.8)';
      c.fillRect(w * 0.36, d * 0.36, w * 0.28, 3);
    },
    face(c, w) {
      c.fillStyle = 'rgba(255,243,205,.45)';  // spill from under the shade
      c.fillRect(w * 0.3, 0, w * 0.4, 3);
    },
  },
};
