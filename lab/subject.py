"""The subject: a body, a set of needs, and one thread of intent.

There is no model in here. A subject with its head switched off is still a
complete working creature — reflexes, habits and the scoring layer run the
body perfectly well on their own, and that is the baseline the lab exists to
compare against. When a head *is* attached it writes into the same single
intent slot everything else writes into, so there is never a moment where the
subject is being driven by two things at once.
"""

from __future__ import annotations

from . import room
from .needs import starting_needs

SPEED = 0.6           # tiles per simulated minute — a room crossed in ~40 min
REACH = 1.6


class Subject:
    def __init__(self, x: float, y: float):
        self.x, self.y = float(x), float(y)
        self.needs = starting_needs()

        # Exactly one of these at a time, stamped with who authored it.
        self.intent = None
        self.busy = 0.0               # simulated minutes spent on it
        self.roam = None
        self.stuck = 0                # steps spent not getting anywhere
        self.alive = True

        # What it has worked out. Short lines the sim writes about its own
        # life — including the things that went wrong, which is the only
        # reason it ever stops trying a tap that keeps coming up dry.
        self.learned: list[str] = []
        # What it has done lately, in order, with who decided each one. This
        # is what the head reads back; it is the subject's account of its day.
        self.story: list[dict] = []
        # Circumstance -> {verb: tally}. Past a few, deciding stops happening.
        self.habits: dict[str, dict[str, int]] = {}
        # Conditionals somebody stated through the glass. Kept for the
        # headless baseline; a head just reads the words and makes its own mind up.
        self.deals: list = []
        # Anything said through the glass, verbatim and unparsed. Nothing in
        # the sim interprets it — that is the head's job, if there is one.
        self.heard: list[dict] = []
        # ...and anything it said back.
        self.said: list[dict] = []
        # When each job was last finished, for satiation.
        self.did: dict[str, float] = {}

    # -- one intent -----------------------------------------------------------

    @property
    def job(self):
        return self.intent.job if self.intent is not None else None

    def take(self, intent, lab):
        """Adopt an intent. Everything that decides anything comes through here."""
        self.intent = intent
        self.busy = 0.0
        self.roam = None
        self.stuck = 0
        if intent is None:
            return
        intent.started = lab.minutes
        if intent.verb == "mull":
            return          # not something it did; something it was doing meanwhile
        if intent.say:
            self.said.append({"at": lab.minutes, "t": lab.clock(),
                              "text": intent.say})
            del self.said[:-12]
            lab.note(f"It says, through the glass: “{intent.say}”", "subject")
        self.story.append({"t": lab.clock(), "verb": intent.verb,
                           "label": intent.job.label, "by": intent.by,
                           "why": intent.why})
        del self.story[:-14]

    # -- body -----------------------------------------------------------------

    def at(self, x, y) -> bool:
        return abs(self.x - x) < 0.35 and abs(self.y - y) < 0.35

    def near(self, thing) -> bool:
        return max(abs(self.x - thing.x), abs(self.y - thing.y)) <= REACH

    def walk_to(self, tx, ty, lab):
        moving = not self.at(tx, ty)
        if moving:
            self.x, self.y = room.step_toward(lab.rows, self.x, self.y, tx, ty,
                                              SPEED * lab.step_minutes)
            # Walking costs something, or resting would never be worth it.
            self.needs["energy"].tick(lab.step_minutes, rate=0.6)
        return not moving

    def tick_needs(self, lab):
        for n in self.needs.values():
            n.tick(lab.step_minutes)
        if self.needs["thirst"].level <= 0 or self.needs["hunger"].level <= 0:
            self.alive = self.needs["thirst"].level > 0 or self.needs["hunger"].level > 0

    def remember(self, line: str):
        if line and line not in self.learned:
            self.learned.append(line)
            del self.learned[:-12]

    def feels(self) -> str:
        """Its body, in words rather than percentages.

        Deliberately not numbers. Hand a head a table of decimals and it does
        arithmetic; hand it a feeling and it decides something.
        """
        words = {
            "thirst": ["parched, badly", "thirsty", "a little dry", "not thirsty"],
            "hunger": ["starving", "hungry", "peckish", "not hungry"],
            "energy": ["barely upright", "very tired", "tired", "rested"],
            "curiosity": ["restless, needs something to do", "bored",
                          "mildly interested in things", "content enough"],
        }
        out = []
        for key, scale in words.items():
            lv = self.needs[key].level
            out.append(scale[0] if lv < 0.18 else scale[1] if lv < 0.4
                       else scale[2] if lv < 0.7 else scale[3])
        return "; ".join(out)

    def snapshot(self) -> dict:
        return {
            "x": round(self.x, 2), "y": round(self.y, 2),
            "needs": [n.snapshot() for n in self.needs.values()],
            "doing": self.intent.job.label if self.intent else "nothing",
            "verb": self.intent.verb if self.intent else "idle",
            "by": self.intent.by if self.intent else "",
            "why": self.intent.why if self.intent else "",
            "learned": list(self.learned),
            "story": list(self.story[-8:]),
            "said": list(self.said[-6:]),
            "deals": [d.snapshot() for d in self.deals],
            "alive": self.alive,
        }
