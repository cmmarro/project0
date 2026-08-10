/* How each thing looks, in a world with a bit of height to it.
 *
 * The view is high oblique: looking down at the room, but tilted enough that
 * you see the south face of everything as well as its top. Not isometric — the
 * grid stays square and axis-aligned, which keeps placement, occupancy and
 * pathing exactly as simple as they were. Only the drawing changes.
 *
 * So every object is two drawings:
 *
 *   top(c, w, d, thing)      the top surface, in a w×d box. This rotates with
 *                            the object, because a bed's pillow end turns.
 *   face(c, w, h, thing)     the south face, w wide and h tall, hanging below
 *                            the top. This never rotates, because "up" is a
 *                            property of the screen and not of the furniture.
 *
 * Anything without a `face` gets a default extruded slab in its `side` colour,
 * tapered slightly inward at the bottom. The taper is doing a lot of work for
 * two lines of code: it is most of what stops a box reading as a flat rectangle
 * with a stripe under it.
 *
 * Two palette rules, both learned by getting them wrong. Art is drawn at *full
 * brightness* and lit down — anything already dim turns to sludge the moment
 * light multiplies over it. And materials must separate: a floor, a wall and a
 * table within a few percent of each other read as one grey mass however good
 * the shapes are.
 */

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

/* A leg: a tapered post from the underside of something down to the floor. */
function leg(c, x, h, w = 5, fill = '#6d4c28') {
  c.beginPath();
  c.moveTo(x, 0);
  c.lineTo(x + w, 0);
  c.lineTo(x + w - 0.8, h);
  c.lineTo(x + 0.8, h);
  c.closePath();
  c.fillStyle = fill;
  c.fill();
  c.lineWidth = 1;
  c.strokeStyle = LINE;
  c.stroke();
}

/* The edge of a horizontal surface seen from slightly in front — a thin band
 * of the top colour, darkened, with a highlight along its upper lip. */
function edge(c, w, t, fill, hi = 'rgba(255,255,255,.18)') {
  c.fillStyle = fill;
  c.fillRect(0, 0, w, t);
  c.fillStyle = hi;
  c.fillRect(0, 0, w, 1.5);
  c.strokeStyle = LINE;
  c.lineWidth = 1;
  c.strokeRect(0.5, 0.5, w - 1, t - 1);
}

export const ART = {
  wall: {
    h: 22,
    taper: 0,                       // structure doesn't taper; furniture does
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
    side: '#6d4c28',
    top(c, w, d) {
      // The same top as the wall it interrupts, plus the frame reveal. Drawn
      // as anything else and a doorway reads as a dark hole punched in the
      // room rather than as a way through it.
      c.fillStyle = '#a9a192';
      c.fillRect(0, 0, w, d);
      c.fillStyle = 'rgba(255,255,255,.07)';
      c.fillRect(0, 0, w, d * 0.3);
      c.fillStyle = '#6d4c28';
      c.fillRect(1.5, d * 0.34, w - 3, d * 0.32);
      c.strokeStyle = 'rgba(26,22,18,.5)';
      c.lineWidth = 1;
      c.strokeRect(1.5, d * 0.34, w - 3, d * 0.32);
    },
    face(c, w, h) {
      // Two leaves parted in the middle, so a doorway reads as a gap in the
      // wall rather than an object standing in front of one.
      c.fillStyle = '#3f3a33';
      c.fillRect(0, 0, w, h);
      const lw = w * 0.44;
      for (const x of [0.5, w - 0.5 - lw]) {
        box(c, x, 1, lw, h - 2, '#a5763f', 1.5);
        c.fillStyle = 'rgba(255,255,255,.12)';
        c.fillRect(x + 1, 2, lw - 2, 1.5);
      }
      c.fillStyle = '#c9b183';                    // handles
      c.fillRect(lw - 3, h * 0.45, 2, 4);
      c.fillRect(w - lw + 1, h * 0.45, 2, 4);
    },
  },

  bed: {
    h: 10,
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
      edge(c, w, h * 0.5, '#7a5330');              // the frame rail
      c.fillStyle = 'rgba(0,0,0,.12)';
      c.fillRect(0, h * 0.5 - 1, w, 1);
      leg(c, 2, h);                                 // and short legs under it
      leg(c, w - 7, h);
    },
  },

  table: {
    h: 15,
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
      edge(c, w, 5, '#96692f');
      leg(c, 3, h, 5);
      leg(c, w - 8, h, 5);
    },
  },

  chair: {
    h: 16,
    side: '#8a5f33',
    top(c, w, d) {
      box(c, 3, 1.5, w - 6, 6, '#7a5330', 2);      // back, at the head end
      box(c, 2, 8, w - 4, d - 11, '#a5763f', 2.5); // seat
      c.fillStyle = 'rgba(255,255,255,.12)';
      c.fillRect(3, 9, w - 6, 3);
    },
    face(c, w, h) {
      edge(c, w * 0.66, 4, '#96692f');
      leg(c, 2, h, 4);
      leg(c, w * 0.66 - 6, h, 4);
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
      // The shade, seen from above and slightly in front: an ellipse with the
      // lit underside just showing at the near edge.
      c.beginPath();
      c.ellipse(w / 2, d / 2, w * 0.36, d * 0.3, 0, 0, 7);
      c.fillStyle = '#f2d78f';
      c.fill();
      c.lineWidth = 1.25;
      c.strokeStyle = LINE;
      c.stroke();
      c.beginPath();
      c.ellipse(w / 2, d * 0.44, w * 0.22, d * 0.17, 0, 0, 7);
      c.fillStyle = '#fff3cd';
      c.fill();
    },
    face(c, w, h) {
      c.fillStyle = 'rgba(255,246,214,.5)';        // glow spilling from under
      c.fillRect(w * 0.18, 0, w * 0.64, 3);
      const x = w / 2;
      c.fillStyle = '#6f7981';                      // stem
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

  ceilinglight: {
    h: 40,                          // hangs well above everything else
    taper: 0,
    shadow: false,
    side: '#8d97a3',
    top(c, w, d) {
      box(c, w * 0.14, d * 0.14, w * 0.72, d * 0.72, '#aeb8c4', 3);
      c.fillStyle = '#f4f8ff';
      c.beginPath();
      c.roundRect(w * 0.22, d * 0.22, w * 0.56, d * 0.56, 2);
      c.fill();
      c.strokeStyle = 'rgba(26,22,18,.45)';
      c.lineWidth = 1;
      c.stroke();
    },
    face(c, w, h) {
      c.fillStyle = 'rgba(244,248,255,.55)';        // the lit underside
      c.fillRect(w * 0.2, 0, w * 0.6, 3);
      c.strokeStyle = 'rgba(150,160,175,.45)';      // and the flex to the ceiling
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(w / 2, 0);
      c.lineTo(w / 2, -h * 0.3);
      c.stroke();
    },
  },
};
