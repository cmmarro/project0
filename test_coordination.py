"""Proof that the core loop works: you say who does what, and it takes effect.

Runs the real simulation with the model call stubbed out, so it exercises every
piece between "player types a sentence" and "castaway is standing at the
tidepools with a fish", without needing an API key.

    python test_coordination.py
"""

from __future__ import annotations

import json
import time

from island import verbs, world
from island.state import Game, start

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
        assert "THE SITUATION" in system, "world guide missing from system prompt"
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

    game = Game(seed=42)
    game.brain.client = object()          # pretend we're online so _call is used
    stub(game)
    start(game)
    freeze_plans(game)

    wren, odell = game.castaways
    wood_site = next(n for n, items in world.HARVEST.items() if "wood" in items)
    fish_site = next(n for n, items in world.HARVEST.items() if "fish" in items)

    print(f"  island seed {game.seed}: timber at '{wood_site}', fish at '{fish_site}'\n")

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
         "The new one wants me on timber while they take the fish.", "trust_speaker": 1,
         "action": "gather", "target": wood_site},
        {"say": "Fishing! Now that I can plausibly fail at.", "emotion": "amused", "memory":
         "I said I'd take the fish.", "trust_speaker": 1,
         "action": "gather", "target": fish_site},
    ])
    reply = game.player_says(f"Wren, you take the timber. Odell, you take the fish.")
    check("both in earshot answered", len(reply["replies"]) == 2,
          f"{[r['who'] for r in reply['replies']]}")
    check("Wren accepted the timber job", wren.task["target"] == wood_site,
          f"task={wren.task}")
    check("Odell accepted the fish job", odell.task["target"] == fish_site,
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
    check("Wren walked to the timber and gathered it", wren.inventory.get("wood", 0) >= 1,
          f"carrying {wren.inventory}")
    check("Odell walked to the water and caught something", odell.inventory.get("fish", 0) >= 1,
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

    print()
    if FAILS:
        print(f"  {len(FAILS)} failed: {', '.join(FAILS)}\n")
        raise SystemExit(1)
    print("  all good\n")


if __name__ == "__main__":
    main()
