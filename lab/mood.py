"""How it feels about all this, as distinct from what it wants.

Needs are what a body is short of. Mood is what a person makes of their
situation, and it is the difference between a creature that eats when hungry
and one you can be sorry for.

The model is the colony-sim one and it is worth being precise about why it
works. Mood is not a number the sim computes from the world; it is a *stack of
specific reasons*, each with a size and a lifetime. That matters twice over:

  - It is legible. "Mood 0.31" tells you nothing. "Slept on a bare cot −0.08,
    nothing to do −0.10, still in this room −0.14" tells you what to change.
  - It has memory and inertia. A good night still counts at noon; being lied
    to still stings tomorrow. A mood computed fresh from current world state
    every tick can't do either, and reads as a gauge rather than a person.

Thoughts hold at full strength for the first half of their life and then fade,
which is roughly how a grievance behaves and keeps the arithmetic honest.
"""

from __future__ import annotations

BASE = 0.55           # what it feels with nothing in particular going on


class Thought:
    """One specific reason, with a size and a lifetime."""

    __slots__ = ("key", "label", "delta", "life", "born", "held")

    def __init__(self, key, label, delta, life, born, held=False):
        self.key = key
        self.label = label
        self.delta = delta
        self.life = life          # simulated minutes
        self.born = born
        self.held = held          # true while a condition keeps renewing it

    def weight(self, now: float) -> float:
        if self.held:
            return self.delta
        age = now - self.born
        if age >= self.life:
            return 0.0
        # Full strength for the first half, then fading. A grievance doesn't
        # taper from the moment it happens.
        half = self.life / 2
        return self.delta if age <= half else self.delta * (1 - (age - half) / half)

    def snapshot(self, now: float) -> dict:
        return {"label": self.label, "delta": round(self.weight(now), 3),
                "held": self.held}


class Mood:
    def __init__(self):
        self.thoughts: dict[str, Thought] = {}
        self.broke_at = -9e9      # when it last came apart

    def add(self, key: str, label: str, delta: float, life: float, now: float):
        """Something happened. A second one of the same thing replaces the
        first rather than stacking — otherwise one bad night five times over
        is worse than five bad nights, which is backwards."""
        self.thoughts[key] = Thought(key, label, delta, life, now)

    def hold(self, key: str, label: str, delta: float, now: float):
        """Something is *currently* true. Renewed every tick it stays true,
        and starts fading the moment it stops."""
        t = self.thoughts.get(key)
        if t is not None and t.held:
            t.label, t.delta, t.born = label, delta, now
            return
        self.thoughts[key] = Thought(key, label, delta, 240.0, now, held=True)

    def release(self, key: str, now: float):
        """It stopped being true. Let it fade rather than vanish."""
        t = self.thoughts.get(key)
        if t is not None and t.held:
            t.held = False
            t.born = now

    def tick(self, now: float):
        for key in [k for k, t in self.thoughts.items()
                    if not t.held and now - t.born >= t.life]:
            del self.thoughts[key]

    def level(self, now: float, sensitivity: float = 1.0) -> float:
        total = sum(t.weight(now) for t in self.thoughts.values())
        return max(0.0, min(1.0, BASE + total * sensitivity))

    def state(self, now: float, sensitivity: float = 1.0) -> str:
        v = self.level(now, sensitivity)
        if v > 0.65:
            return "content"
        if v > 0.42:
            return "flat"
        if v > 0.20:
            return "strained"
        return "at the end of it"

    def snapshot(self, now: float, sensitivity: float = 1.0) -> dict:
        rows = [t.snapshot(now) for t in self.thoughts.values()]
        rows = [r for r in rows if abs(r["delta"]) >= 0.005]
        rows.sort(key=lambda r: r["delta"])
        return {"level": round(self.level(now, sensitivity), 3),
                "state": self.state(now, sensitivity), "thoughts": rows}
