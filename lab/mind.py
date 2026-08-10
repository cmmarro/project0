"""The head.

It is handed a body's worth of feeling, a room, and the subject's own account
of its day, and it decides what happens next. That is a much larger licence
than this file used to have — it used to be shown two tied options and asked to
pick one, which is a job a coin does for free.

What it is *not* given is the scoring table. Hand a model a column of decimals
and it will do arithmetic and agree with them, and then you have paid several
seconds for a slower version of the code you already had. It gets the body in
words instead — parched, tired, bored — because a feeling is something you
decide about and a number is something you look up.

Two things live here that no scoring layer can hold:

  what was said     the words through the glass arrive verbatim and
                    uninterpreted. Nothing else in the lab can represent
                    "they said pressing that gets me fed", because there is no
                    need it corresponds to and no curve it sits on.

  what it is like   the subject's own log of what it did and why, fed back in.
                    A stance — deciding you don't trust the voice — persists
                    across unrelated decisions without anybody having written
                    a variable called trust.

If the head produces nothing, or produces nonsense, the body carries on
perfectly well without it. That is the control condition and it is always
running underneath.
"""

from __future__ import annotations

from island import providers, settings

ACT_SCHEMA = {
    "type": "object",
    "properties": {
        "because": {
            "type": "string",
            "description": "Why, in your own voice, first person, under fifteen words. Not a justification for anybody — just the thought.",
        },
        "do": {
            "type": "string",
            "description": "Exactly one key from the list of things you can do.",
        },
        "at": {
            "type": "string",
            "description": "The key of the thing you're doing it to, if the action needs one. Otherwise \"\".",
        },
        "say": {
            "type": "string",
            "description": "Something to say out loud through the glass, or \"\" to say nothing. Most of the time, nothing. Speak when you actually have something to say to whoever is out there.",
        },
        "then": {
            "type": "string",
            "description": "What you intend to do straight after this one, if you have thought that far. A key from the same list, or \"\".",
        },
    },
    "required": ["because", "do", "at", "say", "then"],
    "additionalProperties": False,
}

BRIEF = """You woke on the floor of a bare room and you do not remember arriving.
There is a door with no handle on your side, and a window with somebody behind
it who can see you. You have been here a while now.

You are not narrating and you are not explaining yourself to anyone. You are a
person deciding what to do next, and you will be told what happened afterwards.

Some things about how this works:

- Your body looks after itself at the extremes. If you get close to collapse it
  will go and drink or eat without consulting you, and you will find out
  afterwards. Between here and there, what you do about being thirsty is up to
  you, and it is allowed to be nothing.
- What you have done already is listed. You do not have to keep doing it.
- The person behind the glass says things. They are written down exactly as
  said. Nobody has interpreted them for you and nobody is going to. Believe
  them, test them, ignore them, or answer them — that is yours to decide.
- You can speak. There is glass between you and it is not clear they will
  answer. Say something when you have something to say.

Pick one action from the list and give the key exactly as written."""


class Mind:
    def __init__(self):
        self.provider = providers.build(settings.get())
        self.calls = 0
        self.last_error: str | None = None
        self.last: dict | None = None

    @property
    def online(self) -> bool:
        return self.provider is not None

    def act(self, p: dict, reason: str) -> dict | None:
        """One decision. `p` is a plain dict assembled by the lab under its
        lock, so this runs on a background thread without touching the sim."""
        if not self.provider:
            return None

        known = "\n".join(f"  - {line}" for line in p["known"]) \
            or "  - (you have not worked out what anything in here is)"
        unknown = (f"\nThere are {p['unknown']} other things in the room you have "
                   "not looked at properly." if p["unknown"] else "")
        learned = "\n".join(f"  - {line}" for line in p["learned"]) \
            or "  - (nothing yet)"
        story = "\n".join(
            f"  {r['t']}  {r['label']}"
            + {"reflex": "  (your body did this, you did not decide it)",
               "habit": "  (you no longer think about this)",
               "thought": ""}.get(r["by"], "")
            for r in p["story"]) or "  (nothing yet)"
        heard = "\n".join(f"  {h['t']}  “{h['text']}”" for h in p["heard"]) \
            or "  (they have not said anything)"
        said = "\n".join(f"  - “{t}”" for t in p["said"]) or "  (nothing)"
        can = "\n".join(f"  {k}: {v}" for k, v in p["can"].items())
        things = ", ".join(f"{k} ({v})" for k, v in p["things"].items()) or "none yet"

        user = f"""It is {p['clock']} and it is {'dark' if p['dark'] else 'light'}.

YOUR BODY
{p['feels']}.

THE ROOM
{known}{unknown}

WHAT YOU HAVE NOTICED
{learned}

WHAT YOU HAVE BEEN DOING
{story}

SAID TO YOU THROUGH THE GLASS
{heard}

WHAT YOU HAVE SAID BACK
{said}

The crate lid is {p['crate']}% off.

WHAT YOU CAN DO
{can}

Names you can use for `at`: {things}

You are {p['doing']}. {reason.capitalize()}. What do you do?"""

        try:
            self.calls += 1
            out = self.provider.complete(
                BRIEF, user, ACT_SCHEMA,
                int(settings.get().get("max_tokens", 700)))
            self.last_error = None
        except Exception as exc:
            self.last_error = f"{type(exc).__name__}: {exc}"
            return None

        do = str(out.get("do", "")).strip().lower()
        if do not in p["can"]:
            # A verb it invented is no answer at all. The body takes over.
            self.last = {"do": do, "bad": True}
            return None
        at = str(out.get("at", "")).strip().lower()
        if at not in p["things"]:
            at = ""
        then = str(out.get("then", "")).strip().lower()
        result = {
            "do": do,
            "at": at,
            "because": str(out.get("because", "")).strip()[:140],
            "say": str(out.get("say", "")).strip()[:180],
            "then": {"do": then} if then in p["can"] and then != do else None,
        }
        self.last = result
        return result
