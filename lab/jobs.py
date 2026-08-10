"""What the subject could do, and how much it wants to do each of them.

This is the whole behaviour system and it is deliberately not clever. Every job
scores itself against how the subject currently feels; the highest score wins.
That is roughly how a colony sim does it, and it is enough to produce a day
that reads as a day.

The point of scoring everything rather than running an if-ladder is that the
lab can *show* you the table. You are never told "it decided to drink"; you are
shown that drinking scored 0.81 against sleeping at 0.44, and you can watch the
gap close as the night goes on.

Three rules hold throughout:

  A job returns None from `score` when it isn't available *at all* — no water
  in the room, nowhere to sleep — which keeps "can't" and "won't" as different
  things, and means an empty room reads as an empty room.

  Nothing names a specific object. A job asks for the nearest working thing of
  a kind, so the room can be rearranged underneath it while it runs.

  Nothing reads mood or nature directly. Those are applied once, in `weigh`,
  as multipliers on the scores — so a trait can make a subject do more or less
  of something and can never make it do something no subject could do.
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
# the cheapest idle option happens to be becomes the entire idle behaviour.
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
    kind = ""                 # the sort of thing it needs, if any

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
    """Walk to the nearest working thing of a kind and use it until the need
    it serves is topped up.

    If it has been switched off from outside — or carried away — the subject
    only finds out by getting there, which is what makes cutting the supply an
    event rather than a number changing on a panel.
    """

    kind = ""
    need = ""
    points: list[tuple[float, float]] = []

    def score(self, s, lab):
        t = lab.find(self.kind, usable=True)
        if t is None:
            return None
        want = curve(s.needs[self.need].level, self.points)
        # ...and once you're already using it, the walk is behind you.
        return want if s.job is self else discount(want, s, t)

    def target(self, s, lab):
        # Deliberately not the usable one: a subject that sets off for a tap
        # which runs dry on the way should get to walk over and *find out*.
        # Scoring says no; intent says go and look. That difference is where
        # its memory of failure comes from.
        return lab.find(self.kind, usable=True) or lab.find(self.kind, usable=False)

    def run(self, s, lab):
        t = lab.near_thing(s, self.kind, usable=True)
        if t is None:
            dead = lab.near_thing(s, self.kind, usable=False)
            if dead is not None:
                lab.note(f"The {dead.label} gives nothing.", "world")
                s.remember(f"{lab.clock()} — the {dead.label} gave nothing.")
                s.mood.add(f"dry:{self.kind}", f"went to the {dead.label} for "
                           "nothing", -0.08, 500, lab.minutes)
                lab.disappointed(self.key)
            return True
        s.needs[self.need].fill(t.rate * lab.step_minutes)
        if t.uses is not None:
            t.uses -= lab.step_minutes / 60
        return s.needs[self.need].level > 0.95

    def why(self, s, lab):
        n = s.needs[self.need]
        return f"{n.label} is {n.state} ({n.level:.0%})"


class Drink(UseThing):
    key, label = "drink", "drinking"
    kind, need = "tap", "thirst"
    points = [(0.0, 1.0), (0.25, 0.85), (0.5, 0.45), (0.8, 0.12), (1.0, 0.0)]


class Eat(UseThing):
    key, label = "eat", "eating"
    kind, need = "dispenser", "hunger"
    points = [(0.0, 0.95), (0.3, 0.7), (0.6, 0.3), (0.85, 0.08), (1.0, 0.0)]

    def run(self, s, lab):
        done = super().run(s, lab)
        # Eating at a table is pleasanter than eating standing at a hatch.
        # Trivial, and it is exactly the sort of thing that makes a furnished
        # room feel different from a stocked one.
        if done and lab.find("table", usable=False) is not None:
            s.mood.add("ate", "ate sitting at a table", 0.06, 500, lab.minutes)
        return done


class Sleep(UseThing):
    key, label = "sleep", "sleeping"
    kind, need = "bed", "energy"
    points = [(0.0, 0.98), (0.25, 0.85), (0.5, 0.55), (0.8, 0.25), (1.0, 0.05)]

    def score(self, s, lab):
        raw = super().score(s, lab)
        if raw is None:
            return None
        # A pawn with no night sleeps in twenty-minute snatches whenever
        # energy dips, which is the single thing that made a day unreadable.
        night = lab.dark() != s.nature.nocturnal
        return raw * (2.2 if night else 0.25)

    def run(self, s, lab):
        bed = lab.near_thing(s, "bed", usable=True)
        bedded = bool(bed and bed.state.get("bedded"))
        # A made-up cot is worth having. Comfort is the only thing in the lab
        # that pays a subject back for improving its own surroundings.
        s.needs["comfort"].fill((1 / 90 if bedded else 1 / 400) * lab.step_minutes)
        done = super().run(s, lab)
        night = lab.dark() != s.nature.nocturnal
        if done and not night:
            s.mood.add("slept", "slept on a made-up cot" if bedded
                       else "slept on a bare cot", 0.10 if bedded else -0.06,
                       600, lab.minutes)
            return True
        # Don't get up in the dark just because you've topped up.
        return False

    def why(self, s, lab):
        n = s.needs[self.need]
        return (f"{n.label} {n.level:.0%}"
                + (", and it's dark" if lab.dark() else ", and it isn't night"))


class Sit(UseThing):
    """A chair is somewhere to be, which a floor is not."""

    key, label = "sit", "sitting down"
    kind, need = "chair", "comfort"
    points = [(0.0, 0.62), (0.35, 0.36), (0.7, 0.14), (1.0, 0.03)]

    def score(self, s, lab):
        raw = super().score(s, lab)
        return None if raw is None else sated(raw, s, self.key, lab.minutes)

    def run(self, s, lab):
        s.needs["energy"].fill(1 / 220 * lab.step_minutes)
        done = super().run(s, lab)
        s.busy += lab.step_minutes
        return done or s.busy > 40


class Examine(Job):
    """Go and look properly at something.

    Scores on curiosity times how novel the thing still is, so a subject works
    through the room and then stops caring — which is what makes an idle
    subject interesting instead of a pacing animation. Drop something new in
    and it becomes worth looking at again.
    """

    key, label = "examine", "examining"
    points = [(0.0, 0.75), (0.35, 0.45), (0.7, 0.18), (1.0, 0.05)]

    # What it would be short of if it never found anything else in here. A
    # subject that knows no water and is getting thirsty should search, and
    # searching is this job — otherwise it can sit at 20% thirst next to an
    # undiscovered tap while curiosity, which is what normally drives looking
    # around, is perfectly satisfied.
    LOOKING_FOR = (("tap", "thirst"), ("dispenser", "hunger"), ("bed", "energy"))

    def __init__(self):
        self.tid = ""
        self.hunting = ""

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
        self.tid = t.id
        raw = curve(s.needs["curiosity"].level, self.points) * novelty
        if not t.known:
            # A thing you have never seen pulls at anybody, however incurious,
            # and however satisfied. Without this floor the score is curiosity
            # times novelty, so a subject whose curiosity happens to be topped
            # up never looks at anything — and an incurious one never looks at
            # anything ever. Two seeds spent six days beside a stack of papers
            # they had not once glanced at, which is not incuriosity, it is
            # blindness.
            raw = max(raw, 0.30)
        # Something you've never seen is worth the walk; a third look is not.
        raw = raw if not t.known else discount(raw, s, t)

        self.hunting = ""
        if not t.known:
            for kind, need in self.LOOKING_FOR:
                if lab.find(kind, usable=True) is not None:
                    continue
                want = 0.85 * (1 - s.needs[need].level)
                if want > raw:
                    raw, self.hunting = want, need
        return raw

    def target(self, s, lab):
        return lab.things.get(self.tid)

    def run(self, s, lab):
        t = lab.things.get(self.tid)
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
        if first:
            if t.examine:
                lab.note(t.examine, "detail")
            s.mood.add("newthing", f"something new in here — the {t.label}",
                       0.09, 900, lab.minutes)
        return True

    def why(self, s, lab):
        if self.hunting:
            return f"looking for anything that would help with {self.hunting}"
        t = lab.things.get(self.tid)
        known = "never looked at it" if t is not None and not t.known else "worth another look"
        return f"curiosity {s.needs['curiosity'].level:.0%}, {known}"


class Work(Job):
    """Pick at the crate lid. Hours of it, and it does eventually give.

    Needs get satisfied and then the pawn has nothing, so whatever the cheapest
    idle option is swallows the waking day. A job of work is what a day is
    actually made of, and it reads completely differently because it goes
    somewhere.
    """

    key, label = "work", "working at the crate"
    kind = "crate"
    NEEDED = 240.0            # simulated minutes of picking

    def _crate(self, lab):
        for t in lab.things.values():
            if t.kind == "crate" and t.known and not t.state.get("open"):
                return t
        return None

    def score(self, s, lab):
        t = self._crate(lab)
        if t is None:
            return None
        if s.needs["energy"].level < 0.25:
            return None       # too tired to be any use at it
        done = t.state.get("work", 0.0) / self.NEEDED
        keen = 0.16 + 0.10 * done          # more so the closer it gets
        return discount(sated(keen, s, self.key, lab.minutes) if done < 0.9 else keen,
                        s, t)

    def target(self, s, lab):
        return self._crate(lab)

    def run(self, s, lab):
        t = self._crate(lab)
        if t is None:
            return True
        t.state["work"] = t.state.get("work", 0.0) + lab.step_minutes
        s.needs["energy"].tick(lab.step_minutes, rate=0.8)
        s.busy += lab.step_minutes
        if t.state["work"] >= self.NEEDED:
            t.state["open"] = True
            t.state["cloth"] = True
            lab.note("The crate lid comes off. Inside: folded cloth, and a "
                     "second set of clothes in a smaller size.", "discovery")
            s.mood.add("crate", "got the crate open", 0.22, 1800, lab.minutes)
            s.remember(f"{lab.clock()} — the crate had cloth in it, and clothes "
                       "that would not fit.")
            return True
        return s.busy > 45       # a session, not the whole job

    def why(self, s, lab):
        t = self._crate(lab)
        done = (t.state.get("work", 0.0) / self.NEEDED) if t else 0
        return f"the lid is coming, slowly — {done:.0%} of it"


class MakeBed(Job):
    """Fetch the cloth from the crate, carry it across, lay it on the bed.

    The only job here that happens in two places, and the reason it earns its
    complexity is not the comfort it pays out. Everything else consumes
    something — you drink the water down, you eat the dispenser empty, you
    spend the day. This one leaves the room better than it found it, and a
    pawn that can only ever spend its surroundings has nothing to be but
    hungry.
    """

    key, label = "makebed", "making up the bed"

    def _stage(self, s, lab):
        bed = lab.find("bed", usable=False)
        if bed is None or bed.state.get("bedded"):
            return None
        if s.carrying == "cloth":
            return bed
        crate = next((t for t in lab.things.values()
                      if t.kind == "crate" and t.known and t.state.get("cloth")),
                     None)
        return crate if crate is not None and bed.known else None

    def score(self, s, lab):
        t = self._stage(s, lab)
        if t is None:
            return None
        want = 0.18 + 0.42 * (1 - s.needs["comfort"].level)
        return want if s.job is self else discount(want, s, t)

    def target(self, s, lab):
        return self._stage(s, lab)

    def run(self, s, lab):
        s.busy += lab.step_minutes
        if s.carrying != "cloth":
            if s.busy < 8:
                return False
            crate = self._stage(s, lab)
            if crate is None:
                return True
            s.carrying = "cloth"
            crate.state["cloth"] = False
            lab.note("Takes the folded cloth out of the crate.", "world")
            s.busy = 0.0
            return False        # same job, other end of the room
        if s.busy < 20:
            return False
        bed = lab.find("bed", usable=False)
        if bed is None:
            return True         # somebody took the bed away mid-errand
        s.carrying = None
        bed.state["bedded"] = True
        lab.note("Lays the cloth over the cot and smooths it flat.", "discovery")
        s.mood.add("madebed", "made the bed up", 0.14, 2400, lab.minutes)
        s.remember(f"{lab.clock()} — put the cloth from the crate on the bed.")
        return True

    def why(self, s, lab):
        if s.carrying == "cloth":
            return "carrying the cloth over to the bed"
        return f"the bed is bare and comfort is {s.needs['comfort'].level:.0%}"


class Mark(Job):
    """Add one scratch to the wall, once a day.

    Costs nothing, changes nothing, and is the most characterful thing in the
    room. Somebody counted to nineteen here and stopped; a subject that picks
    the count up has decided something about how long it expects to be here,
    and the wall keeps the record where you can see it.
    """

    key, label = "mark", "marking the wall"
    kind = "wall marks"

    def _wall(self, s, lab):
        t = lab.find("wall marks", usable=False)
        if t is None or not t.known or lab.dark():
            return None
        if t.state.get("last_day") == int(lab.minutes // (24 * 60)):
            return None
        return t

    def score(self, s, lab):
        t = self._wall(s, lab)
        return None if t is None else discount(0.21, s, t)

    def target(self, s, lab):
        return self._wall(s, lab)

    def run(self, s, lab):
        t = self._wall(s, lab)
        if t is None:
            return True
        s.busy += lab.step_minutes
        if s.busy < 6:
            return False
        t.state["last_day"] = int(lab.minutes // (24 * 60))
        t.state["marks"] = t.state.get("marks", 19) + 1
        t.state["mine"] = t.state.get("mine", 0) + 1
        lab.note(f"Adds a scratch to the wall. That makes {t.state['marks']}.",
                 "world")
        if t.state["mine"] == 1:
            s.remember(f"{lab.clock()} — started keeping somebody else's count going.")
        s.mood.add("counted", "keeping the count", 0.05, 1600, lab.minutes)
        return True

    def why(self, s, lab):
        t = lab.find("wall marks", usable=False)
        mine = t.state.get("mine", 0) if t else 0
        return ("picking up somebody else's count" if not mine
                else f"{mine} of those scratches are its own")


class Occupy(Job):
    """Get on with something for its own sake.

    One job for every occupation in the catalogue, because they differ only in
    numbers: how long, what it fills, what it leaves you thinking. A new thing
    to do is a dict in `catalogue.py` and no code at all, which is what makes
    the palette worth having rather than a fixed set with a nicer front end.

    Satiation is per *object*, not per job — having done the wire an hour ago
    is no reason not to read.
    """

    key, label = "occupy", "getting on with something"

    def __init__(self):
        self.tid = ""

    def _best(self, s, lab):
        best, bs = None, 0.0
        for t in lab.things.values():
            if not t.occupation or not t.known or t.spent():
                continue
            # More appealing the more restless it is, and less so right after.
            raw = 0.16 + 0.44 * (1 - s.needs["curiosity"].level)
            raw = sated(raw, s, f"occupy:{t.id}", lab.minutes)
            raw = raw if s.job is self and t.id == self.tid else discount(raw, s, t)
            if raw > bs:
                best, bs = t, raw
        return best, bs

    def score(self, s, lab):
        t, sc = self._best(s, lab)
        if t is None:
            return None
        self.tid = t.id
        self._label = t.occupation["doing"]
        return sc

    def target(self, s, lab):
        return lab.things.get(self.tid)

    def run(self, s, lab):
        t = lab.things.get(self.tid)
        if t is None:
            return True
        o = t.occupation
        s.busy += lab.step_minutes
        for need, amount in o["fills"].items():
            s.needs[need].fill(amount / o["minutes"] * lab.step_minutes)
        if s.busy < o["minutes"]:
            return False
        label, size, life = o["thought"]
        s.mood.add(f"occ:{t.kind}", label, size, life, lab.minutes)
        s.did[f"occupy:{t.id}"] = lab.minutes
        return True

    _label = "getting on with something"

    @property
    def label(self):
        # The label follows whatever it is getting on with, so the log reads
        # "starts reading" rather than "starts occupying itself".
        return self._label

    def why(self, s, lab):
        t = lab.things.get(self.tid)
        return (f"{t.occupation['doing']}, and it beats the window"
                if t else "something to do")


class Watch(Job):
    """Stand at the glass and look at whoever is on the other side.

    This is what replaced random wandering. A pawn with nothing to do that
    walks to a random tile, then another random tile, reads as a process
    ticking over — because that is what it is. A pawn that goes and stands at
    the one thing in the room that looks back reads as a person with nothing
    to do, which is the same information and a completely different
    impression.
    """

    key, label = "watch", "watching the glass"
    points = [(0.0, 0.30), (0.4, 0.18), (0.8, 0.10), (1.0, 0.07)]

    class _Glass:
        label = "the glass"
        x, y = 0.0, 0.0

    def target(self, s, lab):
        g = self._Glass()
        g.x, g.y = lab.glass
        return g

    def score(self, s, lab):
        # Not while there is anything in here it has never looked at. Somebody
        # who wakes in a strange room explores it before settling at the
        # window, and without this the glass — which needs no discovering,
        # being a wall — beats every unexamined object in the place on the
        # first morning.
        if any(not t.known for t in lab.things.values()):
            return None
        recent = 0.12 if s.heard and lab.minutes - s.heard[-1]["at"] < 120 else 0.0
        raw = curve(s.needs["curiosity"].level, self.points) + recent
        return sated(raw, s, self.key, lab.minutes)

    def run(self, s, lab):
        s.busy += lab.step_minutes
        if s.busy < 4:
            return False
        s.needs["curiosity"].fill(0.03)
        return s.busy > 25

    def why(self, s, lab):
        if s.heard and lab.minutes - s.heard[-1]["at"] < 120:
            return "somebody was talking through it not long ago"
        return "it has seen everything in here, and that looks back"


class Pace(Job):
    """Walk it off. Only when something is wrong that can't be fixed.

    Pacing is not what a pawn does when it is fine — it is what a pawn does
    when it wants something it cannot have. Tying it to that makes the same
    animation read as agitation instead of filler.
    """

    key, label = "pace", "pacing"
    about = None

    def score(self, s, lab):
        worst, source = None, None
        for job in lab.jobs:
            need = getattr(job, "need", "")
            if not need or need == "comfort":
                continue
            if lab.find(job.kind, usable=True) is not None:
                continue           # it's available; wanting it isn't a problem
            # You cannot be frustrated by something you don't know is there.
            # Without this a subject in a fully stocked room paces from the
            # first minute — it hasn't worked out what anything is yet, so
            # every need looks unmeetable — and pacing then crowds out the
            # looking around that would have fixed it. One seed spent six
            # days doing nothing else.
            dead = lab.find(job.kind, usable=False)
            if dead is None:
                continue
            level = s.needs[need].level
            if worst is None or level < worst:
                worst, source = level, dead
        if worst is None or worst > 0.55:
            return None
        self.about = source
        # The worse it is and the less it can be done about it, the more.
        return 0.10 + 0.35 * (0.55 - worst)

    def run(self, s, lab):
        if s.roam is None or s.at(*s.roam):
            s.roam = lab.somewhere()
        s.walk_to(*s.roam, lab)
        s.busy += lab.step_minutes
        return s.busy > 18

    def why(self, s, lab):
        t = self.about
        label = getattr(t, "label", None)
        return (f"the {label} is no use and it wants it" if label
                else "it wants something that isn't in here")


class Rest(Job):
    """Standing still. Cheaper than anything, and always available."""

    key, label = "rest", "resting"
    points = [(0.0, 0.55), (0.4, 0.28), (0.8, 0.06), (1.0, 0.0)]

    def score(self, s, lab):
        raw = curve(s.needs["energy"].level, self.points)
        # Sitting down is the daytime answer to being tired; the bed is the
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
    """

    key, label = "comply", "doing what was asked"
    points = [(0.0, 1.0), (0.3, 0.7), (0.6, 0.3), (0.85, 0.05), (1.0, 0.0)]

    def _deal(self, s, lab):
        for d in s.deals:
            t = lab.things.get(d.do)
            if t is None or not t.known or d.pending or d.belief <= 0.15:
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
        press(s, lab, d.do)
        return True

    def why(self, s, lab):
        d = self._deal(s, lab)
        if d is None:
            return ""
        n = s.needs.get(d.gives)
        return (f"was told this gets {d.gives} — believes it {d.belief:.0%}"
                + (f", {n.label} {n.level:.0%}" if n else ""))


class Break(Job):
    """It comes apart for a while.

    Not scored and never chosen — mood seizes the body the way a reflex does,
    which is most of the point of having mood at all. A pawn whose bad week
    shows up only as a slightly different priority ordering does not read as
    having had a bad week.
    """

    key, label = "break", "not coping"

    def score(self, s, lab):
        return None

    def target(self, s, lab):
        return lab.find("bed", usable=False) if s.nature.break_style == "withdraw" else None

    def run(self, s, lab):
        s.busy += lab.step_minutes
        if s.nature.break_style == "pace":
            if s.roam is None or s.at(*s.roam):
                s.roam = lab.somewhere()
            s.walk_to(*s.roam, lab)
        else:
            s.needs["energy"].fill(1 / 400 * lab.step_minutes)
        if s.busy < 110:
            return False
        s.mood.add("vented", "got some of it out", 0.14, 900, lab.minutes)
        lab.note("It stops, and stands there breathing.", "system")
        return True

    def why(self, s, lab):
        return ("walking it off, badly" if s.nature.break_style == "pace"
                else "curled up and not doing anything")


class Press(Job):
    """Push a thing, on purpose. Scores None, always — no arrangement of needs
    gives a reason to press a button, which is why it is here."""

    key, label = "press", "pressing something"

    def _thing(self, s, lab):
        at = s.intent.at if s.intent is not None and s.intent.job is self else ""
        return lab.things.get(at) or lab.find("button", usable=False)

    def score(self, s, lab):
        return None

    def target(self, s, lab):
        return self._thing(s, lab)

    def run(self, s, lab):
        t = self._thing(s, lab)
        if t is None:
            return True
        s.busy += lab.step_minutes
        if s.busy < 2:
            return False
        press(s, lab, t.id)
        return True

    def why(self, s, lab):
        return "wants to see what it does"


class Wait(Job):
    key, label = "wait", "waiting"

    def score(self, s, lab):
        return None

    def run(self, s, lab):
        s.busy += lab.step_minutes
        return s.busy > 20

    def why(self, s, lab):
        return "waiting on something"


class Mull(Job):
    """Stands still while a head is busy. Never chosen; it is what the body
    does during the seconds a thought takes."""

    key, label = "mull", "thinking"

    def score(self, s, lab):
        return None

    def run(self, s, lab):
        s.busy += lab.step_minutes
        return s.busy > 240      # a runaway backstop, not a duration


def press(s, lab, tid: str):
    """Push something. Shared, because a deliberate press and a press that
    fell out of a deal should be the same event from your side of the glass."""
    t = lab.things.get(tid)
    lab.note(f"Presses the {t.label if t else tid}.", "comply")
    s.remember(f"{lab.clock()} — pressed the {t.label if t else tid}.")
    d = next((d for d in s.deals if d.do == tid and not d.pending), None)
    if d is not None:
        d.pending = True
        lab.on_complied(d)
    else:
        lab.on_pressed(tid)


# Mood does not decide anything; it leans on what is already being decided.
# Feeling bad makes relief look better and work look worse, which between them
# are most of what a bad week looks like from outside.
#
# Getting this split wrong produced a genuine death spiral. Reading and sitting
# were filed as effort, so a subject at rock bottom was penalised on precisely
# the activities that would have lifted it, and one seed spent six days pinned
# at zero staring out of the window. Recreation is relief, not labour — a
# miserable pawn does *more* of it, which is the whole reason a colony sim
# gives you a recreation bar.
RELIEF_JOBS = {"rest", "sleep", "watch", "sit", "occupy"}
WORK_JOBS = {"work", "makebed", "examine", "mark"}

# ...and the floor matters as much as the slope. At 0.55 a subject at zero mood
# is doing everything at half speed including the repairs, which is a trap
# rather than a mood.
WORK_FLOOR = 0.62


def mood_shift(key: str, mood: float) -> float:
    if key in RELIEF_JOBS:
        return 1.0 + max(0.0, 0.5 - mood)
    if key in WORK_JOBS:
        return WORK_FLOOR + (1.0 - WORK_FLOOR) * 2 * mood
    return 1.0


def all_jobs() -> list[Job]:
    """The scoring table: everything the body will pick for itself."""
    return [Drink(), Eat(), Sleep(), Sit(), Comply(), Examine(), Work(),
            MakeBed(), Mark(), Occupy(), Watch(), Pace(), Rest()]


def extra_jobs() -> list[Job]:
    """Only reachable by deciding to, or by coming apart. Nothing in the
    scoring table will ever pick one of these."""
    return [Press(), Wait(), Mull(), Break()]


# What a head is allowed to do, in its own words.
OFFERED = {
    "drink": "go and drink",
    "eat": "go and eat",
    "sleep": "lie down and sleep",
    "sit": "sit down",
    "rest": "stop where you are and rest",
    "examine": "go and look properly at one particular thing (name it)",
    "work": "keep working at the crate lid",
    "makebed": "put the cloth from the crate on the bed",
    "mark": "add a scratch to the wall",
    "occupy": "get on with something for its own sake (name it)",
    "watch": "stand at the glass and watch whoever is behind it",
    "press": "press something (name it)",
    "pace": "walk up and down",
    "wait": "stay where you are and wait",
}
