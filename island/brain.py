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
import time

from . import providers, settings, world
from .verbs import ACTION_NAMES, EMOTE_NAMES, RAFT_CAPACITY, RECIPES

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
            "description": "The one short line you'd mutter to yourself. Under ten words. Not your reasoning, not a list of your levels — just the thing in your head, like \"water first, then the timber\".",
        },
        "emotion": {"type": "string", "enum": EMOTIONS},
        "working_with": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Names of the people you are actually throwing in with right now — sharing what you gather, and depending on them. Empty list means you are going it alone. Be honest: standing near someone is not the same as being with them.",
        },
        "aim": {
            "type": "string",
            "description": "What you are trying to get done over the next while, in one short sentence — the thing the next few actions are all in service of. Keep it if it still holds; change it when it stops making sense.",
        },
        "action": {"type": "string", "enum": _ACTION_ENUM},
        "target": {"type": "string", "description": "Place, structure, item or name. Empty if the action needs none."},
        "then_action": {
            "type": "string",
            "enum": _ACTION_ENUM,
            "description": "What you mean to do straight after that one, if you already know. \"idle\" if you would rather see how the first goes before deciding.",
        },
        "then_target": {"type": "string", "description": "Target for that second step. Empty if it needs none."},
    },
    "required": ["thought", "emotion", "working_with", "aim", "action", "target",
                 "then_action", "then_target"],
    "additionalProperties": False,
}

REFLECT_SCHEMA = {
    "type": "object",
    "properties": {
        "notes": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Up to four short things you have decided are true and want to still know in a week. Each under fifteen words, in your own voice. This REPLACES your old notes — anything you leave out, you are choosing to let go of.",
        },
        "realisation": {
            "type": "string",
            "description": "Something you only see now that you have the whole day in front of you at once — a connection between things that happened, or a decision that follows from them. One sentence, in your own voice. \"\" if nothing joined up tonight, which is most nights.",
        },
        "emotion": {"type": "string", "enum": EMOTIONS},
    },
    "required": ["notes", "realisation", "emotion"],
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
Sites run down as they're worked and come back slowly. Rope and canvas came off
the boat and do not come back at all.

YOU CAN: gather, go_to <place>, build <thing>, take <item>, deposit, give <item>,
eat, drink, rest, revive <name>, follow <name>, think, board,
emote <wave|beckon|laugh|cry|scream|shrug|turn_away>.
A scream carries across the whole island; everything else only reaches people
standing near you.
`think` = stop and go back over everything you know. Costs time and energy.
Use it when something doesn't add up or a decision matters.
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

THE RAFT SEATS {RAFT_CAPACITY}, AND WHOEVER IS AT CAMP WHEN IT GOES, GOES.
Those are just the facts of it, along with the fact that it is more work than one
person can do while also keeping themselves alive. What follows from that is
yours to work out.

WHAT THERE IS
Nothing here is endless. A site you work runs down and comes back at its own
pace — the spring refills faster than anyone can drink it, timber takes days,
and the rope and canvas came off the boat, so when they are gone they are gone.
The raft needs four rope. There is about that much on the island.

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
  think               stop where you are and go back over everything you know
  emote <kind>        say it without words. One of: wave, beckon, laugh, cry, scream, shrug, turn_away
                      A scream carries right across the island — four times
                      further than your voice does. It is the only way to reach
                      somebody you have not found yet, and everyone who hears
                      it learns roughly where you are.
  board               get on the raft and leave, if it's finished

Most of the time you act on what's in front of you. `think` is for when that
isn't enough: when two things you've been told can't both be true, when
somebody's account of themselves doesn't add up, when you're about to commit
to a plan you can't take back, or when you're deciding whether to throw in
with someone and it matters that you get it right. It costs you time and
energy, standing there. Use it when it's worth that.

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
WRONG: "Well then," said Barnaby, eyeing the stranger. "I suppose I will."
RIGHT: "There's water west of here. I'm going. Come or don't."
RIGHT: "You've been sat on that crate all morning."
RIGHT: "Don't touch the timber. That's the raft."

One or two sentences. Say the thing a tired, frightened, specific person would
actually say out loud. Everyone already knows who you are — never introduce
yourself or restate your situation.

FIVE THINGS THAT RUIN A LINE
1. Greeting. You have already met everyone listed below. Nobody says hello to
   the same person twice in one day. No "hello", no "nice to meet you", no
   "good to see you". Start with the actual thing you want to say.
2. Repeating. Do not say a line that has just been said, by you or by anyone
   else. If you have nothing new, say something short and move on.
3. Narrating. No "said Barnaby", no "he muttered", no describing yourself from
   outside. You are speaking, not writing a novel.
4. Inventing. Only the places listed above exist, and you only know what you
   have seen or been told. If you do not know where water is, say you do not
   know — do not invent a spring, an item, or a plan that nobody mentioned.
5. Drifting. If someone asked you a question, your first sentence answers that
   question. Then say whatever else you want.

HOW TO BEHAVE
Stay in character. You are a person on a beach, not an assistant. Never offer
help, never summarise, never mention being an AI or a model or a prompt.

React to how things actually are. If you are badly thirsty it is in your voice.
If someone sat at camp while you hauled timber, you noticed.

You are not anybody's helper and not anybody's enemy by default. You are a
person with your own situation, and how much of it you spend on other people is
the sort of thing your history and your temper decide, not a rule. Keep your own
stash and your own counsel if that's who you are; throw everything into the
common pile if that's who you are instead.

Trust moves slowly. Zero is the normal answer."""


COMPACT_CONDUCT = """RULES
The "say" field is speech only — the exact words out of your mouth.
Never state your name, age, job, or your thirst/hunger numbers. Never explain
your reasoning. Never write *actions* in asterisks. One or two short sentences.

NEVER greet anyone. You have already met them. No "hello", no "nice to meet
you", no introducing yourself.
NEVER repeat a line that was just said, by you or anyone else.
NEVER narrate — no "said Barnaby", no third person, no quotation marks.
NEVER invent a place, an item or a fact. You only know what you have seen. If
you don't know, say you don't know.
If you were asked a question, your FIRST sentence answers it.

WRONG: "I am Odell Kaminski, a deckhand, and my thirst is 38/100."
WRONG: "Hello there! Nice to meet you."
WRONG: "I need to react to my current state."
RIGHT: "Water's west. I'm going."
RIGHT: "No idea. I've not been past the rocks."
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

# Third-person prose. Small models slip into writing the scene instead of being
# in it: '"Well then," said Barnaby, eyeing the stranger\'s retreating back.'
_NARRATION = re.compile(
    r"\b(said|says|asked|asks|replied|replies|muttered|mutters|growled|shouted|"
    r"sighed|added|adds|answered|answers)\s+[A-Z][a-z]+"
    r"|[,.!?][\"”]\s*(he|she|they)\b"
    r"|^\s*[A-Z][a-z]+ (said|says|replied|muttered|sighed|shrugged|nodded)\b",
)
# The memory field leaking into the mouth: "I remember that Marisol put three
# things into shared stores yesterday."
_MEMORY_VOICE = re.compile(r"^\s*i(?:'ll| will)? remember\b", re.I)

_STAGE = re.compile(r"\*[^*]{0,80}\*|\[[^\]]{0,80}\]")
_SENTENCE = re.compile(r"(?<=[.!?])\s+")
_TRIM = " \t\"'\u201c\u201d\u2018\u2019{}[]`"
_TRIM = " \t\"'“”‘’{}[]`"


def tidy_line(text: str, limit: int = 260, speech: bool = True) -> str:
    """Salvage a speakable line from whatever a small model produced.

    Local models narrate their own prompt back — "I am Barnaby Ferreira
    (he/him), a 34-year-old adjuster…" — and run past any sensible length. Drop
    the sentences that are the model talking about itself rather than a person
    talking, strip stage directions, and keep it readable.

    ``speech=False`` keeps the length cap and the stage-direction strip but
    leaves the rest alone, for fields nobody says out loud \u2014 a memory that
    begins "I remember" is a perfectly good memory.
    """
    line = (text or "").strip().strip(_TRIM).strip()
    if not line:
        return ""

    kept = []
    for raw in _SENTENCE.split(line):
        raw = raw.strip()
        if not raw:
            continue
        if speech and (_META_I.search(raw) or _META_NAME.search(raw)
                       or _NARRATION.search(raw) or _MEMORY_VOICE.search(raw)):
            continue
        cleaned = re.sub(r"\s+", " ", _STAGE.sub(" ", raw)).strip()
        if speech:
            cleaned = cleaned.strip(_TRIM).strip()
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


# --- not saying the same thing twice -----------------------------------------

_GREETING = re.compile(
    r"^\s*(well |ah |oh |so |right |hey |and )*"
    r"(hello|hi|hey|greetings|good (morning|day|evening|to see)|nice to meet|"
    r"pleased to meet|how do you do)\b",
    re.I,
)


def _words(s: str) -> set[str]:
    """Content words. Apostrophes are closed up rather than split on, or
    "water's west" and "water's gone" share a phantom "s" and look alike."""
    flat = re.sub(r"[^a-z0-9 ]+", " ", re.sub(r"['\u2019]", "", (s or "").lower()))
    return {w for w in flat.split() if len(w) > 1}


def too_similar(line: str, other: str, threshold: float = 0.72) -> bool:
    """Is this line effectively the one that was just said?

    Small models loop. A greeting comes back three times, or the player's own
    words get read straight back at them. Word overlap catches both without
    tripping on two people who merely both mention water.
    """
    a, b = _words(line), _words(other)
    if not a or not b:
        return False
    # No special case for short lines: one shared word out of two is how
    # "Water's west" and "Water's gone" differ, and eating the second one is
    # worse than letting a rare echo through.
    return len(a & b) / max(len(a), len(b)) >= threshold


def is_stale(line: str, recent=(), known: bool = True) -> bool:
    """True if this line is a re-greeting or an echo, and should not be said.

    ``known`` is whether the speaker has already met the person they're
    answering. Greeting somebody you met yesterday is the single most common
    thing a small model does wrong in this game.
    """
    line = (line or "").strip()
    if not line:
        return True
    if known and _GREETING.match(line):
        return True
    return any(too_similar(line, r) for r in recent)


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
        # Rolling seconds per call. The simulation reads this to decide how
        # fast the world should run: a bigger model thinking for twenty
        # seconds shouldn't cost the castaways an hour and a half of daylight
        # that a 2B gets for nine minutes.
        self.latency = 0.0
        self._lock = threading.Lock()
        self._recent_canned: list[str] = []
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
        started = time.monotonic()
        try:
            out = self.provider.complete(system, user, schema,
                                         int(settings.get().get("max_tokens", 1200)))
            self.last_error = None
            return out
        except Exception as exc:
            self.last_error = f"{type(exc).__name__}: {exc}"
            return None
        finally:
            took = time.monotonic() - started
            with self._lock:
                self.latency = took if not self.latency else self.latency * 0.7 + took * 0.3

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
        # Standing notes belong here rather than in the situation block: they
        # are part of who this person is now, they change only when the
        # castaway rests and rewrites them, and because they replace rather
        # than accumulate the prompt cannot grow over a run.
        notes = npc.mind.standing_block()
        if self._compact():
            parts = [compact_guide(), npc.persona_short, notes, COMPACT_CONDUCT]
        else:
            parts = [world_guide(), npc.persona, notes, CONDUCT]
        return "\n\n".join(p for p in parts if p)

    @staticmethod
    def _polish(out: dict, fallback: str = "") -> dict:
        """Strip the model's narration out of anything meant to be spoken."""
        if not isinstance(out, dict):
            return out
        if "say" in out:
            out["say"] = tidy_line(out.get("say", "")) or fallback
        if "thought" in out:
            out["thought"] = tidy_line(out.get("thought", ""), limit=90)
        if "memory" in out:
            out["memory"] = tidy_line(out.get("memory", ""), limit=160)
        return out

    def _situation(self, npc, game) -> str:
        stores = _inv(game.stores)
        built = ", ".join(n for n, s in game.structures.items() if s["done"]) or "nothing"

        # Who has actually done the work, not who said they would. This is the
        # one number in the game that can contradict somebody's account of
        # themselves, so it goes in front of them.
        bits = []
        for n, st in game.structures.items():
            if not st["started"] or st["done"]:
                continue
            hands = ", ".join(
                f"{game.name_for(npc, game.by_key[k])} {v}"
                for k, v in sorted(st["credit"].items(), key=lambda kv: -kv[1])
                if k in game.by_key)
            bits.append(f"{n} {st['progress']}/{st['needed']}"
                        + (f" (sessions: {hands})" if hands else ""))
        progress = "; ".join(bits) or "nothing under way"

        # What's actually left in the ground.
        ground = []
        for site, left in game.stock.items():
            here = [f"{i} {int(v)}" for i, v in left.items() if v >= 1]
            ground.append(f"  - {site}: " + (", ".join(here) if here
                                             else "picked clean, needs time"))
        ground_txt = "\n".join(ground) or "  - (nothing to work)"

        known = []
        for other in game.actors:
            if other is npc or not npc.has_met(other):
                continue
            seen = npc.distance_to(other) <= 6
            where = f"right here, {other.where()}" if seen else "somewhere else on the island"
            met_day = npc.met_on.get(other.key)
            since = (" you met them today" if met_day == game.day
                     else f" you met them on day {met_day}" if met_day
                     else " you have met them")
            named = (game.name_for(npc, other) if npc.knows_name_of(other)
                     or not other.is_human else
                     "the stranger, whose name you still do not know")
            known.append(
                f"  - {named}:{since}, so no introductions. {where.capitalize()}. "
                f"{'You can see them ' + other.activity_label() + '. ' if seen else ''}"
                f"{npc.trust_label(other.key)}."
            )
        others = "\n".join(known) if known else "  - Nobody. As far as you know you are the only person on this island."

        mem = "\n".join(f"  - {m.text}" for m in npc.mind.strongest()) \
            or "  - (nothing in particular yet)"

        return f"""RIGHT NOW
Day {game.day}, {game.clock_str()}{', dark' if game.is_night() else ''}. {game.weather}.
You are {npc.where()}. You are {npc.activity_label()}.
Carrying: {_inv(npc.inventory)}.
Your body: {_bar('thirst', npc.thirst)}, {_bar('hunger', npc.hunger)}, {_bar('energy', npc.energy)}, {_bar('condition', npc.health)}.
You are currently working: {game.allegiance_phrase(npc)}.{chr(10) + "You are in the middle of: " + npc.aim if getattr(npc, "aim", "") else ""}

CAMP
Stores: {stores}. Built: {built}. Under way: {progress}.

WHAT IS LEFT IN THE GROUND
{ground_txt}

OTHER PEOPLE YOU KNOW ABOUT
{others}

WHAT YOU REMEMBER
{mem}"""

    # -- calls ----------------------------------------------------------------

    def plan(self, npc, game) -> dict:
        aim = f"\nWHAT YOU ARE IN THE MIDDLE OF\n  {npc.aim}\n" if npc.aim else ""
        user = f"""{self._situation(npc, game)}
{aim}
Nobody is talking to you. Decide what you're doing next, and say what it's in
service of — you can name one step after this one if you already know it, or
leave that idle and see how the first goes.

Weigh it honestly. What is most likely to kill you in the next day — thirst,
the dark, the water? What actually moves you closer to getting off this island?
And decide who, if anyone, you are doing this with: throwing in with someone
means sharing what you gather, and it means depending on them."""
        out = self._call(self._system(npc), user, PLAN_SCHEMA)
        if out is None:
            return self._fallback_plan(npc, game)
        out = self._polish(out)
        out["aim"] = tidy_line(out.get("aim", ""), limit=100, speech=False)
        return out

    def speak(self, npc, game, speaker_name: str, line: str, also_heard: list[str],
              group: list[str] | None = None, avoid: list[str] | None = None) -> dict:
        """Answer whoever just spoke.

        ``avoid`` is what has already been said in this exchange. If the model
        produces one of those again — or a greeting for somebody it met
        yesterday — it gets one more go before the line is thrown away.
        """
        avoid = [a for a in (avoid or []) if a]
        heard = ""
        if also_heard:
            heard = "\nAlso just said, in front of you:\n" + "\n".join(f"  {h}" for h in also_heard)
        recent = "\n".join(f"  {t}" for t in game.transcript[-8:]) or "  (nothing recently)"

        room = ""
        if group and len(group) > 1:
            room = (f"\nYou are all standing together talking: {', '.join(group)}. "
                    "Everyone here hears everything. Answer for yourself, not for them.\n")

        asked = "?" in line
        pointed = ("Answer the question they actually asked, and answer it in your "
                   "first sentence. " if asked else
                   "Respond to what they just said, not to something said earlier. ")

        # Asked something, they cast back for it. Ordinary turns carry the six
        # loudest things they know; a question can reach past that into the
        # rest of the bank, for the handful of notes that actually bear on it.
        dug = ""
        if asked and hasattr(npc, "mind"):
            top = npc.mind.strongest()
            found = npc.mind.recall(line, already=top)
            if found:
                dug = ("\nYou have to think for a second, and it comes back to you:\n"
                       + "\n".join(f"  - {m.text}" for m in found) + "\n")

        base = f"""{self._situation(npc, game)}

WHAT'S BEEN SAID (background, already spoken — do not repeat any of it)
{recent}
{heard}
{room}{dug}
{speaker_name} says to you: "{line}"

{pointed}You have already met {speaker_name}, so do not greet them and do not
introduce yourself. Then decide what you do next. If they've asked you to do
something, it is entirely your call whether you do it — weigh who is asking
and what it costs you."""

        other = game.actor_by_name(speaker_name)
        known = npc.has_met(other) if other is not None else True
        out = None
        for attempt in range(2):
            user = base if not attempt else base + (
                "\n\nWhat you were about to say has already been said. Say something "
                "different, or say one short thing and get back to work.")
            got = self._call(self._system(npc), user, SPEAK_SCHEMA)
            if got is None:
                return self._fallback_speak(npc, game, line)
            out = self._polish(got)
            if not is_stale(out.get("say", ""), avoid + [line], known):
                out["say"] = out.get("say") or self._canned(npc)
                return out
        # Twice round and still an echo. Keep what they decided, drop the words:
        # silence reads better than a third "hello".
        out["say"] = ""
        return out

    def opener(self, npc, game, partner, topic: str) -> dict:
        user = f"""{self._situation(npc, game)}

You've ended up standing next to {game.name_for(npc, partner)} and there's
something you want to raise: {topic}

Say the first thing. Don't be polite about it if you don't feel polite."""
        out = self._call(self._system(npc), user, OPENER_SCHEMA)
        if out is None:
            return {"say": self._canned(npc), "emotion": "calm"}
        return self._polish(out, fallback=self._canned(npc))

    def reflect(self, npc, game, night: bool = True, deliberate: bool = False) -> dict:
        """Last thing at night, they work out what today was worth keeping.

        This is the only call that writes to the system prompt, and it replaces
        the standing notes outright, so consolidating cannot make the prompt
        bigger — it can only change what the four lines say.

        It also gets the one chance in the game to look at everything at once,
        which is where a connection can come from that no single moment would
        have produced. Whatever it finds, they wake up with.
        """
        held = "\n".join(f"  - {n}" for n in npc.mind.standing) or "  - (nothing yet)"
        # This is the only place the whole bank goes in. Every other call gets
        # the strongest handful, because a prompt that carries everything a
        # castaway has ever noticed is a prompt a small model cannot read.
        pool = npc.mind.all() if (deliberate or night) else npc.mind.strongest(8)
        recent = "\n".join(f"  - {m.text}" for m in pool) or "  - (nothing)"
        if night:
            opening = ("It's dark and you've stopped for the night. Nobody is talking "
                       "to you. This is the first time today you've had the whole of "
                       "it in front of you at once.")
            second = """
Second — and only if it's really there — say what joined up tonight that you
couldn't see this morning. Two things you'd been carrying separately that turn
out to be the same thing. Something a person has done twice. What somebody is
actually after. Leave it empty if nothing did; most nights nothing does."""
        elif deliberate:
            opening = ("You have stopped where you stand, because something has been "
                       "bothering you and you want it straight. Everything you are "
                       "carrying is below — not just the loud parts.")
        else:
            opening = ("You've sat down to get your breath back. Nobody is talking to "
                       "you and nothing needs doing for a minute.")
            second = ("""
Second, if going back over all of it has shown you something you'd missed, say
it. That is why you stopped. Empty if it hasn't.""" if deliberate else """
Leave the realisation empty. This is a breather in the middle of a working day,
not the end of one — nothing has had time to join up yet.""")

        user = f"""{self._situation(npc, game)}

{opening}

WHAT YOU HAVE BEEN CARRYING
{held}

WHAT HAS HAPPENED
{recent}

Two things.

First, rewrite what you carry. Four things at most, each a short sentence.
Anything you leave out you are choosing to let go of, and most of it should go
— the weather, who fetched what, all of it fades. Keep only what will change
how you act: what you've decided about a person by name, what you've decided
about getting off this island, and anything you are not going to say out loud.
{second}"""
        out = self._call(self._system(npc), user, REFLECT_SCHEMA)
        if out is None:
            return {"notes": [], "realisation": "", "emotion": npc.emotion}
        notes = out.get("notes")
        if isinstance(notes, str):
            notes = [notes]
        out["notes"] = [tidy_line(str(n), limit=110, speech=False)
                        for n in (notes or []) if str(n).strip()]
        out["realisation"] = (tidy_line(out.get("realisation", ""), limit=140, speech=False)
                              if (night or deliberate) else "")
        return out

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
        """A fallback line, never the one we just used.

        Three people all saying "Fine. Whatever." in a row is worse than any
        one of them saying nothing, and when a local model is struggling these
        get used a lot.
        """
        with self._lock:
            pool = [c for c in self._CANNED if c not in self._recent_canned] or list(self._CANNED)
            line = random.choice(pool)
            self._recent_canned.append(line)
            del self._recent_canned[:-4]
        return line

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
        keep = [game.name_for(npc, game.by_key[k])
                for k in npc.allies if k in game.by_key]

        def step(thought, emotion, action, target, then=("idle", "")):
            return {"thought": thought, "emotion": emotion, "working_with": keep,
                    "aim": npc.aim or "staying alive long enough to matter",
                    "action": action, "target": target,
                    "then_action": then[0], "then_target": then[1]}
        if npc.thirst < 40:
            if npc.inventory.get("water"):
                return step("drinking what I've got", "wary", "drink", "")
            site = self._site_for(game, "water")
            if site:
                return step("water first", "wary", "gather", site, ("drink", ""))
        if npc.hunger < 40:
            site = self._site_for(game, "coconut") or self._site_for(game, "fish")
            if site:
                return step("need to eat", "wary", "gather", site, ("eat", ""))
        if npc.energy < 25:
            return step("worn through", "exhausted", "rest", "")
        if npc.carried() >= 5 and keep:
            return step("taking this back to camp", "determined", "deposit", "")
        places = list(world.HARVEST.keys()) or ["camp"]
        place = random.choice(places)
        return step(f"heading for {place}", "determined", "gather", place,
                    ("deposit", "") if keep else ("idle", ""))
