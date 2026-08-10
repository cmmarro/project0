"""What a castaway keeps, and what they let go of.

Two tiers, because context is the scarce resource here — a 2B model drowns long
before a large one does, and a memory list that only ever grows is the fastest
way to drown it.

**Working memory** is what just happened: short notes written in their own
voice, each with a weight that decays as game time passes. Only the strongest
few ever reach a prompt, and the rest fall off the bottom. It is *meant* to be
forgotten. Repeating an event doesn't add a second copy of it, it makes the
existing one heavier — which is also why "I remember giving that coconut away"
stops appearing five times in the log.

**Standing notes** are what they've decided is true. They live in the system
prompt rather than being appended to it, and they are rewritten *wholesale*
when a castaway rests and reflects. That's the important property: this tier
cannot grow. Four lines on day one, four lines on day nine. What changes is
what's in them — which is what a character turning into someone looks like
from the outside.
"""

from __future__ import annotations

import re

# Working memory
HALF_LIFE_MINUTES = 26 * 60    # a plain memory is half as loud a day later
FLOOR = 0.22                   # below this it's gone
WORKING_CAP = 12               # how many are held at all
IN_PROMPT = 6                  # how many are shown

# Standing notes
STANDING_CAP = 4
NOTE_WORDS = 16


def _words(text: str) -> set[str]:
    flat = re.sub(r"[^a-z0-9 ]+", " ", re.sub(r"['’]", "", (text or "").lower()))
    return {w for w in flat.split() if len(w) > 2}


def same_thing(a: str, b: str, threshold: float = 0.72) -> bool:
    """Are these two notes about the same event?

    Looser than the check that stops a castaway repeating a line out loud —
    here a false positive costs one duplicate memory, which is what we want to
    lose anyway.
    """
    wa, wb = _words(a), _words(b)
    if not wa or not wb:
        return False
    return len(wa & wb) / max(len(wa), len(wb)) >= threshold


class Memory:
    __slots__ = ("text", "day", "weight")

    def __init__(self, text: str, day: int, weight: float = 1.0):
        self.text = text
        self.day = day
        self.weight = weight

    def __repr__(self) -> str:
        return f"<Memory {self.weight:.2f} {self.text[:40]!r}>"


class MemoryBank:
    def __init__(self) -> None:
        self.working: list[Memory] = []
        self.standing: list[str] = []
        self.reflections = 0

    # -- working memory -------------------------------------------------------

    def remember(self, text: str, day: int = 1, weight: float = 1.0) -> bool:
        """File a note. Returns True if it was new rather than a reinforcement."""
        text = (text or "").strip()
        if not text:
            return False
        for m in self.working:
            if same_thing(text, m.text):
                # It happened again, or it mattered enough to say twice. That
                # makes it stickier, not longer.
                m.weight = min(2.0, m.weight + 0.5)
                m.day = day
                return False
        self.working.append(Memory(text, day, weight))
        self._trim()
        return True

    def fade(self, game_minutes: float) -> None:
        if not self.working or game_minutes <= 0:
            return
        decay = 0.5 ** (game_minutes / HALF_LIFE_MINUTES)
        for m in self.working:
            m.weight *= decay
        self.working = [m for m in self.working if m.weight >= FLOOR]

    def _trim(self) -> None:
        if len(self.working) > WORKING_CAP:
            self.working.sort(key=lambda m: m.weight)
            del self.working[:len(self.working) - WORKING_CAP]

    def strongest(self, n: int = IN_PROMPT) -> list[Memory]:
        """The ones worth spending prompt on, oldest first so they read as a story."""
        top = sorted(self.working, key=lambda m: m.weight, reverse=True)[:n]
        return sorted(top, key=lambda m: self.working.index(m))

    def recall(self, query: str, already=(), limit: int = 3) -> list[Memory]:
        """Dig for something specific that isn't loud enough to be top of mind.

        Asked a question, a person casts back for the answer rather than only
        offering whatever they happened to be thinking about. This is that:
        word overlap against the whole bank, minus what's already in the
        prompt. No extra model call — the memory was always there, it just
        wasn't worth the tokens until somebody asked.
        """
        want = _words(query)
        if not want:
            return []
        # Rare words carry the question. "Water" appears in half of everything
        # anyone remembers and means nothing; a name that appears in one note
        # is the whole of what was asked.
        seen_in: dict[str, int] = {}
        banks = [_words(m.text) for m in self.working]
        for ws in banks:
            for w in ws:
                seen_in[w] = seen_in.get(w, 0) + 1

        scored = []
        already_ids = {id(m) for m in already}
        for m, ws in zip(self.working, banks):
            if id(m) in already_ids:
                continue
            score = sum(1.0 / (1 + seen_in[w]) for w in (want & ws))
            if score >= 0.4:
                scored.append((score, m.weight, m))
        scored.sort(key=lambda t: (t[0], t[1]), reverse=True)
        return [m for _, _, m in scored[:limit]]

    def all(self) -> list[Memory]:
        """Everything they're still carrying. Only for a deliberate think."""
        return list(self.working)

    def texts(self) -> list[str]:
        return [m.text for m in self.working]

    # -- standing notes -------------------------------------------------------

    def set_standing(self, notes) -> list[str]:
        """Replace the standing notes. Replace, never append — that's the point."""
        clean = []
        for raw in (notes or []):
            note = " ".join(str(raw).split())
            if not note:
                continue
            words = note.split()
            if len(words) > NOTE_WORDS:
                note = " ".join(words[:NOTE_WORDS]).rstrip(",;:") + "…"
            if not any(same_thing(note, k) for k in clean):
                clean.append(note)
            if len(clean) >= STANDING_CAP:
                break
        if clean:
            self.standing = clean
            self.reflections += 1
        return self.standing

    def standing_block(self) -> str:
        if not self.standing:
            return ""
        lines = "\n".join(f"  - {n}" for n in self.standing)
        return f"WHAT YOU HAVE DECIDED IS TRUE\n{lines}"

    def snapshot(self) -> dict:
        return {
            "standing": list(self.standing),
            "working": [{"text": m.text, "weight": round(m.weight, 2), "day": m.day}
                        for m in sorted(self.working, key=lambda m: m.weight, reverse=True)],
            "reflections": self.reflections,
        }
