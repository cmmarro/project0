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

# Load a .env if there is one, so the key doesn't have to be exported by hand.
_env = pathlib.Path(__file__).with_name(".env")
if _env.exists():
    for raw in _env.read_text().splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip("'\""))

app = Flask(__name__, static_folder="static", static_url_path="/static")
game = Game()
start(game)


@app.get("/")
def index():
    return send_from_directory("static", "index.html")


@app.get("/api/island")
def island():
    """Static data: the map and its landmarks. Fetched once."""
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


@app.get("/api/config")
def get_config():
    return jsonify({
        "settings": settings.public(),
        "online": game.brain.online,
        "backend": game.brain.model,
        "error": game.brain.last_error,
    })


@app.post("/api/config")
def set_config():
    settings.update(request.get_json(silent=True) or {})
    error = game.brain.reconfigure()
    return jsonify({
        "settings": settings.public(),
        "online": game.brain.online,
        "backend": game.brain.model,
        "error": error or game.brain.last_error,
    })


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


@app.post("/api/say")
def say():
    data = request.get_json(silent=True) or {}
    result = game.player_says(data.get("text", ""))
    result["state"] = game.snapshot()
    return jsonify(result)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    url = f"http://127.0.0.1:{port}"
    backend = game.brain.model if game.brain.online else "not set up yet — pick one in the browser"

    print("\n  ---------------------------------------------")
    print("   Castaway is running.")
    print(f"   Open this in your browser:  {url}")
    print(f"   Survivors are played by:    {backend}")
    print("   Press Ctrl+C here to stop.")
    print("  ---------------------------------------------\n")

    # Pop the browser open so nobody has to copy a URL. ISLAND_NO_BROWSER=1 to skip.
    if os.environ.get("ISLAND_NO_BROWSER") != "1":
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()

    app.run(host="127.0.0.1", port=port, threaded=True, debug=False)
