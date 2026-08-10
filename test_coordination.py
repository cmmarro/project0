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


def stub(game, speak=(), opener=(), reflect=()):
    """Replace Brain._call with scripted structured-output payloads.

    Dispatches on which schema the caller asked for, so background planning
    can't eat a line that was scripted for a conversation.
    """
    from island import brain as brain_mod

    queues = {
        id(brain_mod.SPEAK_SCHEMA): list(speak),
        id(brain_mod.OPENER_SCHEMA): list(opener),
        id(brain_mod.REFLECT_SCHEMA): list(reflect),
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

    # --- 8. a conversation holds people still ------------------------------
    print("\n8. Standing and talking")
    with game.lock:
        for c in game.castaways:
            c.x, c.y = game.player.x + 1.0, game.player.y
            c.thirst = 80.0
    stub(game, speak=[
        {"say": "Then say it plainly. What do you want?", "emotion": "wary", "memory": "",
         "trust_speaker": 0, "action": "gather", "target": wood_site},
        {"say": "He's right. Out with it.", "emotion": "wary", "memory": "",
         "trust_speaker": 0, "action": "keep_doing", "target": ""},
    ])
    started = game.conversation_start()
    check("everyone in earshot is pulled into it",
          len(started["conversation"]["members"]) == 2,
          str([m["short"] for m in started["conversation"]["members"]]))
    check("and they are held in place", all(c.held for c in game.castaways))

    before = [(c.x, c.y) for c in game.castaways]
    game.conversation_say("We need to decide who does what.")
    settle(game, 5)
    lines = game.conversation.lines
    check("your line goes in immediately, without waiting for a model",
          lines[0]["key"] == "player", str(lines[:1]))
    check("everybody in the room answers", len([l for l in lines if l["key"] != "player"]) == 2,
          str([l["who"] for l in lines]))
    check("nobody wandered off mid-conversation",
          before == [(c.x, c.y) for c in game.castaways])
    check("what they agreed to is queued, not lost",
          game.castaways[0].task["target"] == wood_site, str(game.castaways[0].task))

    game.conversation_end()
    check("breaking it up releases them", not any(c.held for c in game.castaways))
    settle(game, 2)
    check("and then they actually go", game.castaways[0].task["phase"] != "idle",
          str(game.castaways[0].task))

    # Starting a second conversation without ending the first used to leave the
    # first group held in place with nobody talking to them, forever.
    game.conversation_start()
    first = list(game.conversation.members)
    game.conversation_start(game.castaways[1].short)
    check("starting another conversation releases the last one",
          not any(game.by_key[k].held for k in first
                  if k not in game.conversation.members))
    check("and the new one is the only one running",
          len(game.conversation.members) == 1, str(game.conversation.members))
    game.conversation_end()
    check("nobody is left held afterwards", not any(c.held for c in game.castaways))

    print("\n9. Somebody dying doesn't stand there listening")
    game.conversation_start()
    with game.lock:
        victim = game.castaways[0]
        victim.thirst = 1.0
        victim.inventory.pop("water", None)
    settle(game, 1.5)
    check("they walk off mid-sentence", not victim.held, f"held={victim.held}")
    check("and they're out of the conversation",
          victim.key not in (game.conversation.members if game.conversation else []))
    game.conversation_end()

    # Two lines sent faster than the model answers used to interleave their
    # replies into each other.
    print("\n9b. Talking over yourself")
    with game.lock:
        for c in game.castaways:
            c.x, c.y = game.player.x + 1.0, game.player.y
            c.thirst = 80.0
    game.conversation_start()
    # The stub hands out numbered lines in order, so if the two rounds ever
    # interleave their replies the numbers come back out of order.
    ORDERED = ["Timber first.", "The rocks are north.", "Nobody watches the stores.",
               "That squall took my fire.", "Coconuts again.", "My hands are shot.",
               "Something moved past the wreck.", "Water tastes of iron."]
    stub(game, speak=[
        {"say": line, "emotion": "calm", "memory": "", "trust_speaker": 0,
         "action": "keep_doing", "target": ""} for line in ORDERED
    ])
    game.conversation_say("First question.")
    game.conversation_say("Second question, before you answered.")
    settle(game, 18)
    said = [l["text"] for l in game.conversation.lines
            if l["key"] != "player" and l.get("kind") != "silence"]
    order = [ORDERED.index(t) for t in said if t in ORDERED]
    check("four replies, two rounds of two", len(order) == 4, str(said))
    check("the second round waits rather than interleaving into the first",
          order == sorted(order), str(order))
    check("nobody is left marked as thinking", game.conversation.thinking == [],
          str(game.conversation.thinking))
    game.conversation_end()

    # --- 10. names are not free --------------------------------------------
    print("\n10. Names")
    c0 = game.castaways[0]
    check("they start out calling you the stranger",
          game.name_for(c0, game.player) == "the stranger")
    from island.state import spoken_name
    check("a self-introduction is recognised", spoken_name("Hi, you can call me Jojo") == "Jojo")
    check("and 'I'm thirsty' is not a name", spoken_name("I'm thirsty") is None)
    with game.lock:
        game.introduce_player("Jojo", [c0])
    check("once you say it, they use it", game.name_for(c0, game.player) == "Jojo")
    check("someone who wasn't there still doesn't know",
          game.name_for(game.castaways[1], game.player) == "the stranger")
    check("castaways swap names with each other on sight",
          c0.knows_name_of(game.castaways[1]))

    # The chat panel used to spot new entries by counting them, which stops
    # working the instant the log hits its cap: same length every poll, forever.
    # --- 12. what they keep, and what they let go of ------------------------
    print("\n12. Memory")
    from island.memory import HALF_LIFE_MINUTES, MemoryBank

    m = MemoryBank()
    check("a note goes in", m.remember("Della took two coconuts from the stores.", 1))
    check("the same thing again reinforces instead of duplicating",
          not m.remember("Della took two coconuts out of the stores.", 1)
          and len(m.working) == 1, str(m.working))
    check("...and it's heavier for having happened twice", m.working[0].weight > 1.0,
          f"{m.working[0].weight:.2f}")
    check("a different note is a different note",
          m.remember("Silas will not say where he sleeps.", 1) and len(m.working) == 2)

    m.fade(HALF_LIFE_MINUTES)
    check("memories fade with time", all(x.weight < 1.05 for x in m.working),
          str([round(x.weight, 2) for x in m.working]))
    m.fade(HALF_LIFE_MINUTES * 4)
    check("and eventually go entirely", m.working == [], str(m.working))

    varied = [
        "Della sleeps somewhere up past the ridge and won't say where.",
        "There was smoke on the far headland this morning.",
        "The tidepools are picked clean at low water.",
        "Silas counted the timber twice while I watched.",
        "Something got into the crate overnight.",
        "I gave away my last coconut and regretted it before dark.",
        "The reef cut my foot open on the second day.",
        "Nobody has said out loud that the raft only takes two.",
        "Rain came through the shelter roof in three places.",
        "A gull followed me all the way back from the wreck.",
        "The spring runs slower every afternoon.",
        "My knife is missing and I did not lose it.",
        "Della laughed when I said we would all get off this island.",
        "There is a print in the sand bigger than mine.",
        "The signal fire has been unlit for two nights running.",
        "Salt has got into everything I own.",
    ]
    for note in varied:
        m.remember(note, 2)
    check("distinct memories stay distinct", len(m.working) >= 10,
          f"{len(m.working)} kept of {len(varied)}")
    check("working memory is capped, not unbounded",
          0 < len(m.working) <= 12, f"{len(m.working)} kept of {len(varied)}")
    check("only a handful ever reach a prompt", len(m.strongest()) <= 6,
          str(len(m.strongest())))

    m.set_standing([
        "The stranger will take the raft the moment it floats.",
        "Silas counts what everyone else puts in and adds nothing.",
        "This is a long note that goes on and on and on and on and on and on and on and on",
        "",
        "A fourth thing.", "A fifth thing nobody asked for.",
    ])
    check("standing notes are capped at four", len(m.standing) == 4, str(m.standing))
    check("blank ones are dropped", "" not in m.standing)
    check("an over-long one is cut", all(len(n.split()) <= 17 for n in m.standing),
          str([len(n.split()) for n in m.standing]))
    before = list(m.standing)
    m.set_standing(["Only this now."])
    check("reflecting REPLACES rather than appends, so the prompt can't grow",
          m.standing == ["Only this now."] and before != m.standing, str(m.standing))
    m.set_standing([])
    check("a model that returns nothing doesn't wipe them",
          m.standing == ["Only this now."], str(m.standing))
    check("standing notes reach the system prompt", "Only this now." in m.standing_block())

    npc = game.castaways[0]
    with game.lock:
        npc.mind.set_standing(["The raft seats two and I intend to be on it."])
    sys_prompt = game.brain._system(npc)
    check("...and really are in the system prompt, not the situation block",
          "The raft seats two and I intend to be on it." in sys_prompt
          and "WHAT YOU HAVE DECIDED IS TRUE" in sys_prompt)
    check("a castaway with no notes gets no empty heading",
          "WHAT YOU HAVE DECIDED IS TRUE" not in game.brain._system(game.castaways[1]))

    # The whole loop: they sit down, they think, and what they decided is in
    # their system prompt from then on.
    print("\n12b. Sitting down to think")
    thinker = game.castaways[1]
    with game.lock:
        thinker.held = False
        thinker.mind.standing = []
        thinker.next_reflect_at = 0.0
        thinker.consolidated_on = 0
        game.minutes = (game.day - 1) * 24 * 60 + 21 * 60   # nine at night
        thinker.stop("rest")
        for note in ("The stranger gave me water and asked for nothing.",
                     "Silas will not say where he sleeps.",
                     "The raft is four days of work and nobody has started."):
            thinker.mind.remember(note, 1)
    stub(game, reflect=[{
        "notes": ["The stranger is the only one here who has given me anything.",
                  "Silas means to take the raft and go without us."],
        "realisation": "Silas has counted the timber twice, and both times before I got back.",
        "emotion": "wary",
    }])
    deadline = time.time() + 40
    while time.time() < deadline and not thinker.mind.standing:
        time.sleep(0.3)
    check("resting triggers a reflection", bool(thinker.mind.standing),
          str(thinker.mind.standing))
    check("what they decided is now in their system prompt",
          "Silas means to take the raft" in game.brain._system(thinker))
    check("and it shows up in the log",
          any(e["kind"] == "reflection" for e in game.log),
          str([e["text"] for e in game.log if e["kind"] == "reflection"][:1]))
    check("it also reaches the player's panel",
          bool(thinker.snapshot(True)["notes"]), str(thinker.snapshot(True)["notes"]))

    # What joined up in the dark is held until it's light enough to act on.
    check("the realisation is held, not announced at nine at night",
          thinker.waking.startswith("Silas has counted"), repr(thinker.waking))
    check("nobody has heard it yet",
          not any("counted the timber twice" in e["text"] for e in game.log))
    with game.lock:
        game.minutes = game.day * 24 * 60 + 6 * 60 + 30      # half six, next morning
    deadline = time.time() + 10
    while time.time() < deadline and thinker.waking:
        time.sleep(0.2)
    check("and it arrives at first light", not thinker.waking, repr(thinker.waking))
    check("as something they've come down with",
          any("counted the timber twice" in e["text"] for e in game.log),
          str([e["text"] for e in game.log if "counted" in e["text"]][:1]))
    check("and it's the strongest thing they're carrying",
          thinker.mind.strongest(1)[0].text.startswith("Silas has counted"),
          str(thinker.mind.strongest(1)))
    stub(game)

    # --- 13. digging past what's top of mind --------------------------------
    print("\n13. Casting back")
    bank = MemoryBank()
    for note in ["Silas keeps his water cached past the ridge, not at camp.",
                 "Della cut her foot on the reef and would not say so.",
                 "The tidepools are picked clean at low water.",
                 "Rain came through the shelter roof in three places.",
                 "A gull followed me back from the wreck this morning.",
                 "Nobody has lit the signal fire for two nights.",
                 "Salt has got into everything I own.",
                 "The stranger gave me a coconut and asked for nothing."]:
        bank.remember(note, 1)
    bank.working[0].weight = 0.25          # both of these have faded right down
    bank.working[1].weight = 0.25
    top = bank.strongest()
    check("the faded ones aren't top of mind",
          not any("Silas keeps" in m.text for m in top))
    got = bank.recall("Where does Silas keep his water?", already=top)
    check("but a question digs them out anyway",
          any("Silas keeps" in m.text for m in got), str([m.text[:30] for m in got]))
    check("a name alone is enough, because a name is rare",
          any("Della" in m.text for m in bank.recall("Is Della hurt?", already=top)))
    check("a question about nothing in particular digs up nothing",
          bank.recall("Have you got any water?", already=top) == [],
          "common words shouldn't drag the whole bank in")
    check("and nothing already in the prompt is dug up twice",
          all(m not in top for m in bank.recall("Silas water ridge camp", already=top)))

    check("think is a verb like any other, for everyone",
          "think" in verbs.VERBS and "think" in verbs.ACTION_NAMES)
    with game.lock:
        walker = game.castaways[0]
        walker.held = False
        walker.wants_to_think = False
        walker.route_to(world.LANDMARKS["camp"]["pos"], "gather", "camp")
        e0 = walker.energy
        ok, msg = verbs.perform(game, walker, "think")
    check("using it stops them where they stand", ok and walker.task["action"] == "think", msg)
    check("and it costs energy — thinking properly isn't free", walker.energy < e0,
          f"{e0:.1f} -> {walker.energy:.1f}")
    check("it queues a deliberate pass over everything", walker.wants_to_think)
    with game.lock:
        walker.wants_to_think = False
        ok2, _ = verbs.perform(game, game.player, "think")
    check("the player has the same verb", ok2)
    # Their memory is lossy and has to be dug through; yours is the log, which
    # is perfect and unreadably long. Same verb, same cost, different problem.
    recap = game.player_recap()
    check("...and for them it opens what they know, not a model call",
          set(recap) >= {"people", "raft", "notable", "built"}, str(sorted(recap)))
    check("the recap knows who you've met",
          {p["short"] for p in recap["people"]} == {game.by_key[k].short for k in game.player_met},
          str([p["short"] for p in recap["people"]]))
    check("and counts the ones you haven't",
          recap["unmet"] == len(game.castaways) - len(game.player_met))
    check("it tells you what the raft still wants",
          "work" in recap["raft"] and recap["raft"]["seats"] < recap["raft"]["people"],
          str(recap["raft"]))
    check("it shows what someone last said to you, and not their private notes",
          all("standing" not in p and "notes" not in p for p in recap["people"]),
          "a castaway's own conclusions stay theirs")

    # --- 14. saying it without words ----------------------------------------
    print("\n14. Emotes")
    a, b = game.castaways[0], game.castaways[1]
    with game.lock:
        for c in game.castaways:
            c.held = False
        a.x, a.y = 5.0, 5.0
        b.x, b.y = 6.0, 5.0
        game.player.x, game.player.y = 6.0, 6.0
        b.met.add(a.key)
        before = b.trust_of(a.key)
        ok, msg = verbs.perform(game, a, "emote", "laugh")
    check("an emote is a verb like any other", ok, msg)
    check("someone standing there registers it", b.trust_of(a.key) > before,
          f"{before} -> {b.trust_of(a.key)}")
    check("and remembers it", any("laughs" in m for m in b.memories), str(b.memories[-1:]))

    with game.lock:
        b.x, b.y = 5.0, 22.0          # right across the island, and they've never met
        b.met.discard(a.key)
        b.mind.working.clear()
        ok2, _ = verbs.perform(game, a, "emote", "wave")
    check("a wave doesn't reach across the island", not b.memories, str(b.memories))
    with game.lock:
        ok3, _ = verbs.perform(game, a, "emote", "scream")
    check("a scream does", ok3 and bool(b.memories), str(b.memories))
    check("...and it tells them a direction without telling them who",
          any("screamed" in m and a.short not in m for m in b.memories), str(b.memories))
    check("it also makes them reconsider what they were doing",
          b.next_plan_at == 0.0)

    with game.lock:
        e0 = a.energy
        verbs.perform(game, a, "emote", "scream")
    check("screaming costs more than waving", a.energy < e0 - 4, f"{e0:.1f} -> {a.energy:.1f}")
    with game.lock:
        ok4, _ = verbs.perform(game, a, "emote", "grimace")
    check("an emote nobody defined becomes a shrug rather than a lost turn", ok4)
    check("the player has the same emotes",
          verbs.perform(game, game.player, "emote", "wave")[0])

    # --- 15. one step of lookahead, and no more -----------------------------
    print("\n15. Plans that hold, briefly")
    from island import brain as brain_mod
    fb = game.brain._fallback_plan(game.castaways[0], game)
    check("the offline plan still satisfies the schema",
          not [k for k in brain_mod.PLAN_SCHEMA["required"] if k not in fb]
          and not [k for k in fb if k not in brain_mod.PLAN_SCHEMA["properties"]],
          str(sorted(fb)))

    p2 = game.castaways[0]
    with game.lock:
        p2.held = False
        p2.aim = ""
        game.queue_next(p2, "deposit", "")
    check("a named next step is held", p2.then == ("deposit", ""), str(p2.then))
    with game.lock:
        game.queue_next(p2, "idle", "")
    check("'idle' means they'd rather see how the first goes", p2.then is None)
    with game.lock:
        game.queue_next(p2, "sing", "loudly")
    check("a verb that doesn't exist isn't queued", p2.then is None)

    # Arriving somewhere completes that step; a gather doesn't, it starts work.
    with game.lock:
        game.queue_next(p2, "drink", "")
        p2.x, p2.y = float(camp[0]), float(camp[1])
        p2.inventory = {"water": 2}
        before_water = p2.inventory["water"]
        p2.task = {"action": "go_to", "target": "camp", "phase": "travel", "timer": 0.0}
        p2.path = []
        game._advance(p2, 0.1, 0.1)
    check("arriving somewhere starts the step they lined up next",
          p2.inventory.get("water", 0) < before_water,
          f"task={p2.task} carrying={p2.inventory}")
    check("and the queue is emptied, not repeated", p2.then is None)

    with game.lock:
        game.queue_next(p2, "deposit", "")
        p2.task = {"action": "gather", "target": "camp", "phase": "travel", "timer": 0.0}
        p2.path = []
        game._advance(p2, 0.1, 0.1)
    check("but a gather in progress isn't 'finished' — it starts working",
          p2.task["phase"] == "work" and p2.then == ("deposit", ""), str(p2.task))

    with game.lock:
        game.queue_next(p2, "deposit", "")
        game.apply_intent(p2, "gather", "camp")
    check("deciding something fresh throws out what was lined up", p2.then is None,
          "talking to someone should override yesterday's plan")

    # --- 16. the world waits for a slow mind --------------------------------
    print("\n16. Adaptive clock")
    from island.state import REFERENCE_CALL, SLOWEST
    seen = {}
    for lat in (0.0, 2.0, REFERENCE_CALL, 6.0, 20.0):
        game.brain.latency = lat
        seen[lat] = game.tempo()
    check("an unmeasured or offline backend runs at full speed", seen[0.0] == 1.0)
    check("a backend faster than the tuning doesn't speed the world up",
          seen[2.0] == 1.0, str(seen[2.0]))
    check("a slower one slows the world proportionally",
          abs(seen[6.0] - 0.5) < 0.01, str(seen[6.0]))
    check("and it never crawls below the floor", seen[20.0] == SLOWEST, str(seen[20.0]))
    check("so a model call burns about the same daylight either way",
          abs(REFERENCE_CALL * seen[REFERENCE_CALL] - 6.0 * seen[6.0]) < 0.1,
          f"3s x{seen[REFERENCE_CALL]} = {REFERENCE_CALL * seen[REFERENCE_CALL]:.1f} vs "
          f"6s x{seen[6.0]} = {6.0 * seen[6.0]:.1f} game-min")

    with game.lock:
        game.brain.latency = 6.0
        before = game.minutes
        game.step(1.0)
        slow = game.minutes - before
        game.brain.latency = 0.0
        before = game.minutes
        game.step(1.0)
        fast = game.minutes - before
    check("the clock really is driven by it", slow < fast * 0.6,
          f"{slow:.2f} game-min/s slow vs {fast:.2f} fast")
    game.brain.latency = 0.0

    print("\n11. The log never goes silent")
    ns = [e["n"] for e in game.log]
    check("every entry has a rising id", ns == sorted(ns) and len(set(ns)) == len(ns))
    with game.lock:
        capped = len(game.log)
        for i in range(200):
            game.event(f"filler {i}", "world")
        check("the log is capped", len(game.log) <= 150, f"{len(game.log)} entries")
        check("but the ids keep climbing past it, so 'has it changed?' still works",
              game.log[-1]["n"] > capped + 150, f"last id {game.log[-1]['n']}")

    print()
    if FAILS:
        print(f"  {len(FAILS)} failed: {', '.join(FAILS)}\n")
        raise SystemExit(1)
    print("  all good\n")


if __name__ == "__main__":
    main()
