"""Everything that talks to Claude.

Three kinds of call:

  * plan()          a castaway decides, unprompted, what to do next
  * speak()         a castaway answers whoever just spoke near them
  * first_contact() a castaway reacts to meeting another survivor

All use structured outputs, so each call returns the dialogue *and* the intent
behind it: what they do next, what they'll remember, how their trust moved.
Without an API key, deterministic fallbacks keep the game playable.
"""

from __future__ import annotations

import json
import os
import random
import threading

from . import world
from .verbs import ACTION_NAMES, RAFT_CAPACITY, RECIPES

MODEL = os.environ.get("ISLAND_MODEL", "claude-opus-5")

EMOTIONS = [
    "calm", "wary", "hopeful", "frustrated", "exhausted",
    "amused", "afraid", "grateful", "bitter", "determined",
]

_ACTION_ENUM = ACTION_NAMES + ["idle"]

# --- Schemas -----------------------------------------------------------------

SPEAK_SCHEMA = {
    "type": "object",
    "properties": {
        "say": {
            "type": "string",
            "description": "What you say out loud. One to three sentences. Speech only — no stage directions or narration.",
        },
        "emotion": {"type": "string", "enum": EMOTIONS},
        "memory": {
            "type": "string",
            "description": "One short note in your own voice about what this exchange told you, or \"\" if it told you nothing.",
        },
        "trust_speaker": {
            "type": "integer",
            "enum": [-3, -2, -1, 0, 1, 2, 3],
            "description": "How this exchange moved your trust in the person who just spoke to you. 0 is the normal answer.",
        },
        "action": {
            "type": "string",
            "enum": _ACTION_ENUM + ["keep_doing"],
            "description": "What you do next. keep_doing means the conversation didn't change your mind.",
        },
        "target": {
            "type": "string",
            "description": "Target of the action: a place for go_to, a structure for build, an item for take/give/eat, a name for follow/revive. Empty if not needed.",
        },
    },
    "required": ["say", "emotion", "memory", "trust_speaker", "action", "target"],
    "additionalProperties": False,
}

PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "thought": {
            "type": "string",
            "description": "One short line of what you're thinking. The others can see roughly what you're doing, so keep it to something observable.",
        },
        "emotion": {"type": "string", "enum": EMOTIONS},
        "working_with": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Names of the people you are actually throwing in with right now — sharing what you gather, and depending on them. Empty list means you are going it alone. Be honest: standing near someone is not the same as being with them.",
        },
        "action": {"type": "string", "enum": _ACTION_ENUM},
        "target": {"type": "string", "description": "Place, structure, item or name. Empty if the action needs none."},
    },
    "required": ["thought", "emotion", "working_with", "action", "target"],
    "additionalProperties": False,
}

OPENER_SCHEMA = {
    "type": "object",
    "properties": {
        "say": {"type": "string", "description": "The first thing you say. One or two sentences."},
        "emotion": {"type": "string", "enum": EMOTIONS},
    },
    "required": ["say", "emotion"],
    "additionalProperties": False,
}


# --- Prompt pieces -----------------------------------------------------------

def world_guide() -> str:
    places = "\n".join(f"  - {n}: {d['desc']}" for n, d in world.LANDMARKS.items())
    harvest = "\n".join(f"  - {n}: {', '.join(items)}" for n, items in world.HARVEST.items())
    builds = "\n".join(
        f"  - {n}: needs {', '.join(f'{v} {k}' for k, v in r['cost'].items())} from the camp stores, "
        f"then {r['work']} sessions of work by anyone"
        for n, r in RECIPES.items()
    )
    return f"""THE SITUATION
The boat broke up in a squall and put you in the water. You came ashore alone on
a small uninhabited island. There is no radio, no sight of land, and no reason to
think anyone is looking for you. There is no rescue unless somebody makes one.

PLACES
{places}

WHAT'S WHERE
{harvest}

WHAT CAN BE BUILT, AT CAMP ONLY
{builds}
The camp is the spot on the south beach where a supply crate washed up. The
stores there are open — anyone can put things in and anyone can take things out.

THE RAFT SEATS {RAFT_CAPACITY}.
You have looked at the timber and you have done the arithmetic. It will carry two
people and no more, and it is far more work than any one person can do alone
while also keeping themselves alive. So it has to be built by more than the
number of people it can carry. Whoever is standing at camp when it goes, goes.
Everyone here understands this. Nobody has said it out loud yet.

YOUR BODY
Thirst kills faster than hunger. Water comes from the spring, or from a still if
one gets built. Coconuts and fish are food; fish is worth much more once there's
a fire to cook on. Working burns energy. Resting restores it, more under a
shelter. If thirst or hunger bottoms out you start losing condition, and when
that runs out you go down on the sand and cannot get up without someone pouring
water into you.

WHAT YOU CAN DO
  gather              collect whatever is at the place you're standing
  go_to <place>       walk somewhere
  build <thing>       put a session of work into a structure, at camp
  take <item>         take something out of the camp stores
  deposit             put what you're carrying into the camp stores
  give <item>         hand something to whoever is standing next to you
  eat / drink         use what you're carrying
  rest                stop and get your energy back
  revive <name>       pour water into someone who has collapsed
  follow <name>       stay close to someone
  board               get on the raft and leave, if it's finished

Everyone here has exactly this list. The others can do everything you can do, and
you can do everything they can. Nobody has special powers and nobody is in charge."""


CONDUCT = """HOW TO PLAY YOURSELF
Stay in character. You are a person on a beach, not an assistant. Never offer
help, never summarise, never mention being an AI, never break character.

Speak in one to three sentences. Speech only — no asterisks, no stage directions,
no narrating your own actions.

React to the state of things as they actually are. If you are badly thirsty, it
is in your voice. If someone has been sitting at camp while you hauled timber,
you have noticed. If you overheard something, it stays with you.

You are not anybody's helper. Your own survival comes first, and it is a real
question whether these other people make that more likely or less. Working with
someone is worth it when it is worth it. If you'd rather keep your own stash and
your own counsel, do that — but be aware the raft is more work than one person
can do alone, and the island is not big enough to avoid anyone for long.

Trust moves slowly. Zero is the normal answer. Save 2 or 3 for something that
actually cost the other person something."""


def _inv(inventory: dict[str, int]) -> str:
    carried = [f"{n} x{c}" for n, c in inventory.items() if c]
    return ", ".join(carried) if carried else "nothing"


def _bar(label: str, value: float) -> str:
    v = round(value)
    state = "fine" if v > 60 else "getting bad" if v > 30 else "critical"
    return f"{label} {v}/100 ({state})"


class Brain:
    def __init__(self) -> None:
        self.model = MODEL
        self.client = None
        self.last_error: str | None = None
        self.calls = 0
        self._lock = threading.Lock()
        key = os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")
        try:
            import anthropic  # noqa: PLC0415

            if key:
                self.client = anthropic.Anthropic()
            else:
                self.last_error = "no ANTHROPIC_API_KEY — running in offline mode"
        except Exception as exc:  # pragma: no cover
            self.last_error = f"anthropic sdk unavailable: {exc}"

    @property
    def online(self) -> bool:
        return self.client is not None

    def _call(self, system: str, user: str, schema: dict) -> dict | None:
        if not self.client:
            return None
        try:
            with self._lock:
                self.calls += 1
            resp = self.client.messages.create(
                model=self.model,
                max_tokens=2000,
                system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": user}],
                output_config={
                    "effort": "low",
                    "format": {"type": "json_schema", "schema": schema},
                },
            )
            if resp.stop_reason == "refusal":
                self.last_error = "model declined to answer"
                return None
            text = next((b.text for b in resp.content if b.type == "text"), None)
            if not text:
                return None
            self.last_error = None
            return json.loads(text)
        except Exception as exc:
            self.last_error = f"{type(exc).__name__}: {exc}"
            return None

    # -- prompt assembly ------------------------------------------------------

    def _system(self, npc) -> str:
        return "\n\n".join([world_guide(), npc.persona, CONDUCT])

    def _situation(self, npc, game) -> str:
        stores = _inv(game.stores)
        built = ", ".join(n for n, s in game.structures.items() if s["done"]) or "nothing"
        progress = "; ".join(
            f"{n} {s['progress']}/{s['needed']}"
            for n, s in game.structures.items() if s["started"] and not s["done"]
        ) or "nothing under way"

        known = []
        for other in game.actors:
            if other is npc:
                continue
            if not npc.has_met(other):
                continue
            seen = npc.distance_to(other) <= 6
            where = f"right here, {other.where()}" if seen else "somewhere else on the island"
            known.append(
                f"  - {other.prompt_name}: {where}. "
                f"{'You can see them ' + other.activity_label() + '. ' if seen else ''}"
                f"{npc.trust_label(other.key)}."
            )
        others = "\n".join(known) if known else "  - Nobody. As far as you know you are the only person on this island."

        mem = "\n".join(f"  - {m}" for m in npc.memories[-8:]) or "  - (nothing in particular yet)"

        return f"""RIGHT NOW
Day {game.day}, {game.clock_str()}{', dark' if game.is_night() else ''}. {game.weather}.
You are {npc.where()}. You are {npc.activity_label()}.
Carrying: {_inv(npc.inventory)}.
Your body: {_bar('thirst', npc.thirst)}, {_bar('hunger', npc.hunger)}, {_bar('energy', npc.energy)}, {_bar('condition', npc.health)}.
You are currently working: {game.allegiance_phrase(npc)}.

CAMP
Stores: {stores}. Built: {built}. Under way: {progress}.

OTHER PEOPLE YOU KNOW ABOUT
{others}

WHAT YOU REMEMBER
{mem}"""

    # -- calls ----------------------------------------------------------------

    def plan(self, npc, game) -> dict:
        user = f"""{self._situation(npc, game)}

Nobody is talking to you. Decide what you're doing next.

Weigh it honestly. What is most likely to kill you in the next day — thirst,
the dark, the water? What actually moves you closer to getting off this island?
And decide who, if anyone, you are doing this with: throwing in with someone
means sharing what you gather, and it means depending on them."""
        out = self._call(self._system(npc), user, PLAN_SCHEMA)
        return out if out is not None else self._fallback_plan(npc, game)

    def speak(self, npc, game, speaker_name: str, line: str, also_heard: list[str]) -> dict:
        heard = ""
        if also_heard:
            heard = "\nAlso just said, in front of you:\n" + "\n".join(f"  {h}" for h in also_heard)
        recent = "\n".join(f"  {t}" for t in game.transcript[-8:]) or "  (nothing recently)"
        user = f"""{self._situation(npc, game)}

WHAT'S BEEN SAID
{recent}
{heard}

{speaker_name} says to you: "{line}"

Answer them, and decide what you do next. If they've asked you to do something,
it is entirely your call whether you do it — weigh who is asking and what it
costs you."""
        out = self._call(self._system(npc), user, SPEAK_SCHEMA)
        return out if out is not None else self._fallback_speak(npc, game, line)

    def opener(self, npc, game, partner, topic: str) -> dict:
        user = f"""{self._situation(npc, game)}

You've ended up standing next to {partner.prompt_name} and there's
something you want to raise: {topic}

Say the first thing. Don't be polite about it if you don't feel polite."""
        out = self._call(self._system(npc), user, OPENER_SCHEMA)
        return out if out is not None else {"say": self._canned(npc), "emotion": "calm"}

    def first_contact(self, npc, game, other) -> dict:
        alone_days = game.day
        user = f"""{self._situation(npc, game)}

Someone has just come out of the trees. It is another survivor — {other.name} —
and until this second you believed you were alone on this island. You have been
alone with that belief for {alone_days} days.

This is the first thing you say to them. It does not have to be gracious."""
        out = self._call(self._system(npc), user, OPENER_SCHEMA)
        return out if out is not None else {"say": self._canned(npc), "emotion": "wary"}

    # -- offline fallbacks ----------------------------------------------------

    _CANNED = {
        "wren": [
            "Mm. Noted.",
            "Talk later. There's timber that isn't carrying itself.",
            "If you want to be useful, the spring needs someone.",
            "That's a lot of words for a plan with no timber in it.",
        ],
        "odell": [
            "Ha — that's not the worst idea I've heard today. It's close, but it isn't the worst.",
            "Excellent views on this island. Terrible service.",
            "Give me a moment. I'm rallying. I'm very nearly rallied.",
            "You're right. You're right, and I'd thank you not to tell Wren I said so.",
        ],
    }

    def _canned(self, npc) -> str:
        return random.choice(self._CANNED[npc.key])

    # Offline, we still want "you fish, I'll do the wood" to visibly work, so the
    # fallback does a crude keyword read of what was said. It is not pretending to
    # be the model — it is just enough to exercise the loop without a key.
    _WORD_SITES = {
        "wood": "wood", "timber": "wood", "log": "wood",
        "fish": "fish", "fishing": "fish",
        "water": "water", "drink": "water", "spring": "water",
        "coconut": "coconut", "food": "coconut", "frond": "frond",
        "rope": "rope", "canvas": "cloth", "cloth": "cloth", "wreck": "rope",
        "flint": "flint",
    }

    def _site_for(self, game, item: str) -> str | None:
        for name, items in world.HARVEST.items():
            if item in items:
                return name
        return None

    def _fallback_speak(self, npc, game=None, line: str = "") -> dict:
        action, target = "keep_doing", ""
        said = ""
        low = (line or "").lower()
        for word, item in self._WORD_SITES.items():
            if word in low:
                site = self._site_for(game, item) if game else None
                if site:
                    action, target = "gather", site
                    said = f"Fine. I'll take {site}."
                    break
        if "build" in low or "raft" in low:
            action, target = "build", "raft"
            said = "Alright. I'll put work into the raft."
        return {
            "say": said or self._canned(npc), "emotion": "calm", "memory": "",
            "trust_speaker": 0, "action": action, "target": target,
        }

    def _fallback_plan(self, npc, game) -> dict:
        keep = [game.by_key[k].prompt_name for k in npc.allies if k in game.by_key]
        if npc.thirst < 40:
            if npc.inventory.get("water"):
                return {"thought": "drinking what I've got", "emotion": "wary", "working_with": keep,
                        "action": "drink", "target": ""}
            site = self._site_for(game, "water")
            if site:
                return {"thought": "water first", "emotion": "wary", "working_with": keep,
                        "action": "gather", "target": site}
        if npc.hunger < 40:
            site = self._site_for(game, "coconut") or self._site_for(game, "fish")
            if site:
                return {"thought": "need to eat", "emotion": "wary", "working_with": keep,
                        "action": "gather", "target": site}
        if npc.energy < 25:
            return {"thought": "worn through", "emotion": "exhausted", "working_with": keep,
                    "action": "rest", "target": ""}
        if npc.carried() >= 5 and keep != "alone":
            return {"thought": "taking this back to camp", "emotion": "determined", "working_with": keep,
                    "action": "deposit", "target": ""}
        places = list(world.HARVEST.keys()) or ["camp"]
        place = random.choice(places)
        return {"thought": f"heading for {place}", "emotion": "determined", "working_with": keep,
                "action": "gather", "target": place}
