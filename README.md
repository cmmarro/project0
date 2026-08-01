# Hyakushō 百姓

An isometric, turn-based village game set in Sengoku-era Japan. Civilization-style
tiles and turns; RimWorld-style villagers who have their own skills, needs and
moods and decide for themselves which of your work orders to pick up.

No build step, no dependencies. Open `index.html` in a browser and play.

```
python3 -m http.server 8000    # optional, if you'd rather serve it
node tools/bundle.js           # -> dist/hyakusho.html, the whole game in one file
```

Add `?seed=12345` to the URL to replay a specific valley.

## The game

Four peasants settle a valley. You have three years.

**The levy is the whole game.** After each harvest the daimyō's collectors come
for rice — 40 koku, then 75, then 115 — and they do not care whether you can
spare it. The countdown sits in the bar at the top.

| Outcome | Effect |
| --- | --- |
| Paid in full | Spirits lift across the village |
| Short by less than a third | One strike, and everything in the granary is taken |
| Short by more | Two strikes, and someone walks out rather than starve for the castle |

Three strikes and the village is broken up. So you can survive one bad year, or
two tight ones — not both. Hold on through all three levies and the village
endures; you can carry on afterwards, with the demand climbing every autumn.

Nothing happens until you press **End Turn**, so there is no time pressure while
you plan.

### Giving orders

You never command a villager directly. You choose a tool and mark the map, and
they decide who does what.

| Order | Effect |
| --- | --- |
| Fell Timber | Fells a pine grove; the grove grows back in time |
| Quarry Stone | Cuts stone from slopes and mountains |
| Gather Chestnuts | Food, but never enough to cover a levy |

| Building | Cost | Purpose |
| --- | --- | --- |
| Minka | 22 timber | Farmhouse, sleeps two |
| Kura | 28 timber | Granary; +150 to every storage cap |
| Rice Paddy | 5 timber | Your only real source of rice |
| Hearth Fire | 12 timber | Keeps anyone within five tiles alive through winter |
| Yagura | 16 timber, 8 stone | Watchtower; villagers nearby fight harder |
| Ishigaki | 6 stone | Stone rampart; bandits must break through it |

Drag to paint an order or a row of buildings across an area.

### The villagers

Each has four skills (forestry, quarrying, carpentry, farming) that improve with
use, and four needs that don't care how busy you are:

- **Food** falls every turn. Below about a third they stop and eat from the
  shared stores. With nothing in the kura they starve.
- **Rest** falls every turn. Below about a quarter they sleep — in a bed if a
  minka has one free, otherwise on the ground, which wrecks morale.
- **Spirit** is computed from everything else: full belly, a bed of their own,
  warmth in winter, full stores, recent deaths, a levy paid or missed. Someone
  who stays miserable long enough stops working for a few turns.
- **Health** regenerates when fed, drains when starving or caught out in the cold.

The four toggles under each name control which work that villager will accept.
They prefer the nearest job they're willing to do, nudged toward what they're
good at.

### The year

Ten turns per season, forty per year. Rice grows fastest in summer, slowly in
autumn, and not at all in winter — when anyone more than five tiles from a hearth
loses health every turn. The levy falls after the autumn harvest, so you pay
first and face winter on what's left.

Bandits start arriving in year two. Villagers within seven tiles of one drop what
they're doing and fight automatically.

## Code layout

Plain scripts loaded in order — no modules, so it runs straight off the
filesystem.

| File | Responsibility |
| --- | --- |
| `js/config.js` | All balance numbers, terrain / building / order definitions |
| `js/util.js` | Seeded RNG (mulberry32) and value-noise generator |
| `js/iso.js` | Isometric projection and elevation-aware tile picking |
| `js/map.js` | Terrain generation, tile queries, reachability flood fill |
| `js/path.js` | 8-way A\* over a set of acceptable goal tiles |
| `js/colonists.js` | Needs, spirit, skills, health, melee |
| `js/jobs.js` | What a villager decides to do each turn, and doing it |
| `js/buildings.js` | Placement, refunds, crop growth, regrowth |
| `js/events.js` | Bandit raids, arrivals, blight, seasons |
| `js/game.js` | Game state, turn resolution, the levy, save/load |
| `js/camera.js` | Pan and zoom over a fixed-size canvas |
| `js/render.js` | Isometric drawing, painted back to front |
| `js/ui.js` | Panels, tool pickers, pointer and keyboard input |
| `tools/bundle.js` | Inlines everything into one self-contained page |

The simulation files touch no DOM, so the whole game can be run headlessly in
Node for testing — load `config` through `game` into a context whose `window` is
the global object, then call `endTurn()` in a loop. That is how the levy was
balanced.

Rendering is on demand: the game is turn-based, so a frame is only painted when
something actually changed, and the visible tile range is solved for rather than
tested tile by tile.

Save and load use `localStorage`. A save is the whole game state as JSON,
including the RNG's internal state, so a restored village continues on exactly
the random stream it left off on.

## Controls

Drag with no tool chosen to pan; pinch or scroll to zoom; tap a tile to inspect
it, or a villager to select them. With a tool chosen, dragging paints instead —
the chip at the bottom of the map says which tool is live and clears it.

`Space` end turn · `B` build menu · `C`/`M`/`F` work orders · `X` cancel tool ·
`Esc` put the tool down · `H` help
