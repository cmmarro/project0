"""The room, and the things in it.

Deliberately one screen and about a dozen objects. The point of the lab is to
watch one subject decide, and a bigger world only makes the decisions harder to
read, not more interesting.

Nothing in here is themed as anything in particular. It is a room with a door
the subject has not opened, which is enough of a premise.
"""

from __future__ import annotations

import math

W, H = 24, 14

FLOOR, WALL, GLASS = ".", "#", "="


class Thing:
    """Something in the room that can be used or looked at.

    ``affords`` is what using it does to needs. ``examine`` is the line the
    subject learns the first time they look properly — the lab's whole
    discovery arc is objects moving from unknown to known.
    """

    def __init__(self, key, label, x, y, affords=None, examine="", uses=None,
                 glyph="?", refill=0.0):
        self.key = key
        self.label = label
        self.x, self.y = x, y
        self.affords = affords or {}
        self.examine = examine
        self.glyph = glyph
        self.uses = uses            # None = unlimited
        self.cap = uses
        self.refill = refill        # units per simulated minute
        self.known = False          # has the subject worked out what it is
        self.looked = 0             # how many times they've examined it
        # You are on the other side of the glass, and you control the supply.
        # This is where the lab's dilemmas actually come from: the room can't
        # generate a hard choice on its own, but you can make one in a click.
        self.enabled = True
        self.controllable = bool(affords)

    def spent(self) -> bool:
        if not self.enabled:
            return True
        return self.uses is not None and self.uses <= 0

    def tick(self, minutes: float):
        """Come back, slowly. A tap that never runs dry is never a decision."""
        if self.uses is not None and self.refill and self.uses < self.cap:
            self.uses = min(self.cap, self.uses + self.refill * minutes)

    def snapshot(self) -> dict:
        return {"key": self.key, "label": self.label if self.known else "?",
                "x": self.x, "y": self.y, "glyph": self.glyph,
                "known": self.known, "looked": self.looked,
                "uses": None if self.uses is None else round(self.uses, 2),
                "cap": self.cap, "spent": self.spent(),
                "enabled": self.enabled, "controllable": self.controllable,
                "affords": sorted(self.affords)}


def build() -> tuple[list[str], dict[str, Thing]]:
    grid = [[FLOOR] * W for _ in range(H)]
    for x in range(W):
        grid[0][x] = grid[H - 1][x] = WALL
    for y in range(H):
        grid[y][0] = grid[y][W - 1] = WALL
    # One wall is glass. You are on the other side of it.
    for y in range(4, 10):
        grid[y][W - 1] = GLASS

    things = [
        # The tap and the hatch are on opposite walls and both run out. That
        # is the entire source of dilemma in this room: two things you want,
        # a walk between them, and a wait if you get there and it's dry.
        Thing("tap", "water tap", 4, 3, {"thirst": 0.55}, glyph="T", uses=3.0,
              refill=1 / 90,
              examine="A tap. It runs when you turn it, then stops, and takes a "
                      "long while to come back."),
        Thing("hatch", "food hatch", 19, 3, {"hunger": 0.5}, glyph="H", uses=2.0,
              refill=1 / 150,
              examine="A hatch in the wall. Something edible arrives in it now "
                      "and then, and not on any schedule you can see."),
        Thing("cot", "cot", 4, 10, {"energy": 0.9}, glyph="C",
              examine="A low cot, bolted down. It is not comfortable but it is a bed."),
        Thing("door", "door", 12, 0, {}, glyph="D",
              examine="A door with no handle on this side. It does not move."),
        Thing("glass", "the glass", W - 1, 7, {}, glyph="|",
              examine="A window. There is a room on the other side, and it is "
                      "not empty."),
        Thing("crate", "crate", 16, 9, {}, glyph="B",
              examine="A crate with the lid nailed down. Something shifts inside "
                      "when it's tipped."),
        Thing("drain", "drain", 8, 11, {}, glyph="o",
              examine="A drain in the floor. It smells of nothing at all."),
        Thing("mark", "scratches", 20, 11, {}, glyph="x",
              examine="Scratches on the wall, low down. Somebody counted "
                      "something here, and stopped at nineteen."),
        # Does nothing on its own. It exists so there is something to promise
        # a reward for — the one test a scoring system cannot pass by itself,
        # because "they said they'd feed me if I pressed it" is not a need.
        Thing("button", "button", 8, 6, {}, glyph="O",
              examine="A button set flush in a pillar. Pressing it makes a "
                      "sound somewhere behind the wall. Nothing else happens."),
        Thing("lamp", "lamp", 12, 6, {"curiosity": 0.1}, glyph="*",
              examine="A lamp set into the ceiling. It does not turn off."),
    ]
    return ["".join(row) for row in grid], {t.key: t for t in things}


def walkable(rows: list[str], x: int, y: int) -> bool:
    if not (0 <= x < W and 0 <= y < H):
        return False
    return rows[y][x] == FLOOR


def step_toward(rows, fx: float, fy: float, tx: float, ty: float,
                speed: float) -> tuple[float, float]:
    """Move, sliding along a wall rather than stopping dead against it.

    A* would be overkill in a room with no interior walls, and the sliding is
    what stops a subject looking stupid when they clip a corner.
    """
    dx, dy = tx - fx, ty - fy
    dist = math.hypot(dx, dy)
    if dist < 0.05:
        return tx, ty
    # Never overshoot the target, and if a full step lands in a wall try a
    # shorter one. A single all-or-nothing step leaves a subject frozen a few
    # hundredths outside arm's reach of something set into a wall, which is
    # exactly how one of them starved.
    for frac in (1.0, 0.5, 0.25):
        move = min(speed * frac, dist)
        nx, ny = fx + dx / dist * move, fy + dy / dist * move
        ox, oy = fx, fy
        if walkable(rows, round(nx), round(fy)):
            ox = nx
        if walkable(rows, round(ox), round(ny)):
            oy = ny
        if (ox, oy) != (fx, fy):
            return ox, oy
    return fx, fy
