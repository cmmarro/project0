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
