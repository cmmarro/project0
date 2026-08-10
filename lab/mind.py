"""The one place a language model is allowed into the lab.

It is handed a tie — two or three options the scoring system rates as equal —
and asked which one this subject takes. That is all it can do. It cannot invent
an action, it cannot override a clear decision, and if it fails or says nothing
the tie breaks on score exactly as it would have.

The narrow interface is the experiment. If a mind that only ever breaks ties
produces something you can *see* from behind the glass, that tells you where
the latency is worth paying. If it doesn't, that tells you something too.
"""

from __future__ import annotations

from island import providers, settings

HEARD_SCHEMA = {
    "type": "object",
    "properties": {
        "kind": {
            "type": "string",
            "enum": ["offer", "remark"],
            "description": "\"offer\" only if they said that doing some particular thing will get you something you need. Anything else — a greeting, a question, a threat, a comment — is a remark.",
        },
        "do": {
            "type": "string",
            "description": "If it's an offer: the key of the thing you'd have to use. Exactly one of the keys listed. \"\" for a remark.",
        },
        "gives": {
            "type": "string",
            "description": "If it's an offer: which of your needs it would serve. Exactly one of the need keys listed. \"\" for a remark.",
        },
        "took_it_as": {
            "type": "string",
            "description": "What you understood by it, in your own voice, under fifteen words. Not a reply — you have no way to answer. Just what you made of it.",
        },
    },
    "required": ["kind", "do", "gives", "took_it_as"],
    "additionalProperties": False,
}

HEARD_BRIEF = """You are a person who woke on the floor of a bare room with no
memory of arriving. Somebody is on the other side of the window and has just
said something to you. You cannot answer — there is no way to.

Work out what they meant. Most of what anyone says is not an offer: it is a
greeting, a question, a threat, an idle remark. Only call it an offer if they
have actually said that doing some specific thing will get you something you
need. If they have, name the thing and the need from the lists given, using the
exact keys. If they haven't, it is a remark and you leave both blank."""

CHOICE_SCHEMA = {
    "type": "object",
    "properties": {
        "pick": {"type": "string", "description": "The key of the option you take."},
        "because": {
            "type": "string",
            "description": "One short line, in the subject's own voice, for why that one. Under twelve words.",
        },
    },
    "required": ["pick", "because"],
    "additionalProperties": False,
}

BRIEF = """You are a person who has woken on the floor of a bare room with no
memory of arriving. There is a door that does not open and a window with someone
behind it. You are not narrating and you are not explaining yourself to anybody
— you are just deciding what to do next.

You are given two or three things you might do, which you want about equally.
Pick one. There is no right answer; that is the point of asking you. Pick the
one that a specific, tired, curious person would pick, and say why in a few
words."""


class Mind:
    def __init__(self):
        self.provider = providers.build(settings.get())
        self.calls = 0
        self.last_error: str | None = None
        self.last: dict | None = None

    @property
    def online(self) -> bool:
        return self.provider is not None

    def hear(self, lab, text: str) -> dict | None:
        """Work out what was just said through the glass.

        The interface used to make you build a promise out of dropdowns, so
        typing "Hello?" became a binding offer worth 75% belief, which is
        nonsense. Deciding whether an utterance contains an offer is exactly
        the sort of thing the scoring layer cannot do and a model can — so it
        is a good place to spend a call, and the only place speech is parsed.
        """
        if not self.provider:
            return None
        things = ", ".join(f"{t.key} ({t.label})" for t in lab.things.values()
                           if t.known) or "(you haven't worked out what anything is)"
        needs = ", ".join(f"{n.key} ({n.label})" for n in lab.subject.needs.values())
        user = f"""Things in this room you have worked out: {things}
Your needs: {needs}

Through the glass, they say: {text!r}

What was that?"""
        try:
            self.calls += 1
            out = self.provider.complete(
                HEARD_BRIEF, user, HEARD_SCHEMA,
                int(settings.get().get("max_tokens", 700)))
            self.last_error = None
        except Exception as exc:
            self.last_error = f"{type(exc).__name__}: {exc}"
            return None

        kind = str(out.get("kind", "remark")).strip().lower()
        do = str(out.get("do", "")).strip().lower()
        gives = str(out.get("gives", "")).strip().lower()
        # An offer that names something that isn't there is not an offer.
        if kind == "offer" and (do not in lab.things or gives not in lab.subject.needs):
            kind, do, gives = "remark", "", ""
        return {"kind": kind, "do": do, "gives": gives,
                "took_it_as": str(out.get("took_it_as", "")).strip()[:120]}

    def break_tie(self, lab, options) -> str | None:
        if not self.provider:
            return None
        s = lab.subject
        body = ", ".join(f"{n.label} {n.level:.0%}" for n in s.needs.values())
        known = ", ".join(t.label for t in lab.things.values() if t.known) or "nothing yet"
        learned = "\n".join(f"  - {line}" for line in s.learned[-6:]) or "  - (nothing yet)"
        choices = "\n".join(
            f"  {o['key']}: {o['label']} — {o['why']} (weighs {o['score']:.2f})"
            for o in options)
        user = f"""It is {lab.clock()} by the light. You feel: {body}.
You have worked out what these are: {known}.

WHAT YOU'VE NOTICED
{learned}

You want these about equally:
{choices}

Which do you do?"""
        try:
            self.calls += 1
            out = self.provider.complete(
                BRIEF, user, CHOICE_SCHEMA,
                int(settings.get().get("max_tokens", 700)))
            self.last_error = None
        except Exception as exc:
            self.last_error = f"{type(exc).__name__}: {exc}"
            return None

        pick = str(out.get("pick", "")).strip().lower()
        keys = {o["key"] for o in options}
        if pick not in keys:
            # A key it invented is no answer at all. Fall back to the score.
            return None
        because = str(out.get("because", "")).strip()
        self.last = {"pick": pick, "because": because}
        if because:
            lab.note(because, "mind")
            lab.subject.remember(because)
        return pick
