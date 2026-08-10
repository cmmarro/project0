"""Castaway — a small island, two survivors driven by Claude, and one raft that seats two.

Run:  pip install -r requirements.txt
      export ANTHROPIC_API_KEY=...        (optional; without it the NPCs run on canned lines)
      python server.py
"""

from __future__ import annotations

import os
import pathlib

from flask import Flask, jsonify, request, send_from_directory

from island import world
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


@app.post("/api/say")
def say():
    data = request.get_json(silent=True) or {}
    result = game.player_says(data.get("text", ""))
    result["state"] = game.snapshot()
    return jsonify(result)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    banner = "online — " + game.brain.model if game.brain.online else "OFFLINE (no API key; canned dialogue)"
    print(f"\n  Castaway: {banner}")
    print(f"  http://127.0.0.1:{port}\n")
    app.run(host="0.0.0.0", port=port, threaded=True, debug=False)
