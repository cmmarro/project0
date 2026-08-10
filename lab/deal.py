"""A promise made through the glass, and whether it was kept.

This is the part of the lab that the scoring system cannot do. "Press the
button and I'll feed you" is not a need, it is a *conditional* somebody told
you, and acting on it requires holding a causal chain that nothing in the
environment will remind you of.

So the test is precise: say it once, walk away, and see whether the subject
presses the button *later*, when it is hungry, unprompted — and see what
happens to its trust in you when you keep your word or don't.
"""

from __future__ import annotations


class Deal:
    """One conditional the subject believes, more or less."""

    def __init__(self, do: str, gives: str, said: str, at: str):
        self.do = do              # thing key they must use
        self.gives = gives        # need key it's meant to serve
        self.said = said          # what you actually said
        self.at = at              # clock time you said it
        self.belief = 0.5         # 0 = they think you're lying, 1 = certain
        self.tested = 0           # times they've done their half
        self.kept = 0             # times you did yours
        self.pending = False      # they've pressed and are waiting on you

    def honoured(self):
        self.tested += 1
        self.kept += 1
        self.belief = min(1.0, self.belief + 0.3)
        self.pending = False

    def broken(self):
        self.tested += 1
        self.belief = max(0.0, self.belief - 0.35)
        self.pending = False

    @property
    def state(self) -> str:
        if self.tested == 0:
            return "untested"
        if self.belief >= 0.7:
            return "holds up"
        if self.belief <= 0.25:
            return "a lie"
        return "unsure"

    def snapshot(self) -> dict:
        return {"do": self.do, "gives": self.gives, "said": self.said,
                "at": self.at, "belief": round(self.belief, 2),
                "tested": self.tested, "kept": self.kept,
                "pending": self.pending, "state": self.state}
