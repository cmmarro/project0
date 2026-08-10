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

import random
import re
import threading

from . import providers, settings, world
from .verbs import ACTION_NAMES, RAFT_CAPACITY, RECIPES

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
            "description": "How this exchange moved your trust in the person who just spoke to you, "
                           "from -3 to 3. 0 is the normal answer.",
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

def compact_guide() -> str:
    """A much shorter brief, for small local models that lose the thread."""
    places = ", ".join(f"{n} ({'/'.join(world.HARVEST[n])})" if n in world.HARVEST else n
                       for n in world.LANDMARKS)
    return f"""WHERE YOU ARE
Shipwrecked on a small island. No radio, no rescue coming. You must get off it
or live here.

PLACES: {places}.
Camp is where the crate washed up; you build there from shared stores.
The raft seats {RAFT_CAPACITY} and takes more work than one person can do alone.

YOU CAN: gather, go_to <place>, build <thing>, take <item>, deposit, give <item>,
eat, drink, rest, revive <name>, follow <name>, board.
Everyone here can do exactly the same things. Nobody is in charge.

Thirst kills fastest. Water is at the spring. If thirst or hunger hits zero you
start dying, and you collapse when your condition runs out."""


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


CONDUCT = """HOW TO WRITE YOUR LINE
The "say" field is the words that come out of your mouth. Nothing else goes in
it. Not your name, not your age, not your job, not your thirst number, not your
reasoning, not a description of what you are doing. Just speech.

WRONG: "I am Barnaby Ferreira (he/him), a 34-year-old insurance adjuster, and I
        must survive."
WRONG: "I need to react to my current state. Thirst is 38/100 and energy is 0."
WRONG: "*wipes his forehead* Water. We need water."
RIGHT: "There's water west of here. I'm going. Come or don't."
RIGHT: "You've been sat on that crate all morning."
RIGHT: "Don't touch the timber. That's the raft."

One or two sentences. Say the thing a tired, frightened, specific person would
actually say out loud. Everyone already knows who you are — never introduce
yourself or restate your situation.

HOW TO BEHAVE
Stay in character. You are a person on a beach, not an assistant. Never offer
help, never summarise, never mention being an AI or a model or a prompt.

React to how things actually are. If you are badly thirsty it is in your voice.
If someone sat at camp while you hauled timber, you noticed.

You are not anybody's helper. Your own survival comes first, and whether these
other people help or hurt that is a real question. Keep your own stash and your
own counsel if you want — but the raft is more work than one person can do, and
the island is not big enough to avoid anyone for long.

Trust moves slowly. Zero is the normal answer."""


COMPACT_CONDUCT = """RULES
The "say" field is speech only — the exact words out of your mouth.
Never state your name, age, job, or your thirst/hunger numbers. Never explain
your reasoning. Never write *actions* in asterisks. One or two short sentences.

WRONG: "I am Odell Kaminski, a deckhand, and my thirst is 38/100."
WRONG: "I need to react to my current state."
RIGHT: "Water's west. I'm going."
RIGHT: "You touch that timber and we're going to have a problem."

You are a tired, frightened person on a beach. Your survival comes first."""


# Shapes that mean the model narrated its prompt instead of speaking a line.
# Checked per sentence, against the raw text, before anything is stripped.
_META_I = re.compile(
    r"\d+\s*/\s*100"
    r"|\b(he/him|she/her|they/them)\b"
    r"|\bas (an? )?(ai|assistant|language model|character)\b"
    r"|\bi (need|have) to (react|respond|answer|decide|choose)\b"
    r"|\bmy current (state|situation|status)\b"
    r"|\b(the|this) (user|player|prompt|schema|instruction)s?\b"
    r"|\bjson\b"
    r"|\b\d+[- ]year[- ]old\b"
    r"|^\s*as \w+,\s*i\b"
    r"|\b(thirst|hunger|energy|condition) is (high|low|critical|at)\b",
    re.I,
)
# Self-introduction: "I am Firstname Lastname", "I'm Odell Kaminski". Case
# matters here — it's what separates a name from "I am counting the timber".
_META_NAME = re.compile(r"\bI(?: am|'m) [A-Z][a-z]+ [A-Z][a-z]+")

_STAGE = re.compile(r"\*[^*]{0,80}\*|\[[^\]]{0,80}\]")
_SENTENCE = re.compile(r"(?<=[.!?])\s+")


def tidy_line(text: str, limit: int = 260) -> str:
    """Salvage a speakable line from whatever a small model produced.

    Local models narrate their own prompt back — "I am Barnaby Ferreira
    (he/him), a 34-year-old adjuster…" — and run past any sensible length. Drop
    the sentences that are the model talking about itself rather than a person
    talking, strip stage directions, and keep it readable.
    """
    line = (text or "").strip()
    if not line:
        return ""

    if len(line) > 1 and line[0] in "\"'\u201c\u2018" and line[-1] in "\"'\u201d\u2019":
        line = line[1:-1].strip()

    kept = []
    for raw in _SENTENCE.split(line):
        raw = raw.strip()
        if not raw:
            continue
        if _META_I.search(raw) or _META_NAME.search(raw):
            continue
        cleaned = re.sub(r"\s+", " ", _STAGE.sub(" ", raw)).strip()
        if not cleaned or cleaned in ".!?":
            continue
        kept.append(cleaned)
        if len(" ".join(kept)) > limit:
            break

    out = " ".join(kept).strip(" -\u2013\u2014:")
    if len(out) > limit:
        cut = out[:limit]
        stop = max(cut.rfind("."), cut.rfind("!"), cut.rfind("?"))
        out = cut[:stop + 1] if stop > limit * 0.5 else cut.rstrip() + "\u2026"
    return out.strip()


def _inv(inventory: dict[str, int]) -> str:
    carried = [f"{n} x{c}" for n, c in inventory.items() if c]
    return ", ".join(carried) if carried else "nothing"


def _bar(label: str, value: float) -> str:
    v = round(value)
    state = "fine" if v > 60 else "getting bad" if v > 30 else "critical"
    return f"{label} {v}/100 ({state})"


class Brain:
    """Owns the prompts. Which model answers them is the provider's business."""

    def __init__(self) -> None:
        self.last_error: str | None = None
        self.calls = 0
        self._lock = threading.Lock()
        self.provider = None
        self.reconfigure()

    def reconfigure(self) -> str | None:
        """Rebuild the backend from current settings. Returns an error, or None."""
        cfg = settings.get()
        try:
            self.provider = providers.build(cfg)
            self.last_error = None if self.provider else "offline — no model configured"
        except providers.ProviderError as exc:
            self.provider = None
            self.last_error = str(exc)
        except Exception as exc:
            self.provider = None
            self.last_error = f"{type(exc).__name__}: {exc}"
        return self.last_error if self.provider is None else None

    @property
    def online(self) -> bool:
        return self.provider is not None

    @property
    def model(self) -> str:
        return getattr(self.provider, "label", "offline")

    def _call(self, system: str, user: str, schema: dict) -> dict | None:
        if not self.provider:
            return None
        with self._lock:
            self.calls += 1
        try:
            out = self.provider.complete(system, user, schema,
                                         int(settings.get().get("max_tokens", 1200)))
            self.last_error = None
            return out
        except Exception as exc:
            self.last_error = f"{type(exc).__name__}: {exc}"
            return None

    # -- prompt assembly ------------------------------------------------------

    def _compact(self) -> bool:
        """Small local models do better with far less text."""
        style = settings.get().get("prompt_style", "auto")
        if style == "compact":
            return True
        if style == "full":
            return False
        return getattr(self.provider, "kind", "") == "openai"

    def _system(self, npc) -> str:
        if self._compact():
            return "\n\n".join([compact_guide(), npc.persona_short, COMPACT_CONDUCT])
        return "\n\n".join([world_guide(), npc.persona, CONDUCT])

    @staticmethod
    def _polish(out: dict, fallback: str = "") -> dict:
        """Strip the model's narration out of anything meant to be spoken."""
        if not isinstance(out, dict):
            return out
        if "say" in out:
            out["say"] = tidy_line(out.get("say", "")) or fallback
        if "thought" in out:
            out["thought"] = tidy_line(out.get("thought", ""), limit=120)
        if "memory" in out:
            out["memory"] = tidy_line(out.get("memory", ""), limit=160)
        return out

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
        if out is None:
            return self._fallback_plan(npc, game)
        return self._polish(out)

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
        if out is None:
            return self._fallback_speak(npc, game, line)
        return self._polish(out, fallback=self._canned(npc))

    def opener(self, npc, game, partner, topic: str) -> dict:
        user = f"""{self._situation(npc, game)}

You've ended up standing next to {partner.prompt_name} and there's
something you want to raise: {topic}

Say the first thing. Don't be polite about it if you don't feel polite."""
        out = self._call(self._system(npc), user, OPENER_SCHEMA)
        if out is None:
            return {"say": self._canned(npc), "emotion": "calm"}
        return self._polish(out, fallback=self._canned(npc))

    def first_contact(self, npc, game, other) -> dict:
        alone_days = game.day
        user = f"""{self._situation(npc, game)}

Someone has just come out of the trees. It is another survivor — {other.name} —
and until this second you believed you were alone on this island. You have been
alone with that belief for {alone_days} days.

This is the first thing you say to them. It does not have to be gracious."""
        out = self._call(self._system(npc), user, OPENER_SCHEMA)
        if out is None:
            return {"say": self._canned(npc), "emotion": "wary"}
        return self._polish(out, fallback=self._canned(npc))

    # -- offline fallbacks ----------------------------------------------------

    # Offline / total-failure lines. Deliberately characterless: they belong to
    # nobody in particular, because the cast is different every run.
    _CANNED = [
        "Mm. Noted.",
        "Talk later. There's work that isn't doing itself.",
        "If you want to be useful, the water needs someone.",
        "That's a lot of words for a plan with no timber in it.",
        "Say that again and mean it.",
        "Right. And who's carrying it?",
        "Fine. But I'm counting.",
    ]

    def _canned(self, npc=None) -> str:
        return random.choice(self._CANNED)

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
