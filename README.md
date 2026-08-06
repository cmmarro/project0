# Civ Prototype

A deliberately small 4X strategy game in the browser. No dependencies, no build
step — plain ES modules, a canvas, and a side panel.

The point of this first pass is the *shape*, not the content. There is enough
game here to actually play a few dozen turns, and the systems that exist are the
ones everything else will hang off of.

## Running it

ES modules need a real origin, so `file://` will not work. Any static server:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Add `?seed=12345` to the URL to replay a specific world. `New Map` rolls a fresh
one. In the devtools console, `game()` returns the live state object.

## Playing it

You start with a Settler and a Warrior.

| Input | Effect |
| --- | --- |
| Click a tile | Select the unit or city on it (click again to cycle a stack) |
| Click an empty adjacent tile | Move the selected unit there |
| Right-click an adjacent tile | Move, even if the tile is occupied |
| Arrow keys / numpad | Move the selected unit (numpad covers diagonals) |
| Space | Jump to the next unit with movement left |
| Enter | End the turn |

Found a city with the Settler, pick something to build, and end turns. Cities
grow on food and build on production; population is assigned to the best nearby
tiles automatically. Buttons that are greyed out have a tooltip explaining why.

## How it is put together

```
js/
  data/        content tables — terrain, units, city names
  core/        rules. no DOM, no canvas, no imports from ui/
    rng.js       seeded PRNG
    map.js       terrain generation + starting position
    state.js     state shape and read-only queries
    economy.js   which tiles a city works, and what they yield
    actions.js   player-initiated changes
    turn.js      end-of-turn pipeline and fog of war
  ui/          render.js (canvas) and panel.js (side panel)
  main.js      input wiring only
```

Five conventions are doing the load-bearing work:

**State is plain JSON-serializable data.** No classes, no functions, no typed
arrays anywhere in the state tree. Save/load, undo, and replay are all cheap to
add later because of this, and none of them need to be designed now.

**`core/` never touches the DOM.** It has no import that reaches into `ui/`. The
renderer reads state and draws; it never decides anything.

**Content lives in tables, not code.** Adding a terrain type is a row in
`data/terrain.js`; adding a unit is a row in `data/units.js`. Nothing branches on
a specific terrain or unit id.

**Every action is a `can*` / `do*` pair.** `canFoundCity` returns `null` or a
human-readable reason it is blocked; `doFoundCity` assumes it passed. The UI
greys out the button and uses the same string as its tooltip, so exactly one
place knows each rule.

**One RNG, always seeded.** Everything random goes through `core/rng.js`, so a
seed fully determines a world.

## Deliberately not here yet

Left out because each one is a real system, and guessing at it now would mean
tearing it out later:

- **Opponents.** No AI, no barbarians, no other civilizations. This is the
  biggest gap and the obvious next step. `turn.js` is where they plug in.
- **Combat.** Units stack freely and pass through each other. No strength, no
  health, no zone of control.
- **Research and tech.** No tech tree, no eras.
- **Buildings.** Cities build units only.
- **Terrain improvements.** The Worker exists as a placeholder and does nothing.
- **Borders.** A city works tiles within radius 2; territory is not modelled.
- **Multi-tile pathfinding.** Units move one tile at a time.
- **Rivers, resources, wonders, diplomacy, trade, religion, culture.**

## Known rough edges

- **City tile assignment is greedy and automatic.** It scores tiles by
  `food * 4 + production * 3` and trades production for food when a city would
  otherwise stall. It cannot be overridden by hand yet.
- **Food upkeep is 1 per citizen.** It has to stay at or below what a typical
  land tile yields, or new citizens eat more than they bring in and nothing can
  grow — with no terrain improvements, raw tile yields are the whole economy.
  Raise it when Workers start doing something.
- **First city founded wins contested tiles.** Cities within 4 tiles of each
  other split the overlap by founding order, which is arbitrary but stable.
- **Production carries over freely between build orders.** No penalty for
  switching; that is a balance knob, not a system.
- **Completed builds clear the order** rather than repeating, so an idle city is
  visible instead of silently spending production.
