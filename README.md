# Hyakushō 百姓

A live, isometric village simulation set in Sengoku-era Japan. The clock runs
on its own: villagers work from dawn, go to bed at nine, and get up at first
light, and you set the speed or pause and take as long as you like.

No build step, no dependencies. Open `index.html` in a browser and play.

```
python3 -m http.server 8000    # optional, if you'd rather serve it
node tools/bundle.js           # -> dist/hyakusho.html, the whole game in one file
```

Add `?seed=12345` to the URL to replay a specific valley.

## The game

Four peasants settle a valley. What happens next is up to you — including how
much pressure you want.

| | |
| --- | --- |
| **Open Valley** | No collectors, no bandits. Seasons, ground, and people. It does not end. |
| **A Quiet Province** | The castle asks, but lightly, and trouble is far off. Room to make mistakes. |
| **Under the Daimyō** | The levy as written, bandits from year two, and the village can be broken up. |

Chosen on the opening sheet, remembered between sessions, and shareable as
`?mode=open`.

### Time

A day is 240 ticks and about forty seconds at 1×. Ten hours of daylight, a dusk,
and a night the hearths have to get you through. Twelve days to a season,
forty-eight to a year.

`Space` pauses. `1` `2` `3` set the speed. Nothing is lost by stopping to think.

### The levy

In the two scenarios that have one, the daimyō's collectors come after each
harvest: **18 koku, then 55, then 100, then 155**. The first year is a remission
year — newly opened land was taxed lightly — so you get a full year to learn the
valley before a levy can hurt you.

Falling short costs **standing**, in proportion to how far short you fall. A few
koku is a note in a ledger; half the demand is a mark against the village. Run
standing to nothing and the village is broken up. It recovers slowly on its own,
and paying *over* the demand buys credit against a year when the harvest fails —
which is the only reason to grow more rice than the number on the chip.

Tap the levy chip to read the ledger.

### More than one way to pay

The castle only ever asks for rice, so there has to be a way to turn other
things into it. Traders come up the valley with a **single offer** — timber for
rice, rice for stone, take it or leave it, and gone in four days. A village
that cuts bamboo or traps fish can buy its way to the levy without a paddy in
sight.

Offers are weighted towards wanting what you have too much of and carrying what
you lack, because a trade route you cannot plan around is not a route.

### Giving orders

You never command a villager directly. You choose a tool and mark the map, and
they decide who does what.

| Order | Effect |
| --- | --- |
| Fell Timber | Pine, or bamboo — bamboo pays less but is back inside the year |
| Quarry Stone | Cuts stone from slopes and mountains |
| Forage | Whatever is in season: bracken, chestnuts, mushrooms, yam, hemp, herbs |
| Set Fish Traps | Steady food from the riverbank that owes nothing to the paddies |

### The ground

Where you build matters more than how much you build.

| Ground | What it is for |
| --- | --- |
| **Reed Marsh** | Paddies ripen half again as fast. Nothing else will stand on it |
| **Meadow** | Ordinary. Paddies, houses, anything |
| **Susuki Moor** | Open and buildable, but paddies barely work — dry ground |
| **Pine Grove** | Timber, back in a couple of months |
| **Bamboo Grove** | Less timber per cut, back inside the year — logged over and over |

Villages are sited near marsh where there is any, so the good ground is
something you actually meet.

### What grows wild

Each plant is only worth taking in its own season, which is what gives the year
a shape beyond the rice.

| Plant | Season | Gives |
| --- | --- | --- |
| Bracken | Spring | Food |
| Chestnut | Summer, autumn | Food |
| Mushrooms | Autumn | Food, under the pines |
| Wild yam | Autumn, winter | Food that is there when nothing else is |
| Wild hemp | Summer, autumn | Hemp — useless until woven |
| Medicinal herbs | Spring to autumn | Herbs — useless until ground |
| Fish | All year | The one thing the river always gives |

### Rooms, furniture and crafting

There is no pre-fab hut. Raise **timber walls** in a ring, hang a **door**, and
lay a **futon** inside. Any tile you cannot walk from to the edge of the map is
indoors — that one rule is the whole room system, and it is what makes walls
worth building: indoors is warm through winter, and the only place anyone
sleeps properly.

An **irori** hearth keeps a room alive through the cold and lights it after
dark. A **chest** holds more stores. A **low table** is somewhere to eat that
is not the floor.

Build a **work bench** and tap it to set what it makes:

| Recipe | Takes | Gives |
| --- | --- | --- |
| Weave Cloth | 6 hemp | 3 cloth — a futon needs it |
| Grind Medicine | 5 herbs | 2 medicine |
| Dry and Salt | 14 rice | 20 rice — slow, and only worth it on a glut |

### Build tools

Blueprints **cost nothing to place**. Draw the whole house and the village
builds it as the timber comes in — a plan the stores cannot cover waits instead
of blocking the builder, and gets picked up the moment the materials land. The
materials come out of the stores when a thing is finished, not when it is drawn.

| | |
| --- | --- |
| **Drag a wall** | Fills the *outline* of the box — drag a room, get a room |
| **Fill** (`R`) | Turns that off, for a solid block |
| **Cancel** (`X`) | Calls off plans and work orders. Instant; nothing was spent |
| **Deconstruct** (`V`) | Marks something standing to be pulled down — a job somebody walks over and does, returning half the materials |
| **Undo** (`Ctrl+Z`) | Takes back the whole last drag, not the last tile of it |

The chip at the bottom of the map is a live readout: how many tiles the drag
will take, what they cost, and whether the stores can cover it. On the map
itself, each tile shows green if it will take and red if it will not — so a
wall drawn across a river shows you the gap before you let go.

### The villagers

Each has four skills (forestry, quarrying, carpentry, farming) that improve with
use, and four needs that don't care how busy you are:

- **Food** falls all day. Below about a third they stop and eat from the shared
  stores. With nothing in the kura they starve, over about three days.
- **Rest** falls while they are awake. They go to bed around nine and get up at
  first light — on a futon indoors they wake full; on bare ground they lose a
  little every night until it starts to tell.
- **Spirit** is the sum of everything they are currently thinking. Tap a villager
  to read the list.
- **Health** regenerates when fed, drains when starving or caught out in the cold.

The four toggles under each name control which work that villager will accept.
They prefer the nearest job they're willing to do, nudged toward what they're
good at.

Everyone also has an origin, a distinguishing mark, one trait, and a tie to one
other villager. Tap a name to replace it with one of your own.

### Thoughts

Spirit is never shown as a bare number without its reasons:

```
Lost Toshi of Shirakawa · fading   -25
The collectors stripped us bare    -22
No hearth in this cold             -20
Nothing left in the kura           -14
Nowhere to sleep but the ground    -11
Well rested                         +6
```

Some are conditions you can fix today — put up walls, light a hearth. Some are
memories that fade over one to four weeks, which is what makes a paid levy feel
like relief and a missed one hang over the next two seasons. A **Sullen**
villager takes every bad thought 40% harder and a **Steady** one 40% lighter, so
the same winter reads differently down the roster.

A villager who stays miserable long enough sits down and stops working.

### The year

Twelve days per season, forty-eight per year. Rice grows fastest in summer,
slowly in autumn, and not at all in winter — when anyone outdoors and away from
a hearth loses health. The levy falls after the autumn harvest, so you pay first
and face winter on what's left.

Bandits start arriving in year two — later and rarer in a Quiet Province, and
never in an Open Valley. Villagers within seven tiles of one drop what they're
doing and fight automatically.

Roadside shrines stand in some valleys. They do nothing except lift the spirits
of anyone living within a few tiles, which is a reason to settle in one part of
the valley rather than another.

## Code layout

Plain scripts loaded in order — no modules, so it runs straight off the
filesystem.

| File | Responsibility |
| --- | --- |
| `js/config.js` | All balance numbers, terrain / building / order definitions |
| `js/util.js` | Seeded RNG (mulberry32) and value-noise generator |
| `js/time.js` | The clock: ticks, days, seasons, and the light curve |
| `js/iso.js` | Isometric projection and elevation-aware tile picking |
| `js/map.js` | Terrain generation, tile queries, reachability flood fill |
| `js/path.js` | 8-way A\* over a set of acceptable goal tiles |
| `js/colonists.js` | Needs, spirit, skills, health, melee |
| `js/jobs.js` | What a villager decides to do each tick, and doing it |
| `js/buildings.js` | Placement, refunds, crop growth, regrowth, room detection |
| `js/events.js` | Bandit raids, arrivals, blight, seasons |
| `js/game.js` | Game state, the tick loop, day rollover, the levy, save/load |
| `js/camera.js` | Pan and zoom over a fixed-size canvas |
| `js/render.js` | Isometric drawing, painted back to front |
| `js/ui.js` | Panels, tool pickers, pointer and keyboard input |
| `tools/bundle.js` | Inlines everything into one self-contained page |

The simulation files touch no DOM, so the whole game can be run headlessly in
Node for testing — load `config` through `game` into a context whose `window` is
the global object, then call `step()` in a loop. That is how the sleep cycle was
tuned and the levy balanced.

The simulation costs about 7 µs a tick with four villagers and a hundred
standing orders, so even 4× speed is well under a fifth of one core. Night is a
single translucent wash over the finished scene rather than a recolour of every
tile — that is what makes a live day/night cycle affordable at sixty frames on
a phone.

The visible tile range is solved for analytically rather than tested tile by
tile. Villagers are simulated firmly on the grid — only the picture is allowed
to be between tiles, interpolated from the tile they left.

Save and load use `localStorage`. A save is the whole game state as JSON,
including the RNG's internal state, so a restored village continues on exactly
the random stream it left off on.

## Design notes

Shaped by Tynan Sylvester's [*The Simulation
Dream*](https://tynansylvester.com/2013/06/the-simulation-dream/), which argues
that a simulation only counts insofar as it reaches the player's head.

**Named thoughts.** The mood calculation always weighed eight conditions, and
always threw the reasoning away to show one number. `HF.Colonists.thoughts()`
returns the same arithmetic with its reasons attached, and the panel prints
them. No new simulation — the same simulation, made visible.

**Hair complexity.** Origins and marks affect nothing whatsoever. They exist so
the player has someone to picture, they cost nothing to balance, and a player
who doesn't care can ignore them entirely.

**Minimum representation.** A bond is one id on one villager and does nothing at
all while both are alive. That is the whole design: the smallest thing that
supports the story it exists for, which is the one where somebody doesn't come
back. Traits get exactly one hook each, and every hook is legible in the
thoughts list.

**Story-richness.** Skill-ups aren't logged, breakdowns log once per villager
per four days, and spoilage once per four — bookkeeping crowds out the
lines that are about something. What survives in the Record names an actor and
has something at stake.

**Room to breathe.** The levy and the bandits were built first and grew to fill
the game. Open Valley removes both, the year-four mark is a milestone rather
than a finish line, and the Record carries ambient lines — fireflies, geese
going over, ice at the edges of the river — that mean nothing at all. A village
worth keeping has to be somewhere you would look at when nothing is going
wrong. For the same reason nobody is ever "Idle": they are mending something,
watching the river, or sitting at the shrine.

## Controls

Drag with no tool chosen to pan; pinch or scroll to zoom; tap a tile to inspect
it, or a villager to select them. With a tool chosen, dragging paints instead —
the chip at the bottom of the map says which tool is live and clears it.

`Space` pause · `1`/`2`/`3` speed · `B` build menu · `C`/`M`/`F` work orders ·
`X` cancel tool · `Esc` put the tool down · `H` help

Tap a bench to set what it makes.
