"""What the subject wants, and how badly.

Needs are plain numbers that fall over time. Nothing here knows about language
models, jobs, or the room — a need is just a level, a rate, and a name, and
everything else in the lab reads them.

Kept deliberately small. Four needs is enough to produce a day that looks like
a day; more would just be more dials to explain.
"""

from __future__ import annotations


def clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, v))


def curve(x: float, points: list[tuple[float, float]]) -> float:
    """Piecewise-linear lookup, the way a needs-driven sim usually does it.

    Reading a job's priority off a curve rather than an if-statement is what
    makes the behaviour tunable without becoming a nest of thresholds — and it
    means the lab can *show* you the number instead of asserting a decision.
    """
    if not points:
        return 0.0
    if x <= points[0][0]:
        return points[0][1]
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        if x <= x1:
            span = (x1 - x0) or 1e-9
            return y0 + (y1 - y0) * ((x - x0) / span)
    return points[-1][1]


class Need:
    """One drive. 1.0 is satisfied, 0.0 is desperate."""

    __slots__ = ("key", "label", "level", "fall", "note")

    def __init__(self, key: str, label: str, fall: float, level: float = 0.8,
                 note: str = ""):
        self.key = key
        self.label = label
        self.level = level
        self.fall = fall            # per simulated minute
        self.note = note

    def tick(self, minutes: float, rate: float = 1.0):
        self.level = clamp(self.level - self.fall * minutes * rate)

    def fill(self, amount: float):
        self.level = clamp(self.level + amount)

    @property
    def state(self) -> str:
        if self.level > 0.65:
            return "fine"
        if self.level > 0.35:
            return "wanting"
        if self.level > 0.12:
            return "bad"
        return "critical"

    def snapshot(self) -> dict:
        return {"key": self.key, "label": self.label,
                "level": round(self.level, 3), "state": self.state,
                "note": self.note}


def starting_needs(nature=None) -> dict[str, Need]:
    """A fresh subject. Thirst is the fast clock; comfort is the slow one.

    The rates are per simulated minute, and the lab runs at one minute a
    second by default, so thirst empties in about eight minutes of watching if
    nothing is done about it.

    A subject's nature scales the rates rather than adding needs, so every
    subject has the same four dials and no two run them at the same speed.
    """
    out = {n.key: n for n in [
        Need("thirst", "thirst", 1 / 480, 0.75,
             "falls fastest — the thing that will kill them first"),
        Need("hunger", "hunger", 1 / 900, 0.70,
             "slower, but harder to ignore once it bites"),
        Need("energy", "energy", 1 / 1100, 0.85,
             "spent by walking and working, refilled by sleeping"),
        # Not a survival need. This is the one that makes a subject with all
        # its needs met do something other than stand still, which is where
        # any interesting behaviour has to come from.
        Need("curiosity", "curiosity", 1 / 600, 0.55,
             "what makes a satisfied subject get up and look at something"),
        # Nor is this one. Comfort kills nobody; it feeds mood, which is where
        # a bare cot turns into a reason to do something about the bare cot.
        Need("comfort", "comfort", 1 / 700, 0.45,
             "nothing depends on it except how it feels about being here"),
    ]}
    for key, mult in (getattr(nature, "needs", None) or {}).items():
        if key in out:
            out[key].fall *= mult
    return out
