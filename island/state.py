"""The simulation: an island, however many people it rolled, and whatever they
decide about each other."""

from __future__ import annotations

import contextlib
import math
import queue
import random
import re
import threading
import time

from . import people, verbs, world
from .actors import Castaway, Player, clamp
from .brain import Brain

# --- tuning ------------------------------------------------------------------

TICK = 0.2
GAME_MINUTES_PER_SECOND = 1.5

# How fast the world runs is really a question about how long a mind takes.
# All the survival pacing was tuned against a 2B answering in about the time
# the throttle allows; on a 30B the same conversation costs seven times the
# daylight, purely because you loaded a better model. So the clock is scaled
# by how long the backend actually takes, and the world waits with you.
REFERENCE_CALL = 3.0        # seconds per call the pacing was tuned against
SLOWEST = 0.25              # never crawl below a quarter speed
GATHER_MINUTES = 5
BUILD_MINUTES = 6

PLAN_COOLDOWN = 20          # real seconds between a castaway's unprompted decisions
REFLECT_COOLDOWN = 150      # real seconds between a castaway rewriting what they carry
LIGHT_REFLECT_ABOVE = 6.0   # past this many seconds a call, skip the optional thinking
CONVO_COOLDOWN = 100        # real seconds between castaway-to-castaway conversations
CONVO_TURNS = 4
EARSHOT = 4.5               # who hears you speak
MEET_RADIUS = 2.6           # close enough to make contact
SIGHT = 6.5                 # close enough to see someone you haven't met
MAX_REPLIES = 2             # how many people answer one thing you say out loud

DECAY = {"thirst": 0.09, "hunger": 0.05, "energy": 0.045}

WEATHERS = [
    ("clear", "Clear and bright"),
    ("hot", "Hot and still, no wind at all"),
    ("overcast", "Low grey cloud"),
    ("rain", "Warm rain, coming in sheets"),
    ("storm", "A squall — wind and horizontal rain"),
]

HINTS = [
    "Somewhere {dir}, a gull goes up out of the trees all at once.",
    "There's a print in the wet sand that isn't yours, heading {dir}.",
    "You hear something moving through the undergrowth, {dir} of you.",
    "Faint, {dir}: a sound that could be a voice, or could be the wind in the palms.",
    "A branch has been snapped off clean, {dir}. Not by weather.",
]


def bearing(from_xy, to_xy) -> str:
    dx, dy = to_xy[0] - from_xy[0], to_xy[1] - from_xy[1]
    ns = "north" if dy < -1.5 else "south" if dy > 1.5 else ""
    ew = "east" if dx > 1.5 else "west" if dx < -1.5 else ""
    return (ns + ew) or "close by"


# Nobody exchanged names in the water. Say yours and they'll use it; don't and
# you stay "the stranger" for the whole run.
# Case-insensitive on the lead-in, case-sensitive on the name itself: that's
# what keeps "I'm Jo" apart from "I'm thirsty".
_INTRO = re.compile(
    r"(?i:\b(?:i'?m|i am|my name'?s|my name is|name'?s|they call me|call me|"
    r"the name'?s|the name is))\s+"
    r"([A-Z][A-Za-z'\-]{1,14})\b"
)
_NOT_A_NAME = {
    "Sorry", "Here", "There", "Not", "Just", "Fine", "Ok", "Okay", "Good",
    "Going", "Later", "Thirsty", "Hungry", "Tired", "Alone", "Looking",
    "Trying", "Afraid", "Sure", "Still", "Only", "Really", "Done", "With",
}


def spoken_name(text: str) -> str | None:
    """Pull a self-introduction out of a line the player typed, if there is one."""
    m = _INTRO.search(text or "")
    if not m:
        return None
    name = m.group(1)
    return None if name in _NOT_A_NAME else name


class Conversation:
    """A stand-and-talk conversation, started by the player.

    While one is open the people in it stay put and stop re-planning, so a
    back-and-forth can actually happen instead of your second sentence landing
    on an empty beach. The clock does not stop: standing around talking costs
    everyone the same water it always did, and someone desperate enough will
    walk off mid-sentence.
    """

    def __init__(self, members: list[str]):
        self.members = list(members)          # castaway keys, nearest first
        self.lines: list[dict] = []
        self.thinking: list[str] = []         # who is composing a reply
        self.round = 0
        self.closed = False
        # Talk faster than the model answers and you get two rounds in flight.
        # This makes the second one wait rather than interleave its replies
        # into the middle of the first.
        self.turn = threading.Lock()
        self.running = 0

    def add(self, who: str, name: str, colour: str, text: str, stamp: str,
            kind: str = "speech"):
        self.lines.append({"key": who, "who": name, "colour": colour,
                           "text": text, "t": stamp, "kind": kind})
        del self.lines[:-60]

    def recent(self, n: int = 6) -> list[str]:
        return [l["text"] for l in self.lines[-n:]]


class Game:
    def __init__(self, seed: int | None = None, cast_size: int | None = None):
        self.lock = threading.RLock()
        self.brain = Brain()
        self.seed = world.generate(seed)
        rng = random.Random(self.seed ^ 0x5EED)

        # A fresh cast every run: how many, who they were, and what they're like.
        self.cast = people.generate_cast(rng, cast_size)

        # You wash up at the crate. They are elsewhere on the island, and none
        # of you knows yet that the others exist.
        self.player = Player(world.LANDMARKS["camp"]["pos"])
        taken = [(self.player.x, self.player.y)]
        self.castaways = []
        for person in self.cast:
            spot = world.random_start(rng, taken, min_gap=7.0)
            taken.append(spot)
            self.castaways.append(Castaway(person, spot))
        self.player.inventory.update({"water": 2, "coconut": 1})
        for c in self.castaways:
            c.give_item("water", 1)
        self.actors = [self.player, *self.castaways]
        self.by_key = {a.key: a for a in self.actors}
        self.player_met: set[str] = set()
        # Whose name you know. Symmetrical with theirs: nobody's name is
        # perceived, it's told to you, and until then they're a description.
        self.player_knows: set[str] = set()

        # What is actually left in the ground. Sites run down as they're worked
        # and come back at their own rate, so "who took the timber" is a
        # question with a real answer rather than an inconvenience.
        self.stock: dict[str, dict[str, float]] = {
            site: {item: float(world.renewal(item)[0]) for item in items}
            for site, items in world.HARVEST.items()
        }
        self.stores: dict[str, int] = {"water": 1, "coconut": 2, "cloth": 1}
        self.structures = {
            n: {"done": False, "started": False, "progress": 0, "needed": r["work"], "credit": {}}
            for n, r in verbs.RECIPES.items()
        }

        self.minutes = 7 * 60           # day 1, 07:00
        self.weather_key, self.weather = WEATHERS[0]
        self.next_weather_at = 0.0
        self.next_hint_at = time.time() + 30
        self._warned: set[str] = set()

        self.transcript: list[str] = []
        self.log: list[dict] = []
        self.ending: str | None = None
        self.over = False

        self.jobs: queue.Queue = queue.Queue()
        self.brain_lock = threading.Lock()
        self.next_convo_at = time.time() + 40
        self.last_llm_at = 0.0
        self.conversation: Conversation | None = None
        # Anything you are waiting on. Background thinking gets out of its way:
        # a castaway musing about timber must never be the reason your question
        # sits unanswered for half a minute.
        self.player_waiting = 0

        self.event("You come to on the sand beside a split supply crate. "
                   "The boat is gone. As far as you can tell, so is everyone who was on it.", "system")
        # The seed is fine to show — how many people it rolled is not. Finding
        # out whether you're alone is the first thing the game is about.
        self.event(f"Island {self.seed}. You have no idea whether anyone else made it.", "system")

    # -- clock ----------------------------------------------------------------

    @property
    def day(self) -> int:
        return int(self.minutes // (24 * 60)) + 1

    def clock_str(self) -> str:
        m = int(self.minutes % (24 * 60))
        return f"{m // 60:02d}:{m % 60:02d}"

    def tempo(self) -> float:
        """How fast the world should run, given how slowly the model thinks.

        A call ought to cost roughly the same amount of *game* time on any
        backend. Capped at 1.0 so a fast one can't run the island past the
        pacing everything else was tuned for.
        """
        seen = self.brain.latency
        if not seen or not self.brain.online:
            return 1.0
        return max(SLOWEST, min(1.0, REFERENCE_CALL / seen))

    def is_night(self) -> bool:
        h = (self.minutes % (24 * 60)) / 60
        return h < 6 or h >= 20

    def is_evening(self) -> bool:
        """The dark hours before midnight. Nobody sleeps here — there's no bed
        and no sleep verb — but it's too dark to be much use, which is the only
        time anyone stops for long enough to think."""
        h = (self.minutes % (24 * 60)) / 60
        return 20 <= h < 24

    def is_first_light(self) -> bool:
        h = (self.minutes % (24 * 60)) / 60
        return 6 <= h < 8

    # -- lookups --------------------------------------------------------------

    def other_castaways(self, npc: Castaway) -> list[Castaway]:
        return [c for c in self.castaways if c is not npc]

    def allegiance_phrase(self, npc: Castaway) -> str:
        names = [self.name_for(npc, self.by_key[k])
                 for k in sorted(npc.allies) if k in self.by_key]
        if not names:
            return "alone"
        if len(names) == 1:
            return f"with {names[0]}"
        return "with " + ", ".join(names[:-1]) + f" and {names[-1]}"

    def set_allies(self, npc: Castaway, names) -> bool:
        """Turn the model's list of names into actor keys. Returns True if changed."""
        keys = set()
        for n in (names or []):
            who = self.actor_by_name(str(n))
            if who is not None and who is not npc:
                keys.add(who.key)
        changed = keys != npc.allies
        npc.allies = keys
        return changed

    def factions(self) -> list[list[str]]:
        """Groups of people who name each other as allies. Loners come back alone."""
        groups: list[set[str]] = []
        for c in self.castaways:
            bloc = {c.key} | {k for k in c.allies
                              if k == "player" or (k in self.by_key
                                                   and c.key in getattr(self.by_key[k], "allies", set()))}
            for g in groups:
                if g & bloc:
                    g |= bloc
                    break
            else:
                groups.append(bloc)
        return [sorted(g) for g in groups]

    def actor_by_name(self, name: str):
        n = (name or "").strip().lower()
        if not n:
            return None
        if n in ("player", "you", "the player", "the stranger", "stranger"):
            return self.player
        if self.player.given_name and n == self.player.given_name.lower():
            return self.player
        for a in self.actors:
            if n in (a.key, a.short.lower(), a.name.lower()):
                return a
        return None

    # -- who knows whose name -------------------------------------------------

    def name_for(self, observer, subject) -> str:
        """What ``observer`` calls ``subject``.

        Names are not free. The castaways introduce themselves to each other
        when they meet, but you washed up mute — until you actually tell one of
        them your name, you are "the stranger" in their heads and in their
        prompts.
        """
        if subject is observer:
            return subject.name
        if not subject.is_human:
            return subject.name
        if getattr(observer, "knows_name", None) and "player" in observer.knows_name:
            return self.player.given_name or "the stranger"
        return "the stranger"

    def player_name_for(self, npc) -> str:
        """What you can call them. Their name only once they've told you."""
        if not isinstance(npc, Castaway):
            return npc.short
        return npc.short if npc.key in self.player_knows else npc.look

    def player_learns(self, npc, said: str) -> bool:
        """Did they just say their own name where you could hear it?"""
        if not isinstance(npc, Castaway) or npc.key in self.player_knows:
            return False
        low = (said or "").lower()
        if npc.short.lower() not in low and npc.name.lower() not in low:
            return False
        self.player_knows.add(npc.key)
        self.event(f"{npc.look.capitalize()} is called {npc.name}.", "meeting", npc)
        return True

    def introduce_player(self, name: str, to: list) -> list:
        """The player said their own name out loud. Whoever heard it keeps it."""
        name = name.strip()[:16]
        if not name:
            return []
        first = self.player.given_name is None
        self.player.given_name = name
        learned = []
        for c in to:
            if isinstance(c, Castaway) and "player" not in c.knows_name:
                c.knows_name.add("player")
                c.remember(f"The stranger's name is {name}.", self.day)
                c.adjust_trust("player", 1)
                learned.append(c.short)
        if learned:
            self.event(f"You tell {', '.join(learned)} your name."
                       + (" It's the first thing anyone here has known about you."
                          if first else ""), "meeting")
        return learned

    def nearest_other(self, actor, key=None, radius=2.5, only_down=False):
        named = self.actor_by_name(key) if key else None
        candidates = [named] if named and named is not actor else [a for a in self.actors if a is not actor]
        candidates = [c for c in candidates if c and (c.down if only_down else True)]
        candidates = [c for c in candidates if actor.distance_to(c) <= radius]
        candidates.sort(key=actor.distance_to)
        return candidates[0] if candidates else None

    def match_landmark(self, target: str) -> str | None:
        t = (target or "").strip().lower()
        if t in world.LANDMARKS:
            return t
        for name in world.LANDMARKS:
            if t and (t in name or name in t):
                return name
        return None

    # -- logging --------------------------------------------------------------

    def shown(self, actor) -> str | None:
        """How a name appears to you — theirs only once you've been told it."""
        if actor is None:
            return None
        if isinstance(actor, str):
            return actor
        if getattr(actor, "is_human", False):
            return actor.name
        return self.player_name_for(actor).capitalize()

    def event(self, text: str, kind: str = "world", actor=None):
        # The id matters: the client used to notice new entries by counting
        # them, which stops working the moment the log hits its cap and every
        # poll returns the same length forever.
        self._log_n = getattr(self, "_log_n", 0) + 1
        self.log.append({
            "n": self._log_n,
            "t": f"D{self.day} {self.clock_str()}",
            "kind": kind,
            "who": self.shown(actor),
            "colour": getattr(actor, "colour", None),
            "text": text,
        })
        del self.log[:-150]

    def said(self, actor, line: str):
        self.transcript.append(f"{actor.name}: {line}")
        del self.transcript[:-20]
        # You learn a name the same way they learn yours: somebody says it
        # where you can hear it.
        if not actor.is_human and self.player.distance_to(actor) <= EARSHOT:
            self.player_learns(actor, line)
        self.event(line, "speech", actor)

    # -- social side effects, called from the verb layer -----------------------

    def _witnesses(self, actor, radius=SIGHT):
        return [c for c in self.castaways if c is not actor and c.has_met(actor)
                and c.distance_to(actor) <= radius]

    def notice_sharing(self, actor, count: int):
        for c in self._witnesses(actor):
            c.remember(f"{actor.short} put {count} thing{'s' if count > 1 else ''} into the shared stores.", self.day)
            c.adjust_trust(actor.key, 1)

    def notice_taking(self, actor, item: str):
        for c in self._witnesses(actor):
            c.remember(f"{actor.short} took {world.ITEM_LABEL.get(item, item)} out of the shared stores.", self.day)

    def notice_gift(self, actor, recipient, item: str):
        if isinstance(recipient, Castaway):
            recipient.remember(f"{actor.short} handed me {world.ITEM_LABEL.get(item, item)} without being asked.", self.day)
            recipient.adjust_trust(actor.key, 2)
        for c in self._witnesses(actor):
            if c is not recipient:
                c.remember(f"{actor.short} gave {recipient.short} {world.ITEM_LABEL.get(item, item)}.", self.day)

    def notice_rescue(self, actor, who):
        if isinstance(who, Castaway):
            who.remember(f"I went down, and {actor.short} got water into me. I was not getting up on my own.", self.day)
            who.adjust_trust(actor.key, 5)
        for c in self._witnesses(actor):
            if c is not who:
                c.remember(f"{actor.short} brought {who.short} round after they collapsed.", self.day)
                c.adjust_trust(actor.key, 2)

    # =========================================================================
    # simulation
    # =========================================================================

    def step(self, dt: float):
        with self.lock:
            if self.over:
                return
            gm = dt * GAME_MINUTES_PER_SECOND * self.tempo()
            self.minutes += gm
            self._weather(gm)
            self._regrow(gm)
            self._bodies(gm)
            for npc in self.castaways:
                self._advance(npc, dt, gm)
            self._contacts()
            self._first_light()
            self._check_conversation()
            self._warnings()
            self._hints()
            self._schedule()
            if self.player.down and not self.over:
                self.finish("You go down on the sand and don't get back up. "
                            "Whatever the others make of the island, they'll make it without you.")

    def take_from_ground(self, site: str, items: list[str]) -> str | None:
        """Pull one unit out of a site, if there's any left. None if picked clean."""
        left = self.stock.get(site)
        if left is None:
            return random.choice(items)          # a site with no stock model
        have = [i for i in items if left.get(i, 0) >= 1]
        if not have:
            return None
        item = random.choice(have)
        left[item] -= 1
        return item

    def depleted(self) -> list[str]:
        """Sites with nothing left in them right now."""
        return [site for site, left in self.stock.items()
                if not any(v >= 1 for v in left.values())]

    def _regrow(self, gm: float):
        for site, left in self.stock.items():
            for item, amount in left.items():
                cap, rate = world.renewal(item)
                if rate and amount < cap:
                    left[item] = min(cap, amount + rate * gm)

    def _weather(self, gm: float):
        now = time.time()
        if now >= self.next_weather_at:
            self.next_weather_at = now + random.uniform(90, 180)
            key, desc = random.choice(WEATHERS)
            if key != self.weather_key:
                self.weather_key, self.weather = key, desc
                self.event(desc + ".", "weather")
        if self.weather_key == "rain" and self.structures["still"]["done"] and random.random() < gm * 0.05:
            self.stores["water"] = self.stores.get("water", 0) + 1

    def _rates(self) -> dict[str, float]:
        r = dict(DECAY)
        if self.weather_key == "hot":
            r["thirst"] *= 1.5
        if self.weather_key in ("rain", "storm"):
            r["thirst"] *= 0.7
            r["energy"] *= 1.2
        if self.is_night():
            r["energy"] *= 1.3
            if not self.structures["fire"]["done"]:
                r["energy"] *= 1.3
        return r

    def _bodies(self, gm: float):
        r = self._rates()
        sheltered = self.structures["shelter"]["done"]
        for a in self.actors:
            resting = a.task["action"] == "rest"
            working = a.task["phase"] == "work"
            near_camp = a.distance_to(world.LANDMARKS["camp"]["pos"]) <= verbs.CAMP_RADIUS
            msg = a.tick_body(gm, r, resting, working, sheltered and near_camp)
            if msg:
                self.event(msg + (" Water might bring them round." if not a.is_human else ""), "alert", a)

    # -- castaway task execution ---------------------------------------------

    def _advance(self, npc: Castaway, dt: float, gm: float):
        # Everything they were told fades at the same rate whatever they're
        # doing, including lying on the sand.
        npc.mind.fade(gm)
        if npc.down:
            npc.stop()
            return

        # Keeping yourself alive overrides whatever you last decided to do.
        if npc.thirst < 14 and npc.inventory.get("water"):
            verbs.drink(self, npc)
        elif npc.hunger < 14 and (npc.inventory.get("coconut") or npc.inventory.get("fish")):
            verbs.eat(self, npc)

        # Standing in a conversation. Whatever they agreed to do is queued up
        # in npc.task and waiting; it starts the moment the talking stops.
        if npc.held:
            return

        t = npc.task
        if t["phase"] == "travel":
            npc.walk(dt)
            if not npc.path:
                if t["action"] in ("gather", "build"):
                    t["phase"], t["timer"] = "work", 0.0
                else:
                    ok, _ = verbs.perform(self, npc, t["action"], t["target"]) \
                        if t["action"] in ("take", "deposit", "board") else (True, "")
                    npc.stop()
                    self.take_next_step(npc)
            return

        if t["phase"] == "work":
            t["timer"] += gm
            threshold = GATHER_MINUTES if t["action"] == "gather" else BUILD_MINUTES
            if t["timer"] >= threshold:
                t["timer"] = 0.0
                ok, _ = verbs.perform(self, npc, t["action"], t["target"])
                if not ok:
                    npc.stop()
                    self.take_next_step(npc)
                elif t["action"] == "gather" and npc.carried() >= 7:
                    # Hands full. If they said what came next, that's what
                    # comes next; otherwise the old haul-it-back reflex.
                    npc.stop()
                    if not self.take_next_step(npc) and npc.allies:
                        npc.thought = "hauling this back to camp"
                        npc.route_to(world.LANDMARKS["camp"]["pos"], "deposit", "camp")
                elif t["action"] == "build" and self.structures[t["target"]]["done"]:
                    npc.stop()
                    self.take_next_step(npc)
            return

        if t["action"] == "follow":
            who = self.actor_by_name(t["target"])
            if who and npc.distance_to(who) > 2.4:
                path = world.find_path(npc.pos(), who.pos())
                if path:
                    npc.path = path
                    t["phase"] = "travel"
                    t["action"], t["target"] = "follow", t["target"]

    def queue_next(self, npc: Castaway, action: str, target: str):
        """Hold the one step they said comes after this one.

        One, not a list. A queue of five deep goes stale faster than anyone can
        walk across this island, and a small model will follow it off a cliff
        rather than notice. One step covers "fill up, then bring it back",
        which is most of what anybody here actually intends.
        """
        action = (action or "").strip().lower()
        if action in ("", "idle", "keep_doing") or action not in verbs.VERBS:
            npc.then = None
            return
        npc.then = (action, (target or "").strip().lower())

    def take_next_step(self, npc: Castaway) -> bool:
        """Finished something. Do the thing they said came after it, if it still
        makes sense — nothing has happened since to make them reconsider."""
        if not npc.then or npc.down or npc.held:
            return False
        action, target = npc.then
        npc.then = None
        self.apply_intent(npc, action, target, queued=True)
        return npc.task["phase"] != "idle" or npc.task["action"] != "idle"

    def apply_intent(self, npc: Castaway, action: str, target: str, queued: bool = False):
        """Turn a model's chosen verb into motion + execution."""
        action = (action or "").strip().lower()
        target = (target or "").strip().lower()
        if action in ("", "keep_doing"):
            return
        # Having just decided something, give them time to actually do it before
        # they reconsider — otherwise a queued plan can overwrite an agreement
        # a second after it was made.
        npc.next_plan_at = max(npc.next_plan_at, time.time() + PLAN_COOLDOWN)
        # Anything they decide fresh replaces what they'd lined up. Talking to
        # someone is exactly the thing that should throw out yesterday's plan.
        if not queued:
            npc.then = None
        if action == "idle":
            npc.stop()
            return

        if action == "gather":
            place = self.match_landmark(target) or world.landmark_at(npc.x, npc.y, radius=2.8)
            if place and place in world.HARVEST:
                npc.route_to(world.LANDMARKS[place]["pos"], "gather", place)
            return

        if action == "go_to":
            place = self.match_landmark(target)
            if place:
                npc.route_to(world.LANDMARKS[place]["pos"], "go_to", place)
            return

        if action in ("build", "take", "deposit", "board"):
            if action == "build" and target not in verbs.RECIPES:
                return
            at_camp = npc.distance_to(world.LANDMARKS["camp"]["pos"]) <= verbs.CAMP_RADIUS
            if at_camp:
                if action == "build":
                    npc.task = {"action": "build", "target": target, "phase": "work", "timer": 0.0}
                else:
                    verbs.perform(self, npc, action, target)
                    npc.stop()
            else:
                npc.route_to(world.LANDMARKS["camp"]["pos"], action, target)
            return

        verbs.perform(self, npc, action, target)
        if action == "rest":
            npc.stop("rest")

    def witness_emote(self, actor, kind: str, spec: dict, where: str = "") -> tuple[bool, str]:
        """Work out who saw or heard it, and what it did to them.

        A scream reaches twenty tiles, which is most of the island and four
        times what a sentence reaches. That's the point of it: it is the only
        thing in the game that can reach somebody you have not found yet, and
        the price is that everyone else finds out where you are too.
        """
        reach, heard = spec["range"], spec.get("heard")
        # A beckon that names somewhere is the one gesture that carries
        # information: "not here — over there." Without a place it means
        # "come to me", which is the place they're standing.
        place = self.match_landmark(where) if where else None
        if kind == "beckon" and not place:
            place = world.landmark_at(actor.x, actor.y, radius=4.0)
        # A scream is an event on the island, not a gesture. It reads as one.
        said = spec["does"].format(a=actor.short)
        if kind == "beckon" and place:
            said = f"{actor.short} beckons — come to {place}."
        # "you screams" — the third-person phrasing doesn't fit the one actor
        # whose short name is "you".
        if actor.is_human:
            said = spec["self"] if kind != "beckon" or not place \
                else f"You beckon them to {place}."
        self.event(said, "alert" if heard else "emote", actor)

        for other in self.actors:
            if other is actor:
                continue
            gap = actor.distance_to(other)
            if gap > reach:
                continue
            close = gap <= SIGHT
            if not isinstance(other, Castaway):
                # It's the player: they read it in the log. A distant scream
                # should tell them which way to walk, though.
                if heard and not close:
                    self.event(f"A scream, {bearing((self.player.x, self.player.y), (actor.x, actor.y))} "
                               "of you. Someone is out there, and they are not alright.", "hint")
                continue
            if not close and not heard:
                continue
            if other.has_met(actor):
                if kind == "beckon" and place:
                    # Information, not an order. They still decide.
                    other.remember(f"{actor.short} wants me at {place}.", self.day, weight=1.3)
                    other.next_plan_at = 0.0
                else:
                    other.remember(said, self.day)
                if spec["trust"]:
                    other.adjust_trust(actor.key, spec["trust"])
            elif heard:
                # They don't know who it is. They know somebody is there.
                other.remember("Somebody screamed, off "
                               f"{bearing((other.x, other.y), (actor.x, actor.y))} of me. "
                               "I am not alone on this island.", self.day, weight=1.5)
                other.next_plan_at = 0.0
        return True, spec["self"]

    def player_recap(self) -> dict:
        """The player's version of going back over everything.

        A castaway's memory is lossy and has to be dug through; yours is the
        log, which is perfect and far too long to read. So this is the same
        act with the same cost in time — stop walking, spend the energy — and
        what it gives back is the shape of things rather than the transcript.
        """
        people = []
        for c in self.castaways:
            if c.key not in self.player_met:
                continue
            met = c.met_on.get("player")
            people.append({
                "name": c.name, "short": c.short, "colour": c.colour,
                "role": c.role, "pronouns": c.pronouns,
                "met_on": met, "down": c.down,
                "feeling": c.trust_label("player"),
                "allegiance": self.allegiance_phrase(c),
                "knows_you": "player" in c.knows_name,
                "doing": c.activity_label(),
                # Only what they have actually said or shown you. Their
                # standing notes are their own business.
                "last_heard": next((t.split(": ", 1)[1] for t in reversed(self.transcript)
                                    if t.startswith(c.name + ":")), None),
            })

        need = verbs.RECIPES["raft"]["cost"]
        raft = self.structures["raft"]
        keep = {"meeting", "danger", "alert", "allegiance", "ending", "reflection"}
        return {
            "day": self.day, "clock": self.clock_str(), "night": self.is_night(),
            "your_name": self.player.given_name,
            "people": people,
            "unmet": len(self.castaways) - len(people),
            "raft": {
                "short": {k: v - self.stores.get(k, 0) for k, v in need.items()
                          if v > self.stores.get(k, 0)},
                "work": raft["progress"], "needed": raft["needed"],
                "seats": verbs.RAFT_CAPACITY, "people": len(self.castaways) + 1,
            },
            # Who put the hours in, on everything. The ledger is the only thing
            # that can catch somebody out in what they said they'd do.
            "ledger": [
                {"name": n, "done": st["done"],
                 "by": [{"who": self.by_key[k].short if k != "player" else "you",
                         "colour": self.by_key[k].colour, "sessions": v}
                        for k, v in sorted(st["credit"].items(), key=lambda kv: -kv[1])
                        if k in self.by_key]}
                for n, st in self.structures.items() if st["started"]
            ],
            "ground": {site: {i: int(v) for i, v in left.items()}
                       for site, left in self.stock.items()},
            "built": [n for n, st in self.structures.items() if st["done"]],
            "stores": dict(self.stores),
            "notable": [e for e in self.log if e["kind"] in keep][-14:],
        }

    def stop_and_think(self, actor) -> tuple[bool, str]:
        """The think verb, for whoever used it.

        A castaway stops walking and gets the whole memory bank in front of the
        model instead of the strongest six — which is the only way any of it
        gets used, and the reason ordinary turns can stay cheap.

        You get the same verb. You already have perfect recall, so for you it's
        a recap rather than a model call: same act, same cost in time, and it
        keeps the verb table honest.
        """
        if actor.is_human:
            self.event("You stop and go back over it.", "reflection")
            return True, "recap"

        actor.stop("think")
        actor.wants_to_think = True
        self.event(f"{actor.short} stops, and stands there working something out.",
                   "reflection", actor)
        return True, "Standing and thinking."

    # -- meeting people -------------------------------------------------------

    def _contacts(self):
        for i, a in enumerate(self.actors):
            for b in self.actors[i + 1:]:
                if a.distance_to(b) > MEET_RADIUS or a.down or b.down:
                    continue
                self._make_contact(a, b)

    def _make_contact(self, a, b):
        pair_known = self._knows(a, b) and self._knows(b, a)
        if pair_known:
            return
        self._mark_met(a, b)
        self._mark_met(b, a)
        if a.is_human or b.is_human:
            npc = b if a.is_human else a
            subj = npc.pronouns.split("/")[0]
            verb = "are" if subj == "they" else "is"
            self.event(f"You come face to face with a stranger. {subj.capitalize()} {verb} "
                       "looking at you like you might not be real.", "meeting", npc)
            if not npc.busy:
                npc.busy = True
                self.jobs.put(("first_contact", npc.key, self.player.key))
        else:
            self.event(f"{a.short} and {b.short} have found each other.", "meeting")
            if not a.busy and not b.busy:
                a.busy = b.busy = True
                self.jobs.put(("first_contact", a.key, b.key))

    def _knows(self, a, b) -> bool:
        if a.is_human:
            return b.key in self.player_met
        return a.has_met(b)

    def _mark_met(self, a, b):
        if a.is_human:
            self.player_met.add(b.key)
            return
        a.met.add(b.key)
        a.met_on[b.key] = self.day
        # Two castaways swap names when they meet — that's what people do. The
        # player has to actually say theirs, so it isn't learned here.
        if not b.is_human:
            a.knows_name.add(b.key)

    def _warnings(self):
        """Tell the player they're dying before they are dead."""
        p = self.player
        water = next((n for n, items in world.HARVEST.items() if "water" in items), "the spring")
        checks = [
            ("thirst30", p.thirst < 30 and p.thirst > 0,
             f"You're badly thirsty. There's water at {water} — "
             + (f"{self._bearing_to(water)} of you. " if self._bearing_to(water) else "")
             + "Stand there and press E, then press Q to drink."),
            ("thirst0", p.thirst <= 0,
             "You have no water left and it is starting to kill you. Get to "
             f"{water} now."),
            ("hunger25", p.hunger < 25, "You're very hungry. Coconuts are at the palm grove; press E there, then F."),
            ("energy20", p.energy < 20, "You're exhausted. Press R to rest for a while."),
        ]
        for key, hit, text in checks:
            if hit and key not in self._warned:
                self._warned.add(key)
                self.event(text, "danger")
            elif not hit and key in self._warned and not key.endswith("0"):
                self._warned.discard(key)

    def _bearing_to(self, place: str) -> str:
        data = world.LANDMARKS.get(place)
        if not data:
            return ""
        b = bearing((self.player.x, self.player.y), data["pos"])
        return "" if b == "close by" else b

    def player_context(self) -> dict:
        """What's under the player's feet and what they should press."""
        p = self.player
        here = world.landmark_at(p.x, p.y, radius=2.8)
        items = world.HARVEST.get(here or "")
        where = f"At {here}" if here else world.describe_position(p.x, p.y).capitalize()

        if p.down:
            return {"where": "You've collapsed", "advice": "Someone would have to get water into you.",
                    "urgent": True}

        bits = []
        if items:
            bits.append(f"<b>E</b> to gather {'/'.join(items)}")
        if p.inventory.get("water"):
            bits.append("<b>Q</b> to drink")
        if any(p.inventory.get(f) for f in ("coconut", "fish")):
            bits.append("<b>F</b> to eat")
        if here == "camp":
            bits.append("build and store things here")
        if not bits:
            water = next((n for n, i in world.HARVEST.items() if "water" in i), None)
            if water:
                b = self._bearing_to(water)
                bits.append(f"nothing here — water is at {water}" + (f", {b}" if b else ""))

        urgent = p.thirst < 30 or p.hunger < 20 or p.health < 50
        if p.thirst < 30 and not p.inventory.get("water"):
            water = next((n for n, i in world.HARVEST.items() if "water" in i), "the spring")
            b = self._bearing_to(water)
            bits.insert(0, f"<b>you need water</b> — {water}" + (f" is {b}" if b else ""))
        return {"where": where, "advice": " · ".join(bits), "urgent": urgent}

    def _hints(self):
        now = time.time()
        if now < self.next_hint_at:
            return
        unmet = [c for c in self.castaways if c.key not in self.player_met]
        close = [c for c in unmet if self.player.distance_to(c) <= 9.5]
        if not close:
            self.next_hint_at = now + 12
            return
        c = min(close, key=self.player.distance_to)
        self.next_hint_at = now + random.uniform(25, 45)
        self.event(random.choice(HINTS).format(
            dir=bearing((self.player.x, self.player.y), (c.x, c.y))), "hint")

    # -- scheduling model calls ----------------------------------------------

    def _schedule(self):
        now = time.time()
        # Never let the backlog outgrow the cast. A queue of stale intentions is
        # worse than none: by the time they run, the world has moved on.
        if self.player_waiting or self.jobs.qsize() > len(self.castaways):
            return
        for npc in self.castaways:
            if npc.down or npc.busy or npc.held:
                continue
            # They asked for it themselves, so it jumps the queue and it gets
            # everything they have rather than the strongest handful.
            if npc.wants_to_think:
                npc.wants_to_think = False
                npc.busy = True
                self.jobs.put(("reflect", npc.key, False, True))
                continue
            # Somebody may start something with *you*. They had no way to do
            # that before — every conversation in the game was one you opened,
            # which made them furniture that answers. It comes before planning
            # deliberately: standing next to a person, you speak to them rather
            # than wander off to fetch timber.
            if (now >= self.next_convo_at and not self.conversation
                    and npc.has_met(self.player) and not self.player.down
                    and self.player.distance_to(npc) <= EARSHOT):
                self.next_convo_at = now + CONVO_COOLDOWN
                npc.busy = True
                self.jobs.put(("approach", npc.key))
                continue

            stopped = npc.task["phase"] == "idle" or npc.task["action"] == "rest"
            # Once in the dark hours, if they've actually stopped, they go over
            # the day and decide what of it they're keeping. The window is the
            # evening rather than all of "night" so the date can't roll over
            # underneath it at midnight — and anyone still hauling timber at
            # ten at night simply doesn't get to think, which is its own kind
            # of true.
            if (self.is_evening() and stopped and npc.consolidated_on != self.day
                    and len(npc.mind.working) >= 2):
                npc.consolidated_on = self.day
                npc.next_reflect_at = now + REFLECT_COOLDOWN
                npc.busy = True
                self.jobs.put(("reflect", npc.key, True, False))
                continue
            # And a lighter pass any time they sit down for a breather — the
            # first thing to drop when a call is expensive, since it's the only
            # thinking in the game that nothing else depends on.
            if (self.brain.latency <= LIGHT_REFLECT_ABOVE
                    and npc.task["action"] == "rest" and now >= npc.next_reflect_at
                    and len(npc.mind.working) >= 3):
                npc.next_reflect_at = now + REFLECT_COOLDOWN
                npc.busy = True
                self.jobs.put(("reflect", npc.key, False, False))
                continue
            idle = npc.task["phase"] == "idle" and npc.task["action"] in ("idle", "rest", "follow")
            if idle and now >= npc.next_plan_at:
                npc.next_plan_at = now + self.think_gap()
                npc.busy = True
                self.jobs.put(("plan", npc.key))

        if now < self.next_convo_at or self.conversation:
            return
        for i, a in enumerate(self.castaways):
            for b in self.castaways[i + 1:]:
                if (not a.busy and not b.busy and not a.down and not b.down
                        and not a.held and not b.held
                        and a.has_met(b) and a.distance_to(b) <= 3.5):
                    self.next_convo_at = now + CONVO_COOLDOWN
                    a.busy = b.busy = True
                    self.jobs.put(("convo", a.key, b.key))
                    return

    # =========================================================================
    # worker-thread jobs
    # =========================================================================

    def think_gap(self) -> float:
        """How long between one castaway's unprompted model calls.

        Every model call in the game goes through one lock, so scheduling more
        of them than the backend can answer doesn't make anyone livelier — it
        builds a permanent queue that everything else waits behind. At three
        seconds a call the old fixed twenty was fine. At thirty, four castaways
        were offering twelve calls a minute against two served, and the backlog
        grew forever. So the gap scales with how long a mind actually takes.
        """
        return max(PLAN_COOLDOWN,
                   max(self.brain.latency, 0.5) * (len(self.castaways) + 1))

    def _yield_to_player(self, limit: float = 25.0):
        """Hold a background call while the player is waiting on one."""
        until = time.time() + limit
        while self.player_waiting > 0 and time.time() < until and not self.over:
            time.sleep(0.1)

    def _throttle(self):
        wait = 3.0 - (time.time() - self.last_llm_at)
        if wait > 0:
            time.sleep(wait)
        self.last_llm_at = time.time()

    @contextlib.contextmanager
    def player_first(self):
        """Mark a call as one you're sat waiting for, and take the lock."""
        with self.lock:
            self.player_waiting += 1
        try:
            with self.brain_lock:
                self._throttle()
                yield
        finally:
            with self.lock:
                self.player_waiting -= 1

    def run_job(self, job):
        try:
            self._yield_to_player()
            kind = job[0]
            if kind == "plan":
                self._job_plan(self.by_key[job[1]])
            elif kind == "convo":
                self._job_convo(self.by_key[job[1]], self.by_key[job[2]])
            elif kind == "first_contact":
                self._job_first_contact(self.by_key[job[1]], self.by_key[job[2]])
            elif kind == "approach":
                self._job_approach(self.by_key[job[1]])
            elif kind == "reflect":
                self._job_reflect(self.by_key[job[1]], job[2], job[3])
        finally:
            with self.lock:
                for npc in self.castaways:
                    npc.busy = False

    def _job_plan(self, npc: Castaway):
        with self.brain_lock:
            self._throttle()
            out = self.brain.plan(npc, self)
        with self.lock:
            was = npc.thought
            npc.thought = (out.get("thought") or npc.thought)[:120]
            npc.emotion = out.get("emotion", npc.emotion)
            aim = (out.get("aim") or "").strip()[:110]
            if aim and aim != npc.aim:
                npc.aim = aim
                self.event(f"{npc.short} is set on: {aim}", "aim", npc)
            self.queue_next(npc, out.get("then_action", ""), out.get("then_target", ""))
            if self.set_allies(npc, out.get("working_with")):
                self.event(f"{npc.short} is working {self.allegiance_phrase(npc)}.", "allegiance", npc)
            self.apply_intent(npc, out.get("action", ""), out.get("target", ""))
            # A small model will produce the same thought five times running.
            # Once is atmosphere; five times is the log unreadable.
            if npc.thought != was:
                self.event(npc.thought, "thought", npc)

    def _job_approach(self, npc: Castaway):
        """They come over and say something to you, unprompted.

        Not a modal — you might be halfway up a hill. It lands in the log like
        anything else said near you, and if you want to make something of it,
        the conversation verb is right there.
        """
        with self.lock:
            if self.player.distance_to(npc) > EARSHOT or self.player.down:
                return
            topic = self._pick_topic(npc, npc)
        with self.brain_lock:
            self._throttle()
            out = self.brain.opener(npc, self, self.player, topic)
        with self.lock:
            npc.emotion = out.get("emotion", npc.emotion)
            line = (out.get("say") or "").strip()
            if not line or self.player.distance_to(npc) > EARSHOT:
                return
            self.event(f"{self.player_name_for(npc).capitalize()} comes over to you.",
                       "meeting", npc)
            self.said(npc, line)
            # If you're already standing talking, it belongs in that thread.
            convo = self.conversation
            if convo and npc.key in convo.members:
                convo.add(npc.key, self.player_name_for(npc), npc.colour, line,
                          f"D{self.day} {self.clock_str()}")

    def _job_reflect(self, npc: Castaway, night: bool = True, deliberate: bool = False):
        # Nightly consolidation and a deliberate think are never skipped: the
        # standing notes depend on them. Only the idle daytime musing goes.
        """They stop, go back over what's happened, and decide what they keep."""
        with self.brain_lock:
            self._throttle()
            out = self.brain.reflect(npc, self, night=night, deliberate=deliberate)
        with self.lock:
            before = list(npc.mind.standing)
            notes = npc.mind.set_standing(out.get("notes"))
            npc.emotion = out.get("emotion", npc.emotion)
            if notes and notes != before:
                new = [n for n in notes if n not in before]
                where = "sits in the dark a long while" if night else "sits a while"
                self.event(
                    f"{npc.short} {where}. " +
                    (f"Something has settled: {new[0]}" if new
                     else "Something has settled."), "reflection", npc)
            # Whatever joined up in the dark, they have it by morning. It is
            # held until first light rather than announced at 22:00, because
            # nobody is awake to hear it and it reads better as something
            # they've come down with.
            if night:
                npc.waking = out.get("realisation", "") or ""
            elif deliberate:
                # They stopped on purpose, so whatever they worked out lands
                # now — and the very next decision is made in light of it.
                got = out.get("realisation", "") or ""
                if got:
                    npc.thought = got[:120]
                    npc.mind.remember(got, self.day, weight=1.6)
                    self.event(f"{npc.short} has it: {got}", "reflection", npc)
                npc.next_plan_at = 0.0

    def _first_light(self):
        """Deliver what the dark hours turned up, once it's light enough to act."""
        if not self.is_first_light():
            return
        for npc in self.castaways:
            if not npc.waking or npc.down:
                continue
            line, npc.waking = npc.waking, ""
            npc.thought = line[:120]
            npc.mind.remember(line, self.day, weight=1.6)
            npc.next_plan_at = 0.0        # act on it rather than finish yesterday
            self.event(f"{npc.short} has come down to the water with something "
                       f"worked out: {line}", "reflection", npc)

    def _job_first_contact(self, npc: Castaway, other):
        with self.brain_lock:
            self._throttle()
            out = self.brain.first_contact(npc, self, other)
        with self.lock:
            npc.emotion = out.get("emotion", npc.emotion)
            line = (out.get("say") or "").strip()
            if line:
                self.said(npc, line)
            npc.remember(f"I met {other.name} on day {self.day}. Up to then I thought I was alone here.", self.day)

    def _pick_topic(self, a: Castaway, b: Castaway) -> str:
        """Something true about right now that a person might raise.

        These used to be dramatic prompts — "the fact that the raft seats two
        and there are three of you, which neither of you has said out loud
        yet". That was the author leaning on the scale: manufacturing the
        scene rather than the situation. Every option here is now a fact about
        the world state, and it's their business what to make of it.
        """
        options = []
        gone = self.depleted()
        if gone:
            options.append(f"{' and '.join(gone)} being picked clean")
        short = [k for k, v in verbs.RECIPES["raft"]["cost"].items()
                 if self.stores.get(k, 0) < v]
        if short:
            options.append(f"the raft still wanting {', '.join(short)}")
        if min(a.thirst, b.thirst) < 45 or self.stores.get("water", 0) == 0:
            options.append("water, and how little of it either of you is carrying")
        for name, st in self.structures.items():
            if st["started"] and not st["done"]:
                who = sorted(st["credit"].items(), key=lambda kv: -kv[1])
                if who:
                    top = self.by_key.get(who[0][0])
                    if top is not None:
                        options.append(
                            f"the {name}, and the fact that {self.name_for(a, top)} has "
                            f"put {who[0][1]} sessions into it")
        if not self.structures["fire"]["done"]:
            options.append("there being no fire yet, with the dark coming again")
        if "player" in a.met and a.trust_of("player") != 0:
            options.append("what you make of the stranger")
        if a.mind.standing:
            options.append(f"something you've decided: {a.mind.standing[0]}")
        if a.memories:
            options.append(f"something sitting with you: {a.memories[-1]}")
        return random.choice(options) if options else "how the day went"

    def _job_convo(self, a: Castaway, b: Castaway):
        with self.lock:
            topic = self._pick_topic(a, b)

        with self.brain_lock:
            self._throttle()
            out = self.brain.opener(a, self, b, topic)
        with self.lock:
            a.emotion = out.get("emotion", a.emotion)
            line = (out.get("say") or "").strip()
            if not line:
                return
            self.said(a, line)
            last, speaker, listener = line, b, a
            spoken = [line]

        for _ in range(CONVO_TURNS - 1):
            with self.lock:
                if speaker.down or listener.down or self.over or speaker.held or listener.held:
                    return
                heard = list(self.transcript[-3:])
            with self.brain_lock:
                self._throttle()
                out = self.brain.speak(speaker, self, listener.name, last, heard,
                                       avoid=spoken)
            with self.lock:
                line = (out.get("say") or "").strip()
                if not line:
                    break
                spoken.append(line)
                speaker.emotion = out.get("emotion", speaker.emotion)
                speaker.remember(out.get("memory", ""), self.day)
                speaker.adjust_trust(listener.key, int(out.get("trust_speaker", 0) or 0))
                self.said(speaker, line)
                self.apply_intent(speaker, out.get("action", ""), out.get("target", ""))
                last = line
                speaker, listener = listener, speaker

    # =========================================================================
    # talking to people
    # =========================================================================

    def in_earshot(self) -> list[Castaway]:
        near = [c for c in self.castaways
                if not c.down and c.has_met(self.player)
                and self.player.distance_to(c) <= EARSHOT]
        near.sort(key=self.player.distance_to)
        return near

    # -- a proper conversation, where people stand still ----------------------

    def conversation_start(self, who: str | None = None) -> dict:
        """Get somebody to stop and talk. Everyone in earshot if you ask for it."""
        with self.lock:
            if self.over or self.player.down:
                return {"ok": False, "error": "Not now."}
            # Starting a second one without ending the first would leave the
            # first group held in place with nobody talking to them, forever.
            if self.conversation:
                self.conversation_end(None)
            near = self.in_earshot()
            if not near:
                return {"ok": False, "error": "Nobody is close enough to talk to."}
            if who:
                target = self.actor_by_name(who)
                near = [c for c in near if c is target] or near[:1]
            convo = Conversation([c.key for c in near])
            for c in near:
                c.held = True
            self.conversation = convo
            names = " and ".join(c.short for c in near)
            self.event(f"You get {names} to stop and talk."
                       + (" Everyone stands there while the light goes."
                          if len(near) > 1 else ""), "meeting")
            return self.conversation_snapshot()

    def conversation_invite(self, who: str) -> dict:
        with self.lock:
            convo = self.conversation
            target = self.actor_by_name(who)
            if not convo or not isinstance(target, Castaway):
                return self.conversation_snapshot()
            if (target.key not in convo.members and not target.down
                    and target.has_met(self.player)
                    and self.player.distance_to(target) <= EARSHOT):
                convo.members.append(target.key)
                target.held = True
                self.event(f"{target.short} comes over and joins it.", "meeting")
            return self.conversation_snapshot()

    def conversation_end(self, reason: str = "") -> dict:
        with self.lock:
            convo, self.conversation = self.conversation, None
            if convo:
                convo.closed = True
                now = time.time()
                for k in convo.members:
                    npc = self.by_key.get(k)
                    if isinstance(npc, Castaway):
                        npc.held = False
                        # Whatever they agreed to, let them get on with it before
                        # the planner second-guesses them.
                        npc.next_plan_at = max(npc.next_plan_at, now + PLAN_COOLDOWN)
                if reason is not None:
                    self.event(reason or "You break it up and everyone goes back to it.",
                               "system")
            return {"ok": True, "conversation": None}

    def _check_conversation(self):
        """Somebody dying of thirst does not stand there being talked at."""
        convo = self.conversation
        if not convo:
            return
        for k in list(convo.members):
            npc = self.by_key.get(k)
            if not isinstance(npc, Castaway):
                continue
            desperate = npc.thirst <= 6 and not npc.inventory.get("water")
            if npc.down or desperate or self.player.distance_to(npc) > EARSHOT + 3:
                convo.members.remove(k)
                npc.held = False
                npc.next_plan_at = 0.0
                self.event(
                    f"{npc.short} has stopped listening — "
                    + ("collapsed." if npc.down else
                       "walks off mid-sentence. There's only so long you can talk about water."),
                    "alert", npc)
        if not convo.members:
            self.conversation_end("You're talking to nobody.")

    def conversation_say(self, text: str) -> dict:
        """Add your line and set the room replying. Returns straight away."""
        text = (text or "").strip()[:400]
        with self.lock:
            convo = self.conversation
            if not convo:
                return {"ok": False, "error": "You're not talking to anybody."}
            if text:
                members = [self.by_key[k] for k in convo.members if k in self.by_key]
                name = spoken_name(text)
                if name:
                    self.introduce_player(name, members)
                self.said(self.player, text)
                convo.add("player", "You", self.player.colour, text,
                          f"D{self.day} {self.clock_str()}")
            convo.round += 1
            convo.running += 1
            convo.thinking = [m.key for m in self.who_answers(convo, text)]
        threading.Thread(target=self._conversation_round, args=(convo, text), daemon=True).start()
        return self.conversation_snapshot()

    def _conversation_round(self, convo: Conversation, text: str):
        """Everyone in the room answers, in turn, hearing what came before."""
        try:
            with convo.turn:
                self._one_round(convo, text)
        except Exception as exc:
            self.brain.last_error = f"conversation: {type(exc).__name__}: {exc}"
        finally:
            with self.lock:
                convo.running -= 1
                # Only the last round in flight clears the indicator, or a
                # queued second round would look like nobody was answering.
                if convo.running <= 0:
                    convo.thinking = []

    def who_answers(self, convo: Conversation, text: str) -> list[Castaway]:
        """Who actually speaks up.

        Everybody answering every line was wrong twice over. It's unnatural —
        real groups have one person answer and the others chime in — and it
        cost a model call per person per line, which on a local backend is the
        difference between a conversation and a wait.

        Name somebody and it's them. Otherwise whoever you're closest to takes
        it, and the others speak up only if they're the sort who would.
        """
        members = [self.by_key[k] for k in convo.members if k in self.by_key]
        if not members:
            return []
        low = f" {(text or '').lower()} "
        named = [m for m in members
                 if f" {m.short.lower()}" in low or f" {m.name.lower()}" in low]
        if named:
            return named
        members.sort(key=self.player.distance_to)
        answering = [members[0]]
        for other in members[1:]:
            # Boldness is what makes someone answer a question that wasn't
            # aimed at them.
            if random.random() < 0.18 + 0.30 * other.trait("boldness"):
                answering.append(other)
        return answering

    def _one_round(self, convo: Conversation, text: str):
        with self.lock:
            members = self.who_answers(convo, text)
            convo.thinking = [m.key for m in members]
            everyone = [self.by_key[k] for k in convo.members if k in self.by_key]
            group = ([self.name_for(everyone[0], self.player)] + [m.name for m in everyone]
                     if everyone else [])
            avoid = convo.recent(6)

        also_heard: list[str] = []
        for npc in members:
            if convo.closed or self.conversation is not convo:
                return
            with self.lock:
                speaker_name = self.name_for(npc, self.player)
                # Everything this person has already said in this conversation,
                # not just the last six lines. Asked their name twice, eight
                # lines apart, somebody gave the identical answer twice.
                mine = [l["text"] for l in convo.lines if l["key"] == npc.key]
            with self.player_first():
                out = self.brain.speak(npc, self, speaker_name, text, also_heard,
                                       group=group, avoid=avoid + mine)
            with self.lock:
                if convo.closed:
                    return
                line = (out.get("say") or "").strip()
                npc.emotion = out.get("emotion", npc.emotion)
                npc.remember(out.get("memory", ""), self.day)
                npc.adjust_trust("player", int(out.get("trust_speaker", 0) or 0))
                stamp = f"D{self.day} {self.clock_str()}"
                if line:
                    self.said(npc, line)
                    convo.add(npc.key, self.player_name_for(npc), npc.colour, line, stamp)
                    also_heard.append(f"{npc.name}: {line}")
                    avoid.append(line)
                else:
                    # The model had nothing that wasn't a repeat of something
                    # already said. Show that, rather than leave a gap that
                    # reads like the game is broken.
                    convo.add(npc.key, self.player_name_for(npc), npc.colour,
                              f"{self.player_name_for(npc).capitalize()} doesn't answer.",
                              stamp, kind="silence")
                # They're held, so a route just sits there until you let them
                # go — which is exactly what agreeing to something is.
                self.apply_intent(npc, out.get("action", ""), out.get("target", ""))
                if npc.key in convo.thinking:
                    convo.thinking.remove(npc.key)

    def conversation_snapshot(self) -> dict:
        with self.lock:
            convo = self.conversation
            if not convo:
                return {"ok": True, "conversation": None}
            return {"ok": True, "conversation": {
                "round": convo.round,
                "lines": list(convo.lines),
                "thinking": [self.by_key[k].short for k in convo.thinking if k in self.by_key],
                "members": [{
                    "key": k, "name": self.by_key[k].name,
                    "short": self.player_name_for(self.by_key[k]),
                    "colour": self.by_key[k].colour,
                    "emotion": self.by_key[k].emotion,
                    "knows_you": "player" in self.by_key[k].knows_name,
                    "trust": self.by_key[k].trust_of("player"),
                } for k in convo.members if k in self.by_key],
                "can_invite": [{"key": c.key, "short": self.player_name_for(c),
                                "colour": c.colour}
                               for c in self.in_earshot() if c.key not in convo.members],
                "your_name": self.player.given_name,
            }}

    # -- shouting into the air (no modal; whoever's nearby may answer) --------

    def player_says(self, text: str, wait: bool = True) -> dict:
        text = text.strip()[:400]
        if not text:
            return {"heard_by": [], "replies": []}
        with self.lock:
            listeners = self.in_earshot()
            name = spoken_name(text)
            if name and listeners:
                self.introduce_player(name, listeners)
            self.said(self.player, text)
            if not listeners:
                self.event("Nobody is close enough to hear you.", "system")
                return {"heard_by": [], "replies": []}
            for c in listeners:
                c.busy = True

        if not wait:
            threading.Thread(target=self._player_replies, args=(listeners, text),
                             daemon=True).start()
            return {"heard_by": [c.short for c in listeners], "replies": [], "pending": True}
        return self._player_replies(listeners, text)

    def _player_replies(self, listeners, text: str) -> dict:
        replies = []
        also_heard: list[str] = []
        avoid: list[str] = []
        try:
            for npc in listeners[:MAX_REPLIES]:
                with self.lock:
                    speaker_name = self.name_for(npc, self.player)
                with self.player_first():
                    out = self.brain.speak(npc, self, speaker_name, text, also_heard,
                                           avoid=avoid)
                with self.lock:
                    line = (out.get("say") or "").strip()
                    npc.emotion = out.get("emotion", npc.emotion)
                    npc.remember(out.get("memory", ""), self.day)
                    npc.adjust_trust("player", int(out.get("trust_speaker", 0) or 0))
                    if line:
                        self.said(npc, line)
                        also_heard.append(f"{npc.name}: {line}")
                        avoid.append(line)
                        replies.append({"who": npc.name, "colour": npc.colour,
                                        "line": line, "emotion": npc.emotion})
                    self.apply_intent(npc, out.get("action", ""), out.get("target", ""))
        except Exception as exc:
            self.brain.last_error = f"say: {type(exc).__name__}: {exc}"
        finally:
            with self.lock:
                for c in listeners:
                    c.busy = False
        return {"heard_by": [c.short for c in listeners], "replies": replies}

    # -- player input ---------------------------------------------------------

    def move_player(self, x: float, y: float):
        with self.lock:
            if self.over or self.player.down:
                return
            if world.walkable(int(round(x)), int(round(y))):
                self.player.x, self.player.y = x, y

    def player_act(self, action: str, target: str = "") -> str:
        with self.lock:
            if self.over:
                return "It's over."
            if self.player.down and action != "":
                return "You can't move."
            ok, msg = verbs.perform(self, self.player, action, target)
            return msg

    def launch(self, actor) -> tuple[bool, str]:
        """The raft seats two. Whoever is standing at camp when it goes, goes."""
        nearby = [a for a in self.actors
                  if a is not actor and not a.down
                  and a.distance_to(world.LANDMARKS["camp"]["pos"]) <= 4.0]
        nearby.sort(key=actor.distance_to)
        aboard = nearby[:verbs.RAFT_CAPACITY - 1]
        left = [a for a in self.actors if a is not actor and a not in aboard]

        crew = " and ".join(a.short for a in aboard) if aboard else None
        stranded = " and ".join(a.short for a in left) if left else None

        if actor.is_human:
            tail = f" {crew} gets the other place." if crew else " The second place goes empty."
            rest = (f" {stranded} is still on the island." if stranded else "")
            self.finish("You put the raft in the water and get on." + tail + rest +
                        " Nobody says anything for a long time.")
        else:
            took = f" and takes {crew}" if crew else " alone"
            self.finish(f"{actor.short} pushes the raft off the sand{took}. "
                        "You are standing on the beach watching it get small. "
                        "Whatever is left of the camp is what you have now.")
        return True, self.ending or ""

    def finish(self, text: str):
        self.over = True
        self.ending = text
        self.event(text, "ending")
        # The ending sits behind the conversation modal otherwise, so dying
        # mid-sentence would look like the game had simply stopped.
        if self.conversation:
            self.conversation_end(None)

    # -- serialisation --------------------------------------------------------

    def snapshot(self) -> dict:
        with self.lock:
            cast = []
            for c in self.castaways:
                met = c.key in self.player_met
                seen = met or self.player.distance_to(c) <= SIGHT
                snap = c.snapshot(seen)
                snap["met"] = met
                snap["known"] = c.key in self.player_knows
                snap["display"] = self.player_name_for(c)
                snap["allegiance"] = self.allegiance_phrase(c)
                if not met:
                    # You haven't met them: you can see a figure, nothing more.
                    snap = {k: snap[k] for k in ("key", "x", "y", "seen")}
                    snap.update({"name": "someone", "short": "someone", "colour": "#8d8d8d",
                                 "met": False, "unknown": True, "known": False,
                                 "display": c.look if snap["seen"] else "someone"})
                cast.append(snap)

            return {
                "day": self.day, "clock": self.clock_str(), "night": self.is_night(),
                "weather": self.weather, "weather_key": self.weather_key,
                "player": self.player.snapshot(),
                "castaways": cast,
                "stores": dict(self.stores),
                "stock": {site: {i: round(v, 1) for i, v in left.items()}
                          for site, left in self.stock.items()},
                "structures": {k: {kk: vv for kk, vv in v.items() if kk != "credit"}
                               for k, v in self.structures.items()},
                "recipes": {k: v["cost"] for k, v in verbs.RECIPES.items()},
                "log": self.log[-70:],
                "over": self.over, "ending": self.ending,
                "online": self.brain.online, "model": self.brain.model,
                "provider": getattr(self.brain.provider, "kind", "offline"),
                "llm_error": self.brain.last_error, "llm_calls": self.brain.calls,
                "tempo": round(self.tempo(), 2), "latency": round(self.brain.latency, 1),
                "here": world.landmark_at(self.player.x, self.player.y, radius=2.8),
                "context": self.player_context(),
                "seed": self.seed,
                "factions": [[self.by_key[k].short for k in g if k in self.by_key]
                             for g in self.factions() if len(g) > 1],
                "earshot": [{"key": c.key, "short": self.player_name_for(c),
                             "colour": c.colour} for c in self.in_earshot()],
                "your_name": self.player.given_name,
                "emotes": verbs.EMOTE_NAMES,
                "talk": self.conversation_snapshot()["conversation"],
            }


def start(game: Game):
    def sim():
        last = time.time()
        while True:
            time.sleep(TICK)
            now = time.time()
            try:
                game.step(min(now - last, 1.0))
            except Exception as exc:  # never let the clock die
                game.brain.last_error = f"sim: {type(exc).__name__}: {exc}"
            last = now

    def worker():
        while True:
            job = game.jobs.get()
            try:
                game.run_job(job)
            except Exception as exc:
                game.brain.last_error = f"job {job[0]}: {type(exc).__name__}: {exc}"
                with game.lock:
                    for npc in game.castaways:
                        npc.busy = False

    threading.Thread(target=sim, daemon=True).start()
    threading.Thread(target=worker, daemon=True).start()
