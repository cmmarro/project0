"""Actors: the three people on the island.

There is one Actor class. The human player is an Actor. Each castaway is an
Actor with a memory and a language model attached. Everything a body can do —
thirst, hunger, energy, carrying, collapsing — lives here once, so the human and
the two castaways are the same kind of thing to the simulation.
"""

from __future__ import annotations

import math

from . import world


def clamp(v, lo=0.0, hi=100.0):
    return max(lo, min(hi, v))


class Actor:
    is_human = False

    def __init__(self, key: str, name: str, colour: str, pos: tuple[float, float]):
        self.key = key
        self.name = name
        self.short = name.split()[0]
        self.colour = colour
        self.prompt_name = name      # how others refer to them in prompts
        self.x, self.y = float(pos[0]), float(pos[1])

        self.thirst = 72.0
        self.hunger = 66.0
        self.energy = 80.0
        self.health = 100.0
        self.down = False

        self.inventory: dict[str, int] = {}
        # What this actor is currently doing; the human's is set by their input,
        # a castaway's is set by the model.
        self.task = {"action": "idle", "target": "", "phase": "idle", "timer": 0.0}
        self.path: list[tuple[int, int]] = []

    # -- carrying -------------------------------------------------------------

    def carried(self) -> int:
        return sum(self.inventory.values())

    def give_item(self, item: str, n: int = 1):
        self.inventory[item] = self.inventory.get(item, 0) + n

    def take_item(self, item: str, n: int = 1) -> bool:
        if self.inventory.get(item, 0) < n:
            return False
        self.inventory[item] -= n
        if not self.inventory[item]:
            del self.inventory[item]
        return True

    # -- position -------------------------------------------------------------

    def pos(self) -> tuple[int, int]:
        return int(round(self.x)), int(round(self.y))

    def distance_to(self, other) -> float:
        ox, oy = (other.x, other.y) if hasattr(other, "x") else other
        return math.dist((self.x, self.y), (ox, oy))

    def where(self) -> str:
        return world.describe_position(self.x, self.y)

    # -- body -----------------------------------------------------------------

    def tick_body(self, gm: float, rates: dict[str, float], resting: bool,
                  working: bool, sheltered: bool) -> str | None:
        """Advance hunger/thirst/energy. Returns an event string if they collapse."""
        self.thirst = clamp(self.thirst - rates["thirst"] * gm)
        self.hunger = clamp(self.hunger - rates["hunger"] * gm)

        if resting:
            gain = 0.55 + (0.45 if sheltered else 0.0)
            self.energy = clamp(self.energy + gain * gm)
        else:
            drain = rates["energy"] * gm + (0.22 * gm if working else 0.0)
            self.energy = clamp(self.energy - drain)

        hurt = 0.0
        if self.thirst <= 0:
            hurt += 0.9
        if self.hunger <= 0:
            hurt += 0.45
        if self.energy <= 0:
            hurt += 0.3
        if hurt:
            self.health = clamp(self.health - hurt * gm)
        elif self.thirst > 25 and self.hunger > 25:
            self.health = clamp(self.health + 0.15 * gm)

        was_down = self.down
        self.down = self.health <= 0
        if self.down and not was_down:
            return f"{self.short} has collapsed."
        return None

    def activity_label(self) -> str:
        if self.down:
            return "collapsed"
        a, t = self.task["action"], self.task["target"]
        if self.task["phase"] == "travel":
            return f"walking to {t or 'somewhere'}"
        return {
            "gather": f"gathering at {t}",
            "build": f"working on the {t}",
            "rest": "resting",
            "follow": f"keeping near {t}",
            "deposit": "carrying things back to camp",
        }.get(a, "not doing much")

    def snapshot(self) -> dict:
        return {
            "key": self.key, "name": self.name, "short": self.short, "colour": self.colour,
            "x": round(self.x, 2), "y": round(self.y, 2),
            "thirst": round(self.thirst), "hunger": round(self.hunger),
            "energy": round(self.energy), "health": round(self.health),
            "down": self.down, "inventory": dict(self.inventory),
            "activity": self.activity_label(),
        }


class Player(Actor):
    is_human = True

    def __init__(self, pos):
        super().__init__("player", "You", "#f2c14e", pos)
        self.short = "you"
        # Nobody exchanged names in the water. This is how the castaways
        # refer to you in their own heads and in their prompts.
        self.prompt_name = "the stranger"


class Castaway(Actor):
    """An Actor whose decisions come from the model."""

    SPEED = 2.1

    def __init__(self, person: dict, pos):
        super().__init__(person["key"], person["name"], person["colour"], pos)
        self.short = person["short"]
        self.persona = person["persona"]
        self.persona_short = person.get("persona_short", person["persona"])
        self.traits = person["traits"]
        self.role = person["role"]
        self.pronouns = person["pronouns"]

        self.memories: list[str] = []
        self.trust: dict[str, int] = {}      # actor key -> -15..15
        self.met: set[str] = set()           # actor keys they've made contact with
        self.emotion = "wary"
        self.thought = "alone on the sand, working out where to start"
        # Who they've thrown in with, by actor key. Empty means going it alone.
        # Set by the model each time it re-plans, and it can change.
        self.allies: set[str] = set()

        self.next_plan_at = 0.0
        self.busy = False

    def trait(self, name: str) -> float:
        return self.traits.get(name, 0.5)

    # -- social ---------------------------------------------------------------

    def has_met(self, other: Actor) -> bool:
        return other.key in self.met

    def trust_of(self, other_key: str) -> int:
        return self.trust.get(other_key, 0)

    def adjust_trust(self, other_key: str, delta: int):
        self.trust[other_key] = int(clamp(self.trust_of(other_key) + delta, -15, 15))

    def trust_label(self, other_key: str) -> str:
        v = self.trust_of(other_key)
        if v <= -8:
            return "you have written them off"
        if v <= -3:
            return "you don't trust them"
        if v < 3:
            return "you haven't made your mind up about them"
        if v < 8:
            return "you think they're alright"
        return "you'd trust them with your life"

    def remember(self, note: str):
        note = (note or "").strip()
        if not note:
            return
        self.memories.append(note)
        del self.memories[:-14]

    # -- movement -------------------------------------------------------------

    def walk(self, dt: float):
        if not self.path:
            return
        tx, ty = self.path[0]
        dx, dy = tx - self.x, ty - self.y
        dist = math.hypot(dx, dy)
        step = self.SPEED * dt * (0.6 if self.energy < 20 else 1.0)
        if dist <= step:
            self.x, self.y = float(tx), float(ty)
            self.path.pop(0)
        else:
            self.x += dx / dist * step
            self.y += dy / dist * step

    def route_to(self, goal: tuple[int, int], action: str, target: str) -> bool:
        path = world.find_path(self.pos(), (int(goal[0]), int(goal[1])))
        if not path and self.pos() != (int(goal[0]), int(goal[1])):
            return False
        self.path = path
        self.task = {"action": action, "target": target, "phase": "travel", "timer": 0.0}
        return True

    def stop(self, action: str = "idle", target: str = ""):
        self.path = []
        self.task = {"action": action, "target": target, "phase": "idle", "timer": 0.0}

    def snapshot(self, seen: bool) -> dict:
        base = super().snapshot()
        base.update({
            "emotion": self.emotion,
            "thought": self.thought,
            "busy": self.busy,
            "seen": seen,
            "role": self.role,
            "pronouns": self.pronouns,
            "trust_player": self.trust_of("player"),
            "allies": sorted(self.allies),
        })
        return base
