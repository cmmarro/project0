"""Proof that the core loop works: you say who does what, and it takes effect.

Runs the real simulation with the model call stubbed out, so it exercises every
piece between "player types a sentence" and "castaway is standing at the
tidepools with a fish", without needing an API key.

    python test_coordination.py
"""

from __future__ import annotations

import json
import time

from island import settings, verbs, world
from island.state import Game, start

# Run against known settings, not whatever the developer last saved in the UI.
settings._current = dict(settings.DEFAULTS)
settings._current["prompt_style"] = "full"

FAILS: list[str] = []


def check(label: str, ok: bool, detail: str = ""):
    print(f"  {'PASS' if ok else 'FAIL'}  {label}{'  — ' + detail if detail else ''}")
    if not ok:
        FAILS.append(label)


def stub(game, speak=(), opener=()):
    """Replace Brain._call with scripted structured-output payloads.

    Dispatches on which schema the caller asked for, so background planning
    can't eat a line that was scripted for a conversation.
    """
    from island import brain as brain_mod

    queues = {
        id(brain_mod.SPEAK_SCHEMA): list(speak),
        id(brain_mod.OPENER_SCHEMA): list(opener),
    }

    def _call(system, user, schema):
        # Mimic the real thing closely enough to catch schema drift.
        assert ("THE SITUATION" in system or "WHERE YOU ARE" in system), \
            "world guide missing from system prompt"
        assert schema["additionalProperties"] is False
        q = queues.get(id(schema))
        if q is None:          # a plan call: let the offline fallback handle it
            return None
        payload = q.pop(0) if q else None
        if payload is None:
            return None
        missing = [k for k in schema["required"] if k not in payload]
        assert not missing, f"stub payload missing required keys: {missing}"
        extra = [k for k in payload if k not in schema["properties"]]
        assert not extra, f"stub payload has keys the schema forbids: {extra}"
        json.dumps(payload)    # must be serialisable, like a real response
        return payload

    game.brain._call = _call


def freeze_plans(game, seconds=600):
    """Stop the castaways re-deciding, so a scripted exchange can be observed."""
    with game.lock:
        for c in game.castaways:
            c.next_plan_at = time.time() + seconds


def settle(game, seconds=6.0, step=0.1):
    """Let the sim and worker threads catch up."""
    end = time.time() + seconds
    while time.time() < end:
        time.sleep(step)


def main():
    print("\nCastaway — coordination proof\n")

    game = Game(seed=42, cast_size=2)
    game.brain.provider = object()        # pretend we're online so _call is used
    stub(game)
    start(game)
    freeze_plans(game)

    wren, odell = game.castaways   # a two-person cast, rolled from the seed
    wood_site = next(n for n, items in world.HARVEST.items() if "wood" in items)
    fish_site = next(n for n, items in world.HARVEST.items() if "fish" in items)

    print(f"  island seed {game.seed}: timber at '{wood_site}', fish at '{fish_site}'")
    for c in game.castaways:
        print(f"  cast: {c.name} ({c.pronouns}), once a {c.role}")
    print()

    # --- 1. you have to actually meet them ---------------------------------
    print("1. Contact")
    check("nobody is known at the start", not game.player_met)
    r = game.player_says("Is anyone out there?")
    check("talking to nobody reaches nobody", r["replies"] == [] and r["heard_by"] == [])

    # Walk both castaways to the player so contact happens through the real path.
    with game.lock:
        wren.x, wren.y = game.player.x + 1.0, game.player.y
        odell.x, odell.y = game.player.x - 1.0, game.player.y
    stub(game, opener=[
        {"say": "Where in hell did you come from?", "emotion": "wary"},
        {"say": "Oh, thank god. A person. An actual person.", "emotion": "hopeful"},
    ])
    settle(game, 6)
    freeze_plans(game)
    check("meeting both castaways registers", len(game.player_met) == 2,
          f"met={sorted(game.player_met)}")

    # --- 2. dividing the labour --------------------------------------------
    print("\n2. Dividing the work")
    stub(game, speak=[
        {"say": "Timber. Fine. That's mine.", "emotion": "determined", "memory":
         "The stranger wants me on timber while they take the fish.", "trust_speaker": 1,
         "action": "gather", "target": wood_site},
        {"say": "Fishing! Now that I can plausibly fail at.", "emotion": "amused", "memory":
         "I said I'd take the fish.", "trust_speaker": 1,
         "action": "gather", "target": fish_site},
    ])
    reply = game.player_says(
        f"{wren.short}, you take the timber. {odell.short}, you take the fish.")
    check("both in earshot answered", len(reply["replies"]) == 2,
          f"{[r['who'] for r in reply['replies']]}")
    check(f"{wren.short} accepted the timber job", wren.task["target"] == wood_site,
          f"task={wren.task}")
    check(f"{odell.short} accepted the fish job", odell.task["target"] == fish_site,
          f"task={odell.task}")
    check("they remembered the deal", bool(wren.memories) and bool(odell.memories))
    check("trust moved", wren.trust_of("player") == 1 and odell.trust_of("player") == 1,
          f"wren={wren.trust_of('player')} odell={odell.trust_of('player')}")

    # --- 3. the deal turns into actual walking and actual resources ---------
    print("\n3. Following through")
    stub(game)                            # no more scripted lines; let the sim run
    freeze_plans(game)                    # and let them honour the deal, not re-decide
    deadline = time.time() + 90
    while time.time() < deadline:
        if wren.inventory.get("wood") and odell.inventory.get("fish"):
            break
        time.sleep(0.25)
    check(f"{wren.short} walked to the timber and gathered it", wren.inventory.get("wood", 0) >= 1,
          f"carrying {wren.inventory}")
    check(f"{odell.short} walked to the water and caught something", odell.inventory.get("fish", 0) >= 1,
          f"carrying {odell.inventory}")

    # --- 4. shared stores and building -------------------------------------
    print("\n4. Stores and building")
    with game.lock:
        camp = world.LANDMARKS["camp"]["pos"]
        wren.x, wren.y = float(camp[0]), float(camp[1])
        wren.inventory = {"wood": 6}
        ok, msg = verbs.deposit(game, wren)
    check("a castaway can stock the shared stores", ok and game.stores.get("wood", 0) >= 6, msg)

    with game.lock:
        game.player.x, game.player.y = float(camp[0]), float(camp[1])
        game.stores["flint"] = game.stores.get("flint", 0) + 1
        before = dict(game.stores)
        ok, msg = verbs.build(game, game.player, "fire")
    check("player can start a build from the shared stores", ok, msg)
    check("materials were consumed", game.stores.get("wood", 0) == before["wood"] - 3, str(game.stores))

    with game.lock:
        ok2, msg2 = verbs.build(game, wren, "fire")
    check("a castaway contributes to the same build", ok2 and game.structures["fire"]["progress"] == 2, msg2)

    # --- 5. the verb set really is shared ----------------------------------
    print("\n5. Symmetry")
    shared = set(verbs.VERBS)
    check("both kinds of actor route through one verb table", len(shared) >= 10, ", ".join(sorted(shared)))
    with game.lock:
        game.player.inventory["water"] = 1
        odell.x, odell.y = game.player.x, game.player.y
        wren.x, wren.y = game.player.x + 12, game.player.y   # out of reach
        ok3, msg3 = verbs.give(game, game.player, "water")
    check("player uses the same give verb an NPC uses", ok3 and odell.inventory.get("water", 0) >= 1, msg3)
    with game.lock:
        ok4, msg4 = verbs.give(game, odell, "water")
    check("NPC gives it straight back through that verb", ok4, msg4)

    # --- 6. the cast is rolled, not written --------------------------------
    print("\n6. Procedural cast")
    import random as _random

    from island import people

    a = people.generate_cast(_random.Random(101))
    b = people.generate_cast(_random.Random(101))
    c = people.generate_cast(_random.Random(202))
    check("a seed reproduces its cast exactly",
          [p["name"] for p in a] == [p["name"] for p in b],
          ", ".join(p["name"] for p in a))
    check("a different seed gives different people",
          [p["name"] for p in a] != [p["name"] for p in c],
          ", ".join(p["name"] for p in c))

    sizes = {len(people.generate_cast(_random.Random(s))) for s in range(60)}
    check("cast size varies between runs", len(sizes) > 1, f"sizes seen: {sorted(sizes)}")

    clashes = []
    for s in range(60):
        cast = people.generate_cast(_random.Random(s))
        for field in ("short", "role"):
            vals = [p[field] for p in cast]
            if len(set(vals)) != len(vals):
                clashes.append(f"seed {s} {field}")
        surnames = [p["name"].split()[-1] for p in cast]
        if len(set(surnames)) != len(surnames):
            clashes.append(f"seed {s} surname")
    check("no run repeats a name or a background", not clashes, "; ".join(clashes[:4]))

    big = Game(seed=9, cast_size=4)
    check("a four-person cast builds", len(big.castaways) == 4,
          ", ".join(f"{p.short} ({p.role})" for p in big.castaways))
    check("each gets their own persona in the prompt",
          len({p.persona for p in big.castaways}) == 4)

    # --- 7. alliances are sets, so factions can form ------------------------
    print("\n7. Alliances")
    x, y, z, w = big.castaways
    with big.lock:
        big.set_allies(x, [y.short])
        big.set_allies(y, [x.name])              # full name should resolve too
        big.set_allies(z, ["the player"])
        big.set_allies(w, [])
    check("a name list becomes actor keys", x.allies == {y.key} and y.allies == {x.key},
          f"{x.short}->{sorted(x.allies)}, {y.short}->{sorted(y.allies)}")
    check("the player can be named as an ally", z.allies == {"player"})
    check("an empty list means going it alone", w.allies == set())
    check("mutual allies read back as a phrase",
          big.allegiance_phrase(x) == f"with {y.name}", big.allegiance_phrase(x))
    check("solitude reads back as alone", big.allegiance_phrase(w) == "alone")

    blocs = [set(g) for g in big.factions()]
    check("a mutual pair forms one faction", {x.key, y.key} in blocs,
          str([sorted(g) for g in big.factions()]))
    check("the loner is not folded into it",
          all(w.key not in g or g == {w.key} for g in blocs))

    print()
    if FAILS:
        print(f"  {len(FAILS)} failed: {', '.join(FAILS)}\n")
        raise SystemExit(1)
    print("  all good\n")


if __name__ == "__main__":
    main()
