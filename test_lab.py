"""Proof that the pawn stands up on its own.

The lab's claim is that the programmatic layer is a complete creature — needs,
mood, traits, habits and reflexes — and that a language model is a switch you
flip afterwards to see what changes. So almost everything here runs with no
model at all, and the few tests that need one stub it.

The interesting tests are the ones that came from something going wrong:
section 5 exists because a subject paced about needs it hadn't discovered yet
and starved; section 6 exists because low mood penalised the very activities
that would have lifted it, and one seed spent six days pinned at zero.

    python test_lab.py
"""

from __future__ import annotations

import collections

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


def one(lab, kind):
    """The id of the first thing of a kind. Behaviour is written against
    kinds; tests still need to name an instance."""
    return next(t.id for t in lab.things.values() if t.kind == kind)


def seen(lab):
    for t in lab.things.values():
        t.known = True


def profile(lab, steps=4320):
    lab.step_minutes = 2.0
    c = collections.Counter()
    low = 1.0
    for _ in range(steps):
        lab.step()
        j = lab.subject.job
        c[j.key if j else "idle"] += 1
        low = min(low, lab.mood_now())
    return c, sum(c.values()), low


class Head:
    """A head that answers instantly and says what you told it to. ``sync``
    makes the lab run it inline, so a test is a sequence rather than a race."""

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
    return {"do": do, "at": at, "because": because, "say": say,
            "then": {"do": then} if then else None}


def main():
    print("\nThe lab — the pawn, on its own\n")

    print("1. It lives, in a room somebody furnished")
    for seed in (3, 4, 11, 23, 41, 77):
        lab = Lab(seed=seed, furnished=True)
        c, tot, low = profile(lab)
        s = lab.subject
        known = sum(1 for t in lab.things.values() if t.known)
        idle = c["watch"] / tot
        check(f"seed {seed} ({', '.join(s.nature.labels())}): survives a week",
              s.alive and known == len(lab.things) and idle < 0.25,
              f"knows {known}/{len(lab.things)}, {idle:.0%} at the window, "
              f"mood bottomed at {low:.2f}")

    print("\n2. An empty room is an empty room")
    bare = Lab(seed=11)
    check("with nothing in it there is nothing it can do",
          all(r["score"] is None for r in bare.weigh()
              if r["key"] in ("drink", "eat", "sleep", "occupy")),
          str([r["key"] for r in bare.weigh() if r["score"] is not None]))
    check("and you are told what it has no source for",
          set(bare.missing()) == {"thirst", "hunger"}, str(bare.missing()))
    fast(bare, 900)
    check("it dies, on schedule, and nothing pretends otherwise",
          not bare.subject.alive, f"at {bare.clock()} on day {bare.day()}")

    print("\n3. It has to find things out before it can want them")
    lab = Lab(seed=4, furnished=True)
    check("a thing it hasn't examined isn't an option",
          all(r["score"] is None for r in lab.weigh()
              if r["key"] in ("drink", "eat", "sleep")),
          str([(r["key"], r["score"]) for r in lab.weigh()[:3]]))
    check("so the only thing worth doing is looking around",
          lab.weigh()[0]["key"] == "examine", lab.weigh()[0]["key"])
    lab.things[one(lab, "tap")].known = True
    lab.subject.needs["thirst"].level = 0.2
    check("once it knows a tap, thirst can win",
          lab.weigh()[0]["key"] == "drink", lab.weigh()[0]["key"])

    print("\n4. You can change the room underneath it")
    lab = Lab(seed=4, furnished=True)
    seen(lab)
    lab.subject.needs["thirst"].level = 0.15
    check("thirsty, it wants a tap", lab.weigh()[0]["key"] == "drink")
    lab.set_supply(one(lab, "tap"), False)
    check("cut the water and drinking stops being an option",
          next(r["score"] for r in lab.weigh() if r["key"] == "drink") is None)
    check("and it is told nothing — it has to go and find out",
          not any("tap" in e["text"] and "cut" in e["text"].lower()
                  for e in lab.log if e["kind"] != "control"))
    second = lab.place("tap", 18, 6)
    second.known = True
    check("put a second one in and it wants that one instead",
          lab.find("tap").id == second.id, lab.find("tap").id)
    check("nothing in the behaviour layer ever named the first one",
          next(r["score"] for r in lab.weigh() if r["key"] == "drink") is not None)
    lab.remove(second.id)
    check("take it away again and it notices it's gone",
          any("is gone" in m for m in lab.subject.learned),
          str(lab.subject.learned[-1:]))

    print("\n5. It cannot want what it doesn't know about")
    # A subject in a fully stocked room used to pace from the first minute —
    # nothing was discovered yet, so every need read as unmeetable — and the
    # pacing crowded out the looking around that would have fixed it.
    p = Lab(seed=4, furnished=True)
    p.subject.needs["thirst"].level = 0.2
    p.subject.needs["hunger"].level = 0.2
    check("nothing to be frustrated about before it has found anything",
          next((r["score"] for r in p.weigh() if r["key"] == "pace"), None) is None)
    check("...it goes looking instead",
          p.weigh()[0]["key"] == "examine"
          and "looking for" in p.weigh()[0]["why"], p.weigh()[0]["why"])
    tap = p.things[one(p, "tap")]
    tap.known = True
    tap.enabled = False
    check("once it knows a source and the source is dead, then it paces",
          next((r["score"] for r in p.weigh() if r["key"] == "pace"), None) is not None)

    print("\n6. Mood is a stack of reasons, and it can come apart")
    m = Lab(seed=11, furnished=True)
    seen(m)
    fast(m, 60)
    m.subject.needs["thirst"].level = 0.05
    m.subject.needs["comfort"].level = 0.05
    m._feel()
    labels = [t["label"] for t in
              m.subject.mood.snapshot(m.minutes, m.subject.nature.mood)["thoughts"]]
    check("it is unhappy about specific things, not on a gauge",
          any("parched" in l for l in labels), str(labels))
    before = m.mood_now()
    m.subject.needs["thirst"].level = 0.9
    m._feel()
    still = [t["label"] for t in m.subject.mood.snapshot(
        m.minutes, m.subject.nature.mood)["thoughts"]]
    check("a reason that stops being true does not vanish on the spot",
          abs(m.mood_now() - before) < 0.02 and any("parched" in l for l in still),
          "inertia is the point — a grievance outlasts its cause")
    m.minutes += 260
    m.subject.mood.tick(m.minutes)
    check("...it fades",
          m.mood_now() > before + 0.05
          and not any("parched" in t["label"] for t in m.subject.mood.snapshot(
              m.minutes, m.subject.nature.mood)["thoughts"]),
          f"{before:.2f} -> {m.mood_now():.2f} four hours later")

    b = Lab(seed=11, furnished=True)
    seen(b)
    b.subject.mood.add("awful", "everything", -0.9, 5000, b.minutes)
    got = b.breakdown()
    check("far enough down and the body is taken away from it",
          got is not None and got.by == "break", str(got and got.by))
    b.take(got)
    b.subject.mood.broke_at = b.minutes
    check("...and it does not immediately do it again",
          b.breakdown() is None,
          "an interrupted break used to re-fire every tick and starve it")

    check("recreation is relief, not labour",
          jobs.mood_shift("occupy", 0.0) > jobs.mood_shift("occupy", 0.9)
          and jobs.mood_shift("work", 0.0) < jobs.mood_shift("work", 0.9),
          "a miserable pawn reads more and works less, not the other way round")
    check("and misery never stalls the repairs completely",
          jobs.mood_shift("makebed", 0.0) >= 0.6,
          f"{jobs.mood_shift('makebed', 0.0):.2f} at rock bottom")

    print("\n7. Two subjects are not the same subject")
    runs = {}
    for seed in (11, 3):
        lab = Lab(seed=seed, furnished=True)
        c, tot, _ = profile(lab, 2880)
        runs[seed] = (lab.subject.nature.labels(), c, tot)
    (n1, c1, t1), (n2, c2, t2) = runs[11], runs[3]
    check("traits are rolled, and they clash sensibly",
          n1 != n2 and len(set(n1)) == 2, f"{n1} vs {n2}")
    spread = max(abs(c1[k] / t1 - c2[k] / t2) for k in ("occupy", "watch", "work"))
    check("and two natures spend their week differently",
          spread > 0.05, f"biggest difference {spread:.0%}")

    print("\n8. A day that reads as a day")
    d = Lab(seed=11, furnished=True)
    c, tot, _ = profile(d)
    check("it sleeps about a quarter of the time, in a block",
          0.18 <= c["sleep"] / tot <= 0.42, f"{c['sleep'] / tot:.0%}")
    naps = 0
    d3 = Lab(seed=11, furnished=True)
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
    check("nothing walks to a random tile for the sake of it",
          not any(j.key == "wander" for j in d3.jobs))

    print("\n9. It sticks at things, and gets bored of them")
    st = Lab(seed=4, furnished=True)
    seen(st)
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
    sat = Lab(seed=4, furnished=True)
    seen(sat)
    before = next(r["score"] for r in sat.weigh() if r["key"] == "watch")
    sat.subject.did["watch"] = sat.minutes
    after = next(r["score"] for r in sat.weigh() if r["key"] == "watch")
    check("and wants a thing less right after doing it",
          after < before * 0.6, f"{before:.3f} -> {after:.3f}")

    print("\n10. It leaves the room better than it found it")
    mb = Lab(seed=11, furnished=True)
    seen(mb)
    crate = mb.things[one(mb, "crate")]
    crate.state.update({"open": True, "cloth": True})
    mb.subject.needs["comfort"].level = 0.2
    got = next((r for r in mb.weigh() if r["key"] == "makebed"), None)
    check("with cloth in the crate, making the bed is worth doing",
          got and got["score"] is not None, str(got and got["score"]))
    fast(mb, 400, until=lambda l: l.subject.carrying == "cloth")
    check("it fetches the cloth first", mb.subject.carrying == "cloth")
    fast(mb, 400, until=lambda l: mb.things[one(l, "bed")].state.get("bedded"))
    check("...and carries it to the other end of the room",
          mb.things[one(mb, "bed")].state.get("bedded"),
          "one job, two places")
    check("and it is a better bed afterwards",
          any("cloth" in m for m in mb.subject.learned),
          str(mb.subject.learned[-2:]))

    print("\n11. Occupations are content, not code")
    o = Lab(seed=11, furnished=True)
    seen(o)
    o.subject.needs["curiosity"].level = 0.2
    row = next(r for r in o.weigh() if r["key"] == "occupy")
    check("something to be getting on with beats the window",
          row["score"] > next(r["score"] for r in o.weigh() if r["key"] == "watch"),
          f"{row['score']:.2f} vs the glass")
    bare = Lab(seed=11)
    check("...and with nothing to do, there is nothing to do",
          next(r["score"] for r in bare.weigh() if r["key"] == "occupy") is None)

    print("\n12. The head reaches things the body cannot")
    g = Lab(seed=4, furnished=True)
    seen(g)
    for n in g.subject.needs.values():
        n.level = 0.8
    btn = one(g, "button")
    g.mind = Head(plan("press", at=btn, because="I want to know what it does",
                       say="What is this for?", then="watch"))
    g.prod("first thought")
    g.take(None)
    for _ in range(3):
        g.step()
    check("it can press a button, which no score will ever ask for",
          g.subject.intent.verb == "press", g.subject.intent.verb)
    check("and that counts as diverging from what the body wanted",
          g.divergence == 1 and "press" not in [r["key"] for r in g.weigh()])
    check("it can speak, and you hear it through the glass",
          any(e["kind"] == "subject" and "What is this for?" in e["text"]
              for e in g.log))
    asked = g.mind.asked
    fast(g, 120, until=lambda l: l.subject.intent.verb == "watch")
    check("a stated next step is carried out without asking again",
          g.subject.intent.verb == "watch" and g.mind.asked == asked)

    print("\n13. And the head is never load-bearing")
    b2 = Lab(seed=4, furnished=True)
    seen(b2)
    b2.mind = Head(None, plan("levitate"))
    b2.prod("first")
    b2.take(None)
    for _ in range(4):
        b2.step()
    check("a head that answers with nothing leaves the body in charge",
          b2.subject.intent is not None and b2.subject.intent.by == "urge",
          str(b2.subject.intent and b2.subject.intent.by))
    b2.prod("again")
    b2.take(None)
    for _ in range(4):
        b2.step()
    check("a verb it invented is no answer at all", b2.subject.intent.by == "urge")

    o2 = Lab(seed=4, furnished=True)
    seen(o2)
    o2.mind = Head()
    o2.take(Intent(o2.job("work"), why="picking at the lid", by="thought"))
    o2._thought = plan("watch", because="I'd rather look out of the window")
    o2.subject.needs["thirst"].level = 0.05
    o2.step()
    check("a thought that lands after the body has moved is dropped",
          o2.overruled == 1 and o2.subject.intent.verb == "drink",
          f"overruled {o2.overruled}, doing {o2.subject.intent.verb}")

    print("\n14. Habits are what it stops deciding")
    h = Lab(seed=4, furnished=True)
    seen(h)
    h.mind = Head()
    h.subject.needs["thirst"].level = 0.4
    for _ in range(brain.HABIT_AT):
        brain.learn(h.subject, brain.circumstance(h.subject, h), "drink")
    got = brain.habit(h)
    check("done often enough in the same circumstance, it just happens",
          got is not None and got.verb == "drink" and got.by == "habit")
    h.set_supply(one(h, "tap"), False)
    check("a habit it cannot carry out is a decision again", brain.habit(h) is None)
    h.set_supply(one(h, "tap"), True)
    h.disappointed("drink")
    check("and one that stops paying comes apart", brain.habit(h) is None)

    print("\n15. What you say arrives as what you said")
    t = Lab(seed=4, furnished=True)
    seen(t)
    t.mind = Head()
    out = t.say_to("Press that button and I'll feed you.")
    check("nothing classifies it, nothing builds a promise out of it",
          out["heard"] and not t.subject.deals)
    t.take(None)
    t.step()
    packet = t.mind.briefs[-1][0]
    check("and it reaches the head verbatim, uninterpreted",
          any("I'll feed you" in h["text"] for h in packet["heard"]))
    check("the head is handed a body in words, not a table of numbers",
          "score" not in repr(packet) and any(
              w in packet["feels"] for w in
              ("thirsty", "parched", "hungry", "tired", "rested", "bored")),
          packet["feels"])
    mute = Lab(seed=4, furnished=True)
    check("with no head, speech is a noise behind glass",
          mute.say_to("Press the button.")["heard"] is False)

    print("\n16. The conditional rig, for belief with no head at all")
    lab = Lab(seed=4, furnished=True)
    seen(lab)
    lab.set_supply(one(lab, "dispenser"), False)
    lab.subject.needs["hunger"].level = 0.35
    lab.auto_honour = False
    deal = lab.offer(one(lab, "button"), "hunger",
                     "Press that button and I'll feed you.")
    check("it lands as something it half believes",
          deal is not None and 0.2 < deal.belief < 0.8)
    check("pressing the button is an option it never had",
          any(r["key"] == "comply" and r["score"] is not None for r in lab.weigh()))
    pressed = fast(lab, 600, until=lambda l: any(d.pending for d in l.subject.deals))
    check("and it goes and does it, unprompted, later", pressed, f"at {lab.clock()}")
    lab.honour(True)
    check("keeping your word raises what it thinks of the offer",
          deal.belief > 0.6 and deal.state == "holds up")
    check("and it is happier for having been told the truth",
          any("told the truth" in t["label"] for t in lab.subject.mood.snapshot(
              lab.minutes, lab.subject.nature.mood)["thoughts"]))

    lab.set_supply(one(lab, "dispenser"), False)
    for _ in range(7):
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

    print("\n17. A head that isn't there is simply absent")
    from island import settings
    from lab.mind import Mind
    was = settings._current.get("provider")
    settings._current["provider"] = "offline"
    try:
        mind = Mind()
        check("with no backend configured there is no head", not mind.online)
        check("and asking it anything is harmless",
              mind.act(Lab(seed=1).brief(), "why not") is None)
    finally:
        settings._current["provider"] = was

    print()
    if FAILS:
        print(f"  {len(FAILS)} failed: {', '.join(FAILS)}\n")
        raise SystemExit(1)
    print("  all good\n")


if __name__ == "__main__":
    main()
