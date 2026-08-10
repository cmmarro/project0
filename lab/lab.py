"""The observation lab.

A subject wakes in a room with no memory of how it got there. It has needs, it
has a dozen things it can look at, and it decides what to do by scoring every
option against how it feels. All of that is ordinary code.

The experiment is the *one* place a language model is allowed in. Every tick
the subject scores its options; most of the time one option wins clearly and
there is nothing to think about. Occasionally two options come out level — the
programmatic layer genuinely has no answer — and that, and only that, is when
the mind gets asked.

So the lab measures the thing worth measuring: how often is the model actually
needed, what did it change, and could you tell.
"""

from __future__ import annotations

import random
import threading
import time

from . import jobs, room
from .deal import Deal
from .subject import Subject

TICK = 0.25                 # real seconds between sim steps
MINUTES_PER_TICK = 1.0      # simulated minutes each step


class Lab:
    def __init__(self, seed: int | None = None):
        self.lock = threading.RLock()
        self.seed = seed if seed is not None else random.randrange(1, 10 ** 6)
        self.rng = random.Random(self.seed)

        self.rows, self.things = room.build()
        self.subject = Subject(11, 7)
        self.jobs = jobs.all_jobs()
        self.step_minutes = MINUTES_PER_TICK

        self.minutes = 0.0
        self.log: list[dict] = []
        self._n = 0
        self.decisions: list[dict] = []      # the scoring table, every time it changes

        # The mind is off until you switch it on. Everything below works
        # without it, which is the baseline the experiment is against.
        self.mind = None
        self.auto_honour = True              # keep your word without being asked
        self.forks = 0                       # times the top two were level
        self.consulted = 0                   # times the mind was actually asked
        self.running = True
        self.crate_work = 0.0                # minutes spent on the lid
        self.crate_open = False

        self.note("The subject wakes on the floor. It does not know where it is, "
                  "and it does not appear to remember arriving.", "system")

    # -- bookkeeping ----------------------------------------------------------

    def dark(self) -> bool:
        """Lights out. The lamp is on a cycle you control, and it is the only
        thing in the room that organises a day."""
        lamp = self.things.get("lamp")
        if lamp is not None and not lamp.enabled:
            return True
        h = (self.minutes % (24 * 60)) / 60
        return h < 7 or h >= 22

    def clock(self) -> str:
        m = int(self.minutes)
        return f"{m // 60:02d}:{m % 60:02d}"

    def note(self, text: str, kind: str = "world"):
        self._n += 1
        self.log.append({"n": self._n, "t": self.clock(), "kind": kind, "text": text})
        del self.log[:-200]

    def somewhere(self) -> tuple[float, float]:
        for _ in range(40):
            x = self.rng.randint(1, room.W - 2)
            y = self.rng.randint(1, room.H - 2)
            if room.walkable(self.rows, x, y):
                return float(x), float(y)
        return self.subject.x, self.subject.y

    def set_supply(self, key: str, on: bool) -> bool:
        """Turn something on or off from your side of the glass.

        The subject is not told. It finds out by going over and trying, which
        is the whole point — a dilemma you created, discovered the hard way.
        """
        t = self.things.get(key)
        if t is None or not t.controllable:
            return False
        if t.enabled == on:
            return True
        t.enabled = on
        self.note(f"You {'restore' if on else 'cut'} the {t.label}.", "control")
        # Whatever it was doing was decided against a world that no longer
        # exists, so it gets to choose again.
        if not on and self.subject.job is not None:
            if getattr(self.subject.job, "thing_key", None) == key:
                self.subject.job = None
        return True

    # -- talking through the glass --------------------------------------------

    def say_to(self, text: str) -> dict:
        """Say something through the glass, in your own words.

        Whether that was an offer is the mind's to work out. Most things people
        say are not offers, and forcing every sentence through a pair of
        dropdowns turned "Hello?" into a binding promise, which is silly.
        """
        text = (text or "").strip()[:200]
        if not text:
            return {"heard": False}
        self.note(f"You: \u201c{text}\u201d", "you")
        if self.mind is None:
            self.note("It looks at the glass. Nothing it can do anything with.",
                      "system")
            return {"heard": False, "why": "no mind"}

        read = self.mind.hear(self, text)
        if read is None:
            self.note("It hears you and makes nothing of it.", "system")
            return {"heard": False, "why": "the mind had nothing"}

        if read["took_it_as"]:
            self.note(f"Takes it as: {read['took_it_as']}", "mind")
            self.subject.remember(read["took_it_as"])
        if read["kind"] != "offer":
            return {"heard": True, "offer": False}

        deal = self._make_deal(read["do"], read["gives"], text)
        if deal is None:
            return {"heard": True, "offer": False}
        self.note("It has taken that as an offer, and has not decided yet "
                  "whether to believe it.", "system")
        return {"heard": True, "offer": True}

    def _make_deal(self, do: str, gives: str, said: str) -> Deal | None:
        thing = self.things.get(do)
        if thing is None or gives not in self.subject.needs:
            return None
        # A second offer about the same thing replaces the first rather than
        # stacking, or you end up with four beliefs about one button.
        self.subject.deals = [d for d in self.subject.deals if d.do != do]
        deal = Deal(do, gives, said, self.clock())
        deal.belief = 0.45      # somebody it has no reason to trust, yet
        self.subject.deals.append(deal)
        del self.subject.deals[:-4]
        return deal

    def offer(self, do: str, gives: str, said: str) -> Deal | None:
        """Tell the subject that doing one thing gets it another.

        Reaching them at all requires the mind — an instruction is language,
        and language is exactly the thing the scoring layer has no way to
        represent. With the mind off, this is a noise from behind the glass
        and nothing more, which is itself the result.
        """
        """Set a deal directly, without the mind having to parse anything.

        The blunt instrument, for when there's no backend or you want to test
        the belief machinery without a model in the loop.
        """
        if self.things.get(do) is None or gives not in self.subject.needs:
            return None
        self.note(f"You: \u201c{said}\u201d", "you")
        if self.mind is None:
            self.note("It looks at the glass. Nothing about the room has "
                      "changed, so nothing about what it wants has either.", "system")
            return None
        deal = self._make_deal(do, gives, said)
        if deal is not None:
            self.subject.remember(f"The one behind the glass says: {said}")
            self.note("It has understood that as an offer, and has not decided "
                      "yet whether to believe it.", "system")
        return deal

    def on_complied(self, deal: Deal):
        """They did their half. Yours is a button on your side of the glass."""
        self.note("It has done what you asked. It is waiting to see whether "
                  "you meant it.", "system")
        if self.auto_honour:
            self.honour(True)

    def honour(self, keep: bool):
        d = next((d for d in self.subject.deals if d.pending), None)
        if d is None:
            return False
        thing = self.things.get(
            {"hunger": "hatch", "thirst": "tap", "energy": "cot"}.get(d.gives, ""))
        if keep:
            d.honoured()
            if thing is not None:
                thing.enabled = True
                if thing.uses is not None:
                    thing.uses = thing.cap
            self.note("You keep your word.", "control")
            self.subject.remember("It pressed the button and the promise held.")
        else:
            d.broken()
            self.note("You do nothing.", "control")
            self.subject.remember("It pressed the button and nothing came of it.")
        # Whatever it does next, it does knowing that.
        self.subject.job = None
        return True

    # -- deciding -------------------------------------------------------------

    def weigh(self) -> list[dict]:
        """Score every option. This is the whole mind, when the mind is off."""
        s = self.subject
        table = []
        for job in self.jobs:
            score = job.score(s, self)
            table.append({
                "key": job.key, "label": job.label,
                "score": None if score is None else round(score, 3),
                "why": job.why(s, self) if score is not None else "not available",
                "job": job,
            })
        table.sort(key=lambda r: (1, 0.0) if r["score"] is None else (0, -r["score"]))
        return table

    def choose(self):
        """Pick something to do, and record why — including who picked it."""
        s = self.subject
        table = self.weigh()
        live = [r for r in table if r["score"] is not None]
        if not live:
            return

        # Whatever it was already doing keeps a bonus, so it isn't abandoned on
        # a hair's difference. A pawn that re-decides constantly reads as a
        # process ticking over rather than as someone who meant to do this.
        if s.job is not None:
            for r in live:
                if r["job"] is s.job:
                    r["score"] = round(r["score"] + jobs.COMMITMENT, 3)
                    live.sort(key=lambda r: -r["score"])
                    break

        top = live[0]
        gap = top["score"] - live[1]["score"] if len(live) > 1 else 1.0
        # A tie only counts when the subject wanted something. Otherwise every
        # satisfied moment reads as a hard decision, which is the opposite of
        # true and would have the mind adjudicating what to do about nothing.
        forked = (len(live) > 1 and gap < jobs.FORK
                  and top["score"] >= jobs.STAKES)
        decided_by = "scores"

        if forked:
            self.forks += 1
            tied = [r for r in live if top["score"] - r["score"] < jobs.FORK]
            answered = False
            # The only place anything more expensive is allowed to matter.
            if self.mind is not None:
                self.consulted += 1
                picked = self.mind.break_tie(self, tied[:3])
                if picked is not None:
                    chosen = next((r for r in live if r["key"] == picked), None)
                    if chosen is not None:
                        top, decided_by, answered = chosen, "mind", True
            if not answered and len(tied) > 1:
                # With no mind — or a mind that had nothing to say — the tie
                # breaks on a weighted coin rather than list order. Otherwise
                # the same tie always resolves the same way, and switching the
                # mind on looks better purely because it varies. The control
                # condition has to be allowed to be indecisive too.
                weights = [max(r["score"], 0.01) for r in tied]
                top = self.rng.choices(tied, weights=weights)[0]
                decided_by = "coin"

        s.job = top["job"]
        s.busy = 0.0
        s.roam = None
        record = {
            "t": self.clock(),
            "chose": top["key"],
            "label": top["label"],
            "gap": round(gap, 3),
            "forked": forked,
            "by": decided_by,
            "options": [{k: r[k] for k in ("key", "label", "score", "why")}
                        for r in table],
        }
        self.decisions.append(record)
        del self.decisions[:-40]
        tail = {"mind": "  [the mind broke the tie]",
                "coin": "  [a tie, broken at random]"}.get(decided_by, "")
        self.note(f"Starts {top['label']} — {top['why']}{tail}", "choice")

    # -- the loop -------------------------------------------------------------

    def step(self):
        with self.lock:
            if not self.running or not self.subject.alive:
                return
            s = self.subject
            self.minutes += self.step_minutes
            for t in self.things.values():
                t.tick(self.step_minutes)
            s.tick_needs(self)
            if not s.alive:
                self.note("The subject stops moving.", "danger")
                return

            if s.job is None:
                self.choose()
                return

            target = s.job.target(s, self)
            if target is not None and not s.near(target):
                where = (round(s.x, 2), round(s.y, 2))
                s.walk_to(target.x, target.y, self)
                # Whatever the geometry does, a subject that cannot get where
                # it is going gives up rather than standing there until it
                # dies. This is a guarantee, not a fix for one wall.
                if (round(s.x, 2), round(s.y, 2)) == where:
                    s.stuck += 1
                    if s.stuck > 12:
                        self.note(f"Cannot get to the {getattr(target, 'label', '?')}. "
                                  "Gives up on it.", "system")
                        s.stuck = 0
                        s.job = None
                        self.choose()
                else:
                    s.stuck = 0
                return
            s.stuck = 0
            if s.job.run(s, self):
                s.did[s.job.key] = self.minutes    # satiation
                s.job = None
                self.choose()

    def snapshot(self) -> dict:
        with self.lock:
            table = self.weigh()
            return {
                "clock": self.clock(),
                "dark": self.dark(),
                "seed": self.seed,
                "rows": self.rows,
                "w": room.W, "h": room.H,
                "subject": self.subject.snapshot(),
                "things": [t.snapshot() for t in self.things.values()],
                "table": [{k: r[k] for k in ("key", "label", "score", "why")}
                          for r in table],
                "decisions": self.decisions[-8:],
                "log": self.log[-60:],
                "fork_threshold": jobs.FORK,
                "stakes": jobs.STAKES,
                "forks": self.forks,
                "consulted": self.consulted,
                "mind_on": self.mind is not None,
                "auto_honour": self.auto_honour,
                "crate": {"done": round(self.crate_work), "needed": 240,
                          "open": self.crate_open},
                "waiting": any(d.pending for d in self.subject.deals),
                "running": self.running,
            }


def start(lab: Lab):
    def loop():
        while True:
            time.sleep(TICK)
            try:
                lab.step()
            except Exception as exc:      # never let the lab die silently
                lab.note(f"sim error: {type(exc).__name__}: {exc}", "danger")
    threading.Thread(target=loop, daemon=True).start()
