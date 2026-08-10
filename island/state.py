"""The simulation: an island, however many people it rolled, and whatever they
decide about each other."""

from __future__ import annotations

import math
import queue
import random
import threading
import time

from . import people, verbs, world
from .actors import Castaway, Player, clamp
from .brain import Brain

# --- tuning ------------------------------------------------------------------

TICK = 0.2
GAME_MINUTES_PER_SECOND = 1.5
GATHER_MINUTES = 5
BUILD_MINUTES = 6

PLAN_COOLDOWN = 20          # real seconds between a castaway's unprompted decisions
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

    def is_night(self) -> bool:
        h = (self.minutes % (24 * 60)) / 60
        return h < 6 or h >= 20

    # -- lookups --------------------------------------------------------------

    def other_castaways(self, npc: Castaway) -> list[Castaway]:
        return [c for c in self.castaways if c is not npc]

    def allegiance_phrase(self, npc: Castaway) -> str:
        names = [self.by_key[k].prompt_name for k in sorted(npc.allies) if k in self.by_key]
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
        if n in ("player", "you", "the player"):
            return self.player
        for a in self.actors:
            if n in (a.key, a.short.lower(), a.name.lower()):
                return a
        return None

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

    def event(self, text: str, kind: str = "world", actor=None):
        self.log.append({
            "t": f"D{self.day} {self.clock_str()}",
            "kind": kind,
            "who": getattr(actor, "name", actor if isinstance(actor, str) else None),
            "colour": getattr(actor, "colour", None),
            "text": text,
        })
        del self.log[:-150]

    def said(self, actor, line: str):
        self.transcript.append(f"{actor.name}: {line}")
        del self.transcript[:-20]
        self.event(line, "speech", actor)

    # -- social side effects, called from the verb layer -----------------------

    def _witnesses(self, actor, radius=SIGHT):
        return [c for c in self.castaways if c is not actor and c.has_met(actor)
                and c.distance_to(actor) <= radius]

    def notice_sharing(self, actor, count: int):
        for c in self._witnesses(actor):
            c.remember(f"{actor.short} put {count} thing{'s' if count > 1 else ''} into the shared stores.")
            c.adjust_trust(actor.key, 1)

    def notice_taking(self, actor, item: str):
        for c in self._witnesses(actor):
            c.remember(f"{actor.short} took {world.ITEM_LABEL.get(item, item)} out of the shared stores.")

    def notice_gift(self, actor, recipient, item: str):
        if isinstance(recipient, Castaway):
            recipient.remember(f"{actor.short} handed me {world.ITEM_LABEL.get(item, item)} without being asked.")
            recipient.adjust_trust(actor.key, 2)
        for c in self._witnesses(actor):
            if c is not recipient:
                c.remember(f"{actor.short} gave {recipient.short} {world.ITEM_LABEL.get(item, item)}.")

    def notice_rescue(self, actor, who):
        if isinstance(who, Castaway):
            who.remember(f"I went down, and {actor.short} got water into me. I was not getting up on my own.")
            who.adjust_trust(actor.key, 5)
        for c in self._witnesses(actor):
            if c is not who:
                c.remember(f"{actor.short} brought {who.short} round after they collapsed.")
                c.adjust_trust(actor.key, 2)

    # =========================================================================
    # simulation
    # =========================================================================

    def step(self, dt: float):
        with self.lock:
            if self.over:
                return
            gm = dt * GAME_MINUTES_PER_SECOND
            self.minutes += gm
            self._weather(gm)
            self._bodies(gm)
            for npc in self.castaways:
                self._advance(npc, dt, gm)
            self._contacts()
            self._warnings()
            self._hints()
            self._schedule()
            if self.player.down and not self.over:
                self.finish("You go down on the sand and don't get back up. "
                            "Whatever the others make of the island, they'll make it without you.")

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
        if npc.down:
            npc.stop()
            return

        # Keeping yourself alive overrides whatever you last decided to do.
        if npc.thirst < 14 and npc.inventory.get("water"):
            verbs.drink(self, npc)
        elif npc.hunger < 14 and (npc.inventory.get("coconut") or npc.inventory.get("fish")):
            verbs.eat(self, npc)

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
            return

        if t["phase"] == "work":
            t["timer"] += gm
            threshold = GATHER_MINUTES if t["action"] == "gather" else BUILD_MINUTES
            if t["timer"] >= threshold:
                t["timer"] = 0.0
                ok, _ = verbs.perform(self, npc, t["action"], t["target"])
                if not ok:
                    npc.stop()
                elif t["action"] == "gather" and npc.carried() >= 7:
                    if not npc.allies:
                        npc.stop()
                    else:
                        npc.thought = "hauling this back to camp"
                        npc.route_to(world.LANDMARKS["camp"]["pos"], "deposit", "camp")
                elif t["action"] == "build" and self.structures[t["target"]]["done"]:
                    npc.stop()
            return

        if t["action"] == "follow":
            who = self.actor_by_name(t["target"])
            if who and npc.distance_to(who) > 2.4:
                path = world.find_path(npc.pos(), who.pos())
                if path:
                    npc.path = path
                    t["phase"] = "travel"
                    t["action"], t["target"] = "follow", t["target"]

    def apply_intent(self, npc: Castaway, action: str, target: str):
        """Turn a model's chosen verb into motion + execution."""
        action = (action or "").strip().lower()
        target = (target or "").strip().lower()
        if action in ("", "keep_doing"):
            return
        # Having just decided something, give them time to actually do it before
        # they reconsider — otherwise a queued plan can overwrite an agreement
        # a second after it was made.
        npc.next_plan_at = max(npc.next_plan_at, time.time() + PLAN_COOLDOWN)
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
        else:
            a.met.add(b.key)

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
        for npc in self.castaways:
            if npc.down or npc.busy:
                continue
            idle = npc.task["phase"] == "idle" and npc.task["action"] in ("idle", "rest", "follow")
            if idle and now >= npc.next_plan_at:
                npc.next_plan_at = now + PLAN_COOLDOWN
                npc.busy = True
                self.jobs.put(("plan", npc.key))

        if now < self.next_convo_at:
            return
        for i, a in enumerate(self.castaways):
            for b in self.castaways[i + 1:]:
                if (not a.busy and not b.busy and not a.down and not b.down
                        and a.has_met(b) and a.distance_to(b) <= 3.5):
                    self.next_convo_at = now + CONVO_COOLDOWN
                    a.busy = b.busy = True
                    self.jobs.put(("convo", a.key, b.key))
                    return

    # =========================================================================
    # worker-thread jobs
    # =========================================================================

    def _throttle(self):
        wait = 3.0 - (time.time() - self.last_llm_at)
        if wait > 0:
            time.sleep(wait)
        self.last_llm_at = time.time()

    def run_job(self, job):
        try:
            kind = job[0]
            if kind == "plan":
                self._job_plan(self.by_key[job[1]])
            elif kind == "convo":
                self._job_convo(self.by_key[job[1]], self.by_key[job[2]])
            elif kind == "first_contact":
                self._job_first_contact(self.by_key[job[1]], self.by_key[job[2]])
        finally:
            with self.lock:
                for npc in self.castaways:
                    npc.busy = False

    def _job_plan(self, npc: Castaway):
        with self.brain_lock:
            self._throttle()
            out = self.brain.plan(npc, self)
        with self.lock:
            npc.thought = (out.get("thought") or npc.thought)[:160]
            npc.emotion = out.get("emotion", npc.emotion)
            if self.set_allies(npc, out.get("working_with")):
                self.event(f"{npc.short} is working {self.allegiance_phrase(npc)}.", "allegiance", npc)
            self.apply_intent(npc, out.get("action", ""), out.get("target", ""))
            self.event(npc.thought, "thought", npc)

    def _job_first_contact(self, npc: Castaway, other):
        with self.brain_lock:
            self._throttle()
            out = self.brain.first_contact(npc, self, other)
        with self.lock:
            npc.emotion = out.get("emotion", npc.emotion)
            line = (out.get("say") or "").strip()
            if line:
                self.said(npc, line)
            npc.remember(f"I met {other.name} on day {self.day}. Up to then I thought I was alone here.")

    def _pick_topic(self, a: Castaway, b: Castaway) -> str:
        options = []
        if min(a.thirst, b.thirst) < 45 or self.stores.get("water", 0) == 0:
            options.append("water, and the fact that nobody has actually solved it")
        if self.structures["raft"]["started"] and not self.structures["raft"]["done"]:
            options.append("how far along the raft is, and whether it will really float")
            options.append(f"the fact that the raft seats {verbs.RAFT_CAPACITY} and there are three of you, "
                           "which neither of you has said out loud yet")
        else:
            options.append("whether the timber goes into a raft or into a signal fire")
        if not self.structures["fire"]["done"]:
            options.append("there being no fire yet, with the dark coming again")
        if "player" in a.met and a.trust_of("player") != 0:
            options.append("what you make of the stranger, and whether they're pulling their weight")
        if not a.allies or not b.allies:
            options.append("whether you're actually doing this together or just standing near each other")
        if a.memories:
            options.append(f"something sitting with you: {a.memories[-1]}")
        return random.choice(options)

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

        for _ in range(CONVO_TURNS - 1):
            with self.lock:
                if speaker.down or listener.down or self.over:
                    return
                heard = list(self.transcript[-3:])
            with self.brain_lock:
                self._throttle()
                out = self.brain.speak(speaker, self, listener.name, last, heard)
            with self.lock:
                line = (out.get("say") or "").strip()
                if not line:
                    break
                speaker.emotion = out.get("emotion", speaker.emotion)
                speaker.remember(out.get("memory", ""))
                speaker.adjust_trust(listener.key, int(out.get("trust_speaker", 0) or 0))
                self.said(speaker, line)
                self.apply_intent(speaker, out.get("action", ""), out.get("target", ""))
                last = line
                speaker, listener = listener, speaker

    # -- player speech (synchronous, so the UI can wait on it) ----------------

    def player_says(self, text: str) -> dict:
        text = text.strip()[:400]
        if not text:
            return {"heard_by": [], "replies": []}
        with self.lock:
            listeners = [c for c in self.castaways
                         if not c.down and c.has_met(self.player)
                         and self.player.distance_to(c) <= EARSHOT]
            listeners.sort(key=self.player.distance_to)
            self.said(self.player, text)
            if not listeners:
                self.event("Nobody is close enough to hear you.", "system")
                return {"heard_by": [], "replies": []}
            for c in listeners:
                c.busy = True

        replies = []
        also_heard: list[str] = []
        try:
            for npc in listeners[:MAX_REPLIES]:
                with self.brain_lock:
                    self._throttle()
                    out = self.brain.speak(npc, self, self.player.prompt_name, text, also_heard)
                with self.lock:
                    line = (out.get("say") or "").strip()
                    npc.emotion = out.get("emotion", npc.emotion)
                    npc.remember(out.get("memory", ""))
                    npc.adjust_trust("player", int(out.get("trust_speaker", 0) or 0))
                    if line:
                        self.said(npc, line)
                        also_heard.append(f"{npc.name}: {line}")
                        replies.append({"who": npc.name, "colour": npc.colour,
                                        "line": line, "emotion": npc.emotion})
                    self.apply_intent(npc, out.get("action", ""), out.get("target", ""))
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

    # -- serialisation --------------------------------------------------------

    def snapshot(self) -> dict:
        with self.lock:
            cast = []
            for c in self.castaways:
                met = c.key in self.player_met
                seen = met or self.player.distance_to(c) <= SIGHT
                snap = c.snapshot(seen)
                snap["met"] = met
                snap["allegiance"] = self.allegiance_phrase(c)
                if not met:
                    # You haven't met them: you can see a figure, nothing more.
                    snap = {k: snap[k] for k in ("key", "x", "y", "seen")}
                    snap.update({"name": "someone", "short": "someone", "colour": "#8d8d8d",
                                 "met": False, "unknown": True})
                cast.append(snap)

            return {
                "day": self.day, "clock": self.clock_str(), "night": self.is_night(),
                "weather": self.weather, "weather_key": self.weather_key,
                "player": self.player.snapshot(),
                "castaways": cast,
                "stores": dict(self.stores),
                "structures": {k: {kk: vv for kk, vv in v.items() if kk != "credit"}
                               for k, v in self.structures.items()},
                "recipes": {k: v["cost"] for k, v in verbs.RECIPES.items()},
                "log": self.log[-70:],
                "over": self.over, "ending": self.ending,
                "online": self.brain.online, "model": self.brain.model,
                "provider": getattr(self.brain.provider, "kind", "offline"),
                "llm_error": self.brain.last_error, "llm_calls": self.brain.calls,
                "here": world.landmark_at(self.player.x, self.player.y, radius=2.8),
                "context": self.player_context(),
                "seed": self.seed,
                "factions": [[self.by_key[k].short for k in g if k in self.by_key]
                             for g in self.factions() if len(g) > 1],
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
