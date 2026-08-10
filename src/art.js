/* How each thing looks.
 *
 * Every routine draws into an unrotated box of (w, h) pixels with the origin
 * at the top-left; the renderer applies rotation around the footprint centre.
 * So a bed is always drawn head-at-top here and turns correctly for free, and
 * a new object needs a drawing function and nothing else.
 *
 * Two rules about the palette, both learned the hard way. Art is drawn at
 * *full brightness* — light multiplies it down, so anything already dim turns
 * to sludge the moment it is lit. And materials must separate: a floor, a wall
 * and a table that sit within a few percent of each other read as one grey
 * mass from any distance, whatever the shapes are doing.
 *
 * The house style otherwise: flat fills, one thin dark outline, a lighter top
 * edge implying a light from the north. Colony sims read at a glance because
 * shapes are simple and outlines are consistent, not because anything is
 * detailed.
 */

const LINE = 'rgba(26,22,18,.85)';

function box(c, x, y, w, h, fill, r = 2) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  c.fillStyle = fill;
  c.fill();
  c.lineWidth = 1.25;
  c.strokeStyle = LINE;
  c.stroke();
}

function topLight(c, x, y, w, h, alpha = 0.16) {
  c.save();
  c.beginPath();
  c.roundRect(x, y, w, h, 2);
  c.clip();
  c.fillStyle = `rgba(255,255,255,${alpha})`;
  c.fillRect(x, y, w, Math.max(2, h * 0.2));
  c.fillStyle = 'rgba(0,0,0,.12)';
  c.fillRect(x, y + h - Math.max(2, h * 0.14), w, Math.max(2, h * 0.14));
  c.restore();
}

export const ART = {
  bed(c, w, h) {
    box(c, 1, 1, w - 2, h - 2, '#8a5f33', 3);              // frame
    box(c, 3.5, h * 0.26, w - 7, h - 3.5 - h * 0.26, '#4a7fa6', 2);   // blanket
    box(c, 3.5, 3, w - 7, h * 0.25, '#eceadf', 2);         // pillow, at the head
    c.strokeStyle = 'rgba(255,255,255,.22)';                // turn-down
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(4.5, h * 0.36);
    c.lineTo(w - 4.5, h * 0.36);
    c.stroke();
    c.strokeStyle = 'rgba(0,0,0,.14)';                      // a fold or two
    c.lineWidth = 1;
    for (const f of [0.58, 0.76]) {
      c.beginPath(); c.moveTo(5, h * f); c.lineTo(w - 5, h * f); c.stroke();
    }
    topLight(c, 1, 1, w - 2, h - 2, 0.08);
  },

  table(c, w, h) {
    box(c, 1, 1, w - 2, h - 2, '#a5763f', 3);
    c.strokeStyle = 'rgba(0,0,0,.20)';
    c.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const x = 2 + ((w - 4) / 4) * i;
      c.beginPath(); c.moveTo(x, 3); c.lineTo(x, h - 3); c.stroke();
    }
    topLight(c, 1, 1, w - 2, h - 2);
  },

  chair(c, w, h) {
    box(c, 3, 1.5, w - 6, 6, '#8a5f33', 2);                // back, at the top
    box(c, 2, 7, w - 4, h - 10, '#a5763f', 2.5);           // seat
    topLight(c, 2, 7, w - 4, h - 10);
  },

  dispenser(c, w, h) {
    box(c, 1, 1, w - 2, h - 2, '#9aa4ac', 2.5);
    box(c, 3, 2.5, w - 6, h * 0.4, '#78838c', 2);          // hopper along the back
    c.fillStyle = '#3a4148';                                // nozzles, front face
    const n = Math.max(2, Math.round(w / 24));
    for (let i = 0; i < n; i++) {
      const x = ((i + 0.5) * (w - 8)) / n + 4;
      c.beginPath();
      c.roundRect(x - 3.5, h - 11, 7, 7, 1.5);
      c.fill();
    }
    c.fillStyle = '#7fe0aa';                                // status light
    c.beginPath();
    c.arc(w - 7, 7, 2.2, 0, 7);
    c.fill();
    topLight(c, 1, 1, w - 2, h - 2);
  },

  lamp(c, w, h) {
    c.fillStyle = 'rgba(0,0,0,.26)';                        // base shadow
    c.beginPath();
    c.ellipse(w / 2, h - 6, w * 0.3, h * 0.13, 0, 0, 7);
    c.fill();
    box(c, w / 2 - 3, h * 0.46, 6, h * 0.4, '#6f7981', 1.5);
    c.beginPath();                                          // shade
    c.moveTo(w * 0.14, h * 0.52);
    c.lineTo(w * 0.86, h * 0.52);
    c.lineTo(w * 0.7, h * 0.12);
    c.lineTo(w * 0.3, h * 0.12);
    c.closePath();
    c.fillStyle = '#f2d78f';
    c.fill();
    c.strokeStyle = LINE;
    c.lineWidth = 1.25;
    c.stroke();
    c.fillStyle = 'rgba(255,248,215,.85)';                  // the lit underside
    c.fillRect(w * 0.16, h * 0.47, w * 0.68, 4);
  },

  ceilinglight(c, w, h) {
    box(c, w * 0.14, h * 0.14, w * 0.72, h * 0.72, '#aeb8c4', 3);
    c.fillStyle = '#f4f8ff';
    c.beginPath();
    c.roundRect(w * 0.22, h * 0.22, w * 0.56, h * 0.56, 2);
    c.fill();
    c.strokeStyle = 'rgba(26,22,18,.5)';
    c.lineWidth = 1;
    c.stroke();
  },

  door(c, w, h) {
    // Two leaves parted in the middle of the wall run, so a doorway reads as a
    // gap in the wall rather than an object sitting in front of one.
    c.fillStyle = '#5a5348';
    c.fillRect(0, 1, w, h - 2);
    box(c, 0.5, 2, w * 0.44, h - 4, '#a5763f', 1.5);
    box(c, w - 0.5 - w * 0.44, 2, w * 0.44, h - 4, '#a5763f', 1.5);
    c.fillStyle = 'rgba(255,255,255,.14)';
    c.fillRect(0.5, 2, w - 1, 2);
  },
};

/* Walls are drawn by the renderer rather than from this table, because they
 * need to know their neighbours in order to join up. */
export const WALL = {
  fill: '#9c9486',
  top: '#b3ab9c',
  side: '#6f6a5f',
  line: 'rgba(26,22,18,.85)',
};
