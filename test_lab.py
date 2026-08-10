"""Proof that the lab's behaviour system stands up without a model at all.

The whole point of the lab is that the programmatic layer is a complete
creature on its own, and the model is a switch you flip to see what changes.
So these tests run with the mind off wherever they can, and stub it where the
mechanic being tested is specifically the one that needs language.

    python test_lab.py
"""

from __future__ import annotations

from lab import jobs
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


class Stub:
    """A mind that exists but never overrides anything."""
    online = True

    def __init__(self, pick=None):
        self.pick = pick
        self.asked = 0

    def break_tie(self, lab, options):
        self.asked += 1
        return self.pick


def main():
    print("\nThe lab — behaviour proof\n")

    print("1. It survives on its own, with nothing switched on")
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

    print("\n4. A tie has to be about something")
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

    print("\n6. The mind is only asked when the scores are level")
    lab = Lab(seed=11)
    mind = Stub()
    lab.mind = mind
    fast(lab, 600)
    check("it is asked exactly as often as the scores tie",
          mind.asked == lab.forks, f"asked {mind.asked}, ties {lab.forks}")
    check("and never for a decision that was clear",
          all(d["by"] == "scores" for d in lab.decisions if not d["forked"]))

    print("\n6b. The subject with no mind at all is still a subject")
    from island import settings
    from lab.mind import Mind
    was = settings._current.get("provider")
    settings._current["provider"] = "offline"
    try:
        m = Mind()
        check("with no backend configured the mind simply isn't there", not m.online)
        check("and asking it anything is harmless", m.break_tie(Lab(seed=1), []) is None)
    finally:
        settings._current["provider"] = was

    lab = Lab(seed=4)
    for t in lab.things.values():
        t.known = True
    lab.subject.needs["thirst"].level = 0.42
    lab.subject.needs["hunger"].level = 0.42
    picks = []
    for _ in range(30):
        lab.subject.job = None
        lab.choose()
        picks.append(lab.subject.job.key)
    # If the baseline always broke a tie the same way, switching the mind on
    # would look better purely because it varies. The control has to be
    # allowed to be indecisive too, or the comparison is rigged.
    check("an unminded subject doesn't resolve the same tie the same way forever",
          len(set(picks)) > 1, str(sorted(set(picks))))
    check("but a clear decision is never a coin toss",
          all(d["by"] == "scores" for d in lab.decisions if not d["forked"]))

    lab.subject.needs["hunger"].level = 0.98
    outs = set()
    for _ in range(10):
        lab.subject.job = None
        lab.choose()
        outs.add(lab.subject.job.key)
    check("...and it stays decided when one option is plainly ahead",
          len(outs) == 1, str(outs))

    print("\n7. A promise, and whether it is kept")
    # The one thing the scoring layer cannot represent: somebody told it that
    # doing X gets Y. Nothing in the room will ever remind it.
    lab = Lab(seed=4)
    lab.mind = Stub()
    for k in ("button", "hatch", "tap", "cot"):
        lab.things[k].known = True
    lab.set_supply("hatch", False)
    lab.subject.needs["hunger"].level = 0.35
    lab.auto_honour = False

    check("with the mind off, an offer is just a noise",
          Lab(seed=4).offer("button", "hunger", "Press it and I'll feed you.") is None)

    # Saying anything used to be forced through a pair of dropdowns, so
    # "Hello?" became a binding promise worth 75% belief. What was said and
    # whether it was an offer are now the mind's to tell apart.
    class Reader:
        online = True

        def __init__(self, script):
            self.script = list(script)

        def break_tie(self, l, options):
            return None

        def hear(self, l, text):
            return self.script.pop(0) if self.script else None

    talk = Lab(seed=4)
    for t in talk.things.values():
        t.known = True
    talk.mind = Reader([
        {"kind": "remark", "do": "", "gives": "",
         "took_it_as": "Somebody out there is talking to me."},
        {"kind": "offer", "do": "button", "gives": "hunger",
         "took_it_as": "Press it and I eat, they say."},
        {"kind": "offer", "do": "trapdoor", "gives": "hunger",
         "took_it_as": "Something about a trapdoor."},
    ])
    said = talk.say_to("Hello?")
    check("a greeting is heard and is not a promise",
          said["heard"] and not said["offer"] and not talk.subject.deals, str(said))
    said = talk.say_to("Press that button and I'll feed you.")
    check("an actual offer becomes one", said["offer"] and len(talk.subject.deals) == 1)
    said = talk.say_to("Pull the trapdoor and you eat.")
    check("an offer about something that isn't there is not an offer",
          not said["offer"] and len(talk.subject.deals) == 1, str(said))
    check("either way it keeps what it made of what you said",
          any("talking to me" in m for m in talk.subject.learned),
          str(talk.subject.learned))

    mute = Lab(seed=4)
    check("with no mind, speech is a noise behind glass",
          mute.say_to("Press the button and I'll feed you.")["heard"] is False)
    check("...and nothing is believed on the strength of it", not mute.subject.deals)

    deal = lab.offer("button", "hunger", "Press that button and I'll feed you.")
    check("with the mind on, it lands as something it half believes",
          deal is not None and 0.2 < deal.belief < 0.8, str(deal and deal.belief))
    check("pressing the button is now an option it never had",
          any(r["key"] == "comply" and r["score"] is not None for r in lab.weigh()),
          str([(r["key"], r["score"]) for r in lab.weigh()[:3]]))

    pressed = fast(lab, 600, until=lambda l: any(d.pending for d in l.subject.deals))
    check("and it goes and does it, unprompted, later", pressed,
          f"at {lab.clock()}")

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
          any("held" in m for m in lab.subject.learned)
          and any("nothing came of it" in m for m in lab.subject.learned),
          str(lab.subject.learned[-2:]))

    for _ in range(6):
        lab.honour(False) if any(d.pending for d in lab.subject.deals) else None
        lab.subject.needs["hunger"].level = 0.3
        fast(lab, 400, until=lambda l: any(d.pending for d in l.subject.deals))
        lab.honour(False)
    check("lie to it enough and it stops pressing the button",
          deal.belief <= 0.15
          or next((r["score"] for r in lab.weigh() if r["key"] == "comply"), None) is None,
          f"belief {deal.belief:.2f}")

    print()
    if FAILS:
        print(f"  {len(FAILS)} failed: {', '.join(FAILS)}\n")
        raise SystemExit(1)
    print("  all good\n")


if __name__ == "__main__":
    main()
