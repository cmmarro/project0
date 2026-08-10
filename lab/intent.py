"""One thread of intent, and the several things allowed to author it.

The subject is an agent wearing a body. Most of what a body does needs no
deciding: you don't choose which way to walk round a table, and you don't
choose to drink when you are an hour from collapse — that happens, and you
notice it afterwards. What is left over is the part worth a thought.

So there are two layers and they are not equals:

  the subconscious   pathing, reflexes, and habit. Never asks anybody. Fast,
                     free, and always available — including while the head is
                     busy or switched off entirely.

  the head           whatever is doing the deciding. It picks what to do next
                     and why. It is allowed to be wrong, and allowed to ignore
                     the body until the body stops asking.

They are unified by this file. There is exactly one current Intent, it always
knows who authored it, and both layers write into the same slot. That is what
makes this a person doing things rather than two systems fighting over a body:
the subject's own account of its day is one list, and "I went to the tap" reads
the same whether it was decided or merely happened.

The habit layer is the interesting one. Every time the head deliberately picks
something in a given circumstance, that pairing gets a tally. Past a few, it
stops being a decision and starts just happening — which is both how a person
works and, incidentally, how the head's running cost falls the longer a subject
lives in a room it understands.
"""

from __future__ import annotations

# The body takes over below these. Set low on purpose: this is collapse, not
# discomfort. Above the line, being thirsty is the head's problem, and the head
# is welcome to decide that something else matters more.
REFLEX = (
    ("thirst", 0.20, "drink"),
    ("hunger", 0.16, "eat"),
    ("energy", 0.10, "sleep"),
)

# Same choice, same circumstance, this many times, and it stops being a choice.
HABIT_AT = 3
# ...and it can come unstuck again if it starts going wrong.
HABIT_MAX = 8


class Intent:
    """What the subject is doing, and on whose authority.

    ``by`` is the whole point of this object existing:

      thought   the head decided it
      habit     it has decided this often enough not to bother
      reflex    the body did it and informed the head afterwards
      urge      the scoring layer, running the body with no head attached
    """

    __slots__ = ("job", "verb", "at", "why", "by", "say", "started", "told")

    def __init__(self, job, at: str = "", why: str = "", by: str = "urge",
                 say: str = "", started: float = 0.0):
        self.job = job
        self.verb = job.key
        self.at = at or ""          # a thing key, when the head named one
        self.why = why
        self.by = by
        self.say = say              # said out loud as the intent begins
        self.started = started
        self.told = False           # has the head been told this happened

    @property
    def deliberate(self) -> bool:
        return self.by == "thought"

    def snapshot(self) -> dict:
        return {"verb": self.verb, "label": self.job.label, "at": self.at,
                "why": self.why, "by": self.by, "say": self.say}


def circumstance(s, lab) -> str:
    """A coarse name for the situation, for habits to be indexed by.

    Coarse on purpose. If the key were precise the tally would never reach
    three and nothing would ever become automatic; if it were any looser the
    subject would form one habit and do it forever.
    """
    worst, level = None, 1.1
    for n in s.needs.values():
        if n.key != "curiosity" and n.level < level:
            worst, level = n.key, n.level
    if level < 0.5:
        return worst
    return "settled-dark" if lab.dark() else "settled"


def reflex(lab) -> Intent | None:
    """Has the body decided it is no longer taking suggestions?

    Note what this does *not* do: if the tap is dry, no reflex fires. The body
    can only seize control to do something it can actually carry out. A subject
    dying of thirst in a room with no water is a problem for the head, and it
    ought to be — that is the moment worth spending a thought on.
    """
    s = lab.subject
    for key, floor, verb in REFLEX:
        need = s.needs[key]
        if need.level > floor:
            continue
        job = lab.job(verb)
        if job is None or job.score(s, lab) is None:
            continue
        if s.intent is not None and s.intent.verb == verb:
            return None             # already doing it; no need to seize anything
        return Intent(job, why=f"{need.label} at {need.level:.0%} — no decision "
                                "was involved", by="reflex", started=lab.minutes)
    return None


def learn(s, key: str, verb: str):
    """The head chose this here before. Tally it."""
    bucket = s.habits.setdefault(key, {})
    bucket[verb] = min(HABIT_MAX, bucket.get(verb, 0) + 1)


def unlearn(s, key: str, verb: str):
    """It went badly. A habit that stops paying stops being a habit."""
    bucket = s.habits.get(key)
    if bucket and verb in bucket:
        bucket[verb] -= 2
        if bucket[verb] <= 0:
            del bucket[verb]


def habit(lab) -> Intent | None:
    """Something this subject no longer thinks about."""
    s = lab.subject
    key = circumstance(s, lab)
    bucket = s.habits.get(key) or {}
    best, count = None, 0
    for verb, n in bucket.items():
        if n < HABIT_AT or n <= count:
            continue
        job = lab.job(verb)
        if job is None or job.score(s, lab) is None:
            continue                # can't; so it is a decision again
        best, count = job, n
    if best is None:
        return None
    return Intent(best, why=f"{key} — it does this without thinking now",
                  by="habit", started=lab.minutes)


def habits_learned(s) -> list[dict]:
    out = []
    for key, bucket in s.habits.items():
        for verb, n in bucket.items():
            if n >= HABIT_AT:
                out.append({"when": key, "do": verb, "n": n})
    out.sort(key=lambda r: -r["n"])
    return out[:8]
