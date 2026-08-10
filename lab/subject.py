"""The subject: a body, a set of needs, and whatever it is currently doing.

There is no model in here. A subject with the mind switched off is a complete,
working creature — that is the point of the lab. The model, when it is on, only
ever gets to weigh in at one place, and you can see exactly where.
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
        self.job = None               # the Job object currently running
        self.busy = 0.0               # simulated minutes spent on it
        self.roam = None
        self.stuck = 0                # steps spent not getting anywhere
        self.alive = True

        # What it has worked out. Not a language model's memory — just a list
        # of short lines the sim writes, which is all the mind ever gets to
        # read if it is switched on at all.
        self.learned: list[str] = []
        # Conditionals somebody told it through the glass. Nothing in the room
        # will ever remind it these exist.
        self.deals: list = []
        # Anything said through the glass, verbatim and unparsed. Nothing in
        # the sim reads it — it is here for whatever ends up doing the
        # deciding, and for you to see that it was heard.
        self.heard: list[dict] = []
        # When each job was last finished, for satiation.
        self.did: dict[str, float] = {}
        self.picked: list[dict] = []  # the last few decisions, with their tables

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

    def snapshot(self) -> dict:
        return {
            "x": round(self.x, 2), "y": round(self.y, 2),
            "needs": [n.snapshot() for n in self.needs.values()],
            "doing": self.job.label if self.job else "nothing",
            "verb": self.job.key if self.job else "idle",
            "learned": list(self.learned),
            "deals": [d.snapshot() for d in self.deals],
            "alive": self.alive,
        }
