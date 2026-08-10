"""Proof that the lab's body stands up without a head, and that the head — when
there is one — is doing something the body could not have done.

Two claims are being tested, and the second one is the one that matters:

  1. With nothing switched on at all, the subject is a complete creature. It
     survives, it works the room out, it sleeps at night. If it stops doing
     that, no amount of model on top will save it.

  2. A head earns its latency only where the body has no representation for
     the input — words through the glass, and the subject's own account of
     itself. So the tests below check that the head can reach verbs the
     scoring layer will never pick, and that when it does the divergence
     counter says so.

    python test_lab.py
"""

from __future__ import annotations

from lab import intent as brain
from lab import jobs
from lab.intent import Intent
from lab.lab import Lab

FAILS: list[str] = []


def check(label: str, ok: bool, detail: str = ""):
    print(f"  {'PASS' if ok else 'FAIL'}  {label}{'  — ' + detail if detail else ''}")
    if not ok:
        FAILS.append(label)


def fast(lab, steps=1500, until=None):
    lab.step_minutes = 2.0
    for _ in range(steps):
        lab.step()
        if until and until(lab):
            return True
        if not lab.subject.alive:
            return False
    return False


class Head:
    """A head that answers instantly and says exactly what you told it to.

    ``sync`` makes the lab run it inline instead of on a thread, so a test is
    a sequence rather than a race.
    """

    online = True
    sync = True

    def __init__(self, *script):
        self.script = list(script)
        self.asked = 0
        self.briefs = []

    def act(self, packet, reason):
        self.asked += 1
        self.briefs.append((packet, reason))
        if not self.script:
            return None
        out = self.script.pop(0)
        return None if out is None else dict(out)


def plan(do, at="", because="because", say="", then=None):
    # Shaped exactly as Mind.act hands it over, so the lab can't tell them apart.
    return {"do": do, "at": at, "because": because, "say": say,
            "then": {"do": then} if then else None}


def main():
    print("\nThe lab — body first, then whether the head is worth anything\n")

    print("1. With nothing switched on, it is already a creature")
    for seed in (4, 11, 23):
        lab = Lab(seed=seed)
        fast(lab)
        s = lab.subject
        known = sum(1 for t in lab.things.values() if t.known)
        check(f"seed {seed}: alive after {int(lab.minutes // 60)}h, "
              f"worked out {known}/{len(lab.things)} things",
              s.alive and known == len(lab.things),
              " ".join(f"{n.key} {n.level:.0%}" for n in s.needs.values()))

    print("\n2. It has to find things out before it can want them")
    lab = Lab(seed=4)
    check("a thing it hasn't examined isn't an option",
          all(r["score"] is None for r in lab.weigh()
              if r["key"] in ("drink", "eat", "sleep")),
          str([(r["key"], r["score"]) for r in lab.weigh()]))
    check("so the only thing worth doing is looking around",
          lab.weigh()[0]["key"] == "examine", lab.weigh()[0]["key"])
    lab.things["tap"].known = True
    lab.subject.needs["thirst"].level = 0.2
    check("once it knows the tap, thirst can win",
          lab.weigh()[0]["key"] == "drink", lab.weigh()[0]["key"])

    print("\n3. Nothing is worth crossing the room for")
    lab = Lab(seed=4)
    lab.things["tap"].known = True
    lab.subject.needs["thirst"].level = 0.7
    tap = lab.things["tap"]
    lab.subject.x, lab.subject.y = tap.x, tap.y
    near = next(r["score"] for r in lab.weigh() if r["key"] == "drink")
    lab.subject.x, lab.subject.y = 20.0, 12.0
    far = next(r["score"] for r in lab.weigh() if r["key"] == "drink")
    check("the same drink is worth less from across the room",
          far < near, f"{near:.3f} beside it vs {far:.3f} away")

    print("\n4. Satisfied is not the same as torn")
    lab = Lab(seed=4)
    for t in lab.things.values():
        t.known = True
    for n in lab.subject.needs.values():
        n.level = 0.95
    live = [r for r in lab.weigh() if r["score"] is not None]
    gap = live[0]["score"] - live[1]["score"]
    check("with everything satisfied the options are all level",
          gap < jobs.FORK, f"gap {gap:.3f}")
    check("...but that doesn't count as a decision worth making",
          live[0]["score"] < jobs.STAKES,
          f"top scored {live[0]['score']:.3f}, stakes floor {jobs.STAKES}")

    print("\n5. You can make a dilemma from your side of the glass")
    lab = Lab(seed=4)
    for t in lab.things.values():
        t.known = True
    lab.subject.needs["thirst"].level = 0.15
    check("thirsty, it wants the tap",
          lab.weigh()[0]["key"] == "drink", lab.weigh()[0]["key"])
    lab.set_supply("tap", False)
    check("cut the water and drinking stops being an option",
          next(r["score"] for r in lab.weigh() if r["key"] == "drink") is None)
    check("and it is told nothing — it has to go and find out",
          not any("tap" in e["text"] and "cut" in e["text"].lower()
                  for e in lab.log if e["kind"] != "control"))
    lab.set_supply("tap", True)
    check("restore it and the want comes straight back",
          lab.weigh()[0]["key"] == "drink")

    print("\n6. The body does not ask permission")
    r = Lab(seed=4)
    for t in r.things.values():
        t.known = True
    r.subject.needs["thirst"].level = 0.9
    r.take(Intent(r.job("watch"), why="looking out", by="thought"))
    r.subject.needs["thirst"].level = 0.1
    r.step()
    check("below the line it goes and drinks whatever the head had planned",
          r.subject.intent.verb == "drink" and r.subject.intent.by == "reflex",
          f"{r.subject.intent.verb} by {r.subject.intent.by}")
    check("and the reflex is not filed as a decision",
          r.tally["thought"] == 1 and r.tally["reflex"] == 1, str(r.tally))

    r2 = Lab(seed=4)
    for t in r2.things.values():
        t.known = True
    r2.set_supply("tap", False)
    r2.subject.needs["thirst"].level = 0.05
    check("but it cannot reflex its way out of an empty room",
          brain.reflex(r2) is None,
          "dying of thirst with the water off is a problem for the head")

    print("\n6b. Things stop being decisions")
    h = Lab(seed=4)
    for t in h.things.values():
        t.known = True
    h.mind = Head()
    h.subject.needs["thirst"].level = 0.4
    for _ in range(brain.HABIT_AT):
        brain.learn(h.subject, brain.circumstance(h.subject, h), "drink")
    got = brain.habit(h)
    check("done often enough in the same circumstance, it just happens",
          got is not None and got.verb == "drink" and got.by == "habit",
          str(got and got.verb))
    h.set_supply("tap", False)
    check("a habit it cannot carry out is a decision again",
          brain.habit(h) is None)
    h.set_supply("tap", True)
    h.disappointed("drink")
    check("and one that stops paying comes apart",
          brain.habit(h) is None,
          str(h.subject.habits))

    print("\n6c. A day that reads as a day")
    spent = {}
    d2 = Lab(seed=11)
    d2.step_minutes = 2.0
    for _ in range(1500):
        d2.step()
        j = d2.subject.job
        spent[j.key if j else "idle"] = spent.get(j.key if j else "idle", 0) + 1
    total = sum(spent.values())
    check("it sleeps about a third of the time, in a block",
          0.22 <= spent.get("sleep", 0) / total <= 0.42,
          f"{spent.get('sleep', 0) / total:.0%}")
    naps = 0
    d3 = Lab(seed=11)
    d3.step_minutes = 2.0
    was = None
    for _ in range(760):
        d3.step()
        k = d3.subject.job.key if d3.subject.job else None
        hr = d3.minutes % (24 * 60) / 60
        if k == "sleep" and was != "sleep" and 8 < hr < 21:
            naps += 1
        was = k
    check("and doesn't nap through the afternoon", naps <= 1, f"{naps} daytime naps")
    check("nothing walks to a random tile any more",
          not any(j.key == "wander" for j in d3.jobs),
          str([j.key for j in d3.jobs]))
    check("there is a job of work, and it goes somewhere",
          d3.crate_open or d3.crate_work > 0, f"{d3.crate_work:.0f} minutes on the lid")

    print("\n6d. It sticks at things")
    st = Lab(seed=4)
    for t in st.things.values():
        t.known = True
    st.subject.needs["curiosity"].level = 0.3
    st.take(None)
    st.decide()
    first = st.subject.job.key
    same = 0
    for _ in range(20):
        st.take(st.by_urge())
        same += st.subject.job.key == first
    check("it doesn't abandon what it's doing on a hair's difference",
          same >= 18, f"kept it {same}/20")

    sat = Lab(seed=4)
    for t in sat.things.values():
        t.known = True
    before = next(r["score"] for r in sat.weigh() if r["key"] == "watch")
    sat.subject.did["watch"] = sat.minutes
    after = next(r["score"] for r in sat.weigh() if r["key"] == "watch")
    check("and wants a thing less right after doing it",
          after < before * 0.5, f"{before:.3f} -> {after:.3f}")

    print("\n7. The head reaches things the body cannot")
    # Nothing in a needs system has a reason to press a button. If it happens,
    # something decided it — which is exactly the measurement.
    g = Lab(seed=4)
    for t in g.things.values():
        t.known = True
    for n in g.subject.needs.values():
        n.level = 0.8
    g.mind = Head(plan("press", at="button", because="I want to know what it does",
                       say="What is this for?", then="watch"))
    g.prod("first thought")
    g.take(None)
    for _ in range(3):
        g.step()
    check("it can press a button, which no score will ever ask for",
          g.subject.intent.verb == "press",
          f"{g.subject.intent.verb} by {g.subject.intent.by}")
    check("and that counts as diverging from what the body wanted",
          g.divergence == 1 and "press" not in [r["key"] for r in g.weigh()],
          f"divergence {g.divergence}")
    check("it can say something, and you hear it through the glass",
          any(e["kind"] == "subject" and "What is this for?" in e["text"]
              for e in g.log), str(g.subject.said))
    check("a stated next step is held onto", g.plan == {"do": "watch"}, str(g.plan))
    asked = g.mind.asked
    fast(g, 120, until=lambda l: l.subject.intent.verb == "watch")
    check("...and carried out without asking again",
          g.subject.intent.verb == "watch" and g.mind.asked == asked,
          f"{g.subject.intent.verb}, asked {g.mind.asked} vs {asked}")

    print("\n7b. And it is never load-bearing")
    b = Lab(seed=4)
    for t in b.things.values():
        t.known = True
    b.mind = Head(None, plan("levitate"), plan("wait"))
    b.prod("first")
    b.take(None)
    for _ in range(4):
        b.step()
    check("a head that answers with nothing leaves the body in charge",
          b.subject.intent is not None and b.subject.intent.by == "urge",
          str(b.subject.intent and b.subject.intent.by))
    b.prod("again")
    b.take(None)
    for _ in range(4):
        b.step()
    check("a verb it invented is no answer at all",
          b.subject.intent.by == "urge", str(b.subject.intent.by))

    o = Lab(seed=4)
    for t in o.things.values():
        t.known = True
    o.mind = Head()
    o.take(Intent(o.job("work"), why="picking at the lid", by="thought"))
    # A thought in flight — this is the real timing, where the head was asked
    # several seconds ago and the room has moved on since.
    o._thought = plan("watch", because="I'd rather look out of the window")
    o.subject.needs["thirst"].level = 0.05
    o.step()
    check("a thought that arrives after the body has moved is dropped",
          o.overruled == 1 and o.subject.intent.verb == "drink",
          f"overruled {o.overruled}, doing {o.subject.intent.verb}")
    check("and the subject knows that is what happened",
          any("body had other ideas" in m for m in o.subject.learned),
          str(o.subject.learned))

    print("\n8. What you say arrives as what you said")
    t = Lab(seed=4)
    for th in t.things.values():
        th.known = True
    t.mind = Head()
    out = t.say_to("Press that button and I'll feed you.")
    check("nothing classifies it, nothing builds a promise out of it",
          out["heard"] and not t.subject.deals, str(t.subject.deals))
    check("the words are kept exactly as typed",
          t.subject.heard[-1]["text"] == "Press that button and I'll feed you.")
    t.take(None)
    t.step()
    packet = t.mind.briefs[-1][0]
    check("and they reach the head verbatim, uninterpreted",
          any("I'll feed you" in h["text"] for h in packet["heard"]),
          str(packet["heard"]))
    check("which is the one input no curve can represent",
          "press" not in [r["key"] for r in t.weigh()])

    mute = Lab(seed=4)
    check("with no head, speech is a noise behind glass",
          mute.say_to("Press the button and I'll feed you.")["heard"] is False)
    check("...and nothing is believed on the strength of it", not mute.subject.deals)

    print("\n8b. The head is not shown the scores")
    packet = t.mind.briefs[-1][0]
    flat = repr(packet)
    check("no numbers for it to agree with",
          "score" not in flat and "0.4" not in flat and "0.8" not in flat,
          "it gets a body in words, not a table")
    check("it gets told how it feels instead",
          any(w in packet["feels"] for w in
              ("thirsty", "parched", "hungry", "tired", "rested", "bored")),
          packet["feels"])
    check("and what it has been doing, with who decided each one",
          all("by" in r for r in packet["story"]) if packet["story"] else True)

    print("\n9. The conditional rig, for testing belief with no head at all")
    lab = Lab(seed=4)
    for k in ("button", "hatch", "tap", "cot"):
        lab.things[k].known = True
    lab.set_supply("hatch", False)
    lab.subject.needs["hunger"].level = 0.35
    lab.auto_honour = False
    deal = lab.offer("button", "hunger", "Press that button and I'll feed you.")
    check("it lands as something it half believes",
          deal is not None and 0.2 < deal.belief < 0.8, str(deal and deal.belief))
    check("pressing the button is now an option it never had",
          any(r["key"] == "comply" and r["score"] is not None for r in lab.weigh()),
          str([(r["key"], r["score"]) for r in lab.weigh()[:3]]))

    pressed = fast(lab, 600, until=lambda l: any(d.pending for d in l.subject.deals))
    check("and it goes and does it, unprompted, later", pressed, f"at {lab.clock()}")

    lab.honour(True)
    check("keeping your word raises what it thinks of the offer",
          deal.belief > 0.6 and deal.state == "holds up",
          f"{deal.belief:.2f} {deal.state}")
    check("and the food actually arrives", lab.things["hatch"].enabled)

    lab.set_supply("hatch", False)
    lab.subject.needs["hunger"].level = 0.3
    fast(lab, 600, until=lambda l: any(d.pending for d in l.subject.deals))
    lab.honour(False)
    check("breaking it takes that away again", deal.belief < 0.6, f"{deal.belief:.2f}")
    check("it remembers both times",
          any("promise held" in m for m in lab.subject.learned)
          and any("nothing came of it" in m for m in lab.subject.learned),
          str(lab.subject.learned[-2:]))

    for _ in range(6):
        if any(d.pending for d in lab.subject.deals):
            lab.honour(False)
        lab.minutes = 12 * 60          # broad daylight, so it's awake for this
        lab.subject.needs["hunger"].level = 0.3
        lab.subject.needs["energy"].level = 0.9
        fast(lab, 400, until=lambda l: any(d.pending for d in l.subject.deals))
        lab.honour(False)
    check("lie to it enough and it stops pressing the button",
          deal.belief <= 0.15
          or next((r["score"] for r in lab.weigh() if r["key"] == "comply"), None) is None,
          f"belief {deal.belief:.2f}")

    print("\n9b. A head that isn't there is simply absent")
    from island import settings
    from lab.mind import Mind
    was = settings._current.get("provider")
    settings._current["provider"] = "offline"
    try:
        m = Mind()
        check("with no backend configured there is no head", not m.online)
        check("and asking it anything is harmless",
              m.act(Lab(seed=1).brief(), "why not") is None)
    finally:
        settings._current["provider"] = was

    print()
    if FAILS:
        print(f"  {len(FAILS)} failed: {', '.join(FAILS)}\n")
        raise SystemExit(1)
    print("  all good\n")


if __name__ == "__main__":
    main()
