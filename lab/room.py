"""The room, and the things you have put in it.

The room is bare: four walls, one of them glass, and a floor. Everything else
arrives because you dropped it there. Nothing in the behaviour layer names a
specific object — a job asks for *a* water source and gets the nearest working
one — so two taps are two taps, and taking the only one away is a thing that
can happen to a subject rather than a flag on a fixture.
"""

from __future__ import annotations

import math

from .catalogue import KINDS

W, H = 24, 14

FLOOR, WALL, GLASS = ".", "#", "="


class Thing:
    """One placed object.

    ``kind`` is the template it came from; ``id`` is this one. The distinction
    is the whole reason the palette works: behaviour is written against kinds,
    the world is made of instances.
    """

    def __init__(self, tid: str, kind: str, x: float, y: float):
        spec = KINDS[kind]
        self.id = tid
        self.kind = kind
        self.label = spec["label"]
        self.x, self.y = float(x), float(y)
        self.glyph = spec["glyph"]
        self.examine = spec.get("examine", "")
        self.need = spec.get("need", "")          # which need using it fills
        self.rate = spec.get("rate", 0.0)
        self.uses = spec.get("uses")              # None = unlimited
        self.cap = self.uses
        self.refill = spec.get("refill", 0.0)
        self.known = False                        # worked out what it is yet
        self.looked = 0
        # You are on the other side of the glass and you control the supply.
        self.enabled = True
        self.controllable = bool(self.need) or kind == "lamp"
        self.state = dict(spec.get("state", {}))
        # Something to be getting on with, rather than something you need.
        self.occupation = spec.get("occupation")

    def spent(self) -> bool:
        if not self.enabled:
            return True
        return self.uses is not None and self.uses <= 0

    def tick(self, minutes: float):
        """Come back, slowly. A tap that never runs dry is never a decision."""
        if self.uses is not None and self.refill and self.uses < self.cap:
            self.uses = min(self.cap, self.uses + self.refill * minutes)

    def snapshot(self) -> dict:
        return {"id": self.id, "kind": self.kind,
                "label": self.label if self.known else "?",
                "x": self.x, "y": self.y, "glyph": self.glyph,
                "known": self.known, "looked": self.looked,
                "uses": None if self.uses is None else round(self.uses, 2),
                "cap": self.cap, "spent": self.spent(),
                "enabled": self.enabled, "controllable": self.controllable,
                "state": dict(self.state),
                "occupation": bool(self.occupation)}


def build() -> list[str]:
    """Four walls, one of them glass, and nothing else at all."""
    grid = [[FLOOR] * W for _ in range(H)]
    for x in range(W):
        grid[0][x] = grid[H - 1][x] = WALL
    for y in range(H):
        grid[y][0] = grid[y][W - 1] = WALL
    for y in range(4, 10):
        grid[y][W - 1] = GLASS
    return ["".join(row) for row in grid]


def walkable(rows: list[str], x: int, y: int) -> bool:
    if not (0 <= x < W and 0 <= y < H):
        return False
    return rows[y][x] == FLOOR


def placeable(rows: list[str], x: int, y: int) -> bool:
    """Fittings go on a wall; everything else stands on the floor. Both are
    legal places to drop something, so this is looser than `walkable`."""
    if not (0 <= x < W and 0 <= y < H):
        return False
    return True


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
