"""The observation lab.

A subject wakes in a room with no memory of arriving. It has a body that keeps
itself alive without being asked, and — if you switch one on — a head.

The arrangement is deliberately the other way round from where this started.
The scoring layer used to decide everything and hand the model the occasional
tie. It now runs the *body*: pathing, reflexes below the collapse line, and any
habit the subject has formed. The head decides what the day is for. It can
ignore its needs, and it will be overruled by its own reflexes if it ignores
them too long — and told, afterwards, that it was.

What this is really for is a question with a hard answer available. Dwarf
Fortress produces surprising behaviour out of enumerated primitives and no
model at all. So the lab counts the only thing that could justify the latency:
how often the head does something the scoring layer would not have, and whether
that made any difference. `divergence` in the snapshot is that number. If it
sits near zero, the head is decoration, and you will be able to see that.
"""

from __future__ import annotations

import random
import threading
import time

from . import intent as brain
from . import jobs, room
from .deal import Deal
from .intent import Intent
from .subject import Subject

TICK = 0.25                 # real seconds between sim steps
MINUTES_PER_TICK = 1.0      # simulated minutes each step

THINK_GAP = 5.0             # never two thoughts closer than this, sim minutes
THINK_IDLE = 200.0          # ...and check in at least this often while awake


class Lab:
    def __init__(self, seed: int | None = None):
        self.lock = threading.RLock()
        self.seed = seed if seed is not None else random.randrange(1, 10 ** 6)
        self.rng = random.Random(self.seed)

        self.rows, self.things = room.build()
        self.subject = Subject(11, 7)
        self.jobs = jobs.all_jobs()
        self.verbs = {j.key: j for j in self.jobs + jobs.extra_jobs()}
        self.step_minutes = MINUTES_PER_TICK

        self.minutes = 0.0
        self.log: list[dict] = []
        self._n = 0
        self.decisions: list[dict] = []      # the scoring table, every time it changes

        # The head is off until you switch it on. Everything below works
        # without it, which is the baseline the experiment is against.
        self.mind = None
        self.auto_honour = True              # keep your word without being asked
        self.running = True
        self.crate_work = 0.0                # minutes spent on the lid
        self.crate_open = False

        # Who has been driving.
        self.tally = {"thought": 0, "habit": 0, "reflex": 0, "urge": 0}
        self.divergence = 0                  # thoughts the scorer disagreed with
        self.overruled = 0                   # thoughts a reflex had to undo
        self.last_thought = -9e9
        self._prod: str | None = None        # a reason to think, waiting to be used
        self._thinking: str | None = None    # ...and one currently in flight
        self._thought: dict | None = None    # a landed answer, not yet adopted
        self.thinking_since = 0.0
        self.plan: dict | None = None        # what it said it would do next

        self.note("The subject wakes on the floor. It does not know where it is, "
                  "and it does not appear to remember arriving.", "system")

    # -- bookkeeping ----------------------------------------------------------

    def job(self, verb: str):
        return self.verbs.get(verb)

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

    def prod(self, reason: str):
        """Something happened that is worth a thought. Nothing forces one —
        the head gets to it when it gets to it."""
        if self._prod is None:
            self._prod = reason

    def somewhere(self) -> tuple[float, float]:
        for _ in range(40):
            x = self.rng.randint(1, room.W - 2)
            y = self.rng.randint(1, room.H - 2)
            if room.walkable(self.rows, x, y):
                return float(x), float(y)
        return self.subject.x, self.subject.y

    def disappointed(self, verb: str):
        """A thing it went to did nothing. Habits that stop paying come apart."""
        brain.unlearn(self.subject, brain.circumstance(self.subject, self), verb)
        self.prod("something it counted on gave it nothing")

    def on_pressed(self, key: str):
        """It pressed something with no deal attached to it — which means it
        did that off its own bat, and is now watching to see what happens."""
        self.prod("it pressed something and is waiting to see")

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
        return True

    # -- talking through the glass --------------------------------------------

    def say_to(self, text: str) -> dict:
        """Say something through the glass, in your own words.

        Nothing here interprets it. It used to be classified into offer-or-
        remark before the subject ever saw it, which made "Hello?" a binding
        promise and turned every sentence into a form to be filled in. The
        words now go in verbatim and stay verbatim; working out what they meant
        is the head's problem, and if there is no head then a voice behind
        glass is a noise, which is the correct result.
        """
        text = (text or "").strip()[:200]
        if not text:
            return {"heard": False}
        self.note(f"You: “{text}”", "you")
        self.subject.heard.append({"at": self.minutes, "t": self.clock(),
                                   "text": text})
        del self.subject.heard[:-10]
        if self.mind is None:
            self.note("It looks at the glass. There is nothing in it that can "
                      "do anything with words.", "system")
            return {"heard": False, "why": "no mind"}
        self._prod = "somebody spoke to you through the glass"
        return {"heard": True}

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
        """Wire a conditional straight into the subject, skipping language.

        The blunt instrument. A subject with a head does not need this — you
        can just say it — but the belief machinery is worth being able to test
        with no model in the loop at all.
        """
        if self.things.get(do) is None or gives not in self.subject.needs:
            return None
        self.note(f"You: “{said}”", "you")
        deal = self._make_deal(do, gives, said)
        if deal is not None:
            self.subject.heard.append({"at": self.minutes, "t": self.clock(),
                                       "text": said})
            del self.subject.heard[:-10]
            self.subject.remember(f"Told: {said}")
            self.note("It holds that as a conditional it has not tested.", "system")
            self.prod("somebody made you an offer")
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
            self.subject.remember(f"{self.clock()} — pressed it, and the promise held.")
        else:
            d.broken()
            self.note("You do nothing.", "control")
            self.subject.remember(f"{self.clock()} — pressed it, and nothing came of it.")
        # Whatever it does next, it does knowing that.
        self.subject.take(None, self)
        self.prod("you either kept your word or you didn't")
        return True

    # -- what the body wants --------------------------------------------------

    def weigh(self) -> list[dict]:
        """Score every option. This is the body talking, and with no head
        attached it is also the decision."""
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

    def by_urge(self) -> Intent | None:
        """What the body would do left to itself. Unchanged from the version
        of this lab that had no head at all — it is the control condition and
        it is not allowed to get worse."""
        s = self.subject
        table = self.weigh()
        live = [r for r in table if r["score"] is not None]
        if not live:
            return None

        # Whatever it was already doing keeps a bonus, so it isn't abandoned on
        # a hair's difference.
        if s.job is not None:
            for r in live:
                if r["job"] is s.job:
                    r["score"] = round(r["score"] + jobs.COMMITMENT, 3)
                    live.sort(key=lambda r: -r["score"])
                    break

        top = live[0]
        gap = top["score"] - live[1]["score"] if len(live) > 1 else 1.0
        forked = (len(live) > 1 and gap < jobs.FORK
                  and top["score"] >= jobs.STAKES)
        if forked:
            # A tie breaks on a weighted coin rather than list order, so the
            # control condition is allowed to be indecisive too.
            tied = [r for r in live if top["score"] - r["score"] < jobs.FORK]
            top = self.rng.choices(tied, weights=[max(r["score"], 0.01)
                                                  for r in tied])[0]
        self._record(table, top["key"], gap, forked, "urge")
        return Intent(top["job"], why=top["why"], by="urge", started=self.minutes)

    def _record(self, table, chose, gap, forked, by):
        self.decisions.append({
            "t": self.clock(), "chose": chose, "gap": round(gap, 3),
            "forked": forked, "by": by,
            "options": [{k: r[k] for k in ("key", "label", "score", "why")}
                        for r in table],
        })
        del self.decisions[:-40]

    def would_have(self) -> str:
        """The verb the body would have picked. Only used to score the head."""
        live = [r for r in self.weigh() if r["score"] is not None]
        return live[0]["key"] if live else ""

    # -- the head -------------------------------------------------------------

    def brief(self) -> dict:
        """Everything the head gets. Assembled under the lock, read outside it."""
        s = self.subject
        known = [t for t in self.things.values() if t.known]
        return {
            "clock": self.clock(),
            "dark": self.dark(),
            "feels": s.feels(),
            "known": [f"{t.key} — {t.label}"
                      + (", and it is giving nothing at the moment" if t.spent() else "")
                      for t in known],
            "unknown": sum(1 for t in self.things.values() if not t.known),
            "learned": list(s.learned[-8:]),
            "story": list(s.story[-6:]),
            "heard": list(s.heard[-5:]),
            "said": [d["text"] for d in s.said[-3:]],
            "doing": s.intent.job.label if s.intent else "nothing",
            "pull": self.would_have(),
            "crate": (100 if self.crate_open
                      else int(self.crate_work / jobs.Work.NEEDED * 100)),
            "can": {k: v for k, v in jobs.OFFERED.items()
                    if self.verbs.get(k) is not None},
            "things": {t.key: t.label for t in known},
        }

    def wants_a_thought(self) -> str | None:
        s = self.subject
        if self.mind is None or self._thinking or self._thought is not None:
            return None
        if self.minutes - self.last_thought < THINK_GAP:
            return None
        if self._prod:
            return self._prod
        if s.intent is None:
            return "you have just finished something"
        # Don't wake it up to have a think.
        if s.intent.verb == "sleep":
            return None
        if self.minutes - self.last_thought > THINK_IDLE:
            return "it has been a while"
        return None

    def _launch(self, reason: str):
        """Set a thought going. It runs off the sim thread, because a head that
        takes four seconds must not stop a body that has a room to walk across
        — the whole arrangement falls over if thinking is a freeze frame."""
        self._prod = None
        self.thinking_since = self.minutes
        packet, mind = self.brief(), self.mind

        def work():
            try:
                return mind.act(packet, reason) or {"failed": True}
            except Exception:
                return {"failed": True}

        if getattr(mind, "sync", False):        # tests want a deterministic tick
            self._thought = work()
            return
        self._thinking = reason

        def run():
            out = work()
            with self.lock:
                self._thought = out
                self._thinking = None
        threading.Thread(target=run, daemon=True).start()

    def _land(self):
        """Take delivery of a thought. It may well be out of date by now —
        that is what a slow head costs, and the body carried on regardless."""
        out, self._thought = self._thought, None
        s = self.subject
        self.last_thought = self.minutes
        if out.get("failed"):
            self.note("The thought comes to nothing.", "system")
            if s.intent is None:
                self.take(self.by_urge())
            return
        # A reflex that seized control while the head was busy wins. The head
        # is told, and that line goes into its own account of the day.
        if s.intent is not None and s.intent.by == "reflex":
            self.overruled += 1
            s.remember(f"{self.clock()} — meant to {out['do']}, but the body "
                       "had other ideas.")
            self.note("The thought arrives too late; the body had already "
                      "moved.", "system")
            return
        self.adopt(out)

    def adopt(self, out: dict):
        s = self.subject
        job = self.verbs.get(out["do"])
        if job is None:
            self.take(self.by_urge())
            return
        if out["do"] != self.would_have():
            self.divergence += 1
        brain.learn(s, brain.circumstance(s, self), out["do"])
        self.plan = out.get("then") or None
        self.take(Intent(job, at=out.get("at", ""), why=out.get("because", ""),
                         by="thought", say=out.get("say", "")))
        if out.get("because"):
            self.note(out["because"], "mind")

    # -- deciding -------------------------------------------------------------

    def take(self, it: Intent | None):
        self.subject.take(it, self)
        if it is None or it.verb == "mull":
            return          # standing there while the head works isn't a decision
        self.tally[it.by] = self.tally.get(it.by, 0) + 1
        tail = {"reflex": "  [no decision was involved]",
                "habit": "  [it doesn't think about this any more]",
                "thought": "", "urge": ""}.get(it.by, "")
        self.note(f"Starts {it.job.label} — {it.why}{tail}",
                  "reflex" if it.by == "reflex" else "choice")

    def decide(self):
        """Nothing is being done. Work out what happens next, cheapest first."""
        s = self.subject
        # 1. Something it said it would do next, decided already.
        if self.plan and self.verbs.get(self.plan.get("do", "")):
            plan, self.plan = self.plan, None
            job = self.verbs[plan["do"]]
            if job.score(s, self) is not None or plan["do"] in ("press", "wait",
                                                                "examine"):
                self.take(Intent(job, at=plan.get("at", ""),
                                 why=plan.get("because", "") or "as it meant to",
                                 by="thought"))
                return
        # 2. Something it no longer thinks about.
        h = brain.habit(self)
        if h is not None:
            self.take(h)
            return
        # 3. Ask the head, and stand there while it answers.
        reason = self.wants_a_thought()
        if reason is not None:
            self._launch(reason)
            self.take(Intent(self.verbs["mull"], why=reason, by="thought",
                             started=self.minutes))
            return
        # 4. No head, or one that is busy. The body knows what it wants.
        if self.mind is None or not self._thinking:
            self.take(self.by_urge())

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

            # The body first, always. It does not wait for anybody.
            r = brain.reflex(self)
            if r is not None:
                self.take(r)
                self.prod("your body took over")

            if self._thought is not None:
                self._land()

            if s.intent is None:
                self.decide()
                return

            # A thought that has landed ends a mull immediately.
            if s.intent.verb == "mull" and not self._thinking and self._thought is None:
                self.take(None)
                self.decide()
                return

            job = s.intent.job
            target = job.target(s, self)
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
                        s.remember(f"{self.clock()} — could not get to the "
                                   f"{getattr(target, 'label', 'thing')}.")
                        self.take(None)
                        self.decide()
                else:
                    s.stuck = 0
                return
            s.stuck = 0
            if job.run(s, self):
                s.did[job.key] = self.minutes    # satiation
                self.take(None)
                self.decide()

    def snapshot(self) -> dict:
        with self.lock:
            table = self.weigh()
            s = self.subject
            return {
                "clock": self.clock(),
                "dark": self.dark(),
                "seed": self.seed,
                "rows": self.rows,
                "w": room.W, "h": room.H,
                "subject": s.snapshot(),
                "things": [t.snapshot() for t in self.things.values()],
                "table": [{k: r[k] for k in ("key", "label", "score", "why")}
                          for r in table],
                "decisions": self.decisions[-8:],
                "log": self.log[-60:],
                "habits": brain.habits_learned(s),
                "tally": dict(self.tally),
                "divergence": self.divergence,
                "overruled": self.overruled,
                "thinking": self._thinking,
                "plan": self.plan,
                "mind_on": self.mind is not None,
                "auto_honour": self.auto_honour,
                "crate": {"done": round(self.crate_work), "needed": 240,
                          "open": self.crate_open},
                "waiting": any(d.pending for d in s.deals),
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
