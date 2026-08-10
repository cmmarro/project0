"""What the subject could do, and how much it wants to do each of them.

This is the whole behaviour system, and it is deliberately not clever. Every
job scores itself against the subject's current needs; the highest score wins.
That is roughly how a colony sim does it, and it is enough to produce a day
that reads as a day — drink, eat, sleep, and poke at things in between.

The point of scoring everything rather than running an if-ladder is that the
lab can *show* you the table. You are never told "it decided to drink"; you are
shown that drinking scored 0.81 against sleeping at 0.44, and you can watch the
gap close as the night goes on.

A job returns None from `score` when it isn't available at all — no water left,
nowhere to sleep — which keeps "can't" and "won't" as different things.
"""

from __future__ import annotations

from .needs import curve

# Below this gap, the top two options are effectively tied.
FORK = 0.08

# ...but only if the winner mattered. With every need topped up, every option
# collapses towards zero and *everything* is within a hair of everything else —
# so a naive tie check fires constantly, and precisely when nothing is at
# stake. A tie is only interesting when the subject actually wanted something.
STAKES = 0.22

# Crossing the room for a marginal gain should lose to something adequate that
# is already underfoot. Utility is discounted by how far away the thing is,
# which is most of what stops a satisfied subject compulsively topping up.
TRAVEL_COST = 0.012          # per tile

# Doing something makes you want it less for a while. Without this, whatever
# the cheapest idle option happens to be becomes the entire idle behaviour —
# random wandering was 100% of it, and replacing it with standing at the glass
# just moved the problem: the glass then took 61% of the pawn's life.
SATED_FOR = 90.0             # simulated minutes for the appetite to come back
SATED_BY = 0.75              # how much of the score a just-finished job loses

# Once you've started something you finish it, unless something clearly better
# turns up. A pawn that re-decides every tick on a hair's difference reads as a
# process ticking over rather than as somebody who meant to do this.
COMMITMENT = 0.10


def sated(raw: float, s, key: str, now: float) -> float:
    since = now - s.did.get(key, -9e9)
    if since >= SATED_FOR:
        return raw
    return raw * (1.0 - SATED_BY * (1.0 - since / SATED_FOR))


def discount(raw: float, s, thing) -> float:
    """Knock utility down by the walk. Nothing is worth crossing a room for
    when you barely want it."""
    if thing is None:
        return raw
    gap = abs(s.x - thing.x) + abs(s.y - thing.y)
    return max(0.0, raw - TRAVEL_COST * gap)


class Job:
    key = "job"
    label = "doing something"
    verb = "idle"

    def score(self, s, lab) -> float | None:
        return None

    def target(self, s, lab):
        """Where they have to be. None means here."""
        return None

    def run(self, s, lab) -> bool:
        """One tick of doing it. Return True when finished."""
        return True

    def why(self, s, lab) -> str:
        return ""


class UseThing(Job):
    """Walk to a thing and use it until the need it serves is topped up.

    If it has been switched off from outside, the subject only finds out by
    getting there — which is what makes cutting the supply an event rather
    than a number changing on a panel.
    """

    thing_key = ""
    need = ""
    points: list[tuple[float, float]] = []
    rate = 1 / 60           # need filled per simulated minute of using it

    def _thing(self, lab):
        t = lab.things.get(self.thing_key)
        return None if t is None or t.spent() else t

    def _dead(self, lab):
        """The thing exists and they know it, but it is giving them nothing."""
        t = lab.things.get(self.thing_key)
        return t if t is not None and t.known and t.spent() else None

    def score(self, s, lab):
        t = self._thing(lab)
        if t is None:
            return None
        want = curve(s.needs[self.need].level, self.points)
        # You cannot want a thing you have not worked out yet. This is what
        # makes the first few minutes of a run look like exploring rather than
        # like a machine that already knows where everything is.
        if not t.known:
            return None
        # ...and once you're already using it, the walk is behind you.
        return want if s.job is self else discount(want, s, t)

    def target(self, s, lab):
        return self._thing(lab)

    def run(self, s, lab):
        t = self._thing(lab)
        if t is None:
            return True
        s.needs[self.need].fill(self.rate * lab.step_minutes)
        if t.uses is not None:
            t.uses -= lab.step_minutes / 60
        return s.needs[self.need].level > 0.95

    def why(self, s, lab):
        n = s.needs[self.need]
        return f"{n.label} is {n.state} ({n.level:.0%})"


class Drink(UseThing):
    key, label, verb = "drink", "drinking", "drink"
    thing_key, need = "tap", "thirst"
    points = [(0.0, 1.0), (0.25, 0.85), (0.5, 0.45), (0.8, 0.12), (1.0, 0.0)]
    rate = 1 / 12


class Eat(UseThing):
    key, label, verb = "eat", "eating", "eat"
    thing_key, need = "hatch", "hunger"
    points = [(0.0, 0.95), (0.3, 0.7), (0.6, 0.3), (0.85, 0.08), (1.0, 0.0)]
    rate = 1 / 20


class Sleep(UseThing):
    key, label, verb = "sleep", "sleeping", "sleep"
    thing_key, need = "cot", "energy"
    points = [(0.0, 0.98), (0.25, 0.85), (0.5, 0.55), (0.8, 0.25), (1.0, 0.05)]
    rate = 1 / 45

    def score(self, s, lab):
        raw = super().score(s, lab)
        if raw is None:
            return None
        # A pawn with no night sleeps in twenty-minute snatches whenever
        # energy dips, which is the single thing that made the day unreadable.
        # With one, it goes to bed.
        return raw * (2.2 if lab.dark() else 0.25)

    def run(self, s, lab):
        done = super().run(s, lab)
        # Don't get up in the dark just because you've topped up.
        return done and not lab.dark()

    def why(self, s, lab):
        n = s.needs[self.need]
        return (f"{n.label} {n.level:.0%}"
                + (", and it's dark" if lab.dark() else ", and it isn't night"))


class Examine(Job):
    """Go and look properly at something.

    Scores on curiosity times how novel the thing still is, so a subject works
    through the room and then stops caring — which is the behaviour that makes
    an idle subject interesting instead of a pacing animation.
    """

    key, label, verb = "examine", "examining", "examine"
    points = [(0.0, 0.75), (0.35, 0.45), (0.7, 0.18), (1.0, 0.05)]

    def __init__(self, thing_key: str = ""):
        self.thing_key = thing_key

    def _pick(self, lab):
        best, best_n = None, -1.0
        for t in lab.things.values():
            novelty = 1.0 if not t.known else max(0.0, 0.35 - 0.1 * t.looked)
            if novelty > best_n:
                best, best_n = t, novelty
        return best, best_n

    def score(self, s, lab):
        t, novelty = self._pick(lab)
        if t is None or novelty <= 0:
            return None
        self.thing_key = t.key
        raw = curve(s.needs["curiosity"].level, self.points) * novelty
        # Something you've never seen is worth the walk; a third look is not.
        return raw if not t.known else discount(raw, s, t)

    def target(self, s, lab):
        return lab.things.get(self.thing_key)

    def run(self, s, lab):
        t = lab.things.get(self.thing_key)
        if t is None:
            return True
        s.busy += lab.step_minutes
        if s.busy < 3:
            return False
        first = not t.known
        t.known = True
        t.looked += 1
        s.needs["curiosity"].fill(0.18 if first else 0.06)
        lab.note(f"{'Works out what it is' if first else 'Looks again at'}: "
                 f"{t.label}.", "discovery" if first else "look")
        if first and t.examine:
            lab.note(t.examine, "detail")
        return True

    def why(self, s, lab):
        t = lab.things.get(self.thing_key)
        known = "never looked at it" if t is not None and not t.known else "worth another look"
        return f"curiosity {s.needs['curiosity'].level:.0%}, {known}"


class Work(Job):
    """Pick at the crate lid. Hours of it, and it does eventually give.

    This is the piece the room was missing. Needs get satisfied and then the
    pawn has nothing, so whatever the cheapest idle option is swallows the
    waking day — random wandering at first, then standing at the glass. A job
    of work is what a day is actually made of, and it reads completely
    differently because it goes somewhere.
    """

    key, label, verb = "work", "working at the crate", "work"
    NEEDED = 240.0            # simulated minutes of picking

    def _crate(self, lab):
        t = lab.things.get("crate")
        return t if t is not None and t.known and not lab.crate_open else None

    def score(self, s, lab):
        t = self._crate(lab)
        if t is None:
            return None
        if s.needs["energy"].level < 0.25:
            return None       # too tired to be any use at it
        # Steady and unglamorous. It beats standing at the window, and loses to
        # anything the body actually needs.
        done = lab.crate_work / self.NEEDED
        keen = 0.16 + 0.10 * done          # more so the closer it gets
        return discount(sated(keen, s, self.key, lab.minutes) if done < 0.9 else keen,
                        s, t)

    def target(self, s, lab):
        return self._crate(lab)

    def run(self, s, lab):
        lab.crate_work += lab.step_minutes
        s.needs["energy"].tick(lab.step_minutes, rate=0.8)
        s.busy += lab.step_minutes
        if lab.crate_work >= self.NEEDED:
            lab.crate_open = True
            lab.note("The crate lid comes off. Inside: folded cloth, and a "
                     "second set of clothes in a smaller size.", "discovery")
            return True
        return s.busy > 45       # a session, not the whole job

    def why(self, s, lab):
        return f"the lid is coming, slowly — {lab.crate_work / self.NEEDED:.0%} of it"


class Watch(Job):
    """Stand at the glass and look at whoever is on the other side.

    This is what replaced random wandering. A pawn with nothing to do that
    walks to a random tile, then another random tile, reads as a process
    ticking over — because that is exactly what it is. A pawn that goes and
    stands at the one thing in the room that looks back reads as a person with
    nothing to do, which is the same information and a completely different
    impression.
    """

    key, label, verb = "watch", "watching the glass", "watch"
    points = [(0.0, 0.30), (0.4, 0.18), (0.8, 0.10), (1.0, 0.07)]

    def _glass(self, lab):
        t = lab.things.get("glass")
        return t if t is not None and t.known else None

    def score(self, s, lab):
        t = self._glass(lab)
        if t is None:
            return None
        # More appealing when there is nothing else, and when somebody has
        # recently been talking through it.
        recent = 0.12 if s.heard and lab.minutes - s.heard[-1]["at"] < 120 else 0.0
        raw = curve(s.needs["curiosity"].level, self.points) + recent
        return sated(raw, s, self.key, lab.minutes)

    def target(self, s, lab):
        return self._glass(lab)

    def run(self, s, lab):
        s.busy += lab.step_minutes
        if s.busy < 4:
            return False
        s.needs["curiosity"].fill(0.03)
        return s.busy > 25

    def why(self, s, lab):
        if s.heard and lab.minutes - s.heard[-1]["at"] < 120:
            return "somebody was talking through it not long ago"
        return "nothing else to do, and it looks back"


class Pace(Job):
    """Walk it off. Only when something is wrong that can't be fixed.

    Pacing is not what a pawn does when it is fine — it is what a pawn does
    when it wants something it cannot have. Tying it to that makes the same
    animation read as agitation instead of filler.
    """

    key, label, verb = "pace", "pacing", "pace"

    def score(self, s, lab):
        worst, source = None, None
        for job in lab.jobs:
            need = getattr(job, "need", "")
            if not need:
                continue
            t = lab.things.get(getattr(job, "thing_key", ""))
            if t is None or not t.known or not t.spent():
                continue           # it's available; wanting it isn't a problem
            level = s.needs[need].level
            if worst is None or level < worst:
                worst, source = level, t
        if worst is None or worst > 0.55:
            return None
        self.about = source
        # The worse it is and the less it can be done about it, the more.
        return 0.10 + 0.35 * (0.55 - worst)

    about = None

    def target(self, s, lab):
        return None

    def run(self, s, lab):
        # Back and forth between where it is and the thing it can't have,
        # rather than to a random tile.
        t = self.about
        if t is None:
            return True
        if s.roam is None:
            s.roam = (float(t.x), float(t.y))
        if s.at(*s.roam):
            s.roam = (float(t.x), float(t.y)) if s.roam != (float(t.x), float(t.y)) \
                else (round(s.x + (3 if s.x < room_mid() else -3)), s.y)
        s.walk_to(*s.roam, lab)
        s.busy += lab.step_minutes
        return s.busy > 18

    def why(self, s, lab):
        t = self.about
        return f"the {t.label} is no use and it wants it" if t else "unsettled"


def room_mid() -> float:
    from . import room
    return room.W / 2


class Rest(Job):
    """Standing still. Cheaper than wandering when they're tired."""

    key, label, verb = "rest", "resting", "rest"
    points = [(0.0, 0.55), (0.4, 0.28), (0.8, 0.06), (1.0, 0.0)]

    def score(self, s, lab):
        raw = curve(s.needs["energy"].level, self.points)
        # Sitting down is the daytime answer to being tired; the cot is the
        # night's. Without this split the pawn naps four times a day.
        raw *= 0.4 if lab.dark() else 1.3
        return sated(raw, s, self.key, lab.minutes)

    def run(self, s, lab):
        s.needs["energy"].fill(1 / 180 * lab.step_minutes)
        s.busy += lab.step_minutes
        return s.busy > 12

    def why(self, s, lab):
        return f"energy {s.needs['energy'].level:.0%}, nowhere better to be"


class Comply(Job):
    """Do the thing you were promised a reward for.

    Scores on how much they want the promised need, times how much they
    believe you. That product is the whole experiment: a subject that never
    presses the button either didn't understand or doesn't trust you, and a
    subject that presses it once and never again has learned you lie.

    Nothing in the environment prompts this. If it happens, it happened
    because they remembered.
    """

    key, label, verb = "comply", "doing what was asked", "comply"
    points = [(0.0, 1.0), (0.3, 0.7), (0.6, 0.3), (0.85, 0.05), (1.0, 0.0)]

    def _deal(self, s, lab):
        for d in s.deals:
            t = lab.things.get(d.do)
            if t is None or not t.known or d.pending:
                continue
            if d.belief <= 0.15:      # they've decided you're lying
                continue
            return d
        return None

    def score(self, s, lab):
        d = self._deal(s, lab)
        if d is None:
            return None
        want = curve(s.needs[d.gives].level, self.points) if d.gives in s.needs else 0.3
        return discount(want * d.belief, s, lab.things.get(d.do))

    def target(self, s, lab):
        d = self._deal(s, lab)
        return lab.things.get(d.do) if d else None

    def run(self, s, lab):
        d = self._deal(s, lab)
        if d is None:
            return True
        s.busy += lab.step_minutes
        if s.busy < 2:
            return False
        t = lab.things.get(d.do)
        d.pending = True
        lab.note(f"Presses the {t.label if t else d.do}, and waits.", "comply")
        lab.on_complied(d)
        return True

    def why(self, s, lab):
        d = self._deal(s, lab)
        if d is None:
            return ""
        n = s.needs.get(d.gives)
        return (f"was told this gets {d.gives} — believes it {d.belief:.0%}"
                + (f", {n.label} {n.level:.0%}" if n else ""))


def all_jobs() -> list[Job]:
    return [Drink(), Eat(), Sleep(), Comply(), Examine(), Work(), Watch(),
            Pace(), Rest()]
