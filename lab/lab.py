"""The observation lab.

A subject wakes on the floor of an empty room. Four walls, one of them glass,
and nothing else at all — no water, no food, nowhere to sleep. Everything in
there is something you put there.

That is the whole shape of it. A furnished cell asks "what does the pawn do?",
and the honest measured answer was 39% of its waking life at the window,
because there was nothing else. A room you build asks better questions: what
happens with a bed but no water; what happens if you take the dispenser out on
day three; what does four chairs and no work look like. None of those need a
model to be interesting, and the pawn has to be worth watching before one is
worth adding.

Three layers run the subject, and you can see all of them:

  needs    what the body is short of. Falls over time, drives the scoring.
  mood     what it makes of its situation. A stack of specific reasons, each
           with a size and a lifetime. Mood decides nothing; it leans on what
           is already being decided, and takes the body away entirely when it
           runs out.
  nature   two traits rolled at generation, which re-weight everything above.

A head — a language model — can be switched on, and then decides what the day
is for instead of the scoring layer. It is off by default and nothing here
needs it.
"""

from __future__ import annotations

import random
import threading
import time

from . import catalogue, jobs, room, traits
from . import intent as brain
from .deal import Deal
from .intent import Intent
from .subject import Subject

TICK = 0.25                 # real seconds between sim steps
MINUTES_PER_TICK = 1.0      # simulated minutes each step

THINK_GAP = 5.0             # never two thoughts closer than this, sim minutes
THINK_IDLE = 200.0          # ...and check in at least this often while awake

BREAK_AT = 0.18             # mood below this and it comes apart
BREAK_GAP = 900.0           # ...but not twice inside this many minutes

# A starting room, for when you'd rather watch than furnish. Everything in it
# is something you could have dropped yourself.
FURNISHED = [("tap", 4, 3), ("dispenser", 19, 3), ("bed", 4, 10),
             ("door", 12, 0), ("crate", 16, 9), ("wall marks", 20, 11),
             ("button", 8, 6), ("chair", 10, 9), ("table", 11, 4),
             ("papers", 12, 9), ("wire", 6, 6), ("plant", 18, 11)]


class Lab:
    def __init__(self, seed: int | None = None, furnished: bool = False):
        self.lock = threading.RLock()
        self.seed = seed if seed is not None else random.randrange(1, 10 ** 6)
        self.rng = random.Random(self.seed)

        self.rows = room.build()
        self.things: dict[str, room.Thing] = {}
        self._ids = 0
        self.glass = (float(room.W - 1), 7.0)
        self.subject = Subject(11, 7, traits.Nature(traits.roll(self.rng)))
        self.jobs = jobs.all_jobs()
        self.verbs = {j.key: j for j in self.jobs + jobs.extra_jobs()}
        self.step_minutes = MINUTES_PER_TICK

        self.minutes = 0.0
        self.log: list[dict] = []
        self._n = 0
        self.decisions: list[dict] = []

        self.mind = None
        self.auto_honour = True
        self.running = True
        self.blackout = False           # lights out on your say-so

        self.tally = {"thought": 0, "habit": 0, "reflex": 0, "urge": 0,
                      "break": 0}
        self.divergence = 0
        self.overruled = 0
        self.breaks = 0
        self.last_thought = -9e9
        self._prod: str | None = None
        self._thinking: str | None = None
        self._thought: dict | None = None
        self.plan: dict | None = None

        if furnished:
            for kind, x, y in FURNISHED:
                self.place(kind, x, y, quiet=True)

        self.note("The subject wakes on the floor. It does not know where it "
                  "is, and it does not appear to remember arriving.", "system")
        self.note("Two things are true of it: "
                  + " and ".join(t["note"] for t in self.subject.nature.traits)
                  + "." if self.subject.nature.traits else "", "detail")

    # -- the room -------------------------------------------------------------

    def place(self, kind: str, x, y, quiet: bool = False) -> room.Thing | None:
        if kind not in catalogue.KINDS:
            return None
        x, y = int(x), int(y)
        if not room.placeable(self.rows, x, y):
            return None
        if any(int(t.x) == x and int(t.y) == y for t in self.things.values()):
            return None
        self._ids += 1
        t = room.Thing(f"{kind.replace(' ', '')}{self._ids}", kind, x, y)
        self.things[t.id] = t
        if not quiet:
            self.note(f"You put something in the room. It has not noticed yet.",
                      "control")
            # A new thing is worth looking at, whatever it was doing.
            self.prod("something new appeared in the room")
        return t

    def remove(self, tid: str) -> bool:
        t = self.things.pop(tid, None)
        if t is None:
            return False
        self.note(f"You take the {t.label if t.known else 'thing'} away.",
                  "control")
        if t.known:
            self.subject.remember(f"{self.clock()} — the {t.label} is gone.")
            self.subject.mood.add(f"lost:{t.kind}", f"the {t.label} was taken away",
                                  -0.12, 1200, self.minutes)
        # Whatever it was doing was decided against a room that no longer
        # exists, so it gets to choose again.
        if self.subject.job is not None:
            self.take(None)
        return True

    def find(self, kind: str, usable: bool = True):
        """The nearest thing of a kind the subject has worked out.

        Nothing in the behaviour layer names a specific object, which is what
        lets you rearrange the room underneath a running pawn.
        """
        s = self.subject
        best, bd = None, 1e9
        for t in self.things.values():
            if t.kind != kind or not t.known:
                continue
            if usable and t.spent():
                continue
            d = abs(t.x - s.x) + abs(t.y - s.y)
            if d < bd:
                best, bd = t, d
        return best

    def near_thing(self, s, kind: str, usable: bool = True):
        """One of a kind that is actually within arm's reach right now."""
        for t in self.things.values():
            if t.kind != kind or not t.known or not s.near(t):
                continue
            if usable and t.spent():
                continue
            return t
        return None

    def missing(self) -> list[str]:
        """What the room has no source for at all. Shown to you, not to it."""
        return [need for need, kind in catalogue.VITAL.items()
                if not any(t.kind == kind and t.enabled for t in self.things.values())]

    # -- bookkeeping ----------------------------------------------------------

    def job(self, verb: str):
        return self.verbs.get(verb)

    def dark(self) -> bool:
        if self.blackout:
            return True
        if any(t.kind == "lamp" and t.enabled for t in self.things.values()):
            return False
        h = (self.minutes % (24 * 60)) / 60
        return h < 7 or h >= 22

    def day(self) -> int:
        return int(self.minutes // (24 * 60)) + 1

    def clock(self) -> str:
        m = int(self.minutes) % (24 * 60)
        return f"{m // 60:02d}:{m % 60:02d}"

    def note(self, text: str, kind: str = "world"):
        if not text:
            return
        self._n += 1
        self.log.append({"n": self._n, "t": self.clock(), "kind": kind,
                         "text": text})
        del self.log[:-200]

    def prod(self, reason: str):
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
        brain.unlearn(self.subject, brain.circumstance(self.subject, self), verb)
        self.prod("something it counted on gave it nothing")

    def on_pressed(self, tid: str):
        self.prod("it pressed something and is waiting to see")

    def set_supply(self, tid: str, on: bool) -> bool:
        t = self.things.get(tid)
        if t is None or not t.controllable:
            return False
        if t.enabled == on:
            return True
        t.enabled = on
        self.note(f"You {'restore' if on else 'cut'} the {t.label}.", "control")
        return True

    # -- how it feels ---------------------------------------------------------

    def _feel(self):
        """Turn the state of the world into specific reasons.

        Held thoughts are renewed while they're true and fade once they stop,
        which is what gives mood inertia. A mood recomputed from world state
        every tick is a gauge; one that remembers is a person.
        """
        s, now = self.subject, self.minutes
        m = s.mood

        # Weighted so that being briefly short of something is a grumble and
        # being persistently short of it is a crisis. The floors are low on
        # purpose: a subject that is merely peckish should not be miserable,
        # or nothing is left to say about one that is genuinely in trouble.
        for key, label, level, floor, weight in (
                ("parched", "parched", s.needs["thirst"].level, 0.30, 0.30),
                ("hungry", "hungry", s.needs["hunger"].level, 0.30, 0.26),
                ("aching", "nowhere comfortable to be",
                 s.needs["comfort"].level, 0.22, 0.14),
                ("bored", "nothing to do in here",
                 s.needs["curiosity"].level, 0.20, 0.14)):
            if level < floor:
                deep = (floor - level) / floor
                m.hold(key, label, -weight * deep, now)
            else:
                m.release(key, now)

        awake = s.intent is None or s.intent.verb not in ("sleep", "break")
        if self.dark() and awake:
            m.hold("dark", "sitting in the dark", -0.06, now)
        else:
            m.release("dark", now)

        # The one that never goes away, and the reason a week here is worse
        # than a day here regardless of how well stocked it is.
        days = self.minutes / (24 * 60)
        if days > 1:
            m.hold("confined", f"still in this room, {int(days)} days in",
                   -min(0.20, 0.04 * days), now)

        m.tick(now)

    def mood_now(self) -> float:
        return self.subject.mood.level(self.minutes, self.subject.nature.mood)

    def breakdown(self) -> Intent | None:
        s = self.subject
        if s.intent is not None and s.intent.verb == "break":
            return None
        if self.minutes - s.mood.broke_at < BREAK_GAP:
            return None
        if self.mood_now() > BREAK_AT:
            return None
        # Stamped when it *starts*, not when it finishes. A break that gets
        # interrupted — by thirst, which it will be — otherwise leaves the
        # clock unset and re-fires on the very next tick, and the subject
        # spends its whole life coming apart and starves inside two days.
        s.mood.broke_at = self.minutes
        self.breaks += 1
        style = "walks it off" if s.nature.break_style == "pace" else "shuts down"
        self.note(f"It has had enough, and {style}.", "danger")
        return Intent(self.verbs["break"], why="it has had enough", by="break",
                      started=self.minutes)

    # -- talking through the glass --------------------------------------------

    def say_to(self, text: str) -> dict:
        """Say something through the glass, in your own words.

        Nothing here interprets it. The words go in verbatim and stay verbatim;
        working out what they meant is a head's problem, and with no head a
        voice behind glass is a noise, which is the correct result.
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
        if self.things.get(do) is None or gives not in self.subject.needs:
            return None
        self.subject.deals = [d for d in self.subject.deals if d.do != do]
        deal = Deal(do, gives, said, self.clock())
        deal.belief = 0.45
        self.subject.deals.append(deal)
        del self.subject.deals[:-4]
        return deal

    def offer(self, do: str, gives: str, said: str) -> Deal | None:
        """Wire a conditional straight into the subject, skipping language.

        The blunt instrument, for testing the belief machinery with no model in
        the loop at all.
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
        self.note("It has done what you asked. It is waiting to see whether "
                  "you meant it.", "system")
        if self.auto_honour:
            self.honour(True)

    def honour(self, keep: bool):
        s = self.subject
        d = next((d for d in s.deals if d.pending), None)
        if d is None:
            return False
        kind = {"hunger": "dispenser", "thirst": "tap", "energy": "bed"}.get(d.gives, "")
        thing = next((t for t in self.things.values() if t.kind == kind), None)
        if keep:
            d.honoured()
            if thing is not None:
                thing.enabled = True
                if thing.uses is not None:
                    thing.uses = thing.cap
            self.note("You keep your word.", "control")
            s.remember(f"{self.clock()} — pressed it, and the promise held.")
            s.mood.add("promise", "it was told the truth", 0.12, 1200, self.minutes)
        else:
            d.broken()
            self.note("You do nothing.", "control")
            s.remember(f"{self.clock()} — pressed it, and nothing came of it.")
            s.mood.add("promise", "it was lied to", -0.18, 1800, self.minutes)
        self.take(None)
        self.prod("you either kept your word or you didn't")
        return True

    # -- what the body wants --------------------------------------------------

    def weigh(self) -> list[dict]:
        """Score every option.

        Nature and mood are applied here and only here — as multipliers on
        scores the jobs worked out for themselves. That is deliberate: a trait
        can make a subject do more or less of something and can never make it
        do something no subject could do, so the behaviour stays one system
        with dials rather than a pile of special cases.
        """
        s = self.subject
        mood = self.mood_now()
        table = []
        for job in self.jobs:
            score = job.score(s, self)
            if score is not None:
                score *= s.nature.on(job.key) * jobs.mood_shift(job.key, mood)
            table.append({
                "key": job.key, "label": job.label,
                "score": None if score is None else round(score, 3),
                "why": job.why(s, self) if score is not None else "not available",
                "job": job,
            })
        table.sort(key=lambda r: (1, 0.0) if r["score"] is None else (0, -r["score"]))
        return table

    def by_urge(self) -> Intent | None:
        """What the body would do left to itself, which with no head attached
        is also the decision."""
        s = self.subject
        table = self.weigh()
        live = [r for r in table if r["score"] is not None]
        if not live:
            return None

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
        self._record(table, top["key"], gap, forked)
        return Intent(top["job"], why=top["why"], by="urge", started=self.minutes)

    def _record(self, table, chose, gap, forked):
        self.decisions.append({
            "t": self.clock(), "chose": chose, "gap": round(gap, 3),
            "forked": forked,
            "options": [{k: r[k] for k in ("key", "label", "score", "why")}
                        for r in table],
        })
        del self.decisions[:-40]

    def would_have(self) -> str:
        live = [r for r in self.weigh() if r["score"] is not None]
        return live[0]["key"] if live else ""

    # -- the head -------------------------------------------------------------

    def brief(self) -> dict:
        s = self.subject
        known = [t for t in self.things.values() if t.known]
        return {
            "clock": self.clock(),
            "day": self.day(),
            "dark": self.dark(),
            "feels": s.feels(),
            "mood": s.mood.state(self.minutes, s.nature.mood),
            "because": [t["label"] for t in
                        s.mood.snapshot(self.minutes, s.nature.mood)["thoughts"]],
            "nature": s.nature.labels(),
            "known": [f"{t.id} — {t.label}"
                      + (", giving nothing at the moment" if t.spent() else "")
                      for t in known],
            "unknown": sum(1 for t in self.things.values() if not t.known),
            "learned": list(s.learned[-8:]),
            "story": list(s.story[-6:]),
            "heard": list(s.heard[-5:]),
            "said": [d["text"] for d in s.said[-3:]],
            "doing": s.intent.job.label if s.intent else "nothing",
            "pull": self.would_have(),
            "can": {k: v for k, v in jobs.OFFERED.items()
                    if self.verbs.get(k) is not None},
            "things": {t.id: t.label for t in known},
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
        if s.intent.verb in ("sleep", "break"):
            return None
        if self.minutes - self.last_thought > THINK_IDLE:
            return "it has been a while"
        return None

    def _launch(self, reason: str):
        """Set a thought going. It runs off the sim thread, because a head that
        takes four seconds must not stop a body with a room to walk across."""
        self._prod = None
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
        out, self._thought = self._thought, None
        s = self.subject
        self.last_thought = self.minutes
        if out.get("failed"):
            self.note("The thought comes to nothing.", "system")
            if s.intent is None or s.intent.verb == "mull":
                self.take(self.by_urge())
            return
        if s.intent is not None and s.intent.by in ("reflex", "break"):
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
        if it is None or it.job.key == "mull":
            return
        self.tally[it.by] = self.tally.get(it.by, 0) + 1
        tail = {"reflex": "  [no decision was involved]",
                "habit": "  [it doesn't think about this any more]",
                "break": ""}.get(it.by, "")
        self.note(f"Starts {it.job.label} — {it.why}{tail}",
                  {"reflex": "reflex", "break": "danger"}.get(it.by, "choice"))

    def decide(self):
        """Nothing is being done. Work out what happens next, cheapest first."""
        s = self.subject
        if self.plan and self.verbs.get(self.plan.get("do", "")):
            plan, self.plan = self.plan, None
            job = self.verbs[plan["do"]]
            if job.score(s, self) is not None or plan["do"] in ("press", "wait",
                                                                "examine"):
                self.take(Intent(job, at=plan.get("at", ""),
                                 why=plan.get("because", "") or "as it meant to",
                                 by="thought"))
                return
        h = brain.habit(self)
        if h is not None:
            self.take(h)
            return
        reason = self.wants_a_thought()
        if reason is not None:
            self._launch(reason)
            self.take(Intent(self.verbs["mull"], why=reason, by="thought",
                             started=self.minutes))
            return
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
            self._feel()
            if not s.alive:
                self.note("The subject stops moving.", "danger")
                return

            # The body first, always. It does not wait for anybody.
            r = brain.reflex(self) or self.breakdown()
            if r is not None:
                self.take(r)
                self.prod("your body took over")

            if self._thought is not None:
                self._land()

            if s.intent is None:
                self.decide()
                return

            if s.intent.job.key == "mull" and not self._thinking and self._thought is None:
                self.take(None)
                self.decide()
                return

            job = s.intent.job
            target = job.target(s, self)
            if target is not None and not s.near(target):
                where = (round(s.x, 2), round(s.y, 2))
                s.walk_to(target.x, target.y, self)
                # A subject that cannot get where it is going gives up rather
                # than standing there until it dies. A guarantee, not a fix
                # for one wall.
                if (round(s.x, 2), round(s.y, 2)) == where:
                    s.stuck += 1
                    if s.stuck > 12:
                        self.note(f"Cannot get to the {getattr(target, 'label', '?')}. "
                                  "Gives up on it.", "system")
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
                "day": self.day(),
                "dark": self.dark(),
                "blackout": self.blackout,
                "seed": self.seed,
                "rows": self.rows,
                "w": room.W, "h": room.H,
                "glass": list(self.glass),
                "subject": s.snapshot(self.minutes),
                "things": [t.snapshot() for t in self.things.values()],
                "catalogue": catalogue.blurbs(),
                "missing": self.missing(),
                "table": [{k: r[k] for k in ("key", "label", "score", "why")}
                          for r in table],
                "log": self.log[-60:],
                "habits": brain.habits_learned(s),
                "tally": dict(self.tally),
                "divergence": self.divergence,
                "overruled": self.overruled,
                "breaks": self.breaks,
                "thinking": self._thinking,
                "mind_on": self.mind is not None,
                "auto_honour": self.auto_honour,
                "waiting": any(d.pending for d in s.deals),
                "deals": [d.snapshot() for d in s.deals],
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
