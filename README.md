# Room

A room you can build in, and light. Nothing lives in it yet — that is the next
stage, and this one is deliberately finished before it starts.

**Windows:** double-click `run.bat`.
**Mac or Linux:** `./run.sh` — or `python3 serve.py`.

It opens your browser for you. Leave the window it starts in open; closing it
stops the server.

No build step, no dependencies, no backend — plain ES modules and a canvas. The
only reason there is a server at all is that browsers refuse to load modules
over `file://`. `serve.py` is a static file server with three manners the stock
one lacks: it finds a free port instead of failing on a busy one, it opens the
browser, and it tells the browser never to cache — without that last one you
edit a file, refresh, and spend ten minutes debugging the version you already
fixed.

**`check.html`** (linked from the terminal on startup) runs the rules about what
can go where against the real `World` and prints pass/fail. Same deal — no
dependencies, no runner. Every check in there is a rule that was worth stating
because getting it wrong was visible on screen.

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
- **Doors orient themselves** to the wall they land in, and *replace* it — a
  door becomes that segment of wall rather than standing inside one. A door you
  have to align by hand is a door you will align wrong.
- **Lighting.** A standing lamp throws warm light about seven tiles; a wall
  light mounts on a wall and finds which side the room is on; a ceiling fan
  lights and doesn't take up the tile. Walls stop light. The sun slider takes
  the room from night to daylight.
- **A ceiling fan that turns.** Click a placed one to change speed. It winds up
  under power in about two seconds and coasts down under friction in ten, and
  the blades stop being countable somewhere in the middle both times — that
  asymmetry is the whole difference between a fan and a texture being rotated.
  Its blades throw a shadow on the floor, which is a moving texture in a room
  that is otherwise a still image.
- **Camera.** Wheel to zoom towards the cursor, drag to pan.

## How it fits together

```
run.bat         double-click, Windows
run.sh          the same, Mac and Linux
serve.py        the static server both of them call
check.html      the placement rules, checked in the browser
src/defs.js     what exists — every object and floor, in one table
src/anim.js     the only things that move: fan spin-up and spin-down
src/occlusion.js floor shading around anything solid
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

There are then two ways to draw a thing, and which you want depends entirely on
whether the thing **is a box**.

**Extruded**, for things that are — walls, tables, beds, the dispenser:

```
top(c, w, d, thing)     the top surface. Rotates with the object, because a
                        bed's pillow end turns.
face(c, w, h, thing)    the south face. Never rotates, because "up" is a
                        property of the screen and not of the furniture.
```

Anything without a `face` gets a default slab, tapered slightly inward at the
bottom. That taper is two lines doing most of the work of making a box look
like a box rather than a rectangle with a stripe under it.

**Viewed**, for things that aren't:

```
view(c, w, d, h, rot)   the whole thing, in a w × (d+h) box with the
                        footprint's south edge at the bottom.
```

A chair is a back with a seat hanging off it, and the two swap places when you
turn it — facing away, the backrest stands in front of the seat and hides its
edge; sideways it is a panel down one side. Extruding that can only ever give
you an orange box with a bar on the front. This is the sprite-sheet model —
north/south/east/west art — except the frames are canvas commands rather than
PNGs, so they stay readable in the source and cost nothing to load.

**Why not three.js?** It would replace the whole pipeline — light map, terrain
bake, painter's sort — for one benefit you don't need, since the camera never
moves. And authoring a chair *mesh* is more work than drawing four views of
one, not less. If the four-view approach ever runs out, the move is to bake
sprites from 3D offline, not to ship a renderer.

Two consequences that are easy to miss:

- **Things overlap now, so draw order stopped being free.** Everything sorts by
  the south edge of its footprint — painter's algorithm — which is why walls
  are in the same pass as furniture rather than drawn last.
- **A wall with a wall to its south draws no face,** because the neighbour's
  body covers it. That one check is most of what makes a run read as a single
  structure. Its counterpart is the exposed top edges: without them a
  north–south run has no outline at all and reads as a strip of pale floor.

## Ambient occlusion

The cheapest thing you can do to stop a room looking like furniture lying on
wallpaper, and it does two jobs from one baked map:

- **contact** — floor next to anything solid is darker, because less of the sky
  reaches it. Undirected, and it is what makes a wall look like it *meets* the
  floor rather than being printed on it.
- **cast** — a wall throws a shadow south, because everything in this art is lit
  from the north, the same convention as the highlight along every object's top
  lip.

It has its own version counter, separate from the terrain bake, for the same
reason those two are separate: terrain changes when you paint a floor,
occlusion changes when you build a wall.

## Lighting things that stand up

The light map is a **ground plane**. It is multiplied over terrain and nothing
else, because anything with height is drawn *above* its own tile — a wall's
body sits thirty pixels north of where it stands. Light it in screen space and
its top face samples whatever is a row behind it, which for the north wall of a
room is the dark outside while its face gets the lit interior. The wall comes
out in patches straddling that boundary.

So things are lit by their own footprint instead: for each one, the patch of
light map over the tiles it stands on, stretched up over its whole silhouette.
Not a flat colour per object — that quantises, and under a wall light the tiles
either side differ enough to read as blocks. Taking the patch off the map keeps
the gradient, and neighbours stay continuous because they sample adjoining
parts of the same map.

Two layers do it for the whole scene rather than per object: everything drawn
once on transparent, and each thing's light patch over its silhouette. Masking
the tint to the layer before multiplying is what stops the patches painting
over the floor between things. The obvious version — a small scratch canvas per
object — ping-pongs between GPU surfaces once per thing, and a room with a
hundred and forty chairs ran at eight frames a second.

## The scene is a still image

Nothing moves except what is turning, so the whole composition — terrain,
occlusion, light, and every object that is holding still — is drawn once into a
cached surface and blitted. It is rebuilt only when the camera moves or the
world changes. Fans are drawn on top per frame.

That took the same hundred-and-forty-chair room from 8 fps to 50 in a software
renderer with no GPU at all. The measurement that pointed at it is worth
recording: with *no objects drawn whatsoever* it was still 12 fps, and halving
the device pixel ratio nearly tripled it. The cost was never the objects or the
lighting — it was compositing four full-screen layers every frame.

## Half-sample errors, which are the whole genre of bug here

Three separate ones, all with the same shape and all visible on screen:

- **The light map was blitted offset.** It covers the map rectangle *exactly* —
  sample `i` spans world pixels `[i·TILE/SUB, (i+1)·TILE/SUB)` — so it draws at
  `(0, 0, w·TILE, h·TILE)` with no offset and no padding. An earlier version
  padded it by half a sample, which shifted **every light in the world** up and
  left by a quarter tile. The symptom was a wall lamp lighting the top of the
  wall instead of the floor in front of it.
- **Index-to-tile rounded wrong.** Sample `i` is centred on tile-space
  `(i+0.5)/SUB`, so tile `T` spans index coordinates
  `[T·SUB − 0.5, (T+1)·SUB − 0.5)` — the conversion needs a `+0.5`. Without it
  a lamp sitting at the centre of its tile reads as being in the tile to its
  *west* the moment a ray steps left, so it lit one side of itself and not the
  other.
- **A fitting mounted in a wall blocked its own light.** Its tile blocks, so
  every ray died before leaving it — and, worse, light two tiles away was
  brighter than light one tile away, because the far ray happened to step past
  the source tile and the near one didn't. Rays now ignore the tile they start
  in.

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
- **A contact shadow has to be soft.** The first one was a rounded rectangle at
  flat alpha, which at any zoom reads as a grey slab lying on the floor. It is
  a radial gradient now.
- **`top` rotates and `face` does not**, so anything whose top art is
  asymmetric comes apart when you turn it — the edge band and legs end up
  hanging off one side. A chair's seat therefore fills its tile and the
  backrest sits *on* the seat, which has the same extent at every rotation and
  lets the back carry the facing by itself.
- **Only a default face gets the tapered outline.** Anything drawing its own
  face has legs, and two diagonals ruled through the air beside them look worse
  than no taper at all.
- **Nothing on a wall's top may line up with the tile.** A run of wall is one
  continuous surface, so a per-tile highlight, a per-tile shade or an outline
  along the buried edge all repeat and read as banding down its length. Only
  noise survives, because noise doesn't tile.
- **A doorway is a hole, not a door on a wall.** If the wall were not there you
  would see floor, so that is what is underneath — nothing in the door's art
  paints over the tile, and the leaf simply stands on it. Drawing the wall's
  face across the tile and cutting a recess in its top is exactly how you get a
  door painted on a thick wall with a window above it.
- **A wall behind a doorway still needs its face**, because you can see through
  the opening. Only something that actually blocks buries the wall behind it.
- **Art that reaches past its own footprint has to say so** (`spread`). A fan's
  blades overhang their tile; clipping the draw bounds to the footprint turns
  the blur disc into a rounded rectangle, because that is a circle cut by a box.
- **Whether a thing is moving is part of the scene's cache key.** A fan that was
  still when the scene was composed otherwise stays baked into it *and* gets
  drawn live on top.
- **A door leaf is a vertical plane with no top at all**, which makes it the
  clearest case in the catalogue for `view` over `top`/`face`. Extruded, it
  draws a full tile-deep slab lying flat *and* a thirty-pixel front, and you
  see the door twice — once on the floor and once standing up.

## Next

A pawn that exists and walks where you tell it. Then one need and one
interaction — hunger, and the dispenser. Behaviour comes after that, and gets
its own loop rather than being threaded through the renderer's.
