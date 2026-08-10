"""Castaway — a small island, two survivors driven by Claude, and one raft that seats two.

Run:  pip install -r requirements.txt
      export ANTHROPIC_API_KEY=...        (optional; without it the NPCs run on canned lines)
      python server.py
"""

from __future__ import annotations

import logging
import os
import pathlib
import threading
import webbrowser

import flask.cli
from flask import Flask, jsonify, request, send_from_directory

# This is a single-player game on localhost, so the dev-server banner and a log
# line for every poll are just noise in the window the player is looking at.
flask.cli.show_server_banner = lambda *a, **k: None
logging.getLogger("werkzeug").setLevel(logging.WARNING)

from island import providers, settings, world
from island.state import Game, start
from lab.lab import Lab
from lab.lab import start as start_lab
from lab.mind import Mind

# Load a .env if there is one, so the key doesn't have to be exported by hand.
_env = pathlib.Path(__file__).with_name(".env")
if _env.exists():
    for raw in _env.read_text().splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip("'\""))

app = Flask(__name__, static_folder="static", static_url_path="/static")

# Both worlds are built on demand. Opening the start screen to change a setting
# shouldn't spin up an island simulation, still less set a castaway thinking.
_game: Game | None = None
_lab: Lab | None = None
_boot = threading.Lock()


def game_() -> Game:
    global _game
    with _boot:
        if _game is None:
            _game = Game()
            start(_game)
        return _game


def lab_() -> Lab:
    global _lab
    with _boot:
        if _lab is None:
            _lab = Lab()
            start_lab(_lab)
        return _lab


class _GameProxy:
    """So every island route below can go on saying `game.…` unchanged."""

    def __getattr__(self, name):
        return getattr(game_(), name)


game = _GameProxy()


@app.get("/")
def index():
    return send_from_directory("static", "start.html")


@app.get("/island")
def island_page():
    return send_from_directory("static", "index.html")


@app.get("/lab")
def lab_page():
    return send_from_directory("static", "lab.html")


@app.get("/api/island")
def island():
    """Static data: the map and its landmarks. Fetched once.

    Reads module-level world state, which only exists once an island has been
    generated — so this has to be the thing that boots one, not a route that
    quietly returns an empty map.
    """
    game_()
    return jsonify({
        "width": world.WIDTH,
        "height": world.HEIGHT,
        "rows": world.grid_rows(),
        "landmarks": {n: {"x": d["pos"][0], "y": d["pos"][1], "desc": d["desc"]}
                      for n, d in world.LANDMARKS.items()},
        "harvest": world.HARVEST,
        "labels": world.ITEM_LABEL,
    })


@app.get("/api/state")
def state():
    x, y = request.args.get("x", type=float), request.args.get("y", type=float)
    if x is not None and y is not None:
        game.move_player(x, y)
    return jsonify(game.snapshot())


@app.post("/api/act")
def act():
    data = request.get_json(silent=True) or {}
    msg = game.player_act(data.get("action", ""), data.get("target", ""))
    return jsonify({"message": msg, "state": game.snapshot()})


def _backend_status(error: str | None = None) -> dict:
    if _game is not None:
        return {"settings": settings.public(), "online": _game.brain.online,
                "backend": _game.brain.model,
                "error": error or _game.brain.last_error}
    try:
        p = providers.build(settings.get())
        return {"settings": settings.public(), "online": p is not None,
                "backend": getattr(p, "label", "offline"), "error": error}
    except Exception as exc:
        return {"settings": settings.public(), "online": False,
                "backend": "offline", "error": error or str(exc)}


@app.get("/api/config")
def get_config():
    return jsonify(_backend_status())


@app.post("/api/config")
def set_config():
    settings.update(request.get_json(silent=True) or {})
    error = None
    # Only re-point a world that already exists; changing a setting is not a
    # reason to start one.
    if _game is not None:
        error = _game.brain.reconfigure()
    if _lab is not None and _lab.mind is not None:
        _lab.mind = Mind()
    return jsonify(_backend_status(error))


@app.post("/api/config/models")
def list_models():
    """Ask a backend what it has loaded, without committing to it."""
    probe = dict(settings.get())
    probe.update({k: v for k, v in (request.get_json(silent=True) or {}).items()
                  if k in settings.DEFAULTS and not (k == "api_key" and v in ("", settings.MASK))})
    try:
        provider = providers.build(probe)
        if provider is None:
            return jsonify({"models": [], "error": "offline"})
        return jsonify({"models": provider.list_models(), "error": None})
    except Exception as exc:
        return jsonify({"models": [], "error": f"{type(exc).__name__}: {exc}"})


@app.post("/api/config/test")
def test_config():
    """Actually call the model, so 'connected' means connected."""
    probe = dict(settings.get())
    probe.update({k: v for k, v in (request.get_json(silent=True) or {}).items()
                  if k in settings.DEFAULTS and not (k == "api_key" and v in ("", settings.MASK))})
    try:
        provider = providers.build(probe)
        if provider is None:
            return jsonify({"ok": False, "message": "Provider is set to offline."})
        return jsonify({"ok": True, "message": provider.ping()})
    except Exception as exc:
        return jsonify({"ok": False, "message": str(exc)})


@app.post("/api/restart")
def restart():
    """New island, new cast, same backend settings."""
    global _game
    with _boot:
        _game = Game()
        start(_game)
        return jsonify({"ok": True, "seed": _game.seed})


# --- the lab -----------------------------------------------------------------

@app.get("/api/lab")
def lab_state():
    return jsonify(lab_().snapshot())


@app.post("/api/lab/mind")
def lab_mind():
    want = bool((request.get_json(silent=True) or {}).get("on"))
    lab = lab_()
    with lab.lock:
        if not want:
            lab.mind = None
            lab.note("The mind is switched off. Ties break on a weighted coin.", "system")
            return jsonify(lab.snapshot())
        mind = Mind()
        if not mind.online:
            return jsonify({"error": "No backend configured. Pick one on the start "
                                     "screen, then switch the mind on."})
        lab.mind = mind
        lab.note("The mind is switched on. It is asked only when two options "
                 "weigh the same.", "system")
    return jsonify(lab.snapshot())


@app.post("/api/lab/supply")
def lab_supply():
    d = request.get_json(silent=True) or {}
    lab = lab_()
    with lab.lock:
        lab.set_supply(d.get("key", ""), bool(d.get("on")))
    return jsonify(lab.snapshot())


@app.post("/api/lab/offer")
def lab_offer():
    d = request.get_json(silent=True) or {}
    lab = lab_()
    with lab.lock:
        made = lab.offer(d.get("do", ""), d.get("gives", ""),
                         d.get("said", "").strip()[:200] or "Do that, and you eat.")
    return jsonify({**lab.snapshot(), "made": made is not None})


@app.post("/api/lab/honour")
def lab_honour():
    d = request.get_json(silent=True) or {}
    lab = lab_()
    with lab.lock:
        lab.honour(bool(d.get("keep", True)))
    return jsonify(lab.snapshot())


@app.post("/api/lab/auto")
def lab_auto():
    d = request.get_json(silent=True) or {}
    lab = lab_()
    with lab.lock:
        lab.auto_honour = bool(d.get("on"))
    return jsonify(lab.snapshot())


@app.post("/api/lab/pause")
def lab_pause():
    lab = lab_()
    with lab.lock:
        lab.running = not lab.running
        lab.note("Observation paused." if not lab.running else "Running.", "system")
    return jsonify(lab.snapshot())


@app.post("/api/lab/reset")
def lab_reset():
    global _lab
    with _boot:
        keep = _lab.mind if _lab else None
        _lab = Lab()
        _lab.mind = keep
        start_lab(_lab)
        return jsonify(_lab.snapshot())


@app.post("/api/say")
def say():
    """Say it out loud. Your line lands in the log now; replies arrive when the
    model has them, which on a local backend can be a long few seconds."""
    data = request.get_json(silent=True) or {}
    result = game.player_says(data.get("text", ""), wait=False)
    result["state"] = game.snapshot()
    return jsonify(result)


@app.get("/api/recap")
def recap():
    """What you know, for the player's own think verb."""
    return jsonify(game.player_recap())


@app.get("/api/talk")
def talk_state():
    return jsonify(game.conversation_snapshot())


@app.post("/api/talk")
def talk():
    """Start, continue, or break up a stand-and-talk conversation.

    Everyone in it stays put while it's open — which is the point, and also the
    cost: the clock doesn't stop for a chat.
    """
    data = request.get_json(silent=True) or {}
    what = data.get("do", "say")
    if what == "start":
        return jsonify(game.conversation_start(data.get("who")))
    if what == "invite":
        return jsonify(game.conversation_invite(data.get("who", "")))
    if what == "end":
        return jsonify(game.conversation_end())
    return jsonify(game.conversation_say(data.get("text", "")))


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    url = f"http://127.0.0.1:{port}"
    print("\n  ---------------------------------------------")
    print("   Running. Open this in your browser:")
    print(f"     {url}")
    print("   You'll get a start screen: pick the island or the lab.")
    print("   Press Ctrl+C here to stop.")
    print("  ---------------------------------------------\n")

    # Pop the browser open so nobody has to copy a URL. ISLAND_NO_BROWSER=1 to skip.
    if os.environ.get("ISLAND_NO_BROWSER") != "1":
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()

    app.run(host="127.0.0.1", port=port, threaded=True, debug=False)
