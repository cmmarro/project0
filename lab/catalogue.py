"""What you are allowed to put in the room.

The room starts empty. Everything in it is something you dropped there, which
is the whole shape of the thing now: you are not observing a furnished cell,
you are furnishing one and watching what that does.

That inverts where the interest comes from. A fixed room asks "what does the
pawn do?" — and the honest answer, measured, was 39% of its waking life staring
out of the window, because there was nothing else. A room you build asks "what
happens if there's a bed but no water", "what if there are four chairs and
nothing to do", "what if I take the dispenser out on day three". Those are
questions with different answers, and none of them need a model to be
interesting.

A kind is a template. Dropping one makes a Thing with its own id, so two beds
are two beds and the pawn walks to whichever is nearer. Nothing in the
behaviour layer names a specific object — jobs ask for *a* water source and
get the nearest one that is working.
"""

from __future__ import annotations

# affords : which need using it fills, and how fast (need per simulated minute)
# uses    : how many charges before it runs dry; None for unlimited
# refill  : charges back per simulated minute
KINDS: dict[str, dict] = {
    "tap": {
        "label": "water tap", "glyph": "T", "group": "supply",
        "need": "thirst", "rate": 1 / 12, "uses": 3.0, "refill": 1 / 90,
        "examine": "A tap. It runs when you turn it, then stops, and takes a "
                   "long while to come back.",
        "blurb": "Water. Runs dry after a while and comes back slowly.",
    },
    "dispenser": {
        "label": "paste dispenser", "glyph": "H", "group": "supply",
        "need": "hunger", "rate": 1 / 20, "uses": 2.0, "refill": 1 / 150,
        "examine": "A hatch in the wall. Something edible arrives in it now "
                   "and then, and not on any schedule you can see.",
        "blurb": "Nutrient paste. Same story — it empties, and it refills.",
    },
    "bed": {
        "label": "cot", "glyph": "C", "group": "furniture",
        "need": "energy", "rate": 1 / 45,
        "examine": "A low cot, bolted down. It is not comfortable but it is a bed.",
        "blurb": "Somewhere to sleep. Bare until there's cloth to make it up with.",
        "state": {"bedded": False},
    },
    "chair": {
        "label": "chair", "glyph": "h", "group": "furniture",
        "need": "comfort", "rate": 1 / 50,
        "examine": "A chair. Somebody thought about the back of it, a little.",
        "blurb": "Somewhere to sit. Resting in a chair is worth more than "
                 "resting on your feet.",
    },
    "table": {
        "label": "table", "glyph": "=", "group": "furniture",
        "examine": "A table, bare. It is the right height to eat at.",
        "blurb": "Does nothing on its own. Eating near one is pleasanter.",
    },
    "lamp": {
        "label": "lamp", "glyph": "*", "group": "fittings",
        "examine": "A lamp. It throws a flat light and it does not flicker.",
        "blurb": "Light. Without one the room follows the clock and it sleeps "
                 "at night; with one on, it can stay up.",
    },
    "crate": {
        "label": "crate", "glyph": "B", "group": "work",
        "examine": "A crate with the lid nailed down. Something shifts inside "
                   "when it's tipped. The nails are old.",
        "blurb": "Four hours of work, and then cloth for the bed. The only "
                 "long job in the room.",
        "state": {"cloth": False, "work": 0.0, "open": False},
    },
    "button": {
        "label": "button", "glyph": "O", "group": "work",
        "examine": "A button set flush in a pillar. Pressing it makes a sound "
                   "somewhere behind the wall. Nothing else happens.",
        "blurb": "Does nothing. Exists so there is something to promise a "
                 "reward for.",
    },
    "wall marks": {
        "label": "scratches", "glyph": "x", "group": "fittings",
        "examine": "Scratches on the wall, low down. Somebody counted "
                   "something here, and stopped at nineteen.",
        "blurb": "Somebody else's tally. It will pick the count up, one a day.",
        "state": {"marks": 19, "mine": 0},
    },
    # Occupations. Not needs — things to be getting on with, which is what a
    # waking day is actually made of. Measured without any of these, a
    # perfectly well-fed subject spent 40% of its life at the window, because
    # there was nothing else; that is content missing, not behaviour failing.
    # Anything with an `occupation` block works with no new code.
    "wire": {
        "label": "knot of wire", "glyph": "&", "group": "work",
        "examine": "A snarl of wire, thick as a finger. It can be worked "
                   "loose, and it goes back to a snarl if you leave it.",
        "blurb": "Something to pick at. Never finishes, which is the point.",
        "occupation": {"doing": "working the wire loose", "minutes": 45,
                       "fills": {"curiosity": 0.30},
                       "thought": ("had something to do with its hands", 0.06, 700)},
    },
    "papers": {
        "label": "stack of papers", "glyph": "≡", "group": "work",
        "examine": "A stack of papers, close-printed, about something "
                   "technical. It is not clear they were meant for anyone here.",
        "blurb": "Reading. Fills the long middle of the day better than "
                 "anything else in the palette.",
        "occupation": {"doing": "reading", "minutes": 60,
                       "fills": {"curiosity": 0.40},
                       "thought": ("read for a while", 0.08, 900)},
    },
    "plant": {
        "label": "potted plant", "glyph": "♈", "group": "furniture",
        "examine": "A plant in a pot, half dead and not getting worse. "
                   "Somebody watered it at some point.",
        "blurb": "Something to look after. Small, and it lifts the room.",
        "occupation": {"doing": "seeing to the plant", "minutes": 25,
                       "fills": {"curiosity": 0.10, "comfort": 0.10},
                       "thought": ("the plant is still alive", 0.09, 1400)},
    },
    "drain": {
        "label": "drain", "glyph": "o", "group": "fittings",
        "examine": "A drain in the floor. It smells of nothing at all.",
        "blurb": "Nothing. Something to look at once.",
    },
    "door": {
        "label": "door", "glyph": "D", "group": "fittings",
        "examine": "A door with no handle on this side. It does not move.",
        "blurb": "It does not open. It is worth having anyway.",
    },
}

# What a subject needs at all in order not to die, for the warning on the panel.
VITAL = {"thirst": "tap", "hunger": "dispenser"}


def blurbs() -> list[dict]:
    return [{"kind": k, "label": v["label"], "glyph": v["glyph"],
             "group": v["group"], "blurb": v["blurb"]}
            for k, v in KINDS.items()]
