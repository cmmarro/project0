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
      // The door *is* this segment of wall, so from above you see the slab
      // filling the opening flush with the run, with the reveal of the frame
      // either side of it and the seam where the two leaves meet.
      c.fillStyle = '#6b6459';                       // frame reveal
      c.fillRect(0, 0, w, d);
      c.fillStyle = '#a5763f';                       // the leaves, closed
      c.fillRect(0, 3, w, d - 6);
      c.fillStyle = 'rgba(255,255,255,.13)';
      c.fillRect(0, 3.5, w, 2);
      c.strokeStyle = 'rgba(26,22,18,.55)';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(0, 3.5); c.lineTo(w, 3.5);
      c.moveTo(0, d - 3.5); c.lineTo(w, d - 3.5);
      c.moveTo(w / 2, 3); c.lineTo(w / 2, d - 3);    // where they part
      c.stroke();
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
      c.fillStyle = '#3f3a33';                       // the dark of the opening
      c.fillRect(0, 0, w, h);
      const lw = w * 0.46;
      for (const x of [0, w - lw]) {
        box(c, x + 0.5, 1, lw - 1, h - 2, '#a5763f', 1.5);
        c.fillStyle = 'rgba(255,255,255,.13)';
        c.fillRect(x + 1.5, 2, lw - 3, 1.5);
        c.fillStyle = 'rgba(0,0,0,.10)';             // a panel line each
        c.fillRect(x + 3, h * 0.42, lw - 6, 1);
      }
      c.fillStyle = '#d8c08c';                       // handles, either side
      c.fillRect(lw - 4, h * 0.44, 2.5, 5);
      c.fillRect(w - lw + 1.5, h * 0.44, 2.5, 5);
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
    h: 16,
    taper: 0,
    side: '#8a5f33',
    // The seat fills its tile and the backrest sits *on* it rather than beside
    // it. That is not just a look: `top` rotates and `face` does not, so an
    // asymmetric top leaves the edge band and legs hanging off one side the
    // moment the chair is turned. A seat that fills the tile has the same
    // extent at every rotation, and the back carries the facing on its own.
    inset: 2.5,
    top(c, w, d) {
      const i = ART.chair.inset;
      box(c, i, i, w - 2 * i, d - i - 0.5, '#a5763f', 3);       // the seat
      c.fillStyle = 'rgba(255,255,255,.10)';
      c.fillRect(i + 1.5, i + 1.5, w - 2 * i - 3, 3);
      box(c, i + 1.5, i + 0.5, w - 2 * i - 3, 7.5, '#7a5330', 2);  // the back
      c.fillStyle = 'rgba(0,0,0,.14)';                          // its shadow
      c.fillRect(i + 2.5, i + 8.5, w - 2 * i - 5, 2.5);
    },
    face(c, w, h) {
      const i = ART.chair.inset;
      leg(c, i, h, 4);
      leg(c, w - i - 4, h, 4);
      edge(c, i, w - 2 * i, 4.5, '#96692f');
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
    face(c, w) {
      // Only the lit underside. It hangs in the air, so there is nothing
      // between here and the floor to draw — and anything above the face
      // region would be clipped away anyway.
      c.fillStyle = 'rgba(244,248,255,.55)';
      c.fillRect(w * 0.2, 0, w * 0.6, 3);
    },
  },
};
