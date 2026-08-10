# Castaway

A desert island survival sandbox where the other two survivors are played by Claude.

You wash up alone beside a split supply crate. Somewhere else on the island are
two other people who also think they're alone. You have to find them, and then
work out whether you're better off with them or without them.

The raft seats two. There are three of you. It takes more work than any one
person can do alone.

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
both survivors are in earshot, both answer — and the second one sees the first
one's reply before composing their own, so a three-way conversation is genuinely
three-way. Out of earshot, your words go nowhere.

The two of them talk to each other on their own when they're near each other. It
lands in the same log you're reading. If you're not close enough, you miss it,
and you only find out what was decided from how they behave afterwards.

## Design

### One verb table

`island/verbs.py` is the complete set of things a person on this island can do:
`gather drink eat rest deposit take build give revive board go_to follow`.

The human and both castaways call **exactly those functions with exactly those
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
  signal fire. Wren wants the raft; Odell wants the signal. Six timber in one is
  six not in the other.
- **Thirst is a fast clock.** It drains about twice as fast as hunger and the
  spring is usually across the island, so every hour spent on the shared project
  is an hour not spent on yourself.
- **Rescue creates debt.** Reviving someone who has collapsed costs you water and
  moves their trust a long way. Walking past is always available.

### The model's job

Each castaway gets three kinds of call, all using structured outputs so one
request returns the dialogue *and* the intent behind it:

| call | when | returns |
|---|---|---|
| `plan` | they're idle and off cooldown | thought, emotion, who they're working with, action, target |
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
told what you said to someone out of earshot, and they don't know the other's
private plans. Information asymmetry is real, which is why gossip matters.

## Layout

```
server.py               Flask routes
island/world.py         procedural island — coastline, resource sites, pathfinding
island/actors.py        Actor / Player / Castaway — one body model for all three
island/verbs.py         the shared verb table
island/brain.py         prompts, schemas, Anthropic calls, offline fallbacks
island/state.py         the simulation, discovery, conversation orchestration
static/                 canvas renderer and UI
test_coordination.py    end-to-end proof with the model stubbed
```

Each run generates a new island from a seed (`Game(seed=...)`), so resource
sites and the distances between them differ every time.

## Not built yet

- Procedural cast: survivor count and personalities are currently fixed at the
  two hand-written characters.
- Factions: allegiance is a single string, so with more than two survivors it
  can't express "me and Odell against her". Needs to become a set.
- Named player, run summary, permadeath, and the rest of the roguelike frame.
