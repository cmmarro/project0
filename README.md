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
- **A build menu** — Structure, Furniture, Misc, Floors, and Deconstruct.
  Click a thing, click the floor. The tool stays selected so you can place
  several; drag to run a wall or paint a floor; **R** rotates; **Esc** or
  right-click cancels.
- **Multi-tile objects.** A bed is 1×2, a table 2×2, a paste dispenser 3×1, and
  they turn properly. Rotation was built in from the first commit because
  retrofitting it into placement, occupancy and drawing is miserable.
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
