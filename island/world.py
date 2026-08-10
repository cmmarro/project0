"""The island — generated fresh from a seed each run.

Every run rolls a different coastline, a different scatter of resource sites,
and a different distance between the things you need. Call `generate(seed)`
before anything else touches the module.
"""

from __future__ import annotations

import math
import random
from collections import deque

WIDTH, HEIGHT = 36, 24

# Tile glyphs -----------------------------------------------------------------
DEEP = "~"
SHALLOW = "w"
SAND = "s"
JUNGLE = "g"
TREE = "j"
PALM = "p"
ROCK = "r"
HILL = "h"
SPRING = "f"
WRECK = "x"
CAMP = "c"

BLOCKED = {DEEP, TREE, PALM, ROCK, SPRING, WRECK}

WALKABLE_LABEL = {
    SHALLOW: "in the shallows",
    SAND: "on the beach",
    JUNGLE: "in the jungle",
    HILL: "on the high ground",
    CAMP: "at camp",
}

ITEM_LABEL = {
    "water": "fresh water",
    "coconut": "a coconut",
    "frond": "a palm frond",
    "wood": "timber",
    "fish": "a fish",
    "flint": "a piece of flint",
    "rope": "a coil of rope",
    "cloth": "a length of canvas",
}

# Site templates: name -> (what it yields, how it's described, terrain it wants)
SITE_TEMPLATES = {
    "spring": (["water"], "a freshwater spring — the only drinkable water on the island", "inland"),
    "palm grove": (["coconut", "frond"], "a stand of palms — coconuts and fronds", "inland"),
    "woods": (["wood"], "thick jungle — deadfall and driftwood for timber", "inland"),
    "tidepools": (["fish", "flint"], "rocks and tidepools — fish, and flint in the stones", "shore"),
    "the wreck": (["rope", "cloth"], "what the sea left of the boat — rope and canvas", "shore"),
    "the shelf": (["fish"], "a shallow shelf where the fish come in on the tide", "shore"),
    "the scree": (["flint", "wood"], "a rockfall with dead timber caught in it", "inland"),
    "the drift": (["cloth", "wood"], "a tangle of drift and wreckage piled by a storm", "shore"),
}

# Always present. The rest are rolled per run.
CORE_SITES = ["spring", "palm grove", "woods", "tidepools", "the wreck"]
OPTIONAL_SITES = ["the shelf", "the scree", "the drift"]

# Module state, replaced by generate() ----------------------------------------
GRID: list[list[str]] = []
LANDMARKS: dict[str, dict] = {}
HARVEST: dict[str, list[str]] = {}
SEED = 0


def generate(seed: int | None = None) -> int:
    """Build a new island. Returns the seed used."""
    global GRID, LANDMARKS, HARVEST, SEED
    SEED = seed if seed is not None else random.randrange(1, 10**9)
    rng = random.Random(SEED)

    grid = _landmass(rng)
    landmarks, harvest = _place_sites(grid, rng)

    GRID, LANDMARKS, HARVEST = grid, landmarks, harvest
    return SEED


def _landmass(rng: random.Random) -> list[list[str]]:
    grid = [[DEEP] * WIDTH for _ in range(HEIGHT)]
    cx, cy = (WIDTH - 1) / 2, (HEIGHT - 1) / 2
    rx = WIDTH * rng.uniform(0.40, 0.48)
    ry = HEIGHT * rng.uniform(0.40, 0.48)

    # A few sine lobes give the coast an irregular shape rather than an oval.
    lobes = [(rng.uniform(0, math.tau), rng.uniform(0.06, 0.16), rng.randint(2, 5))
             for _ in range(3)]

    for y in range(HEIGHT):
        for x in range(WIDTH):
            ang = math.atan2((y - cy) / ry, (x - cx) / rx)
            wobble = sum(a * math.sin(k * ang + ph) for ph, a, k in lobes)
            d = math.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2) - wobble
            if d < 0.52:
                grid[y][x] = JUNGLE
            elif d < 0.80:
                grid[y][x] = SAND
            elif d < 1.0:
                grid[y][x] = SHALLOW
            else:
                grid[y][x] = DEEP

    # Interior clutter: dense trees, a palm belt, an outcrop of rock, high ground.
    for y in range(HEIGHT):
        for x in range(WIDTH):
            if grid[y][x] == JUNGLE and rng.random() < 0.20:
                grid[y][x] = TREE

    hx, hy = _random_tile(grid, rng, JUNGLE) or (int(cx), int(cy))
    for y in range(hy - 1, hy + 2):
        for x in range(hx - 2, hx + 3):
            if 0 <= x < WIDTH and 0 <= y < HEIGHT and grid[y][x] in (JUNGLE, TREE):
                grid[y][x] = HILL if rng.random() < 0.75 else ROCK

    return grid


def _random_tile(grid, rng, want) -> tuple[int, int] | None:
    spots = [(x, y) for y in range(HEIGHT) for x in range(WIDTH) if grid[y][x] == want]
    return rng.choice(spots) if spots else None


def _clear_around(grid, x, y, radius=1):
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            nx, ny = x + dx, y + dy
            if 0 <= nx < WIDTH and 0 <= ny < HEIGHT and grid[ny][nx] in (TREE, PALM, ROCK):
                grid[ny][nx] = JUNGLE if grid[ny][nx] != ROCK else JUNGLE


def _place_sites(grid, rng: random.Random) -> tuple[dict, dict]:
    """Scatter the camp and the resource sites, keeping them apart."""
    inland = [(x, y) for y in range(HEIGHT) for x in range(WIDTH)
              if grid[y][x] in (JUNGLE, TREE, HILL)]
    shore = [(x, y) for y in range(HEIGHT) for x in range(WIDTH) if grid[y][x] == SAND]
    if not inland or not shore:
        raise RuntimeError("degenerate island")

    chosen: dict[str, tuple[int, int]] = {}
    min_gap = 5.0

    def pick(pool, gap=min_gap):
        best, best_score = None, -1
        for _ in range(400):
            c = rng.choice(pool)
            if chosen:
                near = min(math.dist(c, p) for p in chosen.values())
            else:
                near = 99
            if near >= gap:
                return c
            if near > best_score:
                best, best_score = c, near
        return best

    # Camp goes on the beach — where the supply crate came ashore.
    chosen["camp"] = pick(shore)

    names = list(CORE_SITES)
    names += rng.sample(OPTIONAL_SITES, rng.randint(0, 2))

    for name in names:
        _, _, terrain = SITE_TEMPLATES[name]
        pool = shore if terrain == "shore" else inland
        spot = pick(pool)
        if spot:
            chosen[name] = spot

    landmarks: dict[str, dict] = {}
    harvest: dict[str, list[str]] = {}

    for name, (x, y) in chosen.items():
        if name == "camp":
            grid[y][x] = CAMP
            _clear_around(grid, x, y, 2)
            for dy in range(-1, 2):
                for dx in range(-1, 2):
                    if 0 <= x + dx < WIDTH and 0 <= y + dy < HEIGHT and grid[y + dy][x + dx] == SAND:
                        grid[y + dy][x + dx] = CAMP
            landmarks[name] = {"pos": (x, y),
                               "desc": "the beach where the supply crate washed up — "
                                       "the camp, the stores, and anything you build"}
            continue

        items, desc, _ = SITE_TEMPLATES[name]
        _clear_around(grid, x, y, 1)
        # Dress the site so it reads on the map.
        if name == "spring":
            grid[y][x] = SPRING
            if x + 1 < WIDTH and grid[y][x + 1] not in (DEEP, SHALLOW):
                grid[y][x + 1] = SPRING
        elif name in ("palm grove",):
            for dy in range(-2, 3):
                for dx in range(-2, 3):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < WIDTH and 0 <= ny < HEIGHT and grid[ny][nx] == JUNGLE and rng.random() < 0.5:
                        grid[ny][nx] = PALM
        elif name in ("tidepools", "the scree"):
            for dy in range(-1, 2):
                for dx in range(-1, 2):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < WIDTH and 0 <= ny < HEIGHT and rng.random() < 0.45 \
                            and grid[ny][nx] in (SAND, JUNGLE):
                        grid[ny][nx] = ROCK
        elif name in ("the wreck", "the drift"):
            grid[y][x] = WRECK
        elif name == "woods":
            for dy in range(-2, 3):
                for dx in range(-2, 3):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < WIDTH and 0 <= ny < HEIGHT and grid[ny][nx] == JUNGLE and rng.random() < 0.55:
                        grid[ny][nx] = TREE

        anchor = _nearest_walkable(grid, x, y)
        landmarks[name] = {"pos": anchor, "desc": desc}
        harvest[name] = list(items)

    # A lookout, if there's high ground.
    high = [(x, y) for y in range(HEIGHT) for x in range(WIDTH) if grid[y][x] == HILL]
    if high:
        lx, ly = rng.choice(high)
        landmarks["lookout"] = {"pos": (lx, ly),
                                "desc": "bare high ground — you can see the whole horizon from up there"}

    _ensure_connected(grid, landmarks)
    return landmarks, harvest


def _nearest_walkable(grid, x, y) -> tuple[int, int]:
    if grid[y][x] not in BLOCKED:
        return (x, y)
    for r in range(1, 6):
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                nx, ny = x + dx, y + dy
                if 0 <= nx < WIDTH and 0 <= ny < HEIGHT and grid[ny][nx] not in BLOCKED:
                    return (nx, ny)
    return (x, y)


def _ensure_connected(grid, landmarks):
    """Cut a path from camp to anything the generator walled off."""
    camp = landmarks["camp"]["pos"]
    for name, data in landmarks.items():
        if name == "camp":
            continue
        goal = data["pos"]
        if _bfs(grid, camp, goal):
            continue
        x, y = camp
        gx, gy = goal
        while (x, y) != (gx, gy):
            if x != gx:
                x += 1 if gx > x else -1
            elif y != gy:
                y += 1 if gy > y else -1
            if grid[y][x] in (TREE, PALM, ROCK):
                grid[y][x] = JUNGLE
            elif grid[y][x] == DEEP:
                grid[y][x] = SHALLOW


def _bfs(grid, start, goal) -> bool:
    seen = {start}
    q = deque([start])
    while q:
        cx, cy = q.popleft()
        if (cx, cy) == goal:
            return True
        for dx, dy in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            n = (cx + dx, cy + dy)
            if n in seen or not (0 <= n[0] < WIDTH and 0 <= n[1] < HEIGHT):
                continue
            if grid[n[1]][n[0]] in BLOCKED:
                continue
            seen.add(n)
            q.append(n)
    return False


# --- queries -----------------------------------------------------------------

def walkable(x: int, y: int) -> bool:
    if not (0 <= x < WIDTH and 0 <= y < HEIGHT):
        return False
    return GRID[y][x] not in BLOCKED


def tile(x: int, y: int) -> str:
    if not (0 <= x < WIDTH and 0 <= y < HEIGHT):
        return DEEP
    return GRID[y][x]


def landmark_at(x: float, y: float, radius: float = 2.6) -> str | None:
    best, best_d = None, radius
    for name, data in LANDMARKS.items():
        d = math.dist((x, y), data["pos"])
        if d < best_d:
            best, best_d = name, d
    return best


def describe_position(x: float, y: float) -> str:
    near = landmark_at(x, y, radius=3.2)
    if near:
        return f"at {near}"
    return WALKABLE_LABEL.get(tile(int(round(x)), int(round(y))), "somewhere on the island")


def find_path(start: tuple[int, int], goal: tuple[int, int]) -> list[tuple[int, int]]:
    if start == goal:
        return []
    seen = {start}
    q: deque = deque([(start, [])])
    while q:
        (cx, cy), path = q.popleft()
        for dx, dy in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            nxt = (cx + dx, cy + dy)
            if nxt in seen or not walkable(*nxt):
                continue
            new = path + [nxt]
            if nxt == goal:
                return new
            seen.add(nxt)
            q.append((nxt, new))
    return []


def random_start(rng: random.Random, away_from: list[tuple[float, float]], min_gap=7.0):
    """A walkable spot to wash a survivor ashore, away from the others."""
    spots = [(x, y) for y in range(HEIGHT) for x in range(WIDTH)
             if GRID[y][x] in (SAND, JUNGLE, HILL)]
    rng.shuffle(spots)
    best, best_d = spots[0], -1
    for s in spots:
        d = min((math.dist(s, a) for a in away_from), default=99)
        if d >= min_gap:
            return s
        if d > best_d:
            best, best_d = s, d
    return best


def grid_rows() -> list[str]:
    return ["".join(row) for row in GRID]
