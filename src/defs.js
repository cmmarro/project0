/* What exists in the world.
 *
 * One table. Everything else in the project reads from it and nothing
 * hard-codes a thing's name — adding a lamp variant or a second bed should be
 * an entry here and nothing else. That discipline is worth keeping from the
 * first commit, because the moment placement, rendering and lighting each know
 * about "bed" by name, adding the twelfth object costs twelve edits.
 */

export const TILE = 32;              // pixels per tile at zoom 1

/* --- terrain: what the floor is made of ------------------------------------
 * Terrain is painted, not built. It has no thickness and nothing stands on it
 * except things.
 */
export const TERRAIN = {
  void: {
    label: 'Ground',
    build: false,                    // not in the menu; it's what's already there
    base: '#3b4038',
    speck: '#434840',
  },
  concrete: {
    label: 'Concrete',
    cat: 'Floors',
    base: '#75705f',
    speck: '#615d4f',
    grout: '#5c5849',
    plate: 4,                        // seams every N tiles
  },
  steel: {
    label: 'Steel plate',
    cat: 'Floors',
    base: '#8b959c',
    speck: '#7d878e',
    grout: '#6b757c',
    plate: 2,
  },
  tile: {
    label: 'White tile',
    cat: 'Floors',
    base: '#c6c8bd',
    speck: '#b8bab0',
    grout: '#9ea095',
    plate: 1,
  },
  wood: {
    label: 'Wood floor',
    cat: 'Floors',
    base: '#a87e4d',
    speck: '#9a7245',
    grout: '#87643c',
    plate: 1,
    planks: true,
  },
};

/* --- things: what gets built on top ---------------------------------------
 * size is [w, h] in tiles at rotation 0. `rotates` things swap those when
 * turned; a 1x1 thing may still rotate if it has a facing worth seeing.
 *
 * blocks     stops movement, and stops light
 * occupies   takes the tile so nothing else can be built there
 * light      { radius, colour } — read by the light map, nothing else
 */
export const THINGS = {
  wall: {
    label: 'Wall',
    cat: 'Structure',
    size: [1, 1],
    blocks: true,
    occupies: true,
    joins: true,                     // part of a run; hides its face behind one
    hint: 'Drag to build a run.',
  },
  door: {
    label: 'Door',
    cat: 'Structure',
    size: [1, 1],
    blocks: false,
    occupies: true,
    joins: true,
    // Takes its orientation from the wall it lands in, rather than from
    // whatever you last pressed R on. A door you have to align by hand is a
    // door you will align wrong.
    autoOrient: true,
    // ...and it *becomes* that segment of wall rather than standing inside
    // one. Two structures on a tile is not a doorway, it is a bug you can see.
    replaces: true,
    hint: 'Drops into a wall, replacing it, and turns to match.',
  },
  bed: {
    label: 'Bed',
    cat: 'Furniture',
    size: [1, 2],
    rotates: true,
    occupies: true,
    hint: 'The pillow end is the head.',
  },
  table: {
    label: 'Table',
    cat: 'Furniture',
    size: [2, 2],
    rotates: true,
    occupies: true,
  },
  chair: {
    label: 'Chair',
    cat: 'Furniture',
    size: [1, 1],
    rotates: true,
    occupies: true,
    hint: 'Faces the way you turn it.',
  },
  dispenser: {
    label: 'Nutrient paste dispenser',
    cat: 'Misc',
    size: [3, 1],
    rotates: true,
    occupies: true,
    blocks: true,
    light: { radius: 2.4, colour: [120, 200, 160], strength: 0.35 },
    hint: 'Wide. The nozzles are on the face it turns towards.',
  },
  lamp: {
    label: 'Standing lamp',
    cat: 'Misc',
    size: [1, 1],
    rotates: true,
    occupies: true,
    light: { radius: 7.5, colour: [255, 214, 150], strength: 1.0 },
    hint: 'Lights about seven tiles. Walls stop it.',
  },
  ceilinglight: {
    label: 'Ceiling light',
    cat: 'Misc',
    size: [1, 1],
    occupies: false,                 // overhead; you can walk under it
    light: { radius: 10, colour: [214, 226, 255], strength: 1.0 },
    hint: 'Brighter and colder, and nothing stands on the tile.',
  },
};

export const CATEGORIES = ['Structure', 'Furniture', 'Misc', 'Floors'];

/* Terrain entries appear in the build menu too, so the menu is built from one
 * list rather than two special cases. */
export function menuItems() {
  const out = [];
  for (const [key, d] of Object.entries(THINGS)) {
    out.push({ kind: 'thing', key, ...d });
  }
  for (const [key, d] of Object.entries(TERRAIN)) {
    if (d.build !== false) out.push({ kind: 'terrain', key, ...d });
  }
  return out;
}
