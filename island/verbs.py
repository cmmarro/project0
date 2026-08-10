"""The verb layer — the complete set of things a person on this island can do.

This module is the point of the whole design: the human and the two castaways
call exactly the same functions with exactly the same rules. Nothing here knows
or cares whether the actor is driven by a keyboard or by a language model. If a
castaway can do it, you can do it, and the reverse.
"""

from __future__ import annotations

import random

from . import world
from .actors import Actor, clamp

EDIBLE = {"fish": 45, "coconut": 26}

RECIPES = {
    "fire":    {"cost": {"wood": 3, "flint": 1},             "work": 3},
    "shelter": {"cost": {"wood": 4, "frond": 6},             "work": 5},
    "still":   {"cost": {"cloth": 2, "coconut": 2},          "work": 3},
    "signal":  {"cost": {"wood": 6, "cloth": 1},             "work": 4},
    "raft":    {"cost": {"wood": 10, "rope": 4, "cloth": 2}, "work": 12},
}

CAMP_RADIUS = 3.0
REACH = 2.5          # how close you must be to hand something over or help someone

# The raft takes two. There are three of you. This is the whole problem.
RAFT_CAPACITY = 2


def _at_camp(game, actor: Actor) -> bool:
    return actor.distance_to(world.LANDMARKS["camp"]["pos"]) <= CAMP_RADIUS


# --- resource verbs ----------------------------------------------------------

def gather(game, actor: Actor, target: str | None = None) -> tuple[bool, str]:
    place = world.landmark_at(actor.x, actor.y, radius=2.8)
    items = world.HARVEST.get(place or "")
    if not items:
        return False, "There's nothing to gather here."
    if actor.energy <= 2:
        return False, "Too spent to work."
    if actor.carried() >= 10:
        return False, "Hands are full."
    item = random.choice(items)
    actor.give_item(item)
    actor.energy = clamp(actor.energy - 2.5)
    game.event(f"{actor.short} gathers {world.ITEM_LABEL[item]} at {place}.", "world", actor)
    return True, f"Gathered {world.ITEM_LABEL[item]}."


def drink(game, actor: Actor, target: str | None = None) -> tuple[bool, str]:
    if not actor.take_item("water"):
        return False, "No water to drink."
    actor.thirst = clamp(actor.thirst + 55)
    game.event(f"{actor.short} drinks.", "world", actor)
    return True, "You drink."


def eat(game, actor: Actor, target: str | None = None) -> tuple[bool, str]:
    order = ["fish", "coconut"] if game.structures["fire"]["done"] else ["coconut", "fish"]
    if target in EDIBLE:
        order = [target]
    for food in order:
        if actor.take_item(food):
            value = EDIBLE[food]
            if food == "fish" and not game.structures["fire"]["done"]:
                value = int(value * 0.5)
            actor.hunger = clamp(actor.hunger + value)
            game.event(f"{actor.short} eats {world.ITEM_LABEL[food]}.", "world", actor)
            return True, f"You eat {world.ITEM_LABEL[food]}."
    return False, "Nothing to eat."


def rest(game, actor: Actor, target: str | None = None) -> tuple[bool, str]:
    if hasattr(actor, "stop"):
        actor.stop("rest")
    else:
        actor.task = {"action": "rest", "target": "", "phase": "idle", "timer": 0.0}
    return True, "Resting."


# Things you can do without words. Everyone can do all of them, and the ranges
# are the whole design: a scream carries much further than a sentence, which
# makes it the one way to reach somebody you haven't found yet — at the cost of
# every other person on the island knowing roughly where you are.
EMOTES = {
    "wave":    {"range": 7.0, "energy": 0.4, "trust": 0,
                "does": "{a} waves.", "self": "You wave."},
    "beckon":  {"range": 7.0, "energy": 0.6, "trust": 0,
                "does": "{a} beckons — come here.", "self": "You beckon them over."},
    "laugh":   {"range": 6.0, "energy": 0.4, "trust": 1,
                "does": "{a} laughs, and means it.", "self": "You laugh."},
    "cry":     {"range": 5.0, "energy": 1.0, "trust": 0,
                "does": "{a} is crying, and not hiding it.", "self": "You break down."},
    "scream":  {"range": 20.0, "energy": 5.0, "trust": 0, "heard": True,
                "does": "{a} screams. It carries right across the island.",
                "self": "You scream until your throat gives."},
    "shrug":   {"range": 5.0, "energy": 0.2, "trust": 0,
                "does": "{a} shrugs.", "self": "You shrug."},
    "turn_away": {"range": 5.0, "energy": 0.3, "trust": -1,
                  "does": "{a} turns away and won't look at you.",
                  "self": "You turn your back on them."},
}
EMOTE_NAMES = list(EMOTES)


def emote(game, actor: Actor, target: str | None = None) -> tuple[bool, str]:
    """Say something without saying anything.

    The target names which one. An unknown one is a shrug, because a model that
    invents "grimace" clearly meant something and losing the turn helps nobody.
    """
    kind = (target or "").strip().lower().replace(" ", "_")
    spec = EMOTES.get(kind)
    if spec is None:
        kind, spec = "shrug", EMOTES["shrug"]
    if actor.energy <= spec["energy"]:
        return False, "You haven't got it in you."
    actor.energy = clamp(actor.energy - spec["energy"])
    return game.witness_emote(actor, kind, spec)


def think(game, actor: Actor, target: str | None = None) -> tuple[bool, str]:
    """Stop and go through everything, not just what's loudest.

    Ordinary decisions are made on the six strongest things a castaway is
    carrying, because putting all of it in front of the model on every call is
    how you drown a small one. This is the way to get the rest of it: they stop
    walking, stand still, and ask for the whole bank. It costs a chunk of the
    day and it costs energy — thinking properly is not free for anyone.

    The player has it too. It's a verb like any other.
    """
    if actor.energy <= 4:
        return False, "Too far gone to think straight."
    actor.energy = clamp(actor.energy - 3)
    return game.stop_and_think(actor)


# --- camp verbs --------------------------------------------------------------

def deposit(game, actor: Actor, target: str | None = None) -> tuple[bool, str]:
    if not _at_camp(game, actor):
        return False, "Not at camp."
    keep = {"water": 1, "coconut": 1}
    moved = 0
    for item in list(actor.inventory):
        n = actor.inventory[item] - (keep.get(item, 0) if not actor.is_human else 0)
        if target and target != item:
            continue
        if n > 0:
            actor.inventory[item] -= n
            if not actor.inventory[item]:
                del actor.inventory[item]
            game.stores[item] = game.stores.get(item, 0) + n
            moved += n
    if not moved:
        return False, "Nothing to put down."
    game.event(f"{actor.short} adds {moved} to the camp stores.", "world", actor)
    game.notice_sharing(actor, moved)
    return True, f"Deposited {moved}."


def take(game, actor: Actor, target: str | None = None) -> tuple[bool, str]:
    if not _at_camp(game, actor):
        return False, "Not at camp."
    item = (target or "").strip()
    if game.stores.get(item, 0) <= 0:
        return False, "The stores don't have that."
    game.stores[item] -= 1
    if not game.stores[item]:
        del game.stores[item]
    actor.give_item(item)
    game.event(f"{actor.short} takes {world.ITEM_LABEL.get(item, item)} from the stores.", "world", actor)
    game.notice_taking(actor, item)
    return True, f"Took {world.ITEM_LABEL.get(item, item)}."


def build(game, actor: Actor, target: str | None = None) -> tuple[bool, str]:
    name = (target or "").strip()
    if name not in RECIPES:
        return False, "That isn't something you can build."
    if not _at_camp(game, actor):
        return False, "You have to be at camp to build."
    s = game.structures[name]
    if s["done"]:
        return False, f"The {name} is already built."
    if not s["started"]:
        cost = RECIPES[name]["cost"]
        if any(game.stores.get(k, 0) < v for k, v in cost.items()):
            need = ", ".join(f"{v} {k}" for k, v in cost.items())
            return False, f"Not enough in the stores — the {name} needs {need}."
        for k, v in cost.items():
            game.stores[k] -= v
            if not game.stores[k]:
                del game.stores[k]
        s["started"] = True
        game.event(f"Work starts on the {name}.", "build", actor)
    if actor.energy <= 3:
        return False, "Too spent to work."
    actor.energy = clamp(actor.energy - 4)
    s["progress"] += 1
    s["credit"][actor.key] = s["credit"].get(actor.key, 0) + 1
    if s["progress"] >= s["needed"]:
        s["done"] = True
        game.event(f"The {name} is finished.", "build", actor)
        return True, f"The {name} is finished."
    game.event(f"{actor.short} works on the {name} ({s['progress']}/{s['needed']}).", "build", actor)
    return True, f"{name}: {s['progress']}/{s['needed']}"


# --- social verbs ------------------------------------------------------------

def give(game, actor: Actor, target: str | None = None, to: str | None = None) -> tuple[bool, str]:
    item = (target or "").strip()
    if item not in actor.inventory:
        return False, "You aren't carrying that."
    recipient = game.nearest_other(actor, key=to, radius=REACH)
    if not recipient:
        return False, "Nobody close enough to hand it to."
    actor.take_item(item)
    recipient.give_item(item)
    game.event(f"{actor.short} gives {world.ITEM_LABEL.get(item, item)} to {recipient.short}.", "gift", actor)
    game.notice_gift(actor, recipient, item)
    return True, f"Gave {world.ITEM_LABEL.get(item, item)} to {recipient.short}."


def revive(game, actor: Actor, target: str | None = None) -> tuple[bool, str]:
    who = game.nearest_other(actor, key=target, radius=REACH, only_down=True)
    if not who:
        return False, "Nobody within reach needs picking up."
    if actor.inventory.get("water", 0) <= 0:
        return False, "You'd need water for that."
    actor.take_item("water")
    who.thirst = clamp(who.thirst + 50)
    who.health = 25.0
    who.down = False
    game.event(f"{actor.short} gets water into {who.short}. They come round.", "alert", actor)
    game.notice_rescue(actor, who)
    return True, f"{who.short} comes round."


def board(game, actor: Actor, target: str | None = None) -> tuple[bool, str]:
    if not game.structures["raft"]["done"]:
        return False, "There's no raft yet."
    if not _at_camp(game, actor):
        return False, "The raft is at camp."
    return game.launch(actor)


# --- movement (the one verb whose input differs) -----------------------------

def go_to(game, actor: Actor, target: str | None = None) -> tuple[bool, str]:
    """Head for a landmark. The human does this with the keyboard instead."""
    place = game.match_landmark(target or "")
    if not place:
        return False, "Nowhere by that name."
    if not hasattr(actor, "route_to"):
        return False, "Walk there yourself."
    ok = actor.route_to(world.LANDMARKS[place]["pos"], "go_to", place)
    return ok, f"Heading for {place}." if ok else "No way through."


def follow(game, actor: Actor, target: str | None = None) -> tuple[bool, str]:
    who = game.actor_by_name(target or "")
    if not who or who is actor:
        return False, "Follow who?"
    if not hasattr(actor, "stop"):
        return False, "Walk there yourself."
    actor.stop("follow", who.key)
    return True, f"Staying near {who.short}."


VERBS = {
    "gather": gather, "drink": drink, "eat": eat, "rest": rest,
    "think": think, "emote": emote,
    "deposit": deposit, "take": take, "build": build,
    "give": give, "revive": revive, "board": board,
    "go_to": go_to, "follow": follow,
}

# The verb names offered to the model. Identical to what the player's UI offers.
ACTION_NAMES = list(VERBS.keys())


def perform(game, actor: Actor, action: str, target: str = "") -> tuple[bool, str]:
    fn = VERBS.get((action or "").strip().lower())
    if not fn:
        return False, "Nothing happens."
    return fn(game, actor, target or None)
