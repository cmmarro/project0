"""What makes this one different from the last one.

Everything else in the lab is the same for every subject: the same room, the
same curves, the same day. That is fine for proving a behaviour system works
and hopeless for watching one, because the second run tells you nothing the
first didn't.

Traits are the cheapest fix and the one colony sims lean on hardest. Two rolled
at generation, and they don't add behaviour — they re-weight behaviour that
already exists. An industrious subject and a listless one have identical job
lists and produce completely different weeks, and neither needs a line of code
that only one of them can reach.

Deliberately no good ones and bad ones. `nervy` gives you a subject that
notices things and takes them badly; `stoic` gives you one that plods through a
week that would have broken the other and is duller to watch for it.
"""

from __future__ import annotations

import random

# jobs:   multiplier on that job's score
# needs:  multiplier on that need's fall rate (below 1 = holds out longer)
# mood:   how hard thoughts land — 1.4 feels everything, 0.6 shrugs
# break:  what it does when it comes apart
TRAITS = [
    {"key": "industrious", "label": "industrious",
     "note": "would rather be doing something than not",
     "jobs": {"work": 1.7, "makebed": 1.4, "rest": 0.7, "watch": 0.6},
     "needs": {"energy": 1.1}, "mood": 1.0, "break": "pace"},
    {"key": "listless", "label": "listless",
     "note": "starts things and stops",
     "jobs": {"work": 0.5, "rest": 1.4, "watch": 1.3},
     "needs": {"energy": 0.9}, "mood": 1.0, "break": "withdraw"},
    {"key": "nervy", "label": "nervy",
     "note": "feels everything about twice as hard",
     "jobs": {"pace": 1.5, "watch": 1.2}, "needs": {}, "mood": 1.5,
     "break": "pace"},
    {"key": "stoic", "label": "stoic",
     "note": "takes what comes",
     "jobs": {"pace": 0.5}, "needs": {}, "mood": 0.6, "break": "withdraw"},
    {"key": "inquisitive", "label": "inquisitive",
     "note": "has to know what everything is",
     "jobs": {"examine": 1.8, "mark": 1.3}, "needs": {"curiosity": 1.25},
     "mood": 1.0, "break": "pace"},
    {"key": "incurious", "label": "incurious",
     "note": "a wall is a wall",
     "jobs": {"examine": 0.55}, "needs": {"curiosity": 0.8}, "mood": 1.0,
     "break": "withdraw"},
    {"key": "big appetite", "label": "big appetite",
     "note": "eats more and thinks about it more",
     "jobs": {"eat": 1.4}, "needs": {"hunger": 1.5}, "mood": 1.0,
     "break": "withdraw"},
    {"key": "ascetic", "label": "ascetic",
     "note": "does without, and doesn't much mind",
     "jobs": {"eat": 0.8, "rest": 0.7}, "needs": {"hunger": 0.7, "comfort": 0.5},
     "mood": 0.8, "break": "withdraw"},
    {"key": "night owl", "label": "night owl",
     "note": "awake when the lamp is out, and worse for it in the morning",
     "jobs": {}, "needs": {"energy": 0.9}, "mood": 1.0, "break": "pace",
     "nocturnal": True},
    {"key": "soft sleeper", "label": "soft sleeper",
     "note": "a bare cot is not a bed",
     "jobs": {"makebed": 1.8, "sleep": 1.2}, "needs": {"comfort": 1.6},
     "mood": 1.1, "break": "withdraw"},
    {"key": "restless", "label": "restless",
     "note": "cannot sit still for long",
     "jobs": {"rest": 0.6, "pace": 1.4, "examine": 1.2},
     "needs": {"curiosity": 1.3}, "mood": 1.0, "break": "pace"},
]

# Pairs that would cancel each other out rather than combine into a person.
CLASH = [("industrious", "listless"), ("nervy", "stoic"),
         ("inquisitive", "incurious"), ("big appetite", "ascetic"),
         ("listless", "restless"), ("ascetic", "soft sleeper")]


def roll(rng: random.Random, how_many: int = 2) -> list[dict]:
    picked: list[dict] = []
    pool = list(TRAITS)
    rng.shuffle(pool)
    for t in pool:
        if len(picked) >= how_many:
            break
        keys = {p["key"] for p in picked}
        if any((t["key"], k) in CLASH or (k, t["key"]) in CLASH for k in keys):
            continue
        picked.append(t)
    return picked


class Nature:
    """The rolled traits, flattened into the handful of numbers anything asks
    for. Every lookup is a plain multiply, so a trait can never make a subject
    do something no subject could do — only more or less of it."""

    def __init__(self, traits: list[dict]):
        self.traits = traits
        self.jobs: dict[str, float] = {}
        self.needs: dict[str, float] = {}
        self.mood = 1.0
        self.nocturnal = False
        for t in traits:
            for k, v in t["jobs"].items():
                self.jobs[k] = self.jobs.get(k, 1.0) * v
            for k, v in t["needs"].items():
                self.needs[k] = self.needs.get(k, 1.0) * v
            self.mood *= t["mood"]
            self.nocturnal = self.nocturnal or t.get("nocturnal", False)
        self.break_style = traits[0]["break"] if traits else "pace"

    def on(self, job_key: str) -> float:
        return self.jobs.get(job_key, 1.0)

    def labels(self) -> list[str]:
        return [t["label"] for t in self.traits]

    def snapshot(self) -> list[dict]:
        return [{"label": t["label"], "note": t["note"]} for t in self.traits]
