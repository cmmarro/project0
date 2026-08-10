# Room

A room you can build in, and light. Nothing lives in it yet — that is the next
stage, and this one is deliberately finished before it starts.

```bash
python3 -m http.server 8000     # any static server will do
```

Then open <http://localhost:8000>. No build step, no dependencies, no backend.
It is plain ES modules and a canvas.

---

## What it does

- **A tiled map** with a starter room already up, so there is something to look
  at before you build anything.
- **A high-oblique view.** Not isometric — the grid stays square and
  axis-aligned — but tilted enough that everything shows a top *and* a south
  face. Walls have a top, a face and a lip; a table is a slab on legs rather
  than a painted rectangle.
- **A build menu** — Structure, Furniture, Misc, Floors, and Deconstruct.
  Click a thing, click the floor. The tool stays selected so you can place
  several; drag to run a wall or paint a floor; **R** rotates; **Esc** or
  right-click cancels.
- **Multi-tile objects, and everything turns.** A bed is 1×2, a table 2×2, a
  paste dispenser 3×1. Rotation was built in from the first commit because
  retrofitting it into placement, occupancy and drawing is miserable.
- **Doors orient themselves** to the wall they land in. A door you have to
  align by hand is a door you will align wrong.
- **Lighting.** A standing lamp throws warm light about seven tiles; a ceiling
  light is colder, brighter, and doesn't take up the tile. Walls stop light.
  The sun slider takes the room from night to daylight.
- **Camera.** Wheel to zoom towards the cursor, drag to pan.

## How it fits together

```
src/defs.js     what exists — every object and floor, in one table
src/world.js    the map, and the rules about what can go where
src/light.js    the light map
src/art.js      how each thing is drawn
src/render.js   camera, terrain baking, draw order
src/build.js    the menu and what the mouse does
src/main.js     wiring and the frame loop
```

Two rules hold the shape of it:

**Nothing outside `defs.js` names an object.** Adding a second lamp or a wider
table is an entry in that table plus a drawing function. The moment placement,
rendering and lighting each know about `bed` by name, the twelfth object costs
twelve edits.

**Only `world.place` and `world.remove` change anything.** So there is exactly
one place that knows a bed covers two tiles, and the renderer and the menu only
ever read.

## How the height works

Height is a **screen-space offset**, not a third axis. A thing's top face draws
one `h` above its footprint and its south face hangs below that; the footprint
itself never moves. So placement, occupancy and pathing stay on a plain square
grid and know nothing about any of it.

Each object is therefore two drawings:

```
top(c, w, d, thing)     the top surface. Rotates with the object, because a
                        bed's pillow end turns.
face(c, w, h, thing)    the south face. Never rotates, because "up" is a
                        property of the screen and not of the furniture.
```

Anything without a `face` gets a default extruded slab, tapered slightly inward
at the bottom. That taper is two lines of code doing most of the work of making
a box look like a box rather than a rectangle with a stripe under it.

Two consequences that are easy to miss:

- **Things overlap now, so draw order stopped being free.** Everything sorts by
  the south edge of its footprint — painter's algorithm — which is why walls
  are in the same pass as furniture rather than drawn last.
- **A wall with a wall to its south draws no face,** because the neighbour's
  body covers it. That one check is most of what makes a run read as a single
  structure. Its counterpart is the exposed top edges: without them a
  north–south run has no outline at all and reads as a strip of pale floor.

## Notes on the rendering, from getting it wrong

- **Art is drawn at full brightness and lit *down*.** The first pass used a
  muted palette *and* multiplied light over it, and every material in the game
  came out the same shade of mud.
- **Light does two things, not one.** The part at or below full brightness is
  multiplied over the world; only the excess above full is added back as glow.
  With a single multiply pass, full daylight rendered at 64%.
- **A lamp at noon does almost nothing.** Every source is scaled by how dark it
  already is, or lamps leave a permanent bright smear across a sunlit floor.
- **The light map is half-tile resolution.** At one sample per tile the
  interpolation smears a lamp's pool across most of a room and the room stops
  reading as a room.
- **Terrain is baked** into one bitmap and blitted; it has its own version
  counter, because sharing one with things meant every lamp placed re-baked the
  entire floor.

## Next

A pawn that exists and walks where you tell it. Then one need and one
interaction — hunger, and the dispenser. Behaviour comes after that, and gets
its own loop rather than being threaded through the renderer's.
