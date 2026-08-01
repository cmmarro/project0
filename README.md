# Hearthfall

A turn-based colony game for the browser. Civilization-style tiles and turns;
RimWorld-style colonists who have their own skills, needs and moods and decide
for themselves which of your work orders to pick up.

No build step, no dependencies. Open `index.html` in a browser and play.

```
python3 -m http.server 8000    # optional, if you'd rather serve it
```

Add `?seed=12345` to the URL to replay a specific map.

## The game

Four settlers land in a valley with 55 food and a bag of tools. The stated goal
is to endure three years (120 turns); after that the colony keeps running for as
long as you can hold it together.

Nothing happens until you press **End Turn**, so there is no time pressure while
you plan.

### Giving orders

You never command a colonist directly. You mark work on the map and they choose
what to do:

| Order | Key | Effect |
| --- | --- | --- |
| Chop | `C` | Fells a forest tile for wood; trees regrow after ~70 turns |
| Mine | `M` | Cuts stone from mountains and hills; mountains are worked from an adjacent tile |
| Forage | `F` | Picks a berry bush for food; bushes regrow outside winter |
| Cancel | `X` | Clears orders and buildings (blueprints refund in full, finished buildings half) |

Buildings are placed as blueprints on keys `1`–`5`: **House** (2 beds),
**Storehouse** (+150 to every resource cap), **Farm Plot**, **Campfire**
(warmth in winter) and **Stone Wall**. Materials are paid when you place the
blueprint; someone still has to walk over and build it.

Drag to paint an order or a row of blueprints across an area.

### The colonists

Each colonist has four skills (woodcutting, mining, construction, farming) that
improve with use, and four needs that don't care how busy you are:

- **Food** falls every turn. Below about a third they stop and eat from the
  shared stockpile. With no food in store they starve and lose health.
- **Rest** falls every turn. Below about a quarter they go to bed — a real bed
  if a house has a free one, otherwise the ground, which hurts morale.
- **Mood** is computed from everything else: full belly, a bed of their own,
  warmth in winter, a stocked larder, recent deaths. A colonist who stays
  miserable long enough breaks down and refuses to work for a few turns.
- **HP** regenerates when fed, drains when starving or caught out in the cold.

The four toggles under each name control which kinds of work that colonist will
accept. Turn mining off for your carpenter and they'll stay on the building
site. Colonists prefer the nearest job they're willing to do, nudged toward
work they're good at.

### The year

Ten turns per season, forty per year. Crops grow fastest in summer, slowly in
autumn, and not at all in winter — when nothing grows and anyone more than five
tiles from a campfire loses health every turn. Autumn is for stockpiling.

Raiders start arriving in year two and get more numerous over time. Colonists
within seven tiles of one drop what they're doing and fight automatically.
Stone walls don't stop raiders but they do have to break through them, which
buys you turns.

## Code layout

Plain scripts loaded in order — no modules, so it runs straight off the
filesystem.

| File | Responsibility |
| --- | --- |
| `js/config.js` | All balance numbers, terrain / building / order definitions |
| `js/util.js` | Seeded RNG (mulberry32) and value-noise generator |
| `js/map.js` | Terrain generation, tile queries, reachability flood fill |
| `js/path.js` | 8-way A\* over a set of acceptable goal tiles |
| `js/colonists.js` | Needs, mood, skills, health, melee |
| `js/jobs.js` | What a colonist decides to do each turn, and doing it |
| `js/buildings.js` | Placement, refunds, crop growth, regrowth |
| `js/events.js` | Raids, arrivals, blight, seasons |
| `js/game.js` | Game state, turn resolution, save/load |
| `js/render.js` | Canvas drawing (terrain cached to an offscreen buffer) |
| `js/ui.js` | Panels, tools, mouse and keyboard input |

The simulation files touch no DOM, so the whole game can be run headlessly in
Node for testing — load `config` through `game` into a context whose `window`
is the global object, then call `endTurn()` in a loop.

Save and load use `localStorage`. A save is the whole game state as JSON,
including the RNG's internal state, so a restored colony continues on exactly
the random stream it left off on.

## Keys

`Space` end turn · `C`/`M`/`F` orders · `1`–`5` buildings · `X` cancel tool ·
`Esc` clear selection · `H` help · right-click clears the current tool
