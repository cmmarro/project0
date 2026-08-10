# Castaway

A desert island survival sandbox where the other survivors are played by Claude.

You wash up alone beside a split supply crate. Somewhere else on the island are
some number of other people who also think they're alone — you don't know how
many, or whether there are any at all. You have to find them, and then work out
whether you're better off with them or without them.

The raft seats two. There are more of you than that. It takes more work to build
than any one person can manage alone.

## Running it

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...     # or put it in a .env file
.venv/bin/python server.py              # http://127.0.0.1:5000
```

Without a key it still runs — the survivors fall back to canned lines and a crude
keyword reader, which is enough to see the machinery work but not enough to be
interesting. The badge in the top-left tells you which mode you're in.

```bash
.venv/bin/python test_coordination.py   # proves the core loop, no API key needed
```

## Playing

`WASD` / arrows to move. `E` gather, `Q` drink, `F` eat, `R` rest — or use the
buttons. `Enter` jumps to the talk box.

Talking is **proximity speech, not a dialogue menu**. What you type is said out
loud where you're standing, and whoever is within about four tiles hears it. If
more than one of them is in earshot, they both answer — and the second one sees
the first one's reply before composing their own, so a three-way conversation is
genuinely three-way. Out of earshot, your words go nowhere.

They talk to each other on their own when they end up in the same place. It lands
in the same log you're reading. If you're not close enough, you miss it, and you
only find out what was decided from how they behave afterwards.

## Design

### One verb table

`island/verbs.py` is the complete set of things a person on this island can do:
`gather drink eat rest deposit take build give revive board go_to follow`.

The human and every castaway call **exactly those functions with exactly those
rules**. Nothing in that module knows whether the actor is driven by a keyboard
or by a model. There is no NPC-only script and no player-only privilege. The
only asymmetry is input: you walk with the keyboard, they walk by pathfinding.

### What drives the conflict

- **The raft is a public good with private costs.** 16 gathered items and 12
  sessions of work, which is more than one person can produce while also keeping
  themselves watered — but it seats two, so building it and boarding it are
  different questions.
- **The stores are an open commons.** Anything deposited can be taken by anyone,
  and both acts are witnessed and remembered. Cooperation is only stable because
  the game is iterated and reputation carries.
- **Rival plans compete for one bottleneck.** Timber feeds both the raft and the
  signal fire, and which one a survivor argues for falls out of their boldness
  roll. Six timber in one is six not in the other.
- **Thirst is a fast clock.** It drains about twice as fast as hunger and the
  spring is usually across the island, so every hour spent on the shared project
  is an hour not spent on yourself.
- **Rescue creates debt.** Reviving someone who has collapsed costs you water and
  moves their trust a long way. Walking past is always available.

### The cast is rolled, not written

Every run generates its own survivors from the seed: how many (two to four),
who they were before the boat, and five trait axes — generosity, industry,
boldness, candour, temper. An archetype supplies the spine (a commercial diver
is competent and taciturn; a night radio host can talk anyone down and build
nothing), and the trait rolls perturb it, so the same archetype plays as a
different person in a different run. Each also gets a private belief about how
this ends and a secret they will not volunteer.

Names, surnames and backgrounds are drawn without replacement, so no run gives
you two people who are easy to confuse. Traits are visible to the model as
prose, not numbers.

Alliances are sets of people, not a flag, so a survivor can throw in with you,
with one of the others, with several, or with nobody — and mutual alliances get
reported back as factions.

### The model's job

Each castaway gets three kinds of call, all using structured outputs so one
request returns the dialogue *and* the intent behind it:

| call | when | returns |
|---|---|---|
| `plan` | they're idle and off cooldown | thought, emotion, who they're working with (a list of names), action, target |
| `speak` | someone spoke near them | line, emotion, memory, trust change, action, target |
| `first_contact` | they meet someone for the first time | line, emotion |

`action` is constrained by enum to the same verb table above, so the model
cannot invent a capability it doesn't have. The returned action is routed
through pathfinding and then executed by the real verb over game time — agreeing
to fetch timber means walking to the timber and gathering it.

Memories are written by the model in its own voice, capped at fourteen, and fed
back in on the next call. Trust is a number that changes how the relationship is
described in the next prompt. That loop — act in the world, read it back as
text, act again — is the whole thing.

### What they aren't told

They see their own body, their own inventory, the camp, and only what's within
about six tiles of them. They don't see each other's memories, they don't get
told what you said to someone out of earshot, and they don't know anyone else's
private plans or secrets. Information asymmetry is real, which is why gossip matters.

## Layout

```
server.py               Flask routes
island/world.py         procedural island — coastline, resource sites, pathfinding
island/people.py        procedural cast — archetypes, trait axes, persona text
island/actors.py        Actor / Player / Castaway — one body model for everyone
island/verbs.py         the shared verb table
island/brain.py         prompts, schemas, Anthropic calls, offline fallbacks
island/state.py         the simulation, discovery, conversation orchestration
static/                 canvas renderer and UI
test_coordination.py    end-to-end proof with the model stubbed
```

Each run generates a new island *and* a new cast from one seed
(`Game(seed=..., cast_size=...)`), so the resource layout, the walking distances,
and the people are all different every time. Same seed, same run.

## Not built yet

- The castaways can form factions but nothing yet *acts* on one — no group
  decisions, no coordinated exclusion, no shared stash separate from the commons.
- The raft still seats two regardless of cast size, so a four-person run is much
  crueller than a two-person one. Capacity should probably scale, or be rolled.
- Named player, run summary, permadeath, and the rest of the roguelike frame.
